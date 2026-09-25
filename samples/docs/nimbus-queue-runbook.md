# Nimbus Queue Runbook

Nimbus Queue is Acme Orbital's internal message broker. It carries telemetry frames from
ground stations to the processing cluster and commands in the opposite direction. This
runbook covers architecture, alerts and standard recovery procedures.

## Architecture

A Nimbus cluster has three broker nodes and uses Raft for leader election. Each topic is
split into partitions, and every partition has one leader and two followers. Producers
write to the partition leader; a write is acknowledged once a majority of replicas (two of
three) have persisted it.

Messages are retained for 72 hours by default. The `telemetry.raw` topic is the exception:
it keeps 7 days of data because the reprocessing jobs replay it after decoder upgrades.

Consumers track their position with offsets stored in the internal `__nimbus_offsets` topic.
A consumer group rebalances whenever a member joins, leaves or misses three heartbeats.

## Key Metrics

- `nimbus_queue_depth`: messages waiting per partition. Normal is under 5,000.
- `nimbus_consumer_lag_seconds`: how far behind real time a consumer group is.
- `nimbus_isr_size`: in-sync replicas per partition. Anything below 3 means a follower
  has fallen behind.
- `nimbus_leader_elections_total`: should be close to zero outside of deploys.

## Alerts

### NimbusConsumerLagHigh

Fires when `nimbus_consumer_lag_seconds` exceeds 120 seconds for five minutes on any
production consumer group.

1. Check whether the consumer group is still rebalancing with `nimbusctl group describe <group>`.
   Repeated rebalances usually mean a consumer is crashing on a malformed message.
2. If one partition is lagging while the rest are healthy, look for a poison message:
   `nimbusctl partition peek <topic> <partition> --at-offset <committed offset>`.
3. Poison messages are moved to the dead-letter topic with
   `nimbusctl dlq move <topic> <partition> <offset>`. Never skip them by resetting offsets
   by hand: that silently drops every message in between.
4. If all partitions lag evenly, the consumers are simply too slow. Scale the deployment;
   the maximum useful number of consumers equals the number of partitions.

### NimbusUnderReplicated

Fires when `nimbus_isr_size` is below 3 for more than ten minutes.

1. Identify the lagging follower with `nimbusctl cluster status`.
2. Check the node's disk usage. Brokers stop replicating when a disk passes 90 percent.
3. If the disk is healthy, restart the follower process. Do not restart the leader for
   the affected partitions: a leader restart triggers an election and a short write outage.

### NimbusSplitBrainSuspected

Fires if two nodes report themselves as leader for the same partition. This is a SEV1.
Page the storage team immediately and do not run any `nimbusctl` write commands until
they respond.

## Procedures

### Rolling Restart

Restart followers first, one at a time, waiting until `nimbus_isr_size` returns to 3 before
moving on. Restart the current Raft leader last, after moving leadership away with
`nimbusctl leader transfer --to <node>`. A full rolling restart takes about 25 minutes.

### Adding Partitions

Partitions can be added to a topic but never removed. Adding partitions changes which
partition a key maps to, so ordering is only guaranteed for messages produced after the
change. Coordinate with the owning team before increasing partitions on any topic that
relies on per-key ordering, such as `commands.uplink`.

### Disaster Recovery

Nimbus data is mirrored every five minutes to a standby cluster in the secondary region.
The recovery point objective is therefore five minutes and the recovery time objective is
30 minutes. Failover is manual and requires sign-off from the incident commander.

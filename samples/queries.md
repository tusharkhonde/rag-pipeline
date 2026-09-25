# Example queries

Questions over the sample documents in `samples/docs/` (fictional content, so the model cannot
answer from its training data) and the behaviour to expect.

| Question | Expected behaviour |
|---|---|
| How do I roll back a bad deploy, and does it need approval? | `launchpad rollback --to previous`, no approval needed; cites *Handbook › Deploys › Rollback* |
| When are production deploys allowed? | Tuesday–Thursday, 09:00–16:00 UTC, not during critical passes |
| What automatically stops a canary rollout? | Uplink error rate > 0.5 % or p99 command latency > 800 ms |
| How long does the message broker retain messages? | 72 hours; `telemetry.raw` keeps 7 days. Note the question never says "Nimbus": retrieved via semantic similarity |
| NimbusUnderReplicated | Exact identifier: keyword search finds the heading that vector search misses; hybrid ranks it first |
| How should I deal with a poison message? | Move it to the dead-letter topic with `nimbusctl dlq move`; never reset offsets by hand |
| Which satellite commands need a second operator? | Orbit or power configuration changes, countersigned within five minutes |
| What is the CEO of Acme Orbital paid? | Refusal: "I don't know based on the provided documents." (sources are retrieved but don't contain it) |
| Which cloud provider hosts the Nimbus cluster? | Refusal |

Try the same question with `"mode": "vector"`, `"keyword"` and `"hybrid"` on
`POST /collections/:id/search` to compare retrievers; `scripts/eval.sh` does this for the whole dataset.

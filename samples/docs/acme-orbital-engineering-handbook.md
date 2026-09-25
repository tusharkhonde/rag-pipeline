# Acme Orbital Engineering Handbook

Acme Orbital builds ground-station software for small-satellite operators. This handbook
describes how the platform engineering group ships, operates and supports that software.
It is the source of truth when it conflicts with older wiki pages.

## Working Hours and Communication

Engineering runs on a core-hours model. Everyone is expected to be reachable between
10:00 and 15:00 in their local time zone; outside those hours, asynchronous communication
is the default. Decisions that affect more than one team are written up as a short design
note in the `#eng-decisions` channel and left open for comment for at least two business days.

Meetings without an agenda may be declined. Recurring meetings are reviewed every quarter
and cancelled if nobody can say what decision they produced in the last month.

## Code Review

Every change to a production repository requires one approving review from a code owner.
Changes touching the telemetry decoder, the command uplink path or authentication require
two approvals, one of which must come from the Flight Safety guild.

Reviewers should respond within one business day. If a pull request has waited longer than
that, the author may ask in `#eng-review` and tag the on-call reviewer for the week.

Pull requests should stay under 400 changed lines. Larger changes must be split, or come
with a written explanation of why they cannot be, and are reviewed synchronously on a call.

## Deploys

Acme Orbital deploys from the `main` branch using the Launchpad pipeline. Every merge to
`main` produces a signed container image and deploys automatically to the staging
environment, called Sandbox.

### Production Deploy Windows

Production deploys happen Tuesday through Thursday between 09:00 and 16:00 UTC. There are
no production deploys on Mondays, Fridays, weekends, or during a satellite pass that the
operations calendar marks as critical. The freeze calendar is published by the Mission
Operations team every Friday for the following week.

An emergency deploy outside the window requires approval from the incident commander and
must be recorded in the incident timeline.

### Canary Releases

Production deploys roll out in three phases: 5 percent of ground stations for 30 minutes,
then 25 percent for one hour, then 100 percent. Launchpad halts the rollout automatically
if the uplink error rate rises above 0.5 percent or p99 command latency exceeds 800
milliseconds during any phase.

### Rollback

To roll back, run `launchpad rollback --to previous` from the release channel. Rollbacks
do not need approval and should be the first response to any regression discovered during
a canary phase. A rollback must be followed by a written note in `#eng-releases` within
one hour explaining what was rolled back and why.

Database migrations are never rolled back automatically. Every migration must be backward
compatible with the previous release for at least one deploy cycle, which is what makes
code rollbacks safe.

## On-Call

Each team runs a weekly on-call rotation that starts on Wednesday at 10:00 UTC. Handover
happens on a 15-minute call where the outgoing engineer walks through open incidents,
silenced alerts and anything unusual in the past week.

On-call engineers must acknowledge a page within 10 minutes during a critical pass window
and within 30 minutes otherwise. Engineers receive a stipend of 400 credits per on-call week
plus one day of time off for every night in which they were paged after 23:00 local time.

## Incident Severity

- **SEV1**: loss of command uplink to any satellite, or data loss. Incident commander
  assigned immediately; status updates every 30 minutes.
- **SEV2**: degraded telemetry or a failed pass for a single customer. Updates every hour.
- **SEV3**: internal tooling outage with no customer impact. Handled in business hours.

Every SEV1 and SEV2 incident gets a blameless postmortem, published within five business
days. Postmortems list contributing factors rather than a single root cause, and every
action item has an owner and a due date.

## Security Practices

Production credentials are issued through the Vaultkeeper service and expire after eight
hours. Long-lived API keys are not allowed in production; service-to-service calls use
short-lived tokens obtained with the client-credentials flow.

Laptops must use full-disk encryption, and SSH access to ground-station hardware is only
possible through the bastion host `jump.acme-orbital.internal` with a hardware security key.

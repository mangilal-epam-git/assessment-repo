# Runbook: disaster recovery drill

Rehearsing the procedures in
[14 Disaster recovery](../architecture/14-disaster-recovery.md) and producing
the evidence an auditor will ask for.

A drill that is not documented did not happen.

## Schedule

| Drill | Frequency | Environment | Duration |
| --- | --- | --- | --- |
| Task kill | Weekly, automated | Production | Minutes |
| AZ evacuation | Monthly | Staging | 1 hour |
| Database restore | Monthly | Scratch | 2 hours |
| Regional failover | Quarterly | Staging | 4 hours |
| Pricing rollback | Quarterly | Staging | 30 minutes |
| Account rebuild from Git | Annually | Isolated account | 1 day |

## Before any drill

Announce the window. Confirm the on-call engineer knows it is a drill, so a
real incident during the window is not mistaken for one. Record the starting
state: versions deployed, configuration versions serving, task counts.
Agree the abort criterion in advance — the condition under which you stop
and restore rather than pressing on.

## Drill 1 — Task kill (weekly, automated)

```bash
TASK=$(aws ecs list-tasks --cluster "$CLUSTER" --service-name "$SERVICE" \
  --query 'taskArns[0]' --output text)
aws ecs stop-task --cluster "$CLUSTER" --task "$TASK" --reason "weekly DR drill"
```

| Measure | Target |
| --- | --- |
| Failed client requests | 0 |
| Time to replacement task in service | < 90 s |
| Alert fired and cleared | Yes |

Zero failed requests is the real test: it proves deregistration delay and
graceful shutdown are working together.

## Drill 2 — AZ evacuation (monthly)

Simulate by removing one subnet from the service's network configuration, or
by scaling tasks in one AZ to zero.

| Measure | Target |
| --- | --- |
| Availability during evacuation | 100% |
| p99 latency increase | < 50% |
| Capacity restored in surviving AZs | < 3 min |

## Drill 3 — Database restore (monthly)

Restore the most recent snapshot to a scratch instance, run integrity checks,
and verify the most recent transactions are present within the RPO.

| Measure | Target |
| --- | --- |
| Restore duration | Within the tier's RTO |
| Data loss | Within the tier's RPO (5 min for tier 1) |
| Integrity check | Pass |

## Drill 4 — Regional failover (quarterly)

The full procedure from
[14.5 Scenario B](../architecture/14-disaster-recovery.md#scenario-b--regional-failure),
run in staging, timed at each step.

1. Simulate the primary region failing.
2. On-call confirms scope and declares (target T+8).
3. Promote the replica (T+12).
4. Scale the standby to production capacity (T+15).
5. Shift DNS (T+18).
6. Verify (T+20).

Verification is not optional and has two mandatory steps:

```bash
BASE_URL="$NEW_ENDPOINT" npm run smoke
curl -s "$NEW_ENDPOINT/best-offers" | jq '{fxVersion, marginVersion}'
```

The second checks that the configuration versions match the primary's last
known-good state. Restoring availability while serving stale prices would be
the worst possible outcome for this company, and it is an easy mistake to
make when the focus is on getting traffic flowing.

| Measure | Target |
| --- | --- |
| Total RTO | < 30 min |
| Data loss | < 5 min |
| Smoke test | Pass |
| Configuration versions correct | Exact match |

Then fail back, and time that too. Failback is the half everyone skips and
the half that surprises you.

## Drill 5 — Pricing rollback (quarterly)

1. Apply a deliberately wrong margin in staging.
2. Detect it — ideally the alert finds it before you announce it.
3. Roll back per [pricing-change.md](pricing-change.md#rollback).
4. Query the audit records to identify exactly which responses used the bad
   version.

| Measure | Target |
| --- | --- |
| Time to roll back | < 2 min |
| Blast-radius query returns an exact set | Yes |
| Recomputed correct prices match expectation | Exactly |

The third measure is the point of the drill. It rehearses the remediation
path that the group's legal history makes necessary.

## Drill 6 — Account rebuild (annual)

The hardest drill, in an isolated account.

```bash
cd infrastructure/aws
terraform init -backend-config=environments/drill.backend.hcl
terraform apply -var-file=environments/drill.tfvars
# Push images, restore tier 0 and tier 1 data from cross-account backups
BASE_URL="$(terraform output -raw service_url)" npm run smoke
```

| Measure | Target |
| --- | --- |
| Total RTO | < 24 h |
| Manual steps outside Terraform | Documented, and reduced each year |
| Data restored within tier RPOs | Yes |

This drill tests the claim that no infrastructure exists outside Terraform.
It usually finds something — a manually created DNS record, a console-clicked
certificate — and finding it during a drill is the entire point.

## Evidence to capture, every time

| Item | Note |
| --- | --- |
| Date, participants, scenario | Who was there matters for the next drill |
| Start and end times per step | Measured, not estimated |
| Measured RTO and RPO against target | With the deviation if any |
| Screenshots or command output | Primary evidence |
| Issues found | Each with an owner and a due date |
| Improvements identified | Fed into the backlog |

Store with the quarter's compliance evidence. Deviations become tracked work
items; a drill that finds nothing in a system this new is more likely a drill
that was not ambitious enough than a system that is perfect.

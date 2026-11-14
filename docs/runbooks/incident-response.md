# Runbook: incident response

Every alert in [11.3](../architecture/11-observability.md#113-alerts) maps to
a section here.

## First five minutes, any alert

1. Acknowledge, so the escalation stops.
2. Check the dashboard: traffic, errors, latency, capacity, provider health.
3. Decide **scope**: all requests, one provider, one product, or one tenant?
4. Check recent changes: deployments, configuration reloads, provider
   notifications.
5. If customer-visible for more than five minutes, declare an incident and
   appoint a commander.

```bash
# Is the service alive and what is it serving?
curl -s "$BASE_URL/readyz" | jq
# Provider health and rejection reasons, at a glance
curl -s "$BASE_URL/metrics" | grep -E 'vh_provider|vh_rows_rejected|vh_partial'
# Full contract check against a live instance
BASE_URL="$BASE_URL" npm run smoke
```

## Unhealthy targets

**Alert:** any unhealthy target for 3 minutes.

Readiness is failing, so either the service cannot start or it is shutting
down. Check whether a deployment is in progress — the circuit breaker should
roll back automatically. Check the task logs for `server.start.failed`, which
almost always means invalid configuration or an unreachable config path.
Check that the pricing configuration parameter is readable by the task role.

If a deployment is rolling back, let it finish; forcing another deployment
mid-rollback extends the outage.

## Elevated 5xx

**Alert:** more than 5 per minute for 3 of 5 minutes.

Distinguish the two causes immediately:

```bash
curl -s "$BASE_URL/metrics" | grep vh_provider_unavailable_total
```

If providers are failing, this is `ALL_PROVIDERS_UNAVAILABLE` and the service
is behaving correctly — go to [Provider outage](#provider-outage). If
providers are healthy, look for `http.unhandled_error` in the logs and treat
it as a code defect: roll back to the previous task definition.

```bash
aws ecs update-service --cluster "$CLUSTER" --service "$SERVICE" \
  --task-definition "$PREVIOUS_TASK_DEF" --force-new-deployment
```

## Elevated latency

**Alert:** p99 above 1 s for 3 of 5 minutes.

Check `vh_provider_request_duration_seconds` by provider first; a slow
provider is the usual cause and the per-attempt timeout bounds it. Check
`vh_http_in_flight_requests` and `vh_rejected_load_total` for saturation, and
confirm autoscaling is not at its ceiling.

If one provider is consistently slow and recovery is not imminent, reducing
`PROVIDER_TIMEOUT_MS` makes the service fail fast to a partial result rather
than waiting — a deliberate trade of completeness for latency. This requires
a new task definition.

## Provider outage

**Alert:** more than 10 provider-unavailable events in 5 minutes.

The service is already degrading correctly: partial results, the provider
named in `unavailableProviders`, the other provider still ranked.

1. Confirm which provider, and the cause: `grep provider.unavailable` and
   read the `cause` field (`TIMEOUT`, `HTTP_STATUS`, `NETWORK_ERROR`,
   `INVALID_JSON`, `NOT_AN_ARRAY`).
2. `INVALID_JSON` or `NOT_AN_ARRAY` means the provider is serving a broken
   body. This will not self-heal and is not retried; escalate to the provider
   immediately.
3. If unavailable for more than 15 minutes, notify affected customers that
   comparisons are partial.
4. Record the outage against the provider's standing score — availability is
   part of certification.

Do **not** attempt to substitute cached or historical offers. That is
prohibited, and it is the specific conduct the group has settled a lawsuit
over.

## Configuration reload rejected

**Alert:** any occurrence.

The service is safe: the previous snapshot is still serving. The danger is
human — someone believes a price change is live when it is not.

1. Confirm what is actually serving:
   ```bash
   curl -s "$BASE_URL/best-offers" | jq '{fxVersion, marginVersion}'
   ```
2. Find the rejection reason in the logs (`config.reload.rejected` carries a
   `problems` array; `config.reload.unreadable` means the file could not be
   parsed).
3. **Tell whoever made the change.** They are the one operating on a false
   belief.
4. Fix the document and reload. See
   [Pricing configuration change](pricing-change.md).

Most common causes: an FX rate written as a JSON number instead of a decimal
string, a missing base-currency entry, or a base-currency rate that is not
exactly 1.

## Load shedding

**Symptom:** `vh_rejected_load_total` rising, clients seeing 503 with
`Retry-After: 1`.

The concurrency limiter is working as designed. Determine whether the traffic
is legitimate — check WAF metrics for a rate-limit spike and look at the
source IP distribution.

If legitimate, confirm autoscaling is scaling and check whether it is at the
ceiling; raise `service_max_capacity` through Terraform if the new baseline
is real.

If it is an attack, tighten the WAF rate limit, and in a severe case restrict
`allowed_ingress_cidrs` to the known customer ranges of the current cohort.
Accept the shedding rather than scaling indefinitely; the cost ceiling is a
deliberate decision, not an oversight
([9.4](../architecture/09-threat-model.md#94-ddos-posture)).

## No traffic

**Alert:** fewer than 1 request per 5 minutes, 3 periods.

Almost always an edge problem rather than a service problem. Check DNS
resolution, the load balancer's own health, WAF rules for an over-broad
block, and whether a recent `allowed_ingress_cidrs` change locked everyone
out.

## Suspected pricing error

The most serious incident class for this platform. Treat it as an incident
even if availability is perfect.

1. **Stop the spread.** If a bad configuration is live, restore the previous
   file and reload. The service keeps serving throughout.
2. **Establish the blast radius** from the audit ledger. Every response
   records `fxVersion`, `marginVersion` and `asOf`, so the affected set is a
   query, not an estimate.
3. **Recompute** the correct prices from the recorded inputs. The ranking
   function is pure and deterministic, so this is exact.
4. **Remediate commercially**: reissue or credit affected orders.
5. **Notify** legal and finance. Given the group's history, a pricing error
   has reporting implications beyond the technical fix.
6. **Record** everything in the audit ledger.

Full procedure in
[14.5 Scenario C](../architecture/14-disaster-recovery.md#scenario-c--data-corruption-or-bad-pricing-configuration).

## Suspected cross-tenant access

Zero-tolerance. Treat as a security incident from the first alert: preserve
logs, engage security, do not restart the affected tasks (that destroys
in-memory evidence), and follow the security incident process rather than
this runbook.

## After every incident

A blameless postmortem within five working days covering timeline, root
cause, why detection took as long as it did, and what makes recurrence less
likely. Add an alert or a test for anything that was noticed by a human
before it was noticed by monitoring.

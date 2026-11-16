# ADR-0006: Bounded retries with full jitter and a total deadline

- **Status:** Accepted
- **Date:** 2026-11-14
- **Deciders:** Platform engineering, SRE

## Context

The ranking service fans out to provider endpoints on every request. Those
endpoints are operated by third parties, including recently acquired
subsidiaries, with varying reliability. The brief requires predictable
cancellation, timeouts and shutdown, and prohibits substituting stale cached
offers.

A sister product recently suffered a major DDoS incident, which makes retry
amplification a specific concern: naive retries turn a provider's bad minute
into our outage.

## Options considered

### Option A — No retries

Simplest and safest for the provider. Rejected: a single transient 503 would
degrade every concurrent request to partial, which is a visibly worse product
for an entirely recoverable failure.

### Option B — Fixed-interval retries

Easy to reason about, but synchronises retries across replicas. When a
provider degrades, every task retries at the same instants, producing a
thundering herd that prevents recovery.

### Option C — Exponential backoff with equal jitter

Good. Spreads retries while keeping a minimum delay.

### Option D — Exponential backoff with full jitter, plus a total budget

Each delay is drawn uniformly from `[0, cappedExponentialDelay]`, and the
whole operation is bounded by a wall-clock budget independent of attempt
count. Full jitter produces the best decorrelation across clients; the
budget is what bounds tail latency.

## Decision

**Option D**, implemented in `src/best-offers/retry.js`:

| Parameter | Default | Rationale |
| --- | --- | --- |
| `maxAttempts` | 3 | Two retries covers transient faults; more is amplification |
| `initialDelayMillis` | 100 | Below typical provider recovery time |
| `maxDelayMillis` | 1000 | Caps any single wait |
| `backoffMultiplier` | 2 | Conventional |
| `totalBudgetMillis` | 5000 | Bounds worst-case work per request |
| Per-attempt timeout | 2000 ms | A slow provider cannot hold our capacity |
| Request deadline | 10 000 ms | Independent upper bound on the whole request |

### Retryability rules

Retried: network errors, timeouts, HTTP 408, 425, 429 and 5xx.
**Not** retried: other 4xx, invalid JSON, and a non-array body — these are
deterministic faults that will not fix themselves, and retrying them wastes
the budget while adding load.

A `Retry-After` header is honoured when present, capped by `maxDelayMillis`,
because a provider telling us when to come back is better information than
our own backoff curve.

### Cancellation

Retries abort promptly on an `AbortSignal`, which propagates from client
disconnect, request deadline and shutdown. The backoff timer is deliberately
**not** `unref`'d: an unref'd timer lets the event loop drain while a retry is
pending, leaving the caller's promise forever unsettled. This was found by a
test during development, and the comment in the code records why the
unref is absent so it is not "optimised" back in.

## Consequences

**Positive.** Transient provider faults recover invisibly — verified
end-to-end by a test that fails the first attempt and asserts a successful,
non-partial response. Full jitter prevents synchronised retry storms. The
total budget bounds tail latency regardless of attempt count. Cancellation is
prompt, so shutdown and client disconnects do not leak work. Retries are
counted in metrics by provider and cause, so a degrading provider is visible
before it becomes an outage.

**Negative.** Up to three times the load on an already-struggling provider,
bounded by the budget. Worst-case latency rises to roughly 5 seconds before
a provider is declared unavailable. A persistently failing provider is
retried on every request, since there is no cross-request circuit breaker —
the most significant gap, listed in
[22.2](../architecture/22-assumptions-and-gaps.md#known-gaps-in-the-coded-slice).

## Scope

The same policy applies to notification delivery
([17.5](../architecture/17-notifications.md#175-delivery-guarantees)) and
outbound PSP calls. One resilience approach, tested in one place.

## Revisit when

Provider count grows beyond a handful (a circuit breaker becomes necessary),
or a provider's SLA justifies per-provider tuning rather than one global
policy.

## Amendment, 2026-11-16: configurable policy and multiple endpoints

Two requirements arrived after the original decision.

### 1. Several endpoints per provider

A provider may publish mirrors, a failover host or a second region. List them
comma-separated: `PROVIDER_TELEMETRY1_URL=https://a/f,https://b/f`. A single
URL is a list of one, so existing configuration is unchanged.
`PROVIDER_ENDPOINT_STRATEGY` chooses how they are used.

| Strategy | Behaviour | Choose it when |
| --- | --- | --- |
| `failover` (default) | Try in order; the first usable response wins | Mirrors should agree, and speed matters |
| `fan-out` | Query all concurrently; the ranking picks the lowest cost across every usable response | Mirrors may legitimately differ, and a cheaper regional price must not be missed |

Three rules keep this honest.

- **Each endpoint is evaluated separately.** The duplicate-`productId` rule is
  scoped to one provider *response*. Merging two mirrors into one body first
  would make a product quoted by both look self-contradictory and reject it.
- **Staleness still applies per row.** A cheap but stale mirror cannot win, and
  a fresh mirror is still used alongside it.
- **A degraded provider is reported, not hidden.** If some endpoints failed but
  one answered, the result is complete, the provider appears in
  `degradedProviders`, `partial` is true, and
  `vh_provider_endpoint_failover_total` and `vh_provider_degraded_total` move.
  Only when every endpoint fails is the provider `unavailable`.

Retry still applies independently to each endpoint.

### 2. A policy that can change without a deployment

Timing now lives in the hot-reloadable configuration file, versioned like
pricing ([ADR-0007](0007-configuration-snapshots.md)) and validated whole:

```json
"resilienceVersion": "resilience-2026-11-16",
"resilience": {
  "default":   { "strategy": "exponential-full-jitter", "maxAttempts": 3,
                 "initialDelayMillis": 100, "maxDelayMillis": 2000,
                 "totalBudgetMillis": 5000, "perAttemptTimeoutMillis": 2000 },
  "providers": { "telemetry2": { "strategy": "decorrelated-jitter", "maxAttempts": 6 } }
}
```

- **Six named strategies:** `exponential-full-jitter`, `exponential-equal-jitter`,
  `exponential`, `decorrelated-jitter`, `linear`, `fixed`. A new one is one entry
  in `BACKOFF_STRATEGIES` plus its name in the validator.
- **Per-provider overrides inherit from `default`**, so tuning one slow
  provider is one line, not a restated policy.
- **Resolved on every fetch**, so a reload changes behaviour on the next
  request. Verified by a test that reloads the file and observes the attempt
  count move from 1 to 3 per provider.
- **Precedence:** environment variables are the baseline; a `resilience`
  section, when present, overrides them. Absent, nothing changes.
- An invalid section is rejected whole and the previous policy keeps serving,
  as with pricing. Every response reports `resilienceVersion`.

**Trade-off accepted:** fan-out multiplies upstream requests by the endpoint
count, and an aggressive policy multiplies them again. The bounds in the
validator (at most 10 attempts, 300 s budget) exist so a configuration typo
cannot become a self-inflicted denial of service against a provider.


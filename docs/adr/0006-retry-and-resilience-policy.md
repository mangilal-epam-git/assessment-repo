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

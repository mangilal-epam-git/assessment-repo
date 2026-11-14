# ADR-0007: Immutable, versioned configuration snapshots

- **Status:** Accepted
- **Date:** 2026-11-14
- **Deciders:** Solution architecture, pricing governance, legal

## Context

FX rates, the default markup and the quality floor change during normal
operation. The brief requires reading a validated configuration snapshot
once per request, runtime reload without restart, preservation of the last
valid snapshot on a malformed reload, and the snapshot versions returned in
every response.

The legal context adds a harder requirement: it must be possible to prove
which configuration produced a given price, months later.

## Options considered

### Option A — Environment variables, restart to change

Simple and auditable through deployment history. Rejected: a routine FX
update would require a deployment, so rates would be updated less often than
they should be, and an urgent correction would take a deploy cycle.

### Option B — Read configuration per use

Fetch the current value wherever it is needed. Rejected outright: a reload
mid-request could price one product at the old margin and another at the
new, producing a response that is internally inconsistent and impossible to
explain to an auditor.

### Option C — Immutable snapshot, read once per request

Capture a validated, frozen snapshot at the start of each request and use it
throughout. Reloads swap the snapshot atomically; in-flight requests continue
on the snapshot they started with.

## Decision

**Option C.** A `PricingSnapshot` is an immutable, frozen object containing
`fxVersion`, `marginVersion`, the base currency, parsed FX rates, the default
margin in basis points, the precomputed margin multiplier, and the minimum
quality ratio.

| Aspect | Decision |
| --- | --- |
| Read cadence | Exactly once per request, at the start |
| Validation | Whole-document; **all** problems reported, not just the first |
| Invalid reload | Rejected entirely; the previous snapshot stays active |
| Reload triggers | File watch (debounced), `SIGHUP`, and authenticated `POST /admin/config/reload` |
| Version reporting | `fxVersion` and `marginVersion` on every response |
| FX rate type | Decimal **strings**; JSON numbers are rejected |
| Source of truth | The file, so a restart reproduces the last applied configuration |

Validation is all-or-nothing by design. Applying the valid half of a
configuration document would produce a state that exists in no file and that
nobody reviewed.

## Consequences

**Positive.** A price is reproducible from `(inputs, fxVersion,
marginVersion, asOf)` — the central requirement of the legal context. A
mid-request reload can never produce an inconsistent comparison. A bad
configuration publish degrades to "slightly stale rates" rather than "no
marketplace", which makes an out-of-hours FX update a low-risk operation.
Rolling back a bad price takes under two minutes and no deploy.

**Negative.** A reload is not instantaneous for in-flight requests, which is
correct but occasionally surprising. Two sources of truth exist in
production — the file and the cloud parameter store — which must be kept in
step. Operators hold a powerful capability, mitigated by the four-eyes
approval workflow and audit on every attempt.

## Verification

- `test/unit/config.test.js` — validation, version swapping, and that a
  malformed document leaves the active snapshot untouched.
- `test/integration/config-reload.test.js` — a live markup change moves a
  price from 13.16 to 14.35 EUR; a broken file is rejected with HTTP 422 and
  prices do not move.
- `test/integration/config-watch.test.js` — a file edit is picked up without
  a restart; a subsequent broken write leaves the last valid snapshot
  serving.
- `test/integration/golden.test.js` — a mid-service version change is
  reflected in both the price and the reported versions.

A rejected reload also increments `vh_config_reloads_total{outcome="rejected"}`
and raises an alert on a single occurrence, because a human who believes a
price change is live when it is not is exactly how billing disputes begin.

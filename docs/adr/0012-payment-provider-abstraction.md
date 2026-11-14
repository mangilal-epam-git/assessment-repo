# ADR-0012: Payment provider abstraction

- **Status:** Accepted
- **Date:** 2026-11-14
- **Deciders:** Solution architecture, finance, compliance

## Context

The platform must support VISA, MasterCard, AMEX, Apple Pay, Google Pay and
PayPal, assess Bitcoin as an optional capability, and support automatic
currency conversion with a traceable rate snapshot. The brief is explicit:
**do not build a payment processor**, and regulated payment integrations may
be treated as external interfaces and mocked.

## Options considered

### Option A — Integrate one PSP directly throughout the codebase

Fastest to build. Rejected: PSP-specific concepts leak into the order and
pricing domains, a PSP outage becomes a full checkout outage, and
renegotiating or switching providers becomes a rewrite rather than a
commercial decision.

### Option B — A third-party payment orchestration platform

Mature multi-PSP routing as a service. Attractive, but it sits on the
critical path of every transaction, adds a per-transaction fee on top of PSP
fees, and is arguably the kind of turnkey product the brief steers away from
for core commerce flows.

### Option C — A thin internal abstraction over multiple PSPs

One internal payment port; PSP-specific adapters behind it; routing and
failover owned by us.

## Decision

**Option C.** A payment orchestration service exposing a single internal
port — authorise, capture, refund, query — with adapters per provider.

### Scope boundaries

| Concern | Owner |
| --- | --- |
| Card data capture | **The PSP.** Hosted fields or redirect; card data never reaches our infrastructure |
| Tokenisation and vaulting | The PSP |
| 3-D Secure | The PSP |
| Payment intent, idempotency, routing, failover | Us |
| Order state, entitlement, pricing decomposition | Us |
| Reconciliation and the financial ledger | Us |
| FX rate snapshot and version stamping | Us |

The first row is the decision that matters most. Keeping card data entirely
out of our infrastructure holds PCI DSS scope at SAQ-A and makes a cardholder
data breach structurally impossible rather than merely unlikely.

### Reliability

Idempotency keys on every intent, so a client retry cannot double charge.
Webhooks are signature-verified, idempotent and replay-safe, with
reconciliation sweeps catching any webhook that never arrived. Card traffic
fails over to a secondary PSP; wallets and PayPal cannot and degrade to
"temporarily unavailable" with other methods still offered.

### Bitcoin

Assessed in detail in
[16.4](../architecture/16-payments-and-fx.md#164-bitcoin-assessment) and
**not recommended for launch**: probabilistic settlement, volatility
exceeding product margin, no native refunds, materially heavier AML and
licensing obligations, negligible B2B demand, and poor optics immediately
after a fraud settlement.

The abstraction is what keeps that decision cheap to reverse. If a specific
market later requires it, the implementation is a new adapter behind the same
port, using a regulated processor that takes custody and settles to us in
fiat immediately. We would never take custody ourselves.

## Consequences

**Positive.** PCI scope stays at SAQ-A. PSP commercial terms become
negotiable, because switching is an adapter rather than a rewrite. Card
redundancy improves checkout availability. The payment domain stays out of
the pricing and ordering domains, which keeps the auditable pricing chain
clean.

**Negative.** An abstraction over heterogeneous PSPs leaks: dispute
handling, settlement timing and refund semantics differ, and the port must
either expose those differences or hide them imperfectly. Multiple PSP
relationships cost more to maintain commercially and operationally.

**Neutral.** The coded slice contains no payment code at all. It produces
EUR prices with an `fxVersion`, which is exactly the input a checkout flow
consumes — the integration seam is defined even though neither side of it is
built here.

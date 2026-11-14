# ADR-0009: A published provider adapter contract

- **Status:** Accepted
- **Date:** 2026-11-14
- **Deciders:** Solution architecture, partner engineering, data governance

## Context

VectorHarbor grows by acquiring regional device manufacturers, fleet-service
companies and data providers. The brief requires that new subsidiaries can
certify adapters and join the platform **without coupling their internal
systems to its core**.

The default outcome — bespoke integration per subsidiary — makes the core
team a bottleneck and accumulates per-partner special cases that nobody can
safely remove.

## Options considered

### Option A — Bespoke integration per provider

Fastest for the first two providers, catastrophic by the fifth. Integration
velocity becomes a function of core-team capacity, which is precisely the
constraint an acquisition-led strategy cannot afford.

### Option B — Canonical model with core-owned translators

The core owns an adapter per provider. Better than A, since the core model
stays clean, but the core team still writes and maintains N adapters and
still owns every provider's quirks.

### Option C — A published contract that providers adapt to

The platform publishes a stable contract, a conformance suite and a sandbox.
Providers (or acquired subsidiaries) build and own the adapter.

## Decision

**Option C.** The platform publishes:

1. **The Offer contract** — the exact schema in the coding brief, validated
   strictly and closed to unknown fields.
2. **Canonical product definitions** — region, consent scope, schema,
   observation window and permitted use, so comparability is explicit.
3. **Stable reason codes** — every rejection has a machine-readable code with
   published meaning.
4. **A conformance suite and sandbox** — including
   `POST /v1/sandbox/offers:evaluate`, which dry-runs a provider's payload
   through the real ranking pipeline.
5. **Self-service certification** — registration through promotion, without
   core-team involvement.

### Why strict, closed validation is part of the contract

Rejecting unknown fields looks unfriendly, and it is the right default here.
A silently ignored field could be pricing-relevant — a discount, a different
unit, a quality caveat — and a marketplace that quietly drops data it does
not understand cannot defend the prices it derives. Rejection with a specific
reason code is also better feedback than silent acceptance.

### Why identity comes from configuration

A provider never declares its own identity; it is bound to the configured
endpoint. Otherwise a careless or compromised provider could attribute its
offers, and its quality record, to a competitor. Implemented and tested in
the coded slice.

## Consequences

**Positive.** Integration effort moves to the party with the most context
about their own data. Adding a provider becomes configuration, not code —
demonstrated in the slice, where the two providers differ only by URL. Core
maintains one contract rather than N integrations. Rejection feedback is
actionable: "row 3 failed `QUALITY_BELOW_MINIMUM` at 0.80 against a 0.90
floor" needs no meeting.

**Negative.** The contract must be designed well up front, because changing
it later affects every partner. Append-only evolution rules
([15.5](../architecture/15-ma-integration-governance.md#contract-evolution-rules))
constrain future design. Providers who cannot build an adapter need
assistance, which partly reintroduces the cost the decision avoids — hence
the sandbox and reference adapters. Batch-only providers fit awkwardly and
need a staging-buffer adapter plus differently-scoped canonical products.

**Neutral.** The platform cannot accept data it has not modelled. That is a
feature: an unmodelled product is one whose comparability cannot be proven.

## Target

Signed deal to certified adapter in under 30 days, with fewer than five
core-team engineering days per acquisition. If the second number climbs, the
contract is leaking and the fix is in the contract, not in headcount.

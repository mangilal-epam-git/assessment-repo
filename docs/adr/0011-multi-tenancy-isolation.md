# ADR-0011: Four-layer tenant isolation

- **Status:** Accepted
- **Date:** 2026-11-14
- **Deciders:** Solution architecture, security

## Context

The brief requires tenant isolation alongside driver-location privacy and
geofenced residency. Tenants are competing fleet operators; a cross-tenant
disclosure would expose commercial operations to a competitor and would be
reportable.

The platform also hosts acquired subsidiaries acting as both tenants and
providers, which means the isolation model must hold for principals that sit
on both sides of the marketplace.

## Options considered

### Option A — Separate infrastructure per tenant

Perfect isolation, unworkable economics and operations at 10 000 tenants.
Reserved as an option for a small number of customers with contractual
isolation requirements.

### Option B — Shared infrastructure, application-level filtering

Every query filtered by tenant in application code. Rejected as a sole
control: it depends on every developer remembering, forever. One missing
`WHERE tenant_id = ?` is a breach, and that mistake is made routinely in
real systems.

### Option C — Shared infrastructure, defence in depth

Multiple independent layers, each sufficient to prevent cross-tenant access,
such that a bug in one is contained by the others.

## Decision

**Option C**, with four layers that fail closed independently.

| Layer | Mechanism | Failure mode |
| --- | --- | --- |
| **Token** | Short-lived, audience-bound access token carrying a tenant claim | A token without a tenant claim is rejected at the gateway |
| **Service** | Tenant context is a required constructor argument for every repository; there is no ambient default and no "system" tenant | The repository cannot be constructed; the request fails |
| **Database** | PostgreSQL row-level security policies keyed on the session tenant variable | Queries return zero rows rather than another tenant's rows |
| **Storage** | Per-tenant key prefixes and separate encryption-key scopes | Decryption fails rather than yielding readable data |

Cross-tenant access requires defeating all four. The database layer is the
backstop: even a query with no application filter returns nothing, because
RLS is enforced by the engine rather than by the caller.

### Supporting decisions

There is **no system-wide super-tenant**. Operational access to a specific
tenant's data requires an audited break-glass with a stated reason, time
limit and notification. A standing all-tenant credential would quietly become
the thing that is always used.

Tenant context propagates on every internal call and is re-validated at each
hop; a downstream service never trusts an upstream assertion of tenancy.
Cross-tenant aggregates — benchmarks, market statistics — are computed in a
separate pipeline that reads only pre-anonymised, k-anonymity-floored data
and has no access to tenant-scoped stores.

An attempted cross-tenant access is a **security event**, alerted on
immediately, not merely a 403 in a log. At zero expected occurrences, any
occurrence is either a bug worth fixing today or an attack worth responding
to today.

## Consequences

**Positive.** No single mistake causes a breach. The database layer protects
against the most common and most likely error. Isolation is testable at each
layer independently. Dedicated infrastructure remains available for the small
number of customers who contractually require it, without changing the model
for everyone else.

**Negative.** Row-level security carries a query-planning cost, typically
5–15% on tenant-scoped queries, which is acceptable for the protection.
Developers must set the session tenant variable correctly; this is done in
one connection-acquisition helper rather than at call sites. Cross-tenant
analytics needs a genuinely separate pipeline, which is additional
engineering rather than a query flag — correctly so.

**Neutral.** The coded slice has no tenancy, because `/best-offers` in this
exercise is unauthenticated and returns market-wide comparisons that are not
tenant-specific. When authentication lands, tenant scoping applies to
entitlement filtering and to loyalty pricing, not to the ranking itself —
the winner for a canonical product is a property of the market and is
identical for every tenant, which is a deliberate feature of
[ADR-0002](0002-quality-normalised-comparison.md).

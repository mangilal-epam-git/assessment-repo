# ADR-002: Separate user authorization and payment policy from infrastructure

- **Status:** Proposed
- **Date:** 2026-11-13
- **Decision owners:** Security architecture and platform operations

## Context

The platform needs tenant/team/domain access controls and configurable payment-type blocks. Teams and data domains should be onboarded through parameterized infrastructure, while end-user membership and checkout choices change more frequently. Infrastructure state is not an appropriate user directory or payment policy database.

## Decision

Use an OIDC-compatible identity provider for authentication, a durable authorization/policy service for tenant/team/domain access and payment-method rules, and Terraform for team-level infrastructure, workload identities, policy boundaries, and domain resources. Enforce access at every API and data boundary. Keep payment processing with an approved external provider; store only opaque references and statuses. Payment blocks are audited runtime policy decisions, not per-user Terraform resources.

## Consequences

- Adding a new team/domain can be parameterized through reviewed IaC inputs and policy checks.
- Adding/removing individual users does not require infrastructure apply.
- User access and payment restrictions need durable storage, change history, authorization, and audit controls.
- The in-memory demonstration policy in the starter code is not production identity management.
- Bitcoin remains disabled until compliance, legal, settlement, custody, and regional review is complete.

## Alternatives considered

- **Represent all users as Terraform resources:** rejected due to churn, state exposure, and slow policy updates.
- **Trust client-side access checks:** rejected because clients are not an authorization boundary.
- **Build a payment processor:** rejected; use a regulated external interface and avoid card-data handling.

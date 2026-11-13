# User access and payment controls

## User and tenant authorization

The marketplace has distinct user populations: guests, registered fleet customers, dispatchers, maintenance managers, drivers, provider administrators, auditors, pricing approvers, and platform operators. Use an OIDC identity provider for authentication and map identity claims to tenant, team, role, jurisdiction, and permitted data domains. Use server-side authorization on every request and database operation; never trust a client-supplied tenant ID as proof of access.

Apply least privilege and deny by default. Separate provider onboarding, pricing changes, payment administration, and audit review. Require MFA for privileged roles and short-lived workload identities. Log attributable authorization and administration events to a protected audit pipeline, while excluding secrets and unnecessary location details. Review memberships periodically and revoke access promptly when roles change.

The current `AccessPolicyManager` in the starter code is an in-memory demonstration only. It is not durable, authenticated, multi-tenant production IAM and must not be used as such. Production implementation requires an identity provider, persistent policy source, authorization middleware, audit history, and tenant-isolation tests.

## Payment-method restrictions

A payment type is a policy choice (for example, Visa, Mastercard, AMEX, Apple Pay, Google Pay, PayPal, or a separately assessed Bitcoin option). It is not payment data. Evaluate restrictions before checkout and again before redirecting/handing off to the external provider. Policies may be scoped by jurisdiction, tenant, user, and account risk and need an effective time, owner, reason, and audit record.

- Payment processing is delegated to an approved provider; the platform stores only opaque provider references and transaction status.
- Never collect or log PAN, CVV, wallet secrets, or authentication credentials.
- Default Bitcoin to disabled pending legal/compliance, sanctions, custody, refund, tax, volatility, and settlement approvals.
- A blocked or unsupported method fails safely and does not create a charge or silently fall back to another method.
- Reconcile ambiguous provider timeouts using idempotency and provider status queries; do not assume failure and retry a charge blindly.

## Authorization decision flow

```mermaid
sequenceDiagram
  actor User
  participant API as Marketplace API
  participant IdP as OIDC provider
  participant Policy as Authorization and payment policy
  participant Checkout as Checkout orchestration
  participant PSP as External payment provider
  User->>API: Request protected resource / checkout
  API->>IdP: Validate token, issuer, audience, expiry
  IdP-->>API: Principal and scoped claims
  API->>Policy: Check tenant, role, domain, purpose, jurisdiction
  Policy-->>API: Allow or deny; audit decision
  API->>Policy: Check selected payment type (checkout only)
  Policy-->>API: Allow or explicit blocked-method result
  API->>Checkout: Create idempotent pending order if allowed
  Checkout->>PSP: Tokenized payment request
  PSP-->>Checkout: Status/reference, never card data
  Checkout-->>User: Safe status and order reference
```

## Required tests

Test unknown user, wrong tenant/team, missing role/domain, revoked consent, disallowed jurisdiction, blocked payment method, unsupported method, method changed during checkout, duplicate checkout, PSP timeout, and payment callback replay. Assert deny-by-default and confirm errors/logs never contain payment credentials or raw sensitive payloads.

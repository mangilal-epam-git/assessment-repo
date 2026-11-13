# Development guide

**Purpose:** Local development and verification guide for the assessment implementation and the intended evolution toward the full design. The code in this branch is an initial scaffold and should not be treated as production-ready until the gaps listed below are resolved and tests pass in CI.

## Development principles

- Keep ranking pure and deterministic: inject the UTC clock, configuration snapshot, and provider payloads.
- Use `Decimal` or rational arithmetic for monetary comparisons; never compare rounded display values.
- Keep provider identity in trusted configuration, never in offer rows.
- Treat every source as untrusted: validate top-level payload and each row; do not log payload bodies.
- Return stable reason codes; avoid leaking provider secrets or sensitive data in errors.
- Bound retries, request timeouts, concurrency, and the total request deadline. Retry only transient failures and use exponential backoff with jitter in production.
- Do not use stale cached offers to hide provider outages.
- Keep access management, payment policy, and marketplace checkout separate from offer selection.
- Tests should assert exact behavior, edge cases, and failure modes, not merely that the endpoint returns 200.

## Intended layout

```text
backend/
  app/
    main.py                 # API routes and lifecycle
    config.py               # immutable, validated request snapshots
    provider_client.py      # async HTTP, bounded retry and timeout
    offer_service.py        # validation, eligibility, decimal ranking
    access_policy.py        # sample authorization policy only
    fixtures/               # provider responses used by mock endpoints
  tests/
    unit/
    integration/
    contract/
infra/terraform/            # planned parameterized IaC (see iac.md)
docs/
  design/                   # solution and decision records
  wiki/                     # operator and contributor knowledge pages
```

## Local workflow (intended)

From the repository root, create a virtual environment and install backend dependencies:

```bash
cd backend
python -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements.txt
```

When the ASGI entry point and fixtures are implemented, start the mock providers and API using the documented single command (planned Docker Compose target) or run Uvicorn directly. The initial scaffold still needs its application routes, fixture files, and container configuration completed; therefore these commands should not be considered verified yet.

Run tests and static checks after implementation:

```bash
pytest -q
ruff check app tests
ruff format --check app tests
mypy app
```

CI should run unit, integration, and provider-contract tests; dependency and container scans; SBOM generation; and Terraform formatting/validation/policy checks. Pin dependencies and review upgrades.

## Test strategy and acceptance cases

### Ranking unit tests

- Fixture clock is `2026-06-15T10:05:00Z`; assert all sample offers, product sort order, provider winner, rates, margin, and exact formatted values.
- Lowest unrounded normalized cost wins even when rounded output appears tied.
- Tie-break order: quality, observation recency, then provider ID.
- EUR/USD/GBP rates, unknown currency, zero price, markup arithmetic, and half-up formatting.
- Minimum quality boundary inclusive at 0.90; below threshold excluded.
- Observation exactly 15 minutes old is allowed by the stated “no more than 15 minutes” rule; older is stale. Expiry is strict (`now < expiry`).
- Missing expiry uses observed time plus 15 minutes; supplied expiry must parse and be later than observation.
- Reject bools where integer counts/prices are expected, non-integer numbers, negative values, `validEventCount > eventCount`, unknown fields, malformed rows, invalid/future timestamps.
- Any repeated product ID within one provider response rejects all rows for that product from that provider, including a valid first occurrence followed by an invalid duplicate.
- Same product across different providers is expected and compared.
- Partial response when a row is rejected; empty offers with valid top-level arrays but no eligible rows.

### Provider client and API integration tests

- Concurrent provider fetching; response remains within an overall deadline.
- Timeout, connection reset, 429, and transient 5xx retry behavior; non-retryable errors do not exhaust retries.
- Exponential backoff has jitter and is testable with injected sleeper/random source; cancellation stops retries immediately.
- One provider unavailable gives HTTP 200 partial with provider ID; both unavailable/invalid top-level arrays give 503 with safe stable error and request ID.
- Valid top-level array with malformed row keeps other valid rows; malformed top-level JSON/object marks provider unavailable.
- Shutdown closes HTTP clients cleanly; no background retry task remains.
- Config read exactly once per request; invalid reload preserves prior snapshot, valid reload changes FX/margin version atomically.
- No stale offers are substituted; provider identity is endpoint configuration; response contains versions used.

### Security/governance tests

- Tenant/team/domain checks deny by default; blocked payment methods denied before checkout hand-off; unblock and authorization audit are tested.
- Cross-tenant access, unknown user, wrong team, revoked consent, and missing purpose all deny.
- Payment method restrictions do not log or persist payment credentials. Test Bitcoin-disabled default and jurisdiction policy gate.
- AI tools cannot perform spend or operational change without explicit approval; no actuation tool is registered.

Use frozen clocks, `httpx.MockTransport`/dependency injection, deterministic fixtures, and no real payment or notification service in CI. Include contract tests against provider schema versions and Terraform plan policy tests.

## Provider retry policy

Use small, explicit policies. Example target: three total attempts for a transient provider operation, attempt timeout 5 seconds, exponential backoff with full jitter capped at 1 second, and 8-second total endpoint deadline. Retry network errors, 408, 429 (respect bounded `Retry-After`), and selected 5xx. Do not retry malformed rows, unsupported currencies, authentication/authorization failures, or other permanent 4xx responses. Apply per-provider concurrency limits and a circuit breaker. Preserve cancellation and propagate shutdown. Adjust figures from pilot latency measurements; do not multiply retries across stacked client and proxy layers.

## Configuration and runtime reload

Validate configuration into an immutable snapshot before activation: nonempty versions, supported currencies with finite positive decimal rates, nonnegative integer markup, and quality ratio in `[0,1]`. Publish atomically only after the entire snapshot validates. Each request captures one snapshot at its start and uses it for all rows; the response carries both versions. Invalid reload returns an error/health signal while retaining the last known-good snapshot. Protect reload with authorization and audit it. In production, source config from an approved configuration service or signed artifact, not an unauthenticated public API.

## Error and privacy handling

Give every API request a correlation/request ID. Provider errors returned to clients use safe stable codes; do not return internal URLs, exception messages, headers, raw provider payloads, access tokens, location data, or payment information. Store row rejection codes and provider identity for operational evidence, with retention and access controls. Ensure application and proxy logs redact sensitive headers and query strings.

## Current scaffold limitations to close

The pushed initial code is a scaffold, not a verified complete submission. In particular, implement and validate the missing ASGI routes and lifecycle, provider fixture responses, deterministic production/injection clock, unavailable-provider/503 semantics, proper duplicate-product whole-group rejection, strict RFC3339/UTC validation, robust config snapshot validation/reload authorization, production retry/backoff jitter and request deadline, error response/request IDs, Docker/Compose, Terraform resources, and the design/wiki artifacts referenced by the README. Run the full suite in CI before describing the service as deployable. Do not claim tests pass until executed.

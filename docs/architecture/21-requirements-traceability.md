# 21. Requirements traceability

Every requirement from the brief, mapped to where it is addressed and what
evidence exists. Status is deliberately blunt:

- **Coded** — implemented in this repository with tests
- **IaC** — implemented in the Terraform in this repository
- **Designed** — specified here, not built
- **Partial** — partly built, remainder designed

## 21.1 Functional requirements

| # | Requirement | Status | Where | Evidence |
| --- | --- | --- | --- | --- |
| F1 | Clean day-one launch for selected fleets and regions | Designed | [19](19-deployment.md), [1.6](01-context-and-scope.md#16-phased-delivery) | Phased plan with measured gates |
| F2 | Bootstrap vehicle registry, consent, catalogue, provider connections from scratch | Designed | [3](03-domain-model.md), [15](15-ma-integration-governance.md) | Domain model; no migration path needed |
| F3 | Automate data-source onboarding | Designed | [15](15-ma-integration-governance.md) | Merger REST API, self-service certification |
| F4 | **Always display the best eligible price via transparent, quality-normalised comparison** | **Coded** | `ranking.js`, `pricing.js` | `test/integration/golden.test.js`, [worked examples](../coding-task/worked-examples.md) |
| F5 | Real-time margin configuration per product, provider, region, with versioned approvals and auditable effective times | Partial | `config.js` (default markup, hot reload, versions); [4.6](04-pricing-and-comparison.md#46-what-the-full-platform-adds-beyond-the-coded-slice) for overrides | `test/integration/config-reload.test.js` |
| F6 | Collect the full traffic-event stream for analytics and audit, subject to consent, minimisation, retention, residency — without logging secrets or payment details | Partial | `logger.js` redaction (coded); [6](06-telemetry-ingestion.md), [10](10-privacy-consent-residency.md) | `test/unit/logger.test.js` |
| F7 | Directed advertising, with advertising consent separate from fleet-operation consent | Designed | [18](18-advertising-and-loyalty.md) | Separate pipeline and consent records |
| F8 | Loyalty-aware assistant personalising by frequency, area, price range, interests | Designed | [7.6](07-agentic-workflows.md#76-loyalty-aware-personalisation), [18.3](18-advertising-and-loyalty.md#183-loyalty-aware-personalisation-by-the-assistant) | Analytics consent; no raw location |
| F9 | Automatic currency conversion with a traceable rate snapshot | Partial | `config.js` FX snapshots with `fxVersion` (coded); [16.2](16-payments-and-fx.md#162-currency-conversion-with-a-traceable-snapshot) for checkout | Every response carries `fxVersion` |
| F10 | VISA, MasterCard, AMEX, Apple Pay, Google Pay, PayPal | Designed | [16.1](16-payments-and-fx.md#161-payment-orchestration) | PSP orchestration; no card data held |
| F11 | Assess Bitcoin with compliance and settlement trade-offs | Designed | [16.4](16-payments-and-fx.md#164-bitcoin-assessment) | Assessment with a negative recommendation |
| F12 | Configurable notifications via email, phone, messaging, with consent, quiet hours, escalation | Designed | [17](17-notifications.md) | Category model, escalation that expires |
| F13 | Handle duplicate, delayed, out-of-order events; intermittent connectivity; conflicting device-vehicle identity | Partial | Duplicate `productId` rejection (coded); [6](06-telemetry-ingestion.md), [3.4](03-domain-model.md#34-device-to-vehicle-identity-conflicts) | `test/unit/ranking.test.js` duplicate tests |
| F14 | Tenant isolation, driver-location privacy, geofenced residency, revocable analytics/AI rights | Designed | [8.3](08-security.md#83-authorisation-model), [10](10-privacy-consent-residency.md), [ADR-0011](../adr/0011-multi-tenancy-isolation.md) | Four isolation layers; purpose-scoped consent |
| F15 | Agents propose using allow-listed tools; explicit human approval before spend or operational change; no remote actuation | **Coded** | `src/agent/`, [7](07-agentic-workflows.md), [ADR-0010](../adr/0010-agent-tool-allowlisting.md) | `test/integration/agent-supervision.test.js`: self-approval, token replay, expiry, injection and actuation attempts all refused |
| F16 | Explainable insights: source events, quality, freshness, model/version attribution | Partial | Response carries provider, counts, quality ratio, `observedAt`, effective expiry, versions, rejections (coded); [5.4](05-data-quality-and-provenance.md#54-explainability-of-insights) | Golden test asserts every field |
| F17 | Detect spoofed telemetry; prevent low-quality feeds appearing artificially cheap | Partial | Quality floor and per-valid-event normalisation (coded); [5.2](05-data-quality-and-provenance.md#52-four-independent-verification-layers) for spoof detection | Test: a cheaper bundle with 0.80 quality is excluded |

## 21.2 Non-functional requirements

| # | Requirement | Status | Where | Evidence |
| --- | --- | --- | --- | --- |
| N1 | DDoS resilience | **Coded + IaC** | WAF/Front Door; in-service shedding, deadlines, caps | [9.4](09-threat-model.md#94-ddos-posture); load-shedding test |
| N2 | Availability | Coded + IaC | Multi-AZ, rolling deploys, partial results | [20.1](20-nfr-targets.md#201-availability-and-reliability) |
| N3 | Scalability to tens of thousands of concurrent users with surges | IaC + measured | Autoscaling to 40 tasks ≈ 8 000 rps | [12](12-capacity-plan.md) with measured throughput |
| N4 | Observability and alerting | **Coded + IaC** | `/metrics`, structured logs, dashboards, alarms | [11](11-observability.md) |
| N5 | Cloud vendor recommendation with explicit reasoning | Designed | [ADR-0001](../adr/0001-cloud-vendor-selection.md) | Scored comparison |
| N6 | All environments, CI/CD, databases, tooling cloud-hosted | IaC | Terraform for both clouds; GitHub Actions | `infrastructure/`, `.github/workflows/` |
| N7 | Production-grade engineering, IaC, automated verification, secure configuration | **Coded + IaC** | 188 tests, 97.0% line coverage, CI, scanning | `npm test`, `.github/workflows/ci.yml` |
| N8 | No turnkey marketplace / aggregation / agent-orchestration products | Coded | Zero runtime dependencies; ranking and orchestration built | [ADR-0003](../adr/0003-zero-runtime-dependencies.md), [23](23-boundaries-and-licensing.md) |
| N9 | Document boundaries and licensing assumptions | Designed | [23](23-boundaries-and-licensing.md) | Explicit build/mock split |
| N10 | Quantified cost model | Designed | [13](13-cost-model.md) | Line-item derivation, unit economics |
| N11 | Threat model | Designed | [9](09-threat-model.md) | STRIDE, abuse cases, risk register |
| N12 | Capacity plan | Designed + measured | [12](12-capacity-plan.md) | Benchmarks on this codebase |
| N13 | M&A integration governance | Designed | [15](15-ma-integration-governance.md) | Merger API, certification pipeline |
| N14 | Dedicated disaster recovery plan | Designed | [14](14-disaster-recovery.md) | Tiered RTO/RPO, procedures, drills |
| N15 | ADR set | Designed | [adr/](../adr/) | 12 ADRs |
| N16 | Diagrams | Designed | Throughout | Mermaid, version-controlled |

## 21.3 Coding sub-task requirements

Every requirement from the coding brief, with the test that proves it.

| Requirement | Status | Implementation | Test |
| --- | --- | --- | --- |
| Two mock HTTP endpoints, same schema | Coded | `src/mock-providers/server.js` | `lifecycle.test.js` asserts identical shape |
| Provider identity from configuration, not a row field | Coded | `provider-client.js`, `validation.js` | Row with `providerId` rejected as `UNKNOWN_FIELD` |
| `GET /best-offers`, no query parameters | Coded | `app.js` | `http.test.js` |
| Injectable clock; fixtures evaluated at 2026-06-15T10:05:00Z | Coded | `clock.js` | `clock.test.js`, `golden.test.js` |
| Seed config: `fx-demo-1`, EUR/USD/GBP rates, `margin-demo-1`, 1000 bps, 0.90 floor | Coded | `config/pricing-config.json` | `config.test.js` |
| Margin is markup on cost, not gross margin | Coded | `pricing.js` | Explicit test asserting 11.00, not 11.11 |
| `productId` nonempty string | Coded | `validation.js` | `INVALID_PRODUCT_ID` |
| `eventCount`, `validEventCount` positive integers | Coded | `validation.js` | `INVALID_EVENT_COUNT` / `INVALID_VALID_EVENT_COUNT` |
| `validEventCount ≤ eventCount` | Coded | `validation.js` | `VALID_EVENT_COUNT_EXCEEDS_EVENT_COUNT` |
| `priceMinor` nonnegative integer | Coded | `validation.js` | `INVALID_PRICE_MINOR`; zero accepted |
| Currency must have a configured FX rate | Coded | `validation.js` | `UNSUPPORTED_CURRENCY` |
| Timestamps parse; `observedAt` not in the future | Coded | `time.js`, `validation.js` | `OBSERVED_AT_IN_FUTURE`; boundary tested |
| `expiresAt` later than `observedAt` | Coded | `validation.js` | `EXPIRES_AT_NOT_AFTER_OBSERVED_AT` |
| Reject unknown fields and malformed rows with a recorded reason | Coded | `validation.js` | `UNKNOWN_FIELD`, `ROW_NOT_OBJECT`, `MISSING_FIELD` |
| Absent `expiresAt` means `observedAt` + 15 minutes | Coded | `validation.js` | Asserted in validation and golden tests |
| Quality ratio ≥ 0.90 | Coded | `ranking.js` | Boundary test at exactly 0.90 |
| `observedAt` no more than 15 minutes old | Coded | `ranking.js` | Boundary tests at 15 min and 15 min 1 s |
| `now` strictly earlier than effective expiry | Coded | `ranking.js` | Test at exactly expiry (rejected) and 1 s later (accepted) |
| Normalisation formulas | Coded | `pricing.js` | `pricing.test.js`, worked examples |
| Lowest unrounded cost wins | Coded | `ranking.js` | Near-tie test differing beyond 6 dp |
| Tie-break: quality, then newer `observedAt`, then provider ID | Coded | `ranking.js` | One test per tie-break level |
| Decimal/rational arithmetic, not binary floating point | Coded | `rational.js` | `0.1 + 0.2 === 0.3` exactly |
| Round-half-up only when serialising, at 2/6/4 places | Coded | `rational.js`, `service.js` | Half-up tests; banker's rounding would differ |
| Sort results by `productId` ascending | Coded | `ranking.js` | Golden test |
| Reject all rows of a repeated `productId` within one response | Coded | `ranking.js` | Both rows rejected, precedence over other faults |
| Cross-provider matches compared | Coded | `ranking.js` | Golden test: 5 products, both providers |
| Read a validated configuration snapshot once per request | Coded | `service.js` | Version-change test mid-service |
| Runtime reload of FX and markup without restart | Coded | `config.js`, `server.js`, `app.js` | `config-reload.test.js`, `config-watch.test.js` |
| A malformed reload preserves the last valid snapshot | Coded | `config.js` | Prices unchanged after a rejected reload |
| Return snapshot versions in every response | Coded | `service.js` | Golden test |
| Response model exactly as specified | Coded | `service.js` | Golden test asserts the full body |
| Error model: code, message, requestId | Coded | `app.js` | `http.test.js` asserts no leakage |
| 200 with `partial=true` when a source is unavailable or rows excluded | Coded | `service.js` | Both paths tested |
| Identify unavailable providers and row reasons without exposing payloads | Coded | `service.js`, `app.js` | Asserted |
| 200 with empty offers when nothing is eligible | Coded | `service.js` | Clock shifted past all expiries |
| 503 when neither source yields a valid array | Coded | `service.js`, `app.js` | Both providers failing |
| A malformed row does not invalidate others | Coded | `ranking.js` | Mixed valid/invalid test |
| Do not substitute stale cached offers | Coded | `provider-client.js` | `cache: 'no-store'` asserted; no cache exists |
| Predictable cancellation, timeouts and shutdown | Coded | `retry.js`, `app.js`, `server.js` | `lifecycle.test.js` |
| Container definition | Coded | `Dockerfile`, `Dockerfile.mock` | CI container job |
| Cloud deployment configuration | IaC | `infrastructure/` | `terraform validate` in CI |
| Concise README with one-command startup and test instructions | Coded | [`README.md`](../../README.md) | — |
| Automated tests | Coded | `test/` | 188 tests, 97.0% line coverage |

## 21.4 Summary

| Status | Count |
| --- | --- |
| Coded with tests | 46 |
| Implemented in IaC | 8 |
| Partial (coded in part, remainder designed) | 6 |
| Designed only | 17 |

The supervised agent workflow (F15) moved from *designed* to *coded* after
the initial submission: `src/agent/` implements the tool registry, proposal
lifecycle, approval gate, execution service and hash-chained audit ledger,
with a browser console for demonstrating them.

Nothing in the brief is unaddressed. What is designed rather than built is
listed explicitly in [22 Assumptions and gaps](22-assumptions-and-gaps.md),
as the brief asks.

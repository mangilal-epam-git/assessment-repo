# 22. Assumptions and gaps

The brief asks for assumptions, supporting calculations and an honest
identification of unimplemented requirements. This document is deliberately
unflattering where that is accurate.

## 22.1 Assumptions

### Business

| # | Assumption | Impact if wrong | Confidence |
| --- | --- | --- | --- |
| B1 | "Tens of thousands of concurrent users" means up to ~30 000 at phase 3 | Capacity and cost scale roughly linearly; the ceiling would need raising | Medium |
| B2 | An active user issues ~1 request per 30 s | Directly scales the request-rate model | Low — the single weakest input |
| B3 | Monthly average traffic is ~25% of peak | Changes the cost model, not the architecture | Medium |
| B4 | Phase 1 is ~20 fleets in one EU jurisdiction | Residency design already anticipates more regions | High (stated in the brief) |
| B5 | Fleet operators pay by invoice or corporate card, not crypto | Supports the negative Bitcoin recommendation | Medium |
| B6 | Acquisitions arrive at ~4 per year | Drives the self-service certification investment | Medium |
| B7 | Providers are commercially motivated to overstate quality | Underpins the entire verification design | High |

B2 is the input most worth challenging in review. The sizing conclusions
follow arithmetically from it, and a factor-of-three error there is a
factor-of-three error in the compute line. The mitigation is that the planning
figure is re-measured at every rollout gate rather than fixed at design time.

### Technical

| # | Assumption | Impact if wrong | Confidence |
| --- | --- | --- | --- |
| T1 | Providers expose, or can be adapted to, an HTTP JSON endpoint | Batch-only providers need the staging-buffer adapter in [15.4](15-ma-integration-governance.md#154-integration-patterns-by-acquisition-type) | High |
| T2 | Provider p95 latency is 20–50 ms | Longer latency costs concurrency, not CPU; timeouts would need revisiting | Medium |
| T3 | All supported currencies use 100 minor units | **Stated in the brief.** Would break for JPY (no minor unit) or KWD (1000) | High for now |
| T4 | A single-region deployment satisfies phase-1 residency | Multi-region is designed; phase 1 is simply smaller | High |
| T5 | Provider responses fit comfortably in 8 MiB | Larger feeds need pagination or streaming | Medium |
| T6 | Node.js 22 LTS is available in all target environments | Pinned in the image, so this is self-fulfilling | High |
| T7 | Exact rational arithmetic is fast enough | **Verified by measurement**: 2.25 µs/row | High |

T3 deserves flagging to the customer. The brief states all supported
currencies use 100 minor units, and the code relies on it. A marketplace
expanding to Japan would need a per-currency exponent in the FX configuration.
This is a small change — one field in the snapshot and one division — but it
is a change, and it is better raised now than discovered during a launch.

### Operational

| # | Assumption | Impact if wrong |
| --- | --- | --- |
| O1 | A 24/7 on-call rota exists or will exist | The availability targets assume human response within 15 minutes |
| O2 | Pricing changes are made by trained operators via the governed workflow | Hot reload is powerful; it needs process discipline around it |
| O3 | The standby region may be another EU region | A single-region jurisdiction would make the DR plan materially harder |
| O4 | Providers will act on rejection feedback | The certification model relies on it; the standing score exists for when they do not |
| O5 | A named data-governance owner will exist to accept or reject certifications | The separation of duties in [5.7](05-data-quality-and-provenance.md#57-who-decides-and-who-checks) has no meaning without one |
| O6 | A model data-use policy will be approved before any hosted backend is used in production | Until then the conservative default stands and the assistant runs locally |

## 22.2 Not implemented, and why

Stated plainly, by category.

### Deliberately out of scope per the brief

| Capability | Note |
| --- | --- |
| Payment processing | Explicitly prohibited: "do not build a payment processor" |
| PSP, FX, notification integrations | Permitted to be treated as external interfaces and mocked |
| Frontend | "A frontend is optional for this task" |
| Tax and loyalty discounts in the coded slice | "For this exercise, omit tax and loyalty discounts" |
| Per product/provider/region margin overrides | "The coded slice only requires the default markup and EUR output" |
| Local-currency checkout | Same |

### In the architecture, not built

| Capability | Designed in | Estimated effort |
| --- | --- | --- |
| Telemetry ingestion pipeline | [6](06-telemetry-ingestion.md) | 3–4 months, 4 engineers |
| Quality verification and spoof detection | [5](05-data-quality-and-provenance.md) | 4–6 months, 3 engineers + data science |
| ~~Agent orchestrator, tool registry, approval service~~ | **Implemented** in `src/agent/` | — |
| Consent service with purpose scoping | [10](10-privacy-consent-residency.md) | 2–3 months, 2 engineers |
| Merger REST API and certification pipeline | [15](15-ma-integration-governance.md) | 3–4 months, 3 engineers |
| Multi-region residency enforcement | [10.3](10-privacy-consent-residency.md#103-residency) | 2–3 months, 2 engineers |
| Audit ledger with hash chaining | [ADR-0008](../adr/0008-event-sourced-audit-trail.md) | 2 months, 2 engineers |
| Notification service | [17](17-notifications.md) | 2 months, 2 engineers |
| Loyalty tiering and advertising | [18](18-advertising-and-loyalty.md) | 3 months, 3 engineers |
| Web application | — | 4–6 months, 4 engineers |

Estimates are order-of-magnitude, intended for sequencing conversations
rather than for a budget.

### Known gaps in the coded slice

Honest limitations of what *is* built:

| Gap | Impact | Remedy |
| --- | --- | --- |
| Single shared admin token | A coarse credential for a sensitive endpoint | Workload identity with short-lived credentials and per-operator attribution |
| Quality claims trusted after validation | As the brief directs, but a real exposure in production | Implement [layer 1 recount](05-data-quality-and-provenance.md#layer-1--deterministic-recount) before any live provider |
| Egress guard is pattern matching, not semantic understanding | A sufficiently unusual encoding of a coordinate would pass | It is a backstop; minimisation at source remains the control that matters ([ADR-0014](../adr/0014-model-egress-data-classification.md)) |
| No circuit breaker across requests | A persistently failing provider is retried on every request, on every endpoint | Add a per-provider breaker; bounded retries and failover limit the damage. Retry timing is now configurable ([ADR-0006](../adr/0006-retry-and-resilience-policy.md)) |
| No distributed tracing backend | `x-request-id` propagates, but no span export | Add OpenTelemetry export; the header plumbing is already there |
| No rate limiting inside the service | Relies on edge WAF and concurrency shedding | Add per-tenant quotas when authentication lands |
| Provider list fixed at two | Configuration-shaped but not dynamic | Generalise to a provider registry; the orchestration already loops over a list |
| No authentication on `/best-offers` | The slice is unauthenticated by design | Gateway-level authn and per-tenant entitlement filtering |
| SBOM not generated or signed | Supply-chain attestation incomplete | Add Syft plus Sigstore signing to CI |
| Terraform not applied to a live account | Validated and consistency-checked, never deployed | See [22.4](#224-what-has-not-been-executed) |

### Deliberately rejected

Optimisations that were considered and refused, recorded so they are not
silently reintroduced:

| Rejected | Why |
| --- | --- |
| Caching provider offers | Would save ~$176/month and real latency, but the brief prohibits stale offers and serving one is the exact conduct the group settled over |
| Floating-point money | Faster and simpler; cannot be defended when a customer recomputes an invoice |
| Rounding before comparison | Would make ties tidier; can select the wrong winner |
| Automatic cross-region failover | Faster RTO; risks a self-inflicted outage and split brain on a monitoring false positive |
| Auto-approval of expired agent proposals | Would improve throughput; defeats the supervision requirement entirely |
| Active-active multi-region | Better RTO; doubles cost and adds cross-region write coordination to a system whose defining property is reproducible pricing |

## 22.3 Risks to the plan

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Provider quality verification proves harder than modelled | Medium | High | Start layer 1 recount in phase 1 with pilot providers; do not wait for phase 3 |
| B2 traffic assumption is materially wrong | Medium | Medium | Re-measure at each gate; autoscaling absorbs a 3× error without redesign |
| Prompt injection produces a plausible bad proposal | Medium | Medium | Human approval is the backstop; monitor acceptance rates for anomalies |
| M&A pace exceeds certification capacity | Medium | Medium | Self-service is the whole point; measure core-team days per acquisition |
| Residency rules change mid-rollout | Low | High | Regional data planes already isolate; metadata-only cross-region flow |
| A DDoS exceeds the scaling ceiling | Medium | Medium | Shed rather than scale; Shield Advanced before public launch |

## 22.4 What has not been executed

To be unambiguous about the state of the deliverable:

| Item | State |
| --- | --- |
| Service code | **Runs.** 288 tests pass; 96.2% line coverage. An independent review found and fixed eleven defects, two critical; regression tests added |
| Supervised agent service | **Runs.** Console at `http://localhost:8082/`. Deterministic planner by default; Anthropic, OpenAI, Azure OpenAI and Ollama adapters included. Fleet data is in memory and there is no authentication: a demonstration of a control, not a production service |
| Mock providers | **Run.** Fault injection exercised by tests |
| Docker images | Defined; built in CI. Not built in this environment (no Docker available here) |
| Docker Compose stack | Defined; smoke-tested in CI. Not run in this environment |
| Terraform | **Validated** by an offline consistency checker (variables, module wiring, outputs, braces, provider pinning) and by `terraform validate` in CI. **Never applied to a live cloud account** |
| CI pipeline | Defined. Not executed, since the repository has not yet been pushed |
| Load figures | **Measured** on this codebase in this environment, under contention |
| Cost figures | Calculated from published list prices; not reconciled against a real invoice |

The Terraform line is the most important caveat. The configuration is
internally consistent and follows current provider schemas, but no plan has
been run against a real AWS or Azure account, and first-apply issues — IAM
propagation delays, service quotas, region-specific availability — should be
expected. The deployment instructions in
[infrastructure/README.md](../../infrastructure/README.md) include the
chicken-and-egg ordering for the first apply, which is the most predictable
of these.

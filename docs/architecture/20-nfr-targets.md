# 20. Non-functional targets

Every quantified target in one table, with how it is verified. A target
without a verification method is an aspiration, so each row names one.

## 20.1 Availability and reliability

| Target | Value | Verification |
| --- | --- | --- |
| Marketplace availability | 99.9% monthly (99.95% at phase 3) | Load-balancer SLI; error budget tracked |
| Ranking service availability | 99.95% | Same |
| Degraded-mode availability (one provider down) | 100% — partial results, never an error | `test/integration/http.test.js` |
| Maximum consecutive failed provider attempts | 3, then mark unavailable | `test/unit/provider-client.test.js` |
| Deployment-induced downtime | 0 | Rolling deploy with 100% minimum healthy |
| Single-AZ failure impact | No loss of availability | Three AZs, automated drill |

## 20.2 Performance

| Target | Value | Verification |
| --- | --- | --- |
| `/best-offers` p50 | < 150 ms | Measured 5.5 ms at concurrency 1 locally |
| `/best-offers` p95 | < 500 ms | Measured 88 ms at concurrency 64 locally |
| `/best-offers` p99 | < 1 000 ms | Measured 94 ms at concurrency 64 locally |
| Ranking core | < 5 ms for a realistic payload | Measured 0.018 ms for 10 rows, 0.193 ms for 100 |
| Provider call timeout | 2 000 ms per attempt | Configuration, enforced and tested |
| Total request deadline | 10 000 ms | Configuration, enforced and tested |
| Telemetry ingest to queryable | p95 < 10 s | Pipeline metrics |
| Page load (web) | p75 LCP < 2.5 s | Real-user monitoring |

Measured figures come from [12 Capacity plan](12-capacity-plan.md) and were
taken with the service, both mocks and the load generator sharing two cores,
so they understate production performance.

## 20.3 Scalability

| Target | Value | Verification |
| --- | --- | --- |
| Concurrent users | 30 000 at phase 3 | Load test in staging |
| Sustained request rate | 1 000 rps baseline, 3 000 rps surge | Load test |
| Autoscaling ceiling | 8 000 rps (40 tasks × 200 rps) | Configured, drill-verified |
| Scale-out responsiveness | ~100% capacity increase per minute | Measured during a drill |
| Telemetry ingest | 50 000 events/s sustained, 200 000/s surge | Pipeline load test |
| Providers per canonical product | No fixed limit; linear cost | Fan-out is configuration-driven |
| Tenants | 10 000+ | Row-level security, no per-tenant infrastructure |

## 20.4 Correctness and integrity

| Target | Value | Verification |
| --- | --- | --- |
| Price reproducibility from audit records | **100%** | Sampled recomputation; rollout gate |
| Monetary rounding error | **0** before serialisation | Exact rational arithmetic; `test/unit/rational.test.js` |
| Ranking determinism | Identical output for identical inputs | `test/integration/golden.test.js` |
| Ordering independence | Result independent of provider response order | Golden test with reversed providers |
| Actions executed without approval | **0** | Audit query; zero tolerance |
| Cross-tenant data access | **0** | Security alerting; zero tolerance |
| Rejected configuration reloads applied | **0** | `test/integration/config-reload.test.js` |

## 20.5 Security

| Target | Value | Verification |
| --- | --- | --- |
| Critical/high vulnerabilities in a deployed image | 0 at deploy time | Trivy in CI; ECR scan-on-push |
| Secrets in source control | 0 | `npm run check` plus Trivy secret scanning |
| Long-lived cloud credentials | 0 | OIDC federation only |
| Runtime third-party dependencies | 0 | `package.json` |
| TLS version | 1.2 minimum, 1.3 preferred | Load-balancer policy |
| Mean time to patch a critical vulnerability | < 24 h | Pipeline metrics |
| Penetration test cadence | Annual plus pre-launch | External report |

## 20.6 Privacy and compliance

| Target | Value | Verification |
| --- | --- | --- |
| Consent revocation effective for future use | Immediate | Consent service tests |
| Removal from derived analytics | < 72 h | Pipeline SLA monitoring |
| Model retirement after AI-training revocation | < 30 days | Retraining schedule |
| Data subject access request | < 7 days | Workflow SLA |
| Erasure request | < 30 days | Workflow SLA |
| Personal data crossing a residency boundary | **0** | Automated residency assertions; rollout gate |
| Driver location in logs | **0** | `test/unit/logger.test.js` |

## 20.7 Recoverability

| Tier | RTO | RPO | Verification |
| --- | --- | --- | --- |
| Evidence (audit, consent, raw telemetry) | 4 h | **0** | Quarterly restore test |
| Transactional (orders, pricing config) | 1 h | 5 min | Monthly restore test |
| Serving (ranking, API) | 15 min | n/a | Weekly automated drill |
| Analytical | 24 h | 1 h | Quarterly |
| Derived | 72 h | n/a | Rebuild on demand |
| Full account rebuild from Git | 24 h | Per tier above | Annual drill |

## 20.8 Operability

| Target | Value | Verification |
| --- | --- | --- |
| Mean time to detect | < 5 min | Alert evaluation periods |
| Mean time to acknowledge | < 15 min | On-call metrics |
| Alerts with a runbook | 100% | Runbook index cross-check |
| False-positive alert rate | < 10% | Monthly alert review |
| Pricing change without a deploy | Supported | Hot reload, tested |
| Time to roll back a bad deploy | < 5 min | Circuit breaker, automatic |
| Time to roll back a bad price | < 2 min | File restore plus reload |

## 20.9 Maintainability

| Target | Value | Verification |
| --- | --- | --- |
| Line coverage | ≥ 90% | Enforced in `npm test`; currently **97.0%** |
| Branch coverage | ≥ 80% | Enforced; currently **95.3%** |
| Function coverage | ≥ 90% | Enforced; currently **91.1%** |
| Build plus test duration | < 5 min | CI timing |
| Platforms supported for development | Linux, macOS, Windows | CI matrix |
| Time for a new engineer to run the stack | < 15 min | README walkthrough |
| Architecturally significant decisions recorded | 100% | ADR set, enforced at review |

Coverage thresholds are enforced by the test command itself, not merely
reported, so coverage cannot quietly regress.

A caveat worth stating: an independent review of this code found eleven
defects, two of them critical, in lines the 97%-covered suite was already
executing. Coverage measures which lines ran, not which conditions were
considered. The regression tests for those defects are in
`test/integration/hardening.test.js`.

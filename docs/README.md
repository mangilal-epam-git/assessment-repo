# VectorHarbor Mobility — Solution Architecture

Documentation for the VectorHarbor telematics data marketplace and supervised
fleet assistant, and for the coded slice delivered alongside it
(provider-offer normalisation and ranking).

Everything here is greenfield. There is no legacy platform and no data
migration; acquired companies join as independently certified data suppliers
through a published adapter contract.

## How to read this

If you have ten minutes, read
[Solution overview](architecture/02-solution-overview.md) and
[Pricing and comparison](architecture/04-pricing-and-comparison.md): together
they cover the launch priorities of price transparency and demonstrable data
rights.

If you are presenting this, the deck is
[docs/presentation](presentation/README.md) — five slides with speaker notes,
plus a suggested running order that interleaves the slides with the two live
demos.

If you are reviewing the AI part, read
[24 AI model strategy](architecture/24-ai-model-strategy.md) for the model
choices and deployment, and
[Supervised agent demo](coding-task/agent-demo.md) to run it.

If you are reviewing the coded slice, start at
[Coding task: API contract](coding-task/api-contract.md) and
[Worked examples](coding-task/worked-examples.md), which reproduce by hand
every number the service returns for the supplied fixtures.

If you are assessing delivery risk, read
[Requirements traceability](architecture/21-requirements-traceability.md) and
[Assumptions and gaps](architecture/22-assumptions-and-gaps.md), which state
plainly what is built, what is designed, and what is neither.

## Contents

### Architecture

| Document | What it answers |
| --- | --- |
| [01 Context and scope](architecture/01-context-and-scope.md) | Who the actors are, what is in and out of scope, which constraints bind the design |
| [02 Solution overview](architecture/02-solution-overview.md) | The system in C4 context, container and component views |
| [03 Domain model](architecture/03-domain-model.md) | Canonical products, offers, consent, tenancy and the identity-resolution rules |
| [04 Pricing and comparison](architecture/04-pricing-and-comparison.md) | Quality-normalised comparison, margin versioning, FX, reproducible pricing |
| [05 Data quality and provenance](architecture/05-data-quality-and-provenance.md) | How quality claims are independently verified and spoofed telemetry detected |
| [06 Telemetry ingestion](architecture/06-telemetry-ingestion.md) | Duplicate, delayed and out-of-order events; intermittent connectivity; identity conflicts |
| [07 Agentic workflows](architecture/07-agentic-workflows.md) | Allow-listed tools, human approval gates, the prohibition on remote actuation |
| [08 Security](architecture/08-security.md) | Identity, tenancy isolation, secrets, supply chain, hardening |
| [09 Threat model](architecture/09-threat-model.md) | STRIDE analysis, attack trees, DDoS posture, abuse cases |
| [10 Privacy, consent and residency](architecture/10-privacy-consent-residency.md) | Consent separation, minimisation, retention, geofenced residency, revocation |
| [11 Observability](architecture/11-observability.md) | SLIs, SLOs, error budgets, alerting, the audit evidence trail |
| [12 Capacity plan](architecture/12-capacity-plan.md) | Sizing arithmetic for tens of thousands of concurrent users and surges |
| [13 Cost model](architecture/13-cost-model.md) | Quantified monthly cost per environment, unit economics, levers |
| [14 Disaster recovery](architecture/14-disaster-recovery.md) | RTO/RPO per tier, failover procedures, drills, dependency failure |
| [15 M&A integration governance](architecture/15-ma-integration-governance.md) | The merger REST API, adapter certification, decoupling acquired systems |
| [16 Payments and FX](architecture/16-payments-and-fx.md) | Card, wallet and PayPal flows, the Bitcoin assessment, rate snapshots |
| [17 Notifications](architecture/17-notifications.md) | Channels, consent, quiet hours, escalation |
| [18 Advertising and loyalty](architecture/18-advertising-and-loyalty.md) | Tiering, directed advertising, consent separation, personalisation |
| [19 Deployment and environments](architecture/19-deployment.md) | Cloud topology, CI/CD, environment strategy, rollout mechanics |
| [20 Non-functional targets](architecture/20-nfr-targets.md) | Every quantified target in one table |
| [21 Requirements traceability](architecture/21-requirements-traceability.md) | Each brief requirement mapped to design, code and evidence |
| [22 Assumptions and gaps](architecture/22-assumptions-and-gaps.md) | What is assumed, what is not implemented, and why |
| [23 Boundaries and licensing](architecture/23-boundaries-and-licensing.md) | What is built vs mocked, and the open-source licensing position |
| [24 AI model strategy](architecture/24-ai-model-strategy.md) | Which models, why, running locally, deploying to cloud, cost, evaluation, governance |

### Decision records

| ADR | Decision |
| --- | --- |
| [0001](adr/0001-cloud-vendor-selection.md) | AWS as the primary cloud, with Azure kept deployable |
| [0002](adr/0002-quality-normalised-comparison.md) | Rank on cost per 1000 valid events, not bundle price |
| [0003](adr/0003-zero-runtime-dependencies.md) | No third-party runtime dependencies in the service |
| [0004](adr/0004-exact-decimal-arithmetic.md) | Exact rational arithmetic for all monetary comparison |
| [0005](adr/0005-serverless-containers.md) | Fargate / Container Apps rather than Kubernetes on day one |
| [0006](adr/0006-retry-and-resilience-policy.md) | Bounded retries with full jitter and an overall deadline |
| [0007](adr/0007-configuration-snapshots.md) | Versioned, hot-reloadable pricing snapshots read once per request |
| [0008](adr/0008-event-sourced-audit-trail.md) | Append-only audit log as the evidentiary backbone |
| [0009](adr/0009-provider-adapter-contract.md) | A published adapter contract for acquisitions and providers |
| [0010](adr/0010-agent-tool-allowlisting.md) | Agents propose; humans approve; no remote actuation |
| [0011](adr/0011-multi-tenancy-isolation.md) | Tenant isolation model and its enforcement points |
| [0012](adr/0012-payment-provider-abstraction.md) | Payment service provider abstraction and the Bitcoin position |
| [0013](adr/0013-agent-model-provider-abstraction.md) | Pluggable model backend with a deterministic default |

### Coding task

| Document | Contents |
| --- | --- |
| [API contract](coding-task/api-contract.md) | Request and response shapes, reason codes, status semantics |
| [Worked examples](coding-task/worked-examples.md) | Every fixture number derived by hand, step by step |
| [Test strategy](coding-task/test-strategy.md) | What is tested, at which level, and what each test defends |
| [Supervised agent demo](coding-task/agent-demo.md) | Running the agent console, switching models, the injection demonstration |

### Presentation

| Document | Contents |
| --- | --- |
| [Presentation](presentation/README.md) | Five-slide customer deck, the narrative behind it, and how to regenerate it |

### Runbooks

| Runbook | When to use it |
| --- | --- |
| [Demo day](runbooks/demo-day.md) | Starting all three services and presenting them, step by step |
| [Incident response](runbooks/incident-response.md) | Alert fired, service degraded, provider down |
| [Pricing configuration change](runbooks/pricing-change.md) | Changing FX, margin or the quality floor safely |
| [Disaster recovery drill](runbooks/dr-drill.md) | Quarterly rehearsal and evidence capture |

## Diagram conventions

Diagrams are [Mermaid](https://mermaid.js.org/) embedded in Markdown, so they
version and review as text. GitHub renders them natively; most IDEs do too
with a Mermaid extension.

| Shape | Meaning |
| --- | --- |
| Rectangle | A service or component this team builds and runs |
| Rounded rectangle | A managed cloud primitive |
| Double rectangle `[[ ]]` | An external system outside our control |
| Cylinder `[( )]` | A data store |
| Dashed arrow | Asynchronous or event-driven flow |
| Solid arrow | Synchronous request/response |

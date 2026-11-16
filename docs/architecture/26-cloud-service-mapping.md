# 26. Cloud service mapping

Which managed services this solution uses, on both clouds — separated into
what the Terraform provisions **today** and what the full platform would add.

Primary recommendation is AWS ([ADR-0001](../adr/0001-cloud-vendor-selection.md));
the Azure column is maintained and CI-validated so the choice stays
reversible rather than notional.

---

## 26.1 Provisioned today

Everything in this table exists in `infrastructure/` and is validated on
every push.

| Concern | AWS | Azure |
| --- | --- | --- |
| Edge protection | **WAFv2** web ACL + **Shield Standard** | **Front Door Premium** with WAF policy |
| Load balancing | **Application Load Balancer** | Front Door + Container Apps ingress |
| Compute | **ECS Fargate** (3 services) | **Container Apps** (3 apps) |
| Autoscaling | **Application Auto Scaling**, request-count target | **KEDA**, built in, HTTP concurrency |
| Container registry | **ECR**, scan-on-push, immutable tags | **Container Registry**, Premium in prod |
| Secrets | **Secrets Manager** | **Key Vault**, RBAC, purge protection |
| Runtime configuration | **SSM Parameter Store** | Key Vault + container env |
| Workload identity | **IAM task roles** | **User-assigned managed identity** |
| Network | **VPC**, public/private subnets, **NAT**, **VPC endpoints** | **VNet**, delegated subnet, **NSG** |
| Private service DNS | **Cloud Map** | Container Apps internal DNS |
| Logs and metrics | **CloudWatch** Logs, metric filters, **Container Insights** | **Log Analytics** + **Application Insights** |
| Dashboards | **CloudWatch Dashboard** | Log Analytics workbooks |
| Alerting | **CloudWatch Alarms** → **SNS** | **Monitor** alerts → **Action Group** |
| Audit of network flow | **VPC Flow Logs** | NSG flow logs |
| State for IaC | **S3** with versioning + native locking | **Storage Account**, blob lease locking |
| CI/CD | **GitHub Actions** + OIDC into an IAM role | GitHub Actions + OIDC into an app registration |

Roughly 60 AWS resources and 30 Azure resources. Indicative cost is in
[13 Cost model](13-cost-model.md): about **$1 030/month** for AWS production
before inference, **$800/month** for Azure.

---

## 26.2 Why containers rather than Functions

A reasonable first instinct for a greenfield platform is Lambda or Azure
Functions. We chose serverless **containers** instead
([ADR-0005](../adr/0005-serverless-containers.md)), for reasons specific to
this workload.

| Consideration | Why it favours containers here |
| --- | --- |
| Request shape | `/best-offers` fans out to providers and holds concurrent outbound connections. A function per request is a poor fit for connection reuse |
| Tail latency | Cold starts land on a path with a p99 target; the assistant's turns are already model-bound |
| Agent turns | A turn is a loop of 4–6 model round trips taking seconds. That is an awkward shape for a function and trivial for a container |
| Graceful shutdown | The zero-downtime deploy story depends on draining in-flight work, which containers express directly |
| Portability | The same OCI image runs on Fargate, Container Apps, or Kubernetes later. Function packaging is vendor-shaped |
| Local parity | `node src/...` is the same code path as production |

### Where Functions genuinely belong

Not the request path — the **event-driven glue** around it. In the full
platform:

| Job | AWS | Azure |
| --- | --- | --- |
| Telemetry ingest fan-out and enrichment | **Lambda** on Kinesis/MSK | **Functions** on Event Hubs |
| Nightly loyalty-tier recalculation | **EventBridge Scheduler** → Lambda | **Timer-triggered Functions** |
| Proposal expiry sweep at scale | EventBridge → Lambda | Timer Functions |
| Quality recount jobs after delivery | Step Functions + Lambda, or **Batch** | **Durable Functions**, or Container Apps Jobs |
| PSP and provider webhook receivers | **API Gateway** → Lambda | Functions with an HTTP trigger |
| Evidence export for auditors | Lambda → S3 | Functions → Blob |

The rule we applied: **containers for anything with a request/response SLO
or a long-lived connection, functions for anything event-driven, scheduled
or bursty.**

---

## 26.3 API management — a real gap, named

The container view in [2.2](02-solution-overview.md#22-container-view-c4-level-2)
shows an "API gateway" performing authentication, quotas and routing. **No
product is chosen, and none is provisioned.** Today the edge is WAF plus a
load balancer, and the services authenticate for themselves.

That is adequate for phase one and deliberately cheap. It stops being
adequate when the **merger REST API**
([15](15-ma-integration-governance.md)) goes live, because partner
self-service needs things a load balancer does not provide.

| Capability | Needed for | AWS | Azure |
| --- | --- | --- | --- |
| Per-partner keys and quotas | Provider and subsidiary onboarding | **API Gateway** usage plans | **API Management** subscriptions |
| Developer portal and published specs | Self-service certification | API Gateway + separate portal | APIM developer portal, built in |
| Request/response validation at the edge | Rejecting malformed adapter traffic early | API Gateway models | APIM policies |
| Versioning and deprecation windows | The 12-month contract policy | Stages | Versions and revisions |
| Per-consumer throttling and spike arrest | Protecting the core from one bad adapter | Usage plans | Rate-limit policies |
| Monetisation hooks | If provider access is ever charged | Usage plans | APIM products |

**Recommendation:** introduce it at **phase 4**, when M&A self-service
matters, not at phase 1. Adding it early buys a developer portal nobody is
using yet and a fixed monthly cost — APIM Developer tier is around
$50/month, Standard around $700, and AWS API Gateway is per-request. The
decision point is the first external partner, not the first deployment.

When it arrives it sits **in front of** the existing services, so nothing
already built changes.

---

## 26.4 The full platform

Everything below is designed, not built
([22](22-assumptions-and-gaps.md)).

### Data

| Concern | AWS | Azure |
| --- | --- | --- |
| Transactional store (orders, consent, catalogue) | **Aurora PostgreSQL Serverless v2**, row-level security | **Database for PostgreSQL Flexible Server** |
| Telemetry ingest backbone | **MSK**, or **Kinesis Data Streams** at lower volume | **Event Hubs** |
| Stream processing | **Managed Flink**, or Lambda consumers | **Stream Analytics**, or Functions |
| Time-series telemetry | **Timestream**, or Aurora with partitioning | **Azure Data Explorer** (Kusto) |
| Raw landing and evidence (WORM) | **S3 + Object Lock**, compliance mode | **Blob Storage** with an immutability policy |
| Audit ledger | **DynamoDB** hash-chained + S3 Object Lock replication | **Cosmos DB** + immutable Blob |
| Cache | **ElastiCache** for Redis | **Azure Cache for Redis** |
| Catalogue search | **OpenSearch** | **AI Search** |
| Analytics and benchmarking | **Athena** over S3, or **Redshift** | **Synapse**, or Fabric |

> The audit ledger is the one row where AWS's advantage is decisive rather
> than marginal: **S3 Object Lock in compliance mode** means a retention
> period that even a compromised root principal cannot shorten. Given the
> settled litigation, that property is close to the whole cloud argument.

### Identity, workflow and messaging

| Concern | AWS | Azure |
| --- | --- | --- |
| Customer identity | **Cognito**, federated to the customer's IdP | **Entra External ID** |
| Workforce identity | **IAM Identity Center** | **Entra ID** |
| Approval workflow orchestration | **Step Functions** | **Logic Apps** or **Durable Functions** |
| Email, SMS, push | **SES**, **SNS**, **Pinpoint** | **Communication Services** |
| Event routing | **EventBridge** | **Event Grid** |
| DNS and failover | **Route 53** health-checked failover | **Azure DNS** + **Traffic Manager** |
| CDN for the web app | **CloudFront** | Front Door, already present |

### AI inference

| Option | AWS | Azure |
| --- | --- | --- |
| Hosted frontier model | **Bedrock** (Anthropic models, in-region, in-account) | **Azure OpenAI** |
| Self-hosted open-source | **EKS** or **EC2** with GPU, vLLM behind an internal NLB | **AKS** with GPU node pool |
| Embeddings and vector search | Bedrock + **OpenSearch** vector engine | Azure OpenAI + **AI Search** |

> **Bedrock is worth a deliberate look on AWS.** It keeps inference inside
> the account and the region, which clears several gates in
> [25 Model data governance](25-model-data-governance.md) that a public API
> does not. The adapter interface already supports Azure OpenAI; Bedrock
> would be a new adapter of roughly the same size as the existing ones
> ([ADR-0013](../adr/0013-agent-model-provider-abstraction.md)).

### Operations

| Concern | AWS | Azure |
| --- | --- | --- |
| Backup and restore | **AWS Backup** | **Azure Backup** |
| Cost control | **Budgets**, **Cost Anomaly Detection** | **Cost Management** budgets and alerts |
| Config and compliance drift | **Config**, **Security Hub** | **Policy**, **Defender for Cloud** |
| Threat detection | **GuardDuty** | **Defender for Cloud** |
| Volumetric DDoS, beyond default | **Shield Advanced** | **DDoS Network Protection** |
| Distributed tracing | **X-Ray**, or OpenTelemetry → CloudWatch | Application Insights, already present |
| Secret rotation | Secrets Manager rotation Lambda | Key Vault with managed identity |

---

## 26.5 What to add, and when

| Phase | Add | Why then |
| --- | --- | --- |
| 1 — Pilot | Aurora/PostgreSQL, Cognito/Entra, Shield Advanced | The first real customers and the first real data |
| 2 — Supervised agent | Bedrock or Azure OpenAI, Step Functions/Logic Apps | Inference inside the boundary; approval workflow at scale |
| 3 — Scale out | MSK/Event Hubs, Timestream/ADX, ElastiCache/Redis, CloudFront | Telemetry volume and a second region |
| 4 — M&A at pace | **API Gateway / APIM**, OpenSearch/AI Search | Partner self-service and the developer portal |

Nothing in phase 1 is blocked by a decision deferred to a later phase, which
is the property worth protecting: each addition sits alongside or in front of
what exists rather than replacing it.

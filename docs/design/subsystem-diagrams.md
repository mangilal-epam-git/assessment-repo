# Subsystem architecture diagrams

These diagrams expand the [solution design](solution-design.md). All diagrams are Mermaid source embedded in Markdown, suitable for GitHub rendering. They describe the target architecture, not deployment evidence.

## 1. Full solution architecture

```mermaid
flowchart TB
  subgraph People[Actors]
    Guest[Guest]
    Fleet[Fleet dispatcher / maintenance manager]
    Driver[Driver]
    ProviderAdmin[Provider administrator]
    Auditor[Auditor / pricing approver]
  end
  subgraph Edge[Public edge and identity boundary]
    DNS[DNS and CDN - public content only]
    WAF[DDoS protection and WAF]
    Gateway[API gateway - rate limits and request IDs]
    OIDC[OIDC identity provider - MFA and federation]
  end
  subgraph App[Marketplace application services]
    API[Web and marketplace APIs]
    Authz[Tenant and purpose authorization]
    Catalogue[Canonical product catalogue]
    ProviderRegistry[Provider registry and certification]
    Consent[Consent and rights service]
    Offer[Offer comparison API]
    Pricing[Versioned FX and margin policy]
    Checkout[Order and checkout orchestration]
    Loyalty[Loyalty and customer profile]
    Notify[Notification policy and dispatcher]
    AuditProducer[Audit event producer]
  end
  subgraph External[External interfaces]
    Adapters[Isolated provider adapters]
    ProviderA[Certified provider A]
    ProviderN[Certified provider N]
    FX[FX quotation interface]
    PSP[PSP / wallet interface - no card data stored]
    Channels[Email / SMS / messaging]
  end
  subgraph Data[Jurisdiction-scoped data plane]
    Stream[Durable regional event bus]
    Ingest[Ingestion, schema and consent validation]
    Dedupe[Deduplication, ordering and identity resolution]
    Quarantine[Quarantine and quality review]
    Lake[(Encrypted regional data lake)]
    DB[(Tenant-scoped relational store)]
    AuditStore[(Append-only audit store)]
  end
  subgraph AI[Supervised AI and insights]
    Features[Rights-filtered features and analytics]
    Quality[Quality, provenance and freshness scoring]
    Model[Model serving and explanation]
    Tools[Allowlisted read and draft tools]
    Approval[Human approval queue]
    WorkOrder[Work-order interface]
  end
  subgraph Ops[Platform operations]
    Observe[Metrics, traces, redacted logs and alerts]
    Secrets[Managed secrets and key service]
    CICD[Protected CI/CD and signed artifacts]
    Terraform[Terraform landing zone and modules]
  end
  Guest --> DNS
  Fleet --> DNS
  Driver --> DNS
  ProviderAdmin --> DNS
  Auditor --> DNS
  DNS --> WAF --> Gateway
  Gateway --> OIDC
  Gateway --> API
  API --> Authz
  Authz --> Consent
  API --> Catalogue
  API --> ProviderRegistry
  API --> Offer
  Offer --> Pricing
  Offer --> Adapters
  Adapters --> ProviderA
  Adapters --> ProviderN
  API --> Checkout
  Checkout --> Pricing
  Checkout --> FX
  Checkout --> PSP
  API --> Loyalty
  API --> Notify --> Channels
  Adapters --> Stream --> Ingest --> Dedupe
  Dedupe -->|valid and consented| Lake
  Dedupe -->|invalid or conflicting| Quarantine
  Lake --> Features --> Quality --> Model --> Tools --> Approval
  Approval -->|approved purchase| Checkout
  Approval -->|approved ticket| WorkOrder
  API --> DB
  Ingest --> AuditProducer
  API --> AuditProducer
  Offer --> AuditProducer
  Checkout --> AuditProducer
  Consent --> AuditProducer
  AuditProducer --> AuditStore
  API --> Observe
  Stream --> Observe
  Model --> Observe
  Secrets -.-> API
  Secrets -.-> Adapters
  CICD --> API
  Terraform --> Edge
  Terraform --> App
  Terraform --> Data
  Terraform --> Ops
```

**Boundaries:** guests see only public/anonymised content; APIs enforce tenant, purpose, and jurisdiction; provider connections are isolated; telemetry remains in the approved region; payment is external; assistant actions remain drafts until approved. No remote vehicle actuation capability is present.

## 2. Telemetry ingestion and data quality

```mermaid
sequenceDiagram
  autonumber
  participant Device as Vehicle/device gateway
  participant Provider as Certified provider adapter
  participant Edge as Ingestion edge
  participant Consent as Consent/purpose service
  participant Schema as Schema and signature validator
  participant Identity as Event and vehicle identity resolver
  participant Queue as Durable regional stream
  participant Quality as Quality and spoofing checks
  participant Lake as Regional data lake
  participant Quarantine as Quarantine queue
  participant Audit as Audit evidence
  Device->>Provider: Telemetry event and source identity
  Provider->>Edge: Authenticated batch with idempotency key
  Edge->>Edge: Enforce size, rate, region and provider quota
  Edge->>Consent: Check purpose, consent, vehicle and effective time
  Consent-->>Edge: Allow or deny with policy version
  alt Consent denied or revoked
    Edge->>Audit: Record minimized denial evidence
    Edge-->>Provider: Reject unauthorized-purpose event
  else Consent allowed
    Edge->>Schema: Validate signature and schema
    Schema-->>Edge: Valid or invalid
    Edge->>Identity: Resolve event ID and device-to-vehicle claim
    Identity-->>Edge: New, duplicate or conflict
    Edge->>Queue: Publish accepted event with provenance
    Queue->>Quality: Process asynchronously and idempotently
    alt Quality and identity checks pass
      Quality->>Lake: Store encrypted, region-bound event and lineage
      Quality->>Audit: Record quality decision and source references
    else Spoof, conflict or low quality
      Quality->>Quarantine: Isolate event/provider cohort
      Quality->>Audit: Record reason code and evidence reference
    end
  end
```

Use stable event identifiers and idempotent writes so replay does not inflate counts. Preserve event-time and ingestion-time separately. Handle late events through a documented event-time window. Conflicting device-to-vehicle claims go to quarantine; never silently reassign sensitive location history.

## 3. Offer ranking subsystem

```mermaid
flowchart LR
  Request[GET /best-offers] --> Snapshot[Capture validated FX and margin snapshot once]
  Snapshot --> Fanout[Parallel bounded provider fan-out]
  Fanout --> P1[telemetry1 endpoint]
  Fanout --> P2[telemetry2 endpoint]
  P1 --> Array{Valid top-level array?}
  P2 --> Array
  Array -->|No| Unavailable[Mark provider unavailable]
  Array -->|Yes| Rows[Validate each row]
  Rows --> Fields{Exact allowed schema?}
  Fields -->|No| Reject[Record stable rejection reason]
  Fields -->|Yes| Duplicate{Repeated product ID within provider?}
  Duplicate -->|Yes| RejectGroup[Reject all rows for that provider/product]
  Duplicate -->|No| Eligible[Check counts, FX, UTC, quality, age and expiry]
  Eligible -->|No| Reject
  Eligible -->|Yes| Decimal[Decimal FX, markup and valid-event normalization]
  Decimal --> Rank[Rank unrounded cost, quality, recency, provider ID]
  Rank --> Format[Round-half-up only for serialization]
  Format --> Response[Sort product IDs and include versions]
  Unavailable --> Partial[Build partial metadata]
  Reject --> Partial
  RejectGroup --> Partial
  Partial --> Response
```

The winner is lowest unrounded `customerBundleEUR * 1000 / validEventCount`; ties are higher quality, newer observation, then lexically smaller configured provider ID. A malformed row does not poison sibling rows. Any rejected row or unavailable source makes the response partial. If neither source yields a valid top-level array, return safe HTTP 503; never use stale cache data.

## 4. Consent, revocation, and derived-data rights

```mermaid
sequenceDiagram
  autonumber
  actor Driver
  participant Portal as Consent portal
  participant Rights as Consent and rights ledger
  participant Policy as Policy decision point
  participant Ingest as Ingestion and purpose gates
  participant Lake as Regional raw and derived stores
  participant AI as Features and assistant
  participant Audit as Audit evidence
  Driver->>Portal: Grant purpose/scope or revoke
  Portal->>Rights: Write versioned decision with effective time
  Rights->>Audit: Append decision, actor, purpose and policy version
  Rights-->>Policy: Invalidate authorization cache and publish revocation
  Policy-->>Ingest: Updated allow/deny decision
  Policy-->>AI: Updated retrieval and feature entitlement
  Ingest->>Policy: Check purpose for new event
  Policy-->>Ingest: Deny processing after revocation
  AI->>Policy: Check current retrieval rights
  Policy-->>AI: Exclude revoked data/features
  Rights->>Lake: Enqueue deletion/recompute/restriction where required
  Lake-->>Audit: Record completion evidence and exceptions
```

Revocation affects future collection/use promptly and triggers a defined policy for previously derived data, backups, legal retention, and audit evidence.

## 5. Identity, tenant access, and payment controls

```mermaid
flowchart TD
  User[User or workload] --> Login[OIDC authentication]
  Login --> Claims[Verify issuer, audience, expiry and claims]
  Claims --> PDP[Authorization policy decision point]
  PDP --> Tenant{Tenant and team match?}
  Tenant -->|No| Deny[403 deny and audit]
  Tenant -->|Yes| Role{Role and domain allowed?}
  Role -->|No| Deny
  Role -->|Yes| Purpose{Purpose, consent and jurisdiction allowed?}
  Purpose -->|No| Deny
  Purpose -->|Yes| Resource[Tenant-scoped resource access]
  Resource --> Checkout{Checkout requested?}
  Checkout -->|No| Allow[Allow operation]
  Checkout -->|Yes| Method[Check method policy by tenant, user, jurisdiction]
  Method -->|Blocked or disabled| Deny
  Method -->|Allowed| Order[Create idempotent pending order]
  Order --> PSP[External PSP using token/reference]
  PSP --> Status[Persist safe status and opaque reference]
```

End-user membership and payment blocks belong in identity/application policy, not individual Terraform resources. Payment credentials never pass through platform storage or logs. Bitcoin is deny-by-default until approved.

## 6. AI recommendation and human approval boundary

```mermaid
sequenceDiagram
  autonumber
  actor Manager as Fleet manager
  participant API as Assistant API
  participant Auth as Tenant/purpose authorization
  participant Retrieval as Rights-filtered retrieval
  participant Model as Model and explanation layer
  participant Tools as Allowlisted tools
  participant Approval as Human approval service
  participant Order as Order/work-order system
  participant Audit as Audit log
  Manager->>API: Request maintenance or data recommendation
  API->>Auth: Check tenant, role, purpose and current consent
  Auth-->>API: Scoped authorization
  API->>Retrieval: Fetch authorized history and quality metadata
  Retrieval-->>Model: Minimized context with event references
  Model-->>API: Explanation, freshness, model version and draft
  API->>Tools: Validate tool name and typed arguments
  Tools-->>API: Draft only; no spend or actuation
  API->>Audit: Record proposal and provenance references
  API-->>Manager: Present rationale, price and impact
  Manager->>Approval: Explicitly approve or reject
  Approval->>Auth: Recheck role, consent, freshness and offer expiry
  Auth-->>Approval: Decision
  alt Approved and still valid
    Approval->>Order: Submit idempotent purchase or ticket
    Order->>Audit: Record outcome and approver identity
  else Rejected, stale or revoked
    Approval-->>Manager: Explain refusal; require refreshed proposal
    Approval->>Audit: Record rejection or denial
  end
```

Model output is untrusted. Provider text cannot change policy or grant tools. Approval binds to exact proposal, price, product, tenant, and expiry; material changes require new approval. No actuation tool may be registered.

## 7. M&A provider onboarding lifecycle

```mermaid
stateDiagram-v2
  [*] --> Submitted: Provider metadata submitted
  Submitted --> DueDiligence: Ownership, rights, jurisdiction and security review
  DueDiligence --> ContractMapped: Canonical schema and purpose mapping approved
  ContractMapped --> Sandbox: Adapter deployed with isolated credentials
  Sandbox --> ContractTest: Schema, auth, idempotency and failure tests
  ContractTest --> Shadow: Quality and latency measured, not ranked for customers
  Shadow --> Pilot: Limited region/fleet cohort approved
  Pilot --> Certified: Quality, availability, audit and support gates pass
  Pilot --> Remediation: Gate fails
  Remediation --> Sandbox: Fix and recertify
  Certified --> Suspended: Rights, quality, security or SLA violation
  Suspended --> Remediation: Root cause and evidence review
  Certified --> Retired: Version deprecation and migration complete
  Retired --> [*]
```

A versioned REST contract and provider-specific adapters keep subsidiary internals decoupled from marketplace core. Certification includes identity/key rotation, consent rights, region, canonical products, schema/event IDs, quality, timestamps, late/duplicate handling, security response, retention, support, and rollback.

## 8. Parameterized Terraform onboarding

```mermaid
flowchart LR
  Params[Reviewed onboarding parameters] --> Validate[Validate schema, owner and residency]
  Validate --> Plan[Terraform plan per environment and jurisdiction]
  Plan --> Policy[Check region, encryption, IAM, tags and network]
  Policy --> Review[Human review of plan, cost and residency]
  Review --> Apply[Protected short-lived CI apply role]
  Apply --> Modules[Composable Terraform modules]
  subgraph Modules
    Landing[Landing zone]
    Env[Environment and region]
    Team[Teams via for_each]
    Domain[Data domains via for_each]
    Provider[Certified providers via for_each]
    Workload[Services, queues, database and storage]
  end
  Modules --> Verify[Health, drift, audit and budget checks]
  Verify --> Ready[Onboarded infrastructure and boundaries]
  Validate -->|Invalid owner, domain or residency| Reject[Fail closed; no apply]
```

Terraform provisions team-level roles, service identities, policy boundaries, regional resources, and monitoring. It does not create per-user payment blocks or store application secrets. See [IaC onboarding](iac.md) for variable examples and state guidance.

## 9. Availability zones, recovery, and residency

```mermaid
flowchart TB
  Users[Users] --> Edge[Global DNS and DDoS edge]
  Edge --> Region
  subgraph Region[Approved jurisdiction region - active]
    AZ1[Availability zone 1 - API/workers]
    AZ2[Availability zone 2 - API/workers]
    DB[(Multi-AZ relational database)]
    Stream[(Regional durable stream)]
    Lake[(Regional encrypted object storage)]
    Audit[(Append-only audit store)]
    AZ1 --> DB
    AZ2 --> DB
    AZ1 --> Stream
    AZ2 --> Stream
    Stream --> Lake
    Stream --> Audit
  end
  Region --> Backup[Encrypted in-region backup and PITR]
  Region -. only when legally approved .-> Recovery[Approved recovery region/account]
  Backup --> Restore[Restore and verify exercise]
  Recovery --> Restore
  Restore --> Cutover[Controlled failover after residency gate]
```

Cross-region failover is conditional on legal residency and data-rights approval. If replication is prohibited, use in-region backup and document residual recovery objectives. Test restore integrity, consent behavior, key availability, DNS cutover, audit continuity, and data-location controls.

## 10. Notifications and retry safety

```mermaid
sequenceDiagram
  actor User
  participant Event as Business event
  participant Policy as Notification preferences
  participant Queue as Outbox and delivery queue
  participant Worker as Channel worker
  participant Provider as Email/phone/messaging provider
  participant Status as Delivery status
  Event->>Policy: Request notification with purpose and urgency
  Policy->>Policy: Check consent, quiet hours and escalation
  alt Suppressed or scheduled
    Policy-->>Event: Suppress or schedule and record reason
  else Allowed
    Policy->>Queue: Enqueue idempotent message reference
    Queue->>Worker: Deliver with bounded retry/backoff
    Worker->>Provider: Send minimal content with idempotency key
    Provider-->>Worker: Accepted or failure classification
    Worker->>Status: Record safe status and attempt metadata
    alt Transient failure
      Worker->>Queue: Retry with exponential backoff and jitter
    else Permanent failure
      Worker->>Status: Stop retry and apply escalation policy
    end
  end
  User-->>Provider: Opt out or revoke channel consent
  Provider-->>Policy: Preference callback where supported
```

Retries cannot bypass opt-outs or quiet hours. Use an outbox and idempotency keys to prevent duplicate sends.

## 11. Observability and audit flow

```mermaid
flowchart LR
  API[APIs and adapters] --> Telemetry[Metrics, traces and redacted logs]
  Ingest[Ingestion and quality] --> Telemetry
  AI[Assistant and approvals] --> Telemetry
  Checkout[Orders and PSP callbacks] --> Telemetry
  Telemetry --> Dashboards[Operational dashboards]
  Telemetry --> Alerts[On-call alerts and SLOs]
  API --> Events[Attributable business/security events]
  Consent[Consent decisions] --> Events
  Pricing[FX/margin approval and ranking versions] --> Events
  Approval[Human approvals] --> Events
  Events --> Store[(Restricted append-only evidence store)]
  Store --> Review[Auditor review and decision replay]
```

Operational telemetry and audit evidence have separate access and retention policies. Neither should contain secrets, card data, raw payloads by default, or unnecessary precise location. Audit records should retain stable references and versions needed for review.

## Status note

The assessment's coded scope is provider-offer normalization and ranking. These diagrams document the broader proposed architecture; identity integration, durable consent, payment-policy enforcement, ingestion, independent quality verification, AI safety, deployable Terraform, alerting, and DR still require implementation and verification.

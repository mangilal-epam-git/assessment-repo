# 2. Solution overview

## 2.1 System context (C4 level 1)

```mermaid
flowchart TB
  FO[Fleet operator<br/>dispatcher, maintenance manager]
  DRV[Driver]
  PRV[Provider administrator]
  AUD[Auditor]

  VH[VectorHarbor Data Marketplace<br/>and Fleet Assistant]

  PSP[[Payment service providers<br/>cards, wallets, PayPal]]
  FX[[FX rate provider]]
  NOT[[Notification gateways<br/>email, SMS, push, messaging]]
  TEL[[Certified telemetry providers<br/>telemetry1, telemetry2, ...n]]
  IDP[[Enterprise identity providers<br/>OIDC / SAML]]
  SUB[[Acquired subsidiary systems]]

  FO -->|browse, compare, buy, approve| VH
  DRV -->|manage consent, view own records| VH
  PRV -->|onboard and certify feeds| VH
  AUD -->|inspect evidence| VH

  VH -->|authorise and capture| PSP
  VH -->|rate snapshots| FX
  VH -->|deliver notifications| NOT
  VH <-->|offers and telemetry| TEL
  VH -->|federated login| IDP
  SUB -->|certified adapter| VH
```

Everything in double brackets is outside our control. Each has a defined
failure mode and a documented degradation path; none is permitted to make the
marketplace unavailable on its own.

## 2.2 Container view (C4 level 2)

```mermaid
flowchart TB
  subgraph edge[Edge]
    CDN[CDN and WAF<br/>rate limiting, managed rules]
    GW[API gateway<br/>authn, quotas, routing]
  end

  subgraph experience[Experience]
    WEB[Web application<br/>React SPA]
    BFF[Backend for frontend]
  end

  subgraph core[Core marketplace services]
    CAT[Catalogue service<br/>canonical products]
    OFF["**Offer normalisation<br/>and ranking** — CODED"]
    PRC[Pricing and margin service<br/>versioned approvals]
    ORD[Order and entitlement service]
    PAY[Payment orchestration]
    CON[Consent service]
    PROV[Provider onboarding<br/>and certification]
  end

  subgraph data[Data plane]
    ING[Telemetry ingestion<br/>dedupe, ordering, identity]
    QUA[Quality and provenance<br/>scoring and attestation]
    INS[Insights service<br/>explainable aggregates]
  end

  subgraph agent[Supervised agent]
    ORC[Agent orchestrator<br/>built in-house]
    TOOL[Tool registry<br/>allow-list + schemas]
    APPR[Approval service<br/>human gate]
  end

  subgraph platform[Cross-cutting]
    IAM[Identity and tenancy]
    AUDIT[(Audit ledger<br/>append-only)]
    NOTS[Notification service]
    OBS[Observability]
  end

  subgraph stores[Stores]
    PG[(PostgreSQL<br/>transactional, per-tenant RLS)]
    TS[(Time-series store<br/>telemetry)]
    OBJ[(Object store<br/>evidence, snapshots)]
    BUS[(Event bus)]
  end

  EXT[[External providers]]

  CDN --> GW --> BFF --> WEB
  BFF --> CAT & OFF & ORD & INS & CON & ORC
  OFF --> PRC
  OFF -->|fan-out, no cache| EXT
  OFF --> QUA
  ORD --> PAY --> PSP[[PSPs]]
  PROV --> EXT
  ING -.-> BUS -.-> QUA & INS
  EXT -.-> ING
  ORC --> TOOL --> APPR
  APPR --> ORD

  CAT & OFF & PRC & ORD & CON & QUA & INS & ORC --> AUDIT
  CAT & ORD & CON & PRC --> PG
  ING --> TS
  AUDIT --> OBJ
  IAM -.authorises.-> GW
  NOTS --> NOT[[Gateways]]
  OBS -.scrapes.-> core
```

The bold container is the slice implemented in this repository. Everything
else is designed here and not built.

### Container responsibilities

| Container | Responsibility | Why it is separate |
| --- | --- | --- |
| Catalogue | Owns canonical product IDs and their defining attributes | The canonical ID is the comparison key; one owner prevents drift |
| **Offer normalisation and ranking** | Fetch, validate, normalise and rank provider offers | Pure, stateless, deterministic — the part that must be reproducible |
| Pricing and margin | Margin configuration with versioned approvals and effective times | Changing a margin is a governed act, not a config edit |
| Order and entitlement | What a customer bought, and what that entitles them to | Entitlement outlives the offer that created it |
| Payment orchestration | Talks to PSPs; holds no card data | Keeps PCI scope out of the platform entirely |
| Consent | Consent grants, scopes, revocation, and the separation of advertising from operations | Consent is queried by nearly everything; it must not be embedded anywhere |
| Provider onboarding | Adapter registration, conformance testing, certification | The M&A on-ramp; see [15](15-ma-integration-governance.md) |
| Telemetry ingestion | Duplicate, delayed, out-of-order events and identity conflicts | Hard, high-volume, and isolated from the transactional path |
| Quality and provenance | Independent verification of quality claims; spoof detection | Must be independent of the provider making the claim |
| Insights | Explainable aggregates with source references and attribution | Explainability is a product requirement, not a debug aid |
| Agent orchestrator | Plans, calls allow-listed tools, produces proposals | Built in-house; turnkey agent products are prohibited |
| Approval | Human gate before any spend or operational change | The single enforcement point for supervision |
| Audit ledger | Append-only record of every decision-relevant event | The evidentiary backbone demanded by the legal context |

## 2.3 Component view of the coded slice (C4 level 3)

```mermaid
flowchart TB
  subgraph svc[Offer normalisation and ranking service]
    direction TB
    APP[app.js<br/>routing, request id, load shedding,<br/>deadlines, safe errors]
    SRV[service.js<br/>orchestration, partial-result policy]
    PC[provider-client.js<br/>timeout, size cap, no-store]
    RT[retry.js<br/>bounded attempts, full jitter, budget]
    VAL[validation.js<br/>strict closed row contract]
    RNK[ranking.js<br/>eligibility and selection]
    PRI[pricing.js<br/>FX, markup, per-1000 normalisation]
    RAT[rational.js<br/>exact BigInt arithmetic]
    CFG[config.js<br/>validated snapshots, hot reload]
    CLK[clock.js<br/>injectable time]
    LOG[logger.js<br/>structured JSON, redaction]
    MET[metrics.js<br/>Prometheus exposition]
  end

  P1[[telemetry1 endpoint]]
  P2[[telemetry2 endpoint]]

  APP --> SRV
  SRV --> PC --> RT
  PC --> P1 & P2
  SRV --> RNK --> VAL & PRI
  PRI --> RAT
  RNK --> RAT
  SRV --> CFG
  SRV --> CLK
  APP --> LOG & MET
  CFG --> LOG
```

Dependencies point inward: `rational.js` knows nothing about HTTP, and
`app.js` knows nothing about FX. The ranking core is a pure function of
`(rows, snapshot, now)`, which is what makes it exhaustively testable and
reproducible from an audit record.

## 2.4 Request walkthrough: `GET /best-offers`

```mermaid
sequenceDiagram
  autonumber
  participant C as Client
  participant A as app.js
  participant S as service.js
  participant CF as ConfigStore
  participant P1 as ProviderClient<br/>telemetry1
  participant P2 as ProviderClient<br/>telemetry2
  participant R as ranking + pricing

  C->>A: GET /best-offers
  A->>A: assign request id, check readiness and concurrency
  A->>A: start request deadline, wire client-disconnect abort
  A->>S: getBestOffers(signal, requestId)
  S->>CF: current()
  CF-->>S: immutable snapshot (fxVersion, marginVersion, rates, margin, floor)
  S->>S: now = clock.now()  (one instant for the whole request)

  par Concurrent fan-out
    S->>P1: fetchOffers(signal)
    P1->>P1: attempt with timeout; retry 5xx/timeout with jitter
    P1-->>S: {ok, rows} or {ok:false, failureCode}
  and
    S->>P2: fetchOffers(signal)
    P2-->>S: {ok, rows} or {ok:false, failureCode}
  end

  alt No provider returned a valid array
    S-->>A: AllProvidersUnavailableError
    A-->>C: 503 {code: ALL_PROVIDERS_UNAVAILABLE, requestId}
  else At least one usable array
    S->>R: evaluate rows per provider
    R->>R: reject duplicates, then validate, then check eligibility
    R->>R: price eligible rows with exact rational arithmetic
    R-->>S: candidates + rejected rows with reasons
    S->>S: select best per productId, sort ascending
    S->>S: serialise with round-half-up at 2/6/4 places
    S-->>A: body with asOf, versions, partial, rejections, offers
    A-->>C: 200 (partial=true if anything was excluded)
  end
```

Three properties of this flow are worth stating explicitly, because they are
the ones an auditor will ask about.

**One snapshot, one clock, one request.** The configuration snapshot and the
evaluation instant are captured once at the start. A margin change applied
mid-request cannot produce a response in which two products were priced under
different rules.

**No cache, ever, in this slice.** Provider responses are fetched with
`cache: 'no-store'` and never persisted. Serving a stale offer would be
exactly the kind of misleading pricing claim the group has just settled.

**Exclusion is reported, not hidden.** Every rejected row appears in
`rejectedRows` with a stable machine-readable reason, and the response is
flagged `partial`. A customer can see that a cheaper-looking bundle was
excluded, and why.

## 2.5 Technology choices

| Layer | Choice | Reasoning |
| --- | --- | --- |
| Primary cloud | AWS | [ADR-0001](../adr/0001-cloud-vendor-selection.md) |
| Compute | Fargate (AWS) / Container Apps (Azure) | [ADR-0005](../adr/0005-serverless-containers.md) |
| Service runtime | Node.js 22 LTS, ES modules, zero runtime dependencies | [ADR-0003](../adr/0003-zero-runtime-dependencies.md) |
| Monetary arithmetic | Exact rationals over BigInt | [ADR-0004](../adr/0004-exact-decimal-arithmetic.md) |
| Transactional store | PostgreSQL with row-level security | Mature tenancy isolation; see [ADR-0011](../adr/0011-multi-tenancy-isolation.md) |
| Telemetry store | Time-series store with per-region partitioning | Write-heavy, append-mostly, residency-partitionable |
| Event backbone | Managed streaming with per-tenant partition keys | Ordering per vehicle without global ordering cost |
| Audit | Append-only ledger plus object storage with Object Lock | [ADR-0008](../adr/0008-event-sourced-audit-trail.md) |
| Frontend | React SPA behind a backend-for-frontend | Optional for the coded task; not implemented |
| IaC | Terraform | Both clouds, one toolchain, reviewable plans |
| CI/CD | GitHub Actions with OIDC federation | No long-lived cloud credentials |

Node.js was chosen for the coded slice because the work is I/O-bound fan-out
with strict serialisation rules, and because BigInt gives exact arithmetic
without a dependency. The same slice would be equally defensible in Go or
Java; what would not be defensible is binary floating-point money in any
language.

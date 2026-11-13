# Architecture diagrams and decision records

This folder contains the solution overview and detailed infrastructure design for the Greenfield VectorHarbor Mobility assessment. The diagrams are Mermaid source and render in GitHub Markdown.

## Documents

- [Solution design](solution-design.md) — end-to-end logical architecture, requirements mapping, reliability, security, capacity, DR, AI safety, governance, and rollout gates.
- [Terraform / IaC](iac.md) — parameterized team, domain, and provider onboarding design, state, CI, and safety gates.
- [Development guide](../development.md) — implementation workflow, tests, retry policy, and known scaffold gaps.
- [Wiki home](../wiki/Home.md) — navigable operator and contributor documentation.
- [ADR-001: offer ranking](adr/ADR-001-provider-offer-ranking.md)
- [ADR-002: access governance](adr/ADR-002-access-governance.md)

## System context

```mermaid
C4Context
  title VectorHarbor Marketplace - system context
  Person(fleet, "Fleet operator", "Finds eligible data and approves actions")
  Person(driver, "Driver", "Manages consent and personal records")
  Person(provider, "Provider administrator", "Certifies an adapter and offers feeds")
  Person(auditor, "Auditor", "Reviews access, pricing, provenance, and actions")
  System(platform, "VectorHarbor platform", "Marketplace, telemetry, insights, supervised assistant")
  System_Ext(identity, "OIDC identity provider", "Authentication and workforce federation")
  System_Ext(payment, "Payment service provider", "External tokenized payment interface")
  System_Ext(notify, "Notification providers", "Email, phone, messaging")
  Rel(fleet, platform, "Browse, purchase, approve")
  Rel(driver, platform, "Consent, inspect records")
  Rel(provider, platform, "Register and certify data adapter")
  Rel(auditor, platform, "Review controlled evidence")
  Rel(platform, identity, "OIDC / scoped claims")
  Rel(platform, payment, "Payment token / status only")
  Rel(platform, notify, "Consent-checked delivery")
```

## Offer evaluation sequence

```mermaid
sequenceDiagram
  autonumber
  actor Fleet as Fleet client
  participant API as Offer API
  participant Config as Config snapshot
  participant One as Provider telemetry1
  participant Two as Provider telemetry2
  participant Rank as Validator and ranker
  Fleet->>API: GET /best-offers
  API->>Config: Capture one validated snapshot
  par Bounded parallel fetch
    API->>One: GET configured endpoint
    One-->>API: Offer array or failure
  and
    API->>Two: GET configured endpoint
    Two-->>API: Offer array or failure
  end
  API->>Rank: Payloads + source IDs + snapshot + injected clock
  Rank->>Rank: Validate, reject duplicates, check consent-quality fields/freshness
  Rank->>Rank: Decimal FX and markup; rank unrounded normalized cost
  Rank-->>API: Sorted winners, rejections, unavailable sources
  API-->>Fleet: 200 partial/complete, or 503 if no valid source array
```

## Data and trust boundaries

```mermaid
flowchart LR
  subgraph Untrusted[Untrusted provider boundary]
    P[Provider offer payload]
  end
  subgraph Control[Trusted control plane]
    REG[Provider registry and endpoint identity]
    CFG[Approved FX / margin snapshot]
    POLICY[Consent, tenant, residency policy]
  end
  subgraph Runtime[Regional data plane]
    ADAPTER[Authenticated adapter]
    VALIDATE[Schema, quality, freshness, duplicate checks]
    RANK[Deterministic ranker]
    AUDIT[Append-only decision evidence]
  end
  P --> ADAPTER
  REG --> ADAPTER
  ADAPTER --> VALIDATE
  CFG --> RANK
  POLICY --> VALIDATE
  VALIDATE --> RANK
  VALIDATE --> AUDIT
  RANK --> AUDIT
```

Provider claims are data to validate, not instructions. Audit evidence must be privacy-minimized, access-controlled, retained under policy, and sufficient to reproduce a ranking decision without retaining secrets or payment details.

# Architecture decision records

Each ADR captures one architecturally significant decision: its context, the
options considered, the decision taken, and the consequences accepted.

Format: a lightly extended [Nygard](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions)
template. Status values are `Proposed`, `Accepted`, `Superseded by NNNN` or
`Deprecated`. ADRs are immutable once accepted; a change of mind is a new ADR
that supersedes the old one, because the record of what was believed at the
time is part of the value.

| ADR | Title | Status |
| --- | --- | --- |
| [0001](0001-cloud-vendor-selection.md) | AWS as the primary cloud vendor | Accepted |
| [0002](0002-quality-normalised-comparison.md) | Rank on cost per 1000 valid events | Accepted |
| [0003](0003-zero-runtime-dependencies.md) | Zero third-party runtime dependencies | Accepted |
| [0004](0004-exact-decimal-arithmetic.md) | Exact rational arithmetic for money | Accepted |
| [0005](0005-serverless-containers.md) | Serverless containers, not Kubernetes | Accepted |
| [0006](0006-retry-and-resilience-policy.md) | Bounded retries with full jitter | Accepted |
| [0007](0007-configuration-snapshots.md) | Immutable, versioned configuration snapshots | Accepted |
| [0008](0008-event-sourced-audit-trail.md) | Append-only audit ledger | Accepted |
| [0009](0009-provider-adapter-contract.md) | A published provider adapter contract | Accepted |
| [0010](0010-agent-tool-allowlisting.md) | Agents propose; humans approve | Accepted |
| [0011](0011-multi-tenancy-isolation.md) | Four-layer tenant isolation | Accepted |
| [0012](0012-payment-provider-abstraction.md) | Payment provider abstraction | Accepted |
| [0013](0013-agent-model-provider-abstraction.md) | Pluggable model backend with a deterministic default | Accepted |

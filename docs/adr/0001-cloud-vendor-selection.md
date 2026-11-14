# ADR-0001: AWS as the primary cloud vendor

- **Status:** Accepted
- **Date:** 2026-11-14
- **Deciders:** Solution architecture, platform engineering, security
- **Supersedes:** —

## Context

The brief requires a cloud vendor recommendation with explicit reasoning, and
mandates that all environments, CI/CD, databases and operational tooling are
cloud-hosted. Relevant constraints: EU data residency for the launch
jurisdiction, DDoS resilience as a launch requirement, acquisition-led growth
implying heterogeneous inherited estates, and a legal context demanding
immutable audit evidence.

## Options considered

### Option A — AWS

Strongest EU regional coverage for the launch jurisdiction (Stockholm,
Frankfurt, Ireland, Paris, Milan, Zurich, Spain), which matters for a
geofenced residency model that will expand region by region. Shield Standard
is always on, WAFv2 is mature, and S3 Object Lock provides WORM storage
suited to the evidentiary requirement. The managed-service catalogue for
streaming telemetry (MSK, Kinesis, Timestream) is deep. The largest talent
pool, which matters when integrating acquired engineering teams.

Against: WAF per-request pricing is the single largest line in the cost model
([13](../architecture/13-cost-model.md)); NAT gateway data processing is
expensive; the service catalogue's breadth is itself a governance burden.

### Option B — Azure

Front Door Premium bundles global anycast, WAF and DDoS absorption in one
product with simpler per-request economics, and came out roughly $2 700/year
cheaper at modelled volume. Entra ID integration is superior if acquired
companies run Microsoft estates, which many logistics businesses do.
Container Apps bills by the second with no NAT-gateway equivalent.

Against: Front Door Premium's $330/month fixed fee penalises small
environments; fewer EU regions than AWS; the Terraform provider surface
changes more frequently, which raises IaC maintenance cost.

### Option C — Google Cloud

Strongest data and ML tooling (BigQuery, Vertex), which is attractive for the
analytics and assistant workloads. Cloud Armor is a capable WAF.

Against: the thinnest EU regional footprint of the three, which directly
conflicts with a residency model designed to expand region by region; a
smaller enterprise logistics partner ecosystem; least common in the kind of
company VectorHarbor acquires.

### Option D — Multi-cloud from day one

Rejected without extended analysis. It would mean building to the lowest
common denominator, doubling operational surface and halving the depth of
expertise, during a phase where the priority is a clean day-one launch.

## Decision

**AWS is the primary cloud**, with the **Azure stack maintained as a fully
specified, validated alternative** in `infrastructure/azure/`.

The deciding factors, in order:

1. **EU regional breadth.** Residency is geofenced and will expand region by
   region. AWS's EU footprint gives the most options for placing a new
   cohort's data plane without redesign.
2. **Evidentiary storage.** S3 Object Lock in compliance mode gives WORM
   retention that even a compromised root principal cannot delete. Given the
   legal context, this is close to decisive on its own.
3. **Operational maturity for the failure modes we care about.** Shield,
   WAFv2, ALB and ECS are well-trodden; the DDoS posture does not depend on a
   preview service.
4. **Talent and acquisition fit.** The largest pool, which lowers the cost of
   absorbing acquired engineering teams.

Cost was explicitly **not** decisive. Azure's ~$2 700/year advantage is
immaterial against the above and is documented so the decision can be
revisited if volume grows by an order of magnitude.

## Consequences

**Positive.** A single primary platform allows deep expertise. Residency
expansion is a configuration exercise. Object Lock satisfies the audit
requirement directly. Maintaining the Azure stack keeps the decision
reversible and gives a real answer if an acquisition arrives with a
significant Azure commitment.

**Negative.** Per-request WAF pricing dominates the cost model, so
cost-efficiency work must target the edge rather than the application.
Maintaining two IaC stacks costs roughly 15% extra effort on infrastructure
changes. There is a genuine risk the Azure stack rots if it is never
deployed, which is why CI validates both on every push.

**Neutral.** Terraform rather than a cloud-native IaC tool keeps the
portability real rather than notional.

## Revisit when

Volume grows 10× and the edge cost difference becomes material; an
acquisition brings a large Azure or GCP commitment; residency requirements
force a region where AWS has no presence; or Azure's EU footprint overtakes
AWS's for the regions in our expansion plan.

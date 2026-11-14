# ADR-0005: Serverless containers rather than Kubernetes

- **Status:** Accepted
- **Date:** 2026-11-14
- **Deciders:** Platform engineering, solution architecture

## Context

The platform needs a container runtime for a set of stateless HTTP services,
scaling from a 20-fleet pilot to tens of thousands of concurrent users with
seasonal and weather-driven surges. All environments must be cloud-hosted.
The team is building a new platform from scratch under launch pressure.

## Options considered

### Option A — Kubernetes (EKS / AKS)

Maximum portability and ecosystem. The right answer at sufficient scale and
service count.

Against: a control plane to operate, upgrade and secure; node-group capacity
management; a cluster-wide blast radius for misconfiguration; and roughly
$75/month per cluster before any workload, times three environments. Most
significantly, it requires platform-engineering capacity that, at launch,
is better spent on the quality-verification and consent services that
differentiate the product.

### Option B — Serverless containers (Fargate / Container Apps)

Same container images, no control plane, per-task billing, native
integration with the cloud's load balancing, scaling, secrets and
observability.

Against: less control over scheduling and networking, cold-start latency on
scale-out, and per-vCPU pricing that is higher than raw EC2 at sustained high
utilisation.

### Option C — Serverless functions (Lambda / Functions)

Cheapest at low volume, scales instantly.

Against: a poor fit for a fan-out service holding concurrent outbound
connections; cold starts affect tail latency on a path with a p99 target;
and the execution model would complicate graceful shutdown and connection
reuse, both of which matter here.

### Option D — Virtual machines

Rejected: maximum operational burden for no benefit at this scale.

## Decision

**Serverless containers**: ECS Fargate on AWS, Container Apps on Azure.

Standard OCI images mean the decision is reversible: migrating to Kubernetes
later changes the deployment manifests, not the application.

## Consequences

**Positive.** No control plane to operate, so the team ships product instead
of platform. Scaling is declarative and tested. Per-task billing suits a
workload with a large peak-to-average ratio; compute is only 14% of the cost
model ([13](../architecture/13-cost-model.md)), so the per-vCPU premium is
immaterial. Task-level IAM gives tight least-privilege boundaries.
Non-production can use Spot for roughly 70% savings.

**Negative.** Scale-out takes around 45 seconds per task, which means a
severe-weather surge has a two-to-three minute window where load shedding may
engage ([12.4](../architecture/12-capacity-plan.md#124-sizing)). Accepted
and documented rather than solved by permanent over-provisioning. No
DaemonSet-style sidecar patterns, so observability relies on the application
exposing `/metrics` directly — which it does. Vendor-specific deployment
configuration, mitigated by maintaining both stacks in Terraform.

**Neutral.** Portability is preserved at the image level, which is the level
that matters.

## Revisit when

Service count exceeds roughly 20, or sustained utilisation makes reserved
capacity materially cheaper, or a workload needs scheduling control that
Fargate cannot express (GPU scheduling for model inference is the most likely
trigger).

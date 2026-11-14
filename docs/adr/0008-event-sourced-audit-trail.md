# ADR-0008: Append-only audit ledger as the evidentiary backbone

- **Status:** Accepted
- **Date:** 2026-11-14
- **Deciders:** Solution architecture, legal, security

## Context

The group has exited a lawsuit settling an allegation of fraud in
data-quality and billing claims. The new line must support defensible
provenance, reproducible pricing and **independently reviewable audit
evidence**. Auditors must be able to inspect access, pricing and action
histories.

Conventional application logging is insufficient: logs are mutable, roll off
on a retention schedule, are written by the same code whose behaviour is in
question, and are not designed to be read by a non-engineer.

## Options considered

### Option A — Application logs plus database history tables

Cheap and familiar. Rejected: both are mutable by the application, and a
`updated_at` column records that something changed, not what the prior state
was or who decided it.

### Option B — Full event sourcing as the primary persistence model

Every state change as an event, with state as a projection. Maximum
auditability.

Rejected as a platform-wide model: it imposes event-sourcing complexity on
every service, including those with no audit relevance, and the team is
building a new platform under launch pressure. The cost falls in the wrong
place.

### Option C — A dedicated append-only ledger alongside conventional storage

Services use normal transactional storage, and additionally emit immutable
audit events for decision-relevant actions. The ledger is hash-chained and
replicated to WORM storage.

## Decision

**Option C.** A dedicated, append-only, hash-chained audit ledger, replicated
continuously to object storage with Object Lock in compliance mode.

### What is recorded

| Domain | Events |
| --- | --- |
| Pricing | Every ranking result with its inputs digest, `fxVersion`, `marginVersion`, `asOf`, winner and rejections |
| Configuration | Every proposal, approval, activation and rejected reload |
| Consent | Every grant, revocation, and each decision that relied on one |
| Agent | Every proposal, approval, rejection, expiry and execution |
| Provider | Certification changes, standing changes, quality deltas |
| Access | Every data access with purpose and entitlement; every break-glass |
| Orders | Placement, pricing decomposition, fulfilment, refunds |

### Integrity properties

Entries are append-only with no update or delete path. Each entry carries the
hash of its predecessor, so any alteration breaks the chain. Periodic chain
checkpoints are published. Object Lock in compliance mode means even a
compromised root principal cannot delete an entry within its retention
period. The ledger's encryption key scope is separate from application data,
so application compromise does not imply audit compromise.

### Access

Auditors have read-only access through a query interface designed for
non-engineers — "show every price for product X in June, and the
configuration version each used" — not a log search box.

## Consequences

**Positive.** A price can be reconstructed exactly, because the inputs,
versions and evaluation instant are all recorded and the ranking function is
pure and deterministic. The blast radius of a bad configuration becomes a
query rather than an estimate, which is what makes the corruption-recovery
procedure in [14.5](../architecture/14-disaster-recovery.md) exact. Provider
disputes resolve against signed records. The supervision requirement becomes
provable: "zero actions without a recorded approval" is a query with a
numeric answer.

**Negative.** Roughly 1 500 additional durable writes per second at phase 3
([12.5](../architecture/12-capacity-plan.md#125-other-tiers)), batched and
asynchronous. Seven-year retention has a real storage cost, modest relative
to the exposure it covers. Erasure requests interact awkwardly with
immutability — resolved by keeping personal payloads in erasable stores
referenced by pseudonymous ledger entries, so erasure leaves the chain intact
([10.5](../architecture/10-privacy-consent-residency.md#105-data-subject-rights)).

**Neutral.** Audit emission is asynchronous and must not block the request
path, so there is a small window where an action has occurred and its record
is still in flight. Buffered durably and reconciled; a gap is itself an
alertable condition.

## In the coded slice

The slice does not write to a ledger — there is no ledger to write to — but
it produces exactly the evidence one would ingest: every response carries
`asOf`, `fxVersion`, `marginVersion`, the full inputs for each winning offer,
and every rejection with its reason. The `best-offers.completed` log event
carries the same in machine-readable form.

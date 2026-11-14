# ADR-0002: Rank offers on cost per 1000 valid events

- **Status:** Accepted
- **Date:** 2026-11-14
- **Deciders:** Solution architecture, product, legal

## Context

Multiple providers quote the same canonical telemetry product with different
event counts, different verified-quality proportions and different
currencies. The platform must "always display the best eligible customer
price using a transparent, quality-normalised comparison".

The group has just settled an allegation of fraud in data-quality and billing
claims, so the comparison must be not merely reasonable but defensible and
reproducible.

## Options considered

### Option A — Lowest bundle price after conversion

Simple, intuitive, and what a naive implementation produces. It is also
misleading: in the brief's own fixtures, telemetry1's `eu-north-location-hour`
offer converts to 12.00 EUR against telemetry2's 11.96 EUR — effectively
identical — while telemetry2 supplies 114 000 valid events to telemetry1's
98 000. Ranking by bundle price would present a 14% worse deal as equivalent.

The brief explicitly warns against this: *do not silently replace the
normalised comparison with lowest bundle price.*

### Option B — Cost per event

Better, but counts unusable events. A provider supplying 100 000 events of
which 50 000 are invalid would appear twice as cheap as one supplying 50 000
clean events at the same price, for identical delivered value.

### Option C — Cost per **valid** event, with a quality floor

Normalises on the quantity the customer can actually use, and refuses offers
below a minimum quality so that a very poor feed cannot win simply by being
voluminous and cheap.

### Option D — A weighted multi-factor score

Combine price, quality, freshness, provider reputation and coverage into a
composite score. More expressive, and far more flexible commercially.

Rejected, and this is the most interesting rejection. A weighted score is
**not defensible**: the weights are a business judgement, so a customer
disputing their price would be disputing an opinion rather than an
arithmetic. After a fraud settlement about pricing claims, "our algorithm
weighted quality at 0.3" is a much weaker position than "here is the
division". Reputation and freshness therefore act as **eligibility gates**,
not as score components — binary, explainable, and arguable on their merits.

## Decision

Rank on **`costPer1000ValidEventsEUR`**, computed as:

```
providerEUR       = (priceMinor / 100) × FX[currency]
customerBundleEUR = providerEUR × (1 + marginBasisPoints / 10000)
costPer1000       = customerBundleEUR × 1000 / validEventCount
```

Eligibility gates applied first: quality ratio ≥ 0.90, observation no more
than 15 minutes old, and `now` strictly before the effective expiry.

The lowest **unrounded** value wins. Ties break on higher quality ratio, then
newer `observedAt`, then lexicographically smaller provider ID — a total
order, so the result never depends on timing or iteration order.

Per 1000 rather than per event purely for human readability: 0.115404 reads
better than 0.000115404.

## Consequences

**Positive.** The comparison is a single division a customer can perform
themselves. Quality is rewarded automatically rather than through a policy.
A low-quality feed cannot appear artificially cheap, which is a direct
requirement. The result is deterministic and reproducible from an audit
record.

**Negative.** Providers must supply honest `validEventCount` values, which
creates a strong incentive to overstate them — addressed by the verification
layers in [5](../architecture/05-data-quality-and-provenance.md), and the
most significant residual risk in the design. A provider marginally below the
0.90 floor is excluded entirely, which is a blunt instrument; the floor is
configurable per deployment so it can be tuned with evidence.

**Neutral.** Commercial flexibility is constrained: the platform cannot
promote a strategic provider through the ranking. That is intentional. If
commercial promotion is ever required, it must be a labelled placement, not a
distorted comparison.

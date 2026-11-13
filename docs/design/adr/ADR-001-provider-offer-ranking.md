# ADR-001: Deterministic quality-normalized offer ranking

- **Status:** Proposed
- **Date:** 2026-11-13
- **Decision owners:** Marketplace architecture and data governance

## Context

Providers can offer the same canonical telemetry product with differing event counts, data quality, currencies, and prices. Comparing nominal bundle prices can favor offers with fewer usable events or poor quality. A historical legal allegation makes reproducible, independently reviewable pricing essential.

## Decision

Compare only identical canonical product IDs. Validate row and source identity, freshness, expiry, configured currency, and quality threshold. Convert provider cost to EUR using a versioned FX snapshot, apply a separately versioned markup, and rank using unrounded decimal/rational `customerBundleEUR * 1000 / validEventCount`. Break exact ties by higher quality, newer observation, then lexicographically smaller configured provider identity. Round only for response serialization. Return rejection and availability metadata; never silently use stale cached offers.

## Consequences

- Ranking is deterministic and auditable when input rows, time, FX, margin, and algorithm version are retained appropriately.
- FX and markup versions are mandatory response metadata.
- Output bundle price is not the ranking metric; clients should present both values clearly.
- Provider quality must be independently measured in production; the exercise fixture counts are trusted only for the coding task.
- Decimal precision, exact tie behavior, row duplicates, UTC parsing, and freshness boundaries require regression tests.

## Alternatives considered

- **Lowest bundle price:** rejected because event volume and verified quality differ.
- **Round each value before ranking:** rejected because display rounding can create false ties and change winners.
- **Use provider-reported quality without verification in production:** rejected due to incentive and fraud risk; exercise-only trust is explicitly limited.
- **Serve cached stale results on outage:** rejected because stale eligibility can mislead customers; return an explicit partial result instead.

# ADR-0004: Exact rational arithmetic for monetary comparison

- **Status:** Accepted
- **Date:** 2026-11-14
- **Deciders:** Solution architecture, engineering, finance

## Context

The brief requires decimal or rational arithmetic rather than binary floating
point for monetary comparison, with round-half-up applied only at
serialisation. The comparison is a strict inequality between values that can
be arbitrarily close, and its output is a price a customer pays and an
auditor may recompute.

Binary floating point cannot represent 0.1, 0.92 or 1.18 exactly. Errors are
tiny individually but accumulate across a four-step pipeline (divide,
multiply by FX, multiply by margin, divide by event count), and they are not
symmetric.

## Options considered

### Option A — IEEE-754 doubles

Fast and native. Rejected: `0.1 + 0.2 !== 0.3`, and a price that cannot be
reproduced exactly by a customer's spreadsheet is a dispute waiting to
happen. The brief prohibits it directly.

### Option B — Scaled integers (fixed point)

Represent everything in a fixed number of minor units. Exact for addition and
multiplication, but division — which this pipeline does twice — forces an
early rounding decision, and `costPer1000` is frequently a repeating decimal.
Rounding before comparison is exactly what the brief forbids.

### Option C — A decimal library (decimal.js, big.js)

Arbitrary-precision decimal with configurable rounding. Correct and
well-tested, but still requires choosing a working precision, so a repeating
decimal is rounded somewhere before comparison. It also contradicts
[ADR-0003](0003-zero-runtime-dependencies.md).

### Option D — Exact rationals over BigInt

Represent every value as a normalised fraction `n/d` with `BigInt`
numerator and denominator. Addition, multiplication and division are all
exact with no precision choice at all; `1/3` is stored as `1/3`, not as
`0.333...`. Comparison is `a.n × b.d` against `b.n × a.d` — exact integer
arithmetic.

## Decision

**Exact rational arithmetic over `BigInt`** (`src/best-offers/rational.js`),
with round-half-up applied **once**, at serialisation, at the contract
precisions: 2 decimal places for `customerBundleEUR`, 6 for
`costPer1000ValidEventsEUR`, 4 for `qualityRatio`.

Supporting rules: FX rates are configured as **decimal strings**, not JSON
numbers, and the configuration validator rejects a number — because a JSON
number is parsed as a double and would smuggle floating point into the
snapshot. `toFixedHalfUp` refuses negative values, since no negative money
exists in this domain and refusing them avoids ambiguity about rounding
below zero.

## Consequences

**Positive.** No rounding error exists before serialisation, so the
comparison is exact by construction. A customer can reproduce any published
figure with a calculator. Round-half-up matches the published contract rather
than a language default (JavaScript's `toFixed` is neither half-up nor
reliably half-even). Magnitudes beyond `Number.MAX_SAFE_INTEGER` are handled
correctly, tested to 10³⁰.

**Negative.** Roughly 100 lines of arithmetic code to own and test. BigInt
operations are slower than doubles. Denominators can grow large across
chained operations, though normalisation by GCD at every step bounds this in
practice.

**The cost objection is measured, not assumed.** The full validate-price-rank
-serialise pipeline runs at **0.018 ms** for the brief's 10-row fixtures and
**2.25 µs per row** at 1000 rows
([12.1](../architecture/12-capacity-plan.md#121-measured-performance)). At
realistic payload sizes the ranking core could serve over 50 000 requests per
second per core. Exactness is effectively free; HTTP and JSON dominate.

## Verification

`test/unit/rational.test.js` asserts: `0.1 + 0.2` equals `0.3` exactly;
round-half-up rounds 0.125 to 0.13 where banker's rounding would give 0.12;
magnitudes beyond 10³⁰ serialise correctly; and two values identical at six
decimal places but different in the exact value still compare correctly.
`test/unit/ranking.test.js` extends that last point to ranking: a near-tie
differing below the serialised precision still selects deterministically,
which is the case where floating point would silently pick the wrong winner.

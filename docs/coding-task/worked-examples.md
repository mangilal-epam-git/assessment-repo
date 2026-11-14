# Coding task: worked examples

Every number the service returns for the supplied fixtures, derived by hand.
These are the same values asserted in `test/integration/golden.test.js` and
in the CI pipeline's end-to-end check, so this document and the code cannot
drift apart without the build failing.

## Setup

**Evaluation instant:** `2026-06-15T10:05:00Z`

**Configuration** (`fx-demo-1`, `margin-demo-1`):

| Setting | Value |
| --- | --- |
| EUR → EUR | 1.00 |
| USD → EUR | 0.92 |
| GBP → EUR | 1.18 |
| Default margin | 1000 bps → multiplier 1.10 |
| Minimum quality ratio | 0.90 |
| Freshness window | 15 minutes |

**Formulas:**

```
qualityRatio      = validEventCount / eventCount
providerEUR       = (priceMinor / 100) × FX[currency]
customerBundleEUR = providerEUR × 1.10
costPer1000       = customerBundleEUR × 1000 / validEventCount
```

## Provider telemetry1

### Row 0 — `eu-north-location-hour`

```
eventCount 100 000, validEventCount 98 000, 1200 EUR
observedAt 10:00:00Z, expiresAt 10:15:00Z

qualityRatio  = 98 000 / 100 000 = 0.98              ≥ 0.90  ✓
age           = 10:05 − 10:00 = 5 min                ≤ 15    ✓
expiry        = 10:15:00Z, now 10:05 < 10:15                 ✓

providerEUR   = 1200 / 100 × 1.00 = 12.00
bundle        = 12.00 × 1.10      = 13.20
costPer1000   = 13.20 × 1000 / 98 000
              = 13 200 / 98 000
              = 0.13469387755102040816...
```

Serialised: quality `0.9800`, bundle `13.20`, cost `0.134694`. **Eligible.**

### Row 1 — `eu-north-diagnostics-hour`

```
eventCount 50 000, validEventCount 47 000, 900 USD
observedAt 10:01:00Z, no expiresAt

qualityRatio  = 47 000 / 50 000 = 0.94               ≥ 0.90  ✓
age           = 4 min                                ≤ 15    ✓
expiry        = 10:01 + 15 min = 10:16:00Z  (default)        ✓

providerEUR   = 900 / 100 × 0.92 = 9.00 × 0.92 = 8.28
bundle        = 8.28 × 1.10 = 9.108
costPer1000   = 9.108 × 1000 / 47 000
              = 9 108 / 47 000
              = 0.19378723404255319148...
```

Serialised: quality `0.9400`, bundle **`9.11`** (9.108 → half-up at 2 places),
cost `0.193787`. **Eligible.**

### Row 2 — `eu-west-ev-health-hour`

```
eventCount 20 000, validEventCount 19 600, 800 GBP
observedAt 10:02:00Z, no expiresAt

qualityRatio  = 19 600 / 20 000 = 0.98               ≥ 0.90  ✓
age           = 3 min                                        ✓
expiry        = 10:17:00Z (default)                          ✓

providerEUR   = 800 / 100 × 1.18 = 8.00 × 1.18 = 9.44
bundle        = 9.44 × 1.10 = 10.384
costPer1000   = 10 384 / 19 600 = 0.52979591836734693877...
```

Serialised: quality `0.9800`, bundle `10.38` (10.384 → half-up), cost
`0.529796`. **Eligible.**

### Row 3 — `eu-west-braking-hour` — REJECTED

```
eventCount 40 000, validEventCount 32 000, 300 EUR

qualityRatio  = 32 000 / 40 000 = 0.80               < 0.90  ✗
```

**Rejected: `QUALITY_BELOW_MINIMUM`.**

This is the single most instructive row in the fixture set. At 300 EUR minor
(3.00 EUR) this is by far the cheapest bundle for its product — telemetry2
quotes 700 minor, more than twice as much. Had the service ranked on bundle
price, telemetry1 would have won on a feed where one event in five is
unusable. The quality floor is precisely what prevents "low-quality feeds
appearing artificially cheap".

### Row 4 — `eu-north-temperature-hour` — REJECTED

```
observedAt 09:40:00Z
age = 10:05 − 09:40 = 25 min                         > 15    ✗
```

**Rejected: `OBSERVATION_STALE`.** Quality would have been 0.97, comfortably
above the floor, but a 25-minute-old observation is not a current price.

## Provider telemetry2

### Row 0 — `eu-north-location-hour`

```
eventCount 120 000, validEventCount 114 000, 1300 USD
observedAt 10:00:00Z, no expiresAt

qualityRatio  = 114 000 / 120 000 = 0.95             ≥ 0.90  ✓
age           = 5 min                                        ✓
expiry        = 10:15:00Z (default); now 10:05 < 10:15       ✓

providerEUR   = 1300 / 100 × 0.92 = 13.00 × 0.92 = 11.96
bundle        = 11.96 × 1.10 = 13.156
costPer1000   = 13 156 / 114 000 = 0.11540350877192982456...
```

Serialised: quality `0.9500`, bundle **`13.16`** (13.156 → half-up), cost
`0.115404`. **Eligible.**

### Row 1 — `eu-north-diagnostics-hour`

```
eventCount 60 000, validEventCount 58 800, 1100 EUR
observedAt 10:01:00Z, expiresAt 10:12:00Z

qualityRatio  = 58 800 / 60 000 = 0.98                       ✓
age           = 4 min                                        ✓
now 10:05 < 10:12                                            ✓

providerEUR   = 11.00;  bundle = 12.10
costPer1000   = 12 100 / 58 800 = 0.20578231292517006802...
```

Serialised: `0.9800`, `12.10`, `0.205782`. **Eligible.**

### Row 2 — `eu-west-ev-health-hour`

```
eventCount 25 000, validEventCount 24 000, 950 EUR
qualityRatio  = 0.96;  providerEUR = 9.50;  bundle = 10.45
costPer1000   = 10 450 / 24 000 = 0.43541666666666666666...
```

Serialised: `0.9600`, `10.45`, `0.435417`. **Eligible.**

### Row 3 — `eu-west-braking-hour`

```
eventCount 45 000, validEventCount 43 200, 700 EUR
qualityRatio  = 0.96;  providerEUR = 7.00;  bundle = 7.70
costPer1000   = 7 700 / 43 200 = 0.17824074074074074074...
```

Serialised: `0.9600`, `7.70`, `0.178241`. **Eligible.**

### Row 4 — `eu-north-temperature-hour`

```
eventCount 12 000, validEventCount 11 640, 500 USD
observedAt 10:04:00Z

qualityRatio  = 11 640 / 12 000 = 0.97                       ✓
age           = 1 min                                        ✓
providerEUR   = 5.00 × 0.92 = 4.60;  bundle = 5.06
costPer1000   = 5 060 / 11 640 = 0.43470790378006872852...
```

Serialised: `0.9700`, `5.06`, `0.434708`. **Eligible.**

## Selection

| productId | telemetry1 | telemetry2 | Winner | Margin |
| --- | --- | --- | --- | --- |
| `eu-north-diagnostics-hour` | **0.193787** | 0.205782 | **telemetry1** | 5.8% cheaper |
| `eu-north-location-hour` | 0.134694 | **0.115404** | **telemetry2** | 14.3% cheaper |
| `eu-north-temperature-hour` | *stale* | **0.434708** | **telemetry2** | uncontested |
| `eu-west-braking-hour` | *quality* | **0.178241** | **telemetry2** | uncontested |
| `eu-west-ev-health-hour` | 0.529796 | **0.435417** | **telemetry2** | 17.8% cheaper |

Sorted by `productId` ascending. `partial` is `true` because two rows were
excluded. `unavailableProviders` is empty: both providers responded.

### Two cases worth dwelling on

**`eu-north-location-hour`** is the clearest demonstration of why bundle
price misleads. telemetry1's bundle is 13.20 EUR and telemetry2's is 13.16 —
near-identical, and a naive comparison would call it a coin flip. But
telemetry2 delivers 114 000 valid events against 98 000, so it is 14.3%
cheaper on the quantity the customer can actually use.

**`eu-west-ev-health-hour`** shows the same effect with currency conversion
in play. telemetry1 quotes 800 GBP minor, which converts to a **lower**
bundle (10.38 EUR) than telemetry2's 10.45 EUR. telemetry1 still loses,
decisively, because it supplies 19 600 valid events against 24 000.

In both cases the cheaper bundle loses. That is the entire point of
[ADR-0002](../adr/0002-quality-normalised-comparison.md).

## Rounding examples

| Exact value | Places | Half-up | Banker's rounding would give |
| --- | --- | --- | --- |
| 9.108 | 2 | **9.11** | 9.11 |
| 13.156 | 2 | **13.16** | 13.16 |
| 10.384 | 2 | **10.38** | 10.38 |
| 0.125 | 2 | **0.13** | 0.12 |
| 0.19378723404... | 6 | **0.193787** | 0.193787 |
| 0.11540350877... | 6 | **0.115404** | 0.115404 |

The 0.125 row is the one that distinguishes the two modes, and it is
asserted in `test/unit/rational.test.js` so the rounding rule cannot change
silently.

## Why comparison happens before rounding

Consider two offers for the same product whose costs differ only below the
sixth decimal place:

```
a = 110.000000 00 EUR per 1000 valid events
b = 110.000000 11 EUR per 1000 valid events
```

Both serialise to `110.000000`. Compared as exact rationals, `a` wins
unambiguously. Compared after rounding, they tie, and the winner would fall
to whichever tie-break ran next — or, with floating point, to accumulated
representation error. A test constructs exactly this case and asserts the
correct winner.

## Reproducing this yourself

```bash
npm run demo
```

Starts the mock providers and the service with the clock pinned to
`2026-06-15T10:05:00Z`, prints the full response, and exits. Every figure in
this document should appear in that output.

# Coding task: API contract

## `GET /best-offers`

Returns the best eligible offer per canonical product, combining offers from
the configured telemetry providers. No query parameters are required, and any
supplied are ignored.

### Success — HTTP 200

```json
{
  "asOf": "2026-06-15T10:05:00Z",
  "currency": "EUR",
  "fxVersion": "fx-demo-1",
  "marginVersion": "margin-demo-1",
  "partial": true,
  "unavailableProviders": [],
  "rejectedRows": [
    { "providerId": "telemetry1", "rowIndex": 3, "reason": "QUALITY_BELOW_MINIMUM" },
    { "providerId": "telemetry1", "rowIndex": 4, "reason": "OBSERVATION_STALE" }
  ],
  "offers": [
    {
      "productId": "eu-north-diagnostics-hour",
      "providerId": "telemetry1",
      "eventCount": 50000,
      "validEventCount": 47000,
      "qualityRatio": "0.9400",
      "customerBundleEUR": "9.11",
      "costPer1000ValidEventsEUR": "0.193787",
      "observedAt": "2026-06-15T10:01:00Z",
      "expiresAt": "2026-06-15T10:16:00Z"
    }
  ]
}
```

| Field | Type | Notes |
| --- | --- | --- |
| `asOf` | RFC 3339 UTC | The single evaluation instant used for the whole request |
| `currency` | string | Always `EUR` in this slice |
| `fxVersion` | string | The FX snapshot version actually used |
| `marginVersion` | string | The margin snapshot version actually used |
| `partial` | boolean | True when a provider was unavailable **or** any row was excluded |
| `unavailableProviders` | string[] | Sorted; providers that returned no valid top-level array |
| `rejectedRows` | object[] | Sorted by provider then row index; capped at 200 entries |
| `rejectedRowsTruncated` | boolean | Present only when the cap was reached |
| `rejectedRowCount` | number | Present only when truncated: the true total |
| `rejectedRowSummary` | object[] | Present only when truncated: count per provider and reason |
| `offers` | object[] | Sorted by `productId` ascending; at most one per product |

Decimal fields are **strings**, serialised with round-half-up:
`qualityRatio` to 4 places, `customerBundleEUR` to 2, and
`costPer1000ValidEventsEUR` to 6. Strings rather than numbers so that a JSON
parser cannot reintroduce binary floating point on the way out.

`expiresAt` is the **effective** expiry: the supplied value, or `observedAt`
plus 15 minutes when none was supplied.

### Error — HTTP 503 / 500 / 405 / 404

```json
{
  "code": "ALL_PROVIDERS_UNAVAILABLE",
  "message": "No telemetry provider returned a usable offer list",
  "requestId": "0f9c1a4e-..."
}
```

Error bodies carry a stable code, a safe human-readable message and a request
id. They never contain provider payloads, hostnames, stack traces or internal
state — asserted by test.

## Status semantics

| Situation | Status | Body |
| --- | --- | --- |
| All providers responded, nothing excluded | 200 | `partial: false` |
| Some rows excluded | 200 | `partial: true`, reasons in `rejectedRows` |
| One provider unavailable | 200 | `partial: true`, provider named in `unavailableProviders` |
| At least one valid array, but nothing eligible | 200 | `offers: []` |
| **Neither** provider returned a valid top-level array | 503 | `ALL_PROVIDERS_UNAVAILABLE`, `Retry-After: 5` |
| Service not ready, or shutting down | 503 | `SHUTTING_DOWN`, `Retry-After: 5` |
| Concurrency limit exceeded | 503 | `OVERLOADED`, `Retry-After: 1` |
| Request deadline elapsed | 503 | `REQUEST_TIMEOUT`, `Retry-After: 2` |
| Malformed request target | 400 | `BAD_REQUEST` |
| Wrong method | 405 | `METHOD_NOT_ALLOWED`, `Allow` header |
| Unknown route | 404 | `NOT_FOUND` |
| Unexpected failure | 500 | `INTERNAL_ERROR` |

`rejectedRows` is capped at 200 entries. Beyond that the response carries
`rejectedRowsTruncated`, the true `rejectedRowCount`, and a
`rejectedRowSummary` of counts per provider and reason. A provider sending
200 000 malformed rows would otherwise turn a small request into a
multi-megabyte response, which is an amplification vector rather than useful
detail — the per-reason counts are what an operator acts on anyway.

A partial result is deliberately **not** an error. A dispatcher who can see
three of five products, and can see exactly why the other two are missing, is
better served than one who gets a 500.

## Row rejection reasons

Stable, machine-readable, and **append-only**: new codes may be added;
existing codes are never renamed or repurposed.

### Structural

| Code | Meaning |
| --- | --- |
| `ROW_NOT_OBJECT` | The row is not a JSON object |
| `UNKNOWN_FIELD` | A field outside the Offer contract was present |
| `MISSING_FIELD` | A required field was absent |

### Field validation

| Code | Meaning |
| --- | --- |
| `INVALID_PRODUCT_ID` | Not a nonempty string |
| `INVALID_EVENT_COUNT` | Not a positive integer |
| `INVALID_VALID_EVENT_COUNT` | Not a positive integer |
| `VALID_EVENT_COUNT_EXCEEDS_EVENT_COUNT` | More valid events than total events |
| `INVALID_PRICE_MINOR` | Not a nonnegative integer |
| `INVALID_CURRENCY` | Not a nonempty string |
| `UNSUPPORTED_CURRENCY` | No FX rate configured for this currency |
| `INVALID_OBSERVED_AT` | Not a parseable RFC 3339 UTC timestamp |
| `OBSERVED_AT_IN_FUTURE` | Observed after the evaluation instant |
| `INVALID_EXPIRES_AT` | Supplied but not parseable |
| `EXPIRES_AT_NOT_AFTER_OBSERVED_AT` | Expiry at or before observation |
| `DUPLICATE_PRODUCT_ID` | This `productId` appears more than once in the same provider response |

### Eligibility

| Code | Meaning |
| --- | --- |
| `QUALITY_BELOW_MINIMUM` | `validEventCount / eventCount` below the configured floor (0.90) |
| `OBSERVATION_STALE` | `observedAt` more than 15 minutes before the evaluation instant |
| `OFFER_EXPIRED` | The evaluation instant is at or after the effective expiry |

### Evaluation order

Deterministic, so the same inputs always produce the same reason:

1. **Duplicate `productId`** — takes precedence over everything else. All
   rows sharing a repeated id are rejected, not just the later ones.
2. **Structural** — object shape, unknown fields, missing fields.
3. **Field validation** — in contract order.
4. **Eligibility** — quality, then staleness, then expiry.

A row failing several gates reports the first one reached. An auditor
comparing two runs of identical inputs sees identical output, including
reasons.

## Other endpoints

| Endpoint | Method | Purpose |
| --- | --- | --- |
| `/healthz` | GET | Liveness. 200 while the process is running |
| `/readyz` | GET | Readiness. 503 during shutdown; reports active config versions |
| `/metrics` | GET | Prometheus text exposition |
| `/admin/config/reload` | POST | Reload FX and markup. Bearer token required |

`/admin/config/reload` returns 200 with the newly active versions, 401
without a valid token, 405 for the wrong method, or **422** with a
`problems` array and the still-active versions when the document is
rejected. A rejected reload never changes what is being served.

At the edge, `/admin/*` returns 404 from the public listener (AWS) or is
blocked by a WAF custom rule (Azure). The endpoint is reachable only from
inside the network.

## Mock provider endpoints

```
GET /provider/telemetry1
GET /provider/telemetry2
```

Both return an array of `Offer` with the **same schema**; provider identity
comes from the configured endpoint, never from a field in a row.

Fault injection, for testing only:

| Parameter | Effect |
| --- | --- |
| `?fail=500` | HTTP 500 |
| `?fail=404` | HTTP 404 |
| `?fail=invalid-json` | 200 with a malformed body |
| `?fail=not-array` | 200 with a JSON object instead of an array |
| `?fail=empty-body` | 200 with an empty body |
| `?delayMs=N` | Delay the response by N milliseconds |
| `?failFirst=N` | Fail the first N requests with 503, then succeed |
| `POST /admin/reset` | Reset the `failFirst` counters |

`failFirst` state is per server instance, not global, so two mock servers in
one process cannot interfere — a bug found and fixed during development of
the test suite.

## Configuration

`config/pricing-config.json`:

```json
{
  "fxVersion": "fx-demo-1",
  "baseCurrency": "EUR",
  "fxRatesToBase": { "EUR": "1.00", "USD": "0.92", "GBP": "1.18" },
  "marginVersion": "margin-demo-1",
  "defaultMarginBasisPoints": 1000,
  "minimumQualityRatio": "0.90"
}
```

FX rates and the quality floor are **decimal strings**, not JSON numbers.
A number would be parsed as an IEEE-754 double and would reintroduce binary
floating point into the pricing path; the validator rejects it with a
specific message.

Environment variables are documented in
[`.env.example`](../../.env.example) and validated at startup, where an
invalid value stops the process rather than producing surprising behaviour
under load.

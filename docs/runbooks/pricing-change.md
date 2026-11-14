# Runbook: pricing configuration change

Changing FX rates, the default markup or the quality floor. This is the most
commercially sensitive routine operation on the platform.

## Before you start

| Check | Why |
| --- | --- |
| Change is approved by a second person | Four-eyes on anything affecting price |
| Effective time is agreed | Prices change for in-flight customers |
| The current state is recorded | You need to know what to roll back to |
| You can reach the admin endpoint | It is not exposed publicly, by design |

```bash
# What is serving right now?
curl -s "$BASE_URL/best-offers" | jq '{fxVersion, marginVersion, asOf}'
# Keep a copy of the current configuration
cp config/pricing-config.json "config/pricing-config.$(date -u +%Y%m%dT%H%M%SZ).bak"
```

## Make the change

Always bump the version string. An unchanged version with changed values
breaks reproducibility: two different prices would claim the same
provenance.

```json
{
  "fxVersion": "fx-2026-11-14-1",
  "baseCurrency": "EUR",
  "fxRatesToBase": { "EUR": "1.00", "USD": "0.91", "GBP": "1.17" },
  "marginVersion": "margin-2026-11-14-1",
  "defaultMarginBasisPoints": 1200,
  "minimumQualityRatio": "0.90"
}
```

| Rule | Reason |
| --- | --- |
| FX rates are **decimal strings**, never JSON numbers | A number is parsed as a double and reintroduces floating point |
| The base currency must be present with a rate of exactly 1 | Validation rejects anything else |
| `defaultMarginBasisPoints` is an integer | 1200 = 12% markup on converted cost |
| Bump both version strings when both change | They are reported independently |

## Validate before applying

```bash
# Locally, against the real validator
node -e "
import('./src/best-offers/config.js').then(async m => {
  const raw = await m.readConfigDocument('config/pricing-config.json');
  const s = m.buildSnapshot(raw);
  console.log('valid:', s.fxVersion, s.marginVersion, s.defaultMarginBasisPoints);
}).catch(e => { console.error('REJECTED:', e.problems ?? e.message); process.exit(1); });
"
```

Then see the effect before anyone else does:

```bash
npm run demo    # full fixture output under the new configuration
```

## Apply

### Local or Docker Compose

The file is watched; saving it is enough. Or force it:

```bash
curl -fsS -X POST "$BASE_URL/admin/config/reload" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq
```

### AWS

```bash
aws ssm put-parameter \
  --name "/vh-prod-best-offers/pricing-config" \
  --value "file://config/pricing-config.json" \
  --type String --overwrite

# Then reload from inside the network
curl -fsS -X POST "http://$INTERNAL_HOST/admin/config/reload" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq
```

### Azure

```bash
az appconfig kv set --name "$APP_CONFIG" \
  --key "pricing-config" --value @config/pricing-config.json --yes
```

## Verify

```bash
curl -s "$BASE_URL/best-offers" | jq '{fxVersion, marginVersion}'
curl -s "$BASE_URL/metrics" | grep vh_config_reloads_total
```

Expect `outcome="applied"` to have incremented and the versions to match what
you published. Then spot-check a known price against a hand calculation —
the [worked examples](../coding-task/worked-examples.md) show the method.

## If the reload is rejected

HTTP 422 with a `problems` array. **The previous snapshot is still serving**,
so there is no outage and no rush.

| Problem text | Cause |
| --- | --- |
| `must be a decimal string` | An FX rate was written as a JSON number |
| `must contain the base currency` | No entry for EUR |
| `must be exactly 1` | The base-currency rate is not 1.00 |
| `defaultMarginBasisPoints must be an integer...` | Non-integer or out of range |
| `unknown configuration field` | A typo in a key name |
| `file is not valid JSON` | Malformed document |

Fix and reapply. Nothing is half-applied: validation is whole-document by
design.

## Rollback

```bash
cp config/pricing-config.<timestamp>.bak config/pricing-config.json
curl -fsS -X POST "$BASE_URL/admin/config/reload" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

Target: under two minutes, no deployment. If prices were wrong while the bad
configuration was live, follow
[Suspected pricing error](incident-response.md#suspected-pricing-error) — the
blast radius is a query against the audit ledger, not an estimate.

## Record

In the change record: who proposed, who approved, the old and new version
strings, the effective time, and the verification evidence. The audit ledger
captures the reload itself; the change record captures the human decision
behind it.

#!/usr/bin/env node
/**
 * Post-deployment smoke test. Verifies that a running instance answers
 * /healthz, /readyz, /metrics and /best-offers with a contract-shaped body.
 *
 *   BASE_URL=https://best-offers.example npm run smoke
 *
 * Exits non-zero on the first failure so it can gate a deployment.
 */
const baseUrl = (process.env.BASE_URL ?? 'http://127.0.0.1:8080').replace(/\/$/, '');
const timeoutMillis = Number(process.env.SMOKE_TIMEOUT_MS ?? 10_000);

let failures = 0;

function check(name, condition, detail = '') {
  const status = condition ? 'PASS' : 'FAIL';
  if (!condition) failures += 1;
  process.stdout.write(`[${status}] ${name}${detail ? ` - ${detail}` : ''}\n`);
}

async function getJson(path) {
  const response = await fetch(`${baseUrl}${path}`, { signal: AbortSignal.timeout(timeoutMillis) });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = undefined;
  }
  return { response, body, text };
}

const DECIMAL_2 = /^\d+\.\d{2}$/;
const DECIMAL_4 = /^\d+\.\d{4}$/;
const DECIMAL_6 = /^\d+\.\d{6}$/;

try {
  const health = await getJson('/healthz');
  check('GET /healthz returns 200', health.response.status === 200, `got ${health.response.status}`);

  const ready = await getJson('/readyz');
  check('GET /readyz returns 200', ready.response.status === 200, `got ${ready.response.status}`);
  check('readiness reports configuration versions', Boolean(ready.body?.fxVersion && ready.body?.marginVersion));

  const metrics = await fetch(`${baseUrl}/metrics`, { signal: AbortSignal.timeout(timeoutMillis) });
  const metricsText = await metrics.text();
  check('GET /metrics returns 200', metrics.status === 200, `got ${metrics.status}`);
  check('metrics include HTTP counters', metricsText.includes('vh_http_requests_total'));

  const offers = await getJson('/best-offers');
  check('GET /best-offers returns 200', offers.response.status === 200, `got ${offers.response.status}`);

  const body = offers.body;
  check('response declares EUR output', body?.currency === 'EUR');
  check('response reports fxVersion and marginVersion', Boolean(body?.fxVersion && body?.marginVersion));
  check('response reports an asOf instant', typeof body?.asOf === 'string' && !Number.isNaN(Date.parse(body.asOf)));
  check('partial is a boolean', typeof body?.partial === 'boolean');
  check('unavailableProviders is an array', Array.isArray(body?.unavailableProviders));
  check('rejectedRows is an array', Array.isArray(body?.rejectedRows));
  check('offers is an array', Array.isArray(body?.offers));

  const productIds = (body?.offers ?? []).map((o) => o.productId);
  check('offers are sorted by productId', JSON.stringify(productIds) === JSON.stringify([...productIds].sort()));
  check('offers are unique per product', new Set(productIds).size === productIds.length);

  for (const offer of body?.offers ?? []) {
    check(
      `offer ${offer.productId} serialises decimals at the contract precision`,
      DECIMAL_4.test(offer.qualityRatio) &&
        DECIMAL_2.test(offer.customerBundleEUR) &&
        DECIMAL_6.test(offer.costPer1000ValidEventsEUR),
      `${offer.qualityRatio} / ${offer.customerBundleEUR} / ${offer.costPer1000ValidEventsEUR}`,
    );
    check(
      `offer ${offer.productId} names a configured provider`,
      offer.providerId === 'telemetry1' || offer.providerId === 'telemetry2',
      offer.providerId,
    );
  }

  const notFound = await fetch(`${baseUrl}/definitely-not-a-route`, { signal: AbortSignal.timeout(timeoutMillis) });
  check('unknown routes return 404', notFound.status === 404, `got ${notFound.status}`);
  await notFound.text();
} catch (error) {
  check('smoke test completed without transport errors', false, String(error?.message ?? error));
}

process.stdout.write(failures === 0 ? '\nSmoke test passed.\n' : `\nSmoke test FAILED (${failures} checks).\n`);
process.exit(failures === 0 ? 0 : 1);

/** End-to-end HTTP tests: real server, real mock providers, real sockets. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startMockProviders } from '../../src/mock-providers/server.js';
import { startServer } from '../../src/best-offers/server.js';
import { SEED_CONFIG, FIXTURE_INSTANT } from '../helpers/factories.js';

/**
 * Boots mock providers plus the service on ephemeral ports.
 * @param {{ query1?: string, query2?: string, env?: Record<string,string>, config?: object }} [options]
 */
async function boot({ query1 = '', query2 = '', env = {}, config = SEED_CONFIG } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'vh-http-'));
  const configPath = path.join(dir, 'pricing-config.json');
  await writeFile(configPath, JSON.stringify(config), 'utf8');

  const mocks = await startMockProviders({ port: 0, host: '127.0.0.1' });
  const app = await startServer({
    env: {
      PATH: process.env.PATH,
      PORT: '0',
      HOST: '127.0.0.1',
      LOG_LEVEL: 'error',
      FIXED_CLOCK: FIXTURE_INSTANT,
      CONFIG_WATCH_ENABLED: 'false',
      PRICING_CONFIG_PATH: configPath,
      PROVIDER_TELEMETRY1_URL: `${mocks.baseUrl}/provider/telemetry1${query1}`,
      PROVIDER_TELEMETRY2_URL: `${mocks.baseUrl}/provider/telemetry2${query2}`,
      PROVIDER_TIMEOUT_MS: '500',
      PROVIDER_MAX_ATTEMPTS: '2',
      PROVIDER_RETRY_INITIAL_DELAY_MS: '1',
      PROVIDER_RETRY_MAX_DELAY_MS: '2',
      ADMIN_TOKEN: 'test-admin-token',
      ...env,
    },
  });

  return {
    baseUrl: `http://127.0.0.1:${app.port}`,
    configPath,
    mocks,
    app,
    async close() {
      await app.close();
      await mocks.close();
    },
  };
}

test('GET /best-offers returns the ranked offers over HTTP', async (t) => {
  const ctx = await boot();
  t.after(() => ctx.close());

  const response = await fetch(`${ctx.baseUrl}/best-offers`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.ok(response.headers.get('x-request-id'));

  const body = await response.json();
  assert.equal(body.asOf, '2026-06-15T10:05:00Z');
  assert.equal(body.offers.length, 5);
  assert.equal(body.partial, true);
  assert.deepEqual(body.offers.map((o) => o.providerId), [
    'telemetry1', 'telemetry2', 'telemetry2', 'telemetry2', 'telemetry2',
  ]);
});

test('an echoed x-request-id is reused for correlation', async (t) => {
  const ctx = await boot();
  t.after(() => ctx.close());
  const response = await fetch(`${ctx.baseUrl}/best-offers`, {
    headers: { 'x-request-id': 'trace-abc-123' },
  });
  assert.equal(response.headers.get('x-request-id'), 'trace-abc-123');
});

test('a hostile x-request-id is replaced rather than echoed', async (t) => {
  const ctx = await boot();
  t.after(() => ctx.close());
  const response = await fetch(`${ctx.baseUrl}/best-offers`, {
    headers: { 'x-request-id': 'a'.repeat(300) },
  });
  assert.notEqual(response.headers.get('x-request-id'), 'a'.repeat(300));
});

test('one unavailable provider yields HTTP 200 with partial=true', async (t) => {
  const ctx = await boot({ query2: '?fail=500' });
  t.after(() => ctx.close());

  const response = await fetch(`${ctx.baseUrl}/best-offers`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.partial, true);
  assert.deepEqual(body.unavailableProviders, ['telemetry2']);
  assert.ok(body.offers.length > 0);
  assert.ok(body.offers.every((o) => o.providerId === 'telemetry1'));
});

test('a provider returning a non-array body is treated as unavailable', async (t) => {
  const ctx = await boot({ query2: '?fail=not-array' });
  t.after(() => ctx.close());
  const body = await (await fetch(`${ctx.baseUrl}/best-offers`)).json();
  assert.deepEqual(body.unavailableProviders, ['telemetry2']);
});

test('both providers unavailable yields HTTP 503 with a safe error body', async (t) => {
  const ctx = await boot({ query1: '?fail=500', query2: '?fail=invalid-json' });
  t.after(() => ctx.close());

  const response = await fetch(`${ctx.baseUrl}/best-offers`);
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('retry-after'), '5');
  const body = await response.json();
  assert.equal(body.code, 'ALL_PROVIDERS_UNAVAILABLE');
  assert.ok(body.requestId);
  assert.ok(body.message);
  // The error body must not leak provider payloads or internals.
  assert.ok(!JSON.stringify(body).includes('127.0.0.1'));
  assert.equal(body.stack, undefined);
});

test('transient provider failures are retried and the request still succeeds', async (t) => {
  // The first attempt against telemetry2 gets a 503; the retry succeeds.
  const ctx = await boot({ query2: '?failFirst=1' });
  t.after(() => ctx.close());

  const response = await fetch(`${ctx.baseUrl}/best-offers`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.unavailableProviders, [], 'the retry should have recovered');
  assert.ok(body.offers.some((o) => o.providerId === 'telemetry2'));

  const metrics = await (await fetch(`${ctx.baseUrl}/metrics`)).text();
  assert.match(metrics, /vh_provider_retries_total\{provider="telemetry2",cause="HTTP_STATUS"\} 1/);
});

test('a slow provider is timed out without failing the whole request', async (t) => {
  const ctx = await boot({
    query2: '?delayMs=2000',
    env: { PROVIDER_TIMEOUT_MS: '100', PROVIDER_MAX_ATTEMPTS: '1' },
  });
  t.after(() => ctx.close());

  const started = Date.now();
  const response = await fetch(`${ctx.baseUrl}/best-offers`);
  assert.equal(response.status, 200);
  assert.ok(Date.now() - started < 1500, 'the timeout must bound the request');
  const body = await response.json();
  assert.deepEqual(body.unavailableProviders, ['telemetry2']);
});

test('an empty provider list gives 200 with an empty offers array', async (t) => {
  // Shift the clock far past every fixture expiry: nothing is eligible.
  const ctx = await boot({ env: { FIXED_CLOCK: '2026-06-15T23:00:00Z' } });
  t.after(() => ctx.close());

  const response = await fetch(`${ctx.baseUrl}/best-offers`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.offers, []);
  assert.equal(body.partial, true);
  assert.equal(body.rejectedRows.length, 10, 'all ten fixture rows are excluded');
  // Quality is checked before staleness, so the 0.80-quality braking row from
  // telemetry1 still reports QUALITY_BELOW_MINIMUM rather than OBSERVATION_STALE.
  const reasons = body.rejectedRows.map((r) => r.reason);
  assert.equal(reasons.filter((r) => r === 'OBSERVATION_STALE').length, 9);
  assert.equal(reasons.filter((r) => r === 'QUALITY_BELOW_MINIMUM').length, 1);
});

test('health and readiness endpoints respond', async (t) => {
  const ctx = await boot();
  t.after(() => ctx.close());

  const health = await fetch(`${ctx.baseUrl}/healthz`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: 'ok' });

  const ready = await fetch(`${ctx.baseUrl}/readyz`);
  assert.equal(ready.status, 200);
  const body = await ready.json();
  assert.equal(body.status, 'ready');
  assert.equal(body.fxVersion, 'fx-demo-1');
});

test('metrics are exposed in Prometheus text format', async (t) => {
  const ctx = await boot();
  t.after(() => ctx.close());

  await fetch(`${ctx.baseUrl}/best-offers`);
  const response = await fetch(`${ctx.baseUrl}/metrics`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/plain/);
  const text = await response.text();
  assert.match(text, /vh_http_requests_total\{route="\/best-offers",method="GET",status="200"\} 1/);
  assert.match(text, /vh_offers_returned_total/);
  assert.match(text, /vh_rows_rejected_total\{provider="telemetry1",reason="QUALITY_BELOW_MINIMUM"\} 1/);
  assert.match(text, /vh_http_request_duration_seconds_count/);
});

test('unknown routes and wrong methods return stable error codes', async (t) => {
  const ctx = await boot();
  t.after(() => ctx.close());

  const notFound = await fetch(`${ctx.baseUrl}/nope`);
  assert.equal(notFound.status, 404);
  assert.equal((await notFound.json()).code, 'NOT_FOUND');

  const wrongMethod = await fetch(`${ctx.baseUrl}/best-offers`, { method: 'POST' });
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.headers.get('allow'), 'GET');
  assert.equal((await wrongMethod.json()).code, 'METHOD_NOT_ALLOWED');
});

test('metric cardinality is bounded for unknown routes', async (t) => {
  const ctx = await boot();
  t.after(() => ctx.close());
  await fetch(`${ctx.baseUrl}/random-1`);
  await fetch(`${ctx.baseUrl}/random-2`);
  const text = await (await fetch(`${ctx.baseUrl}/metrics`)).text();
  assert.match(text, /vh_http_requests_total\{route="other",method="GET",status="404"\} 2/);
  assert.ok(!text.includes('random-1'));
});

test('GET /best-offers requires no query parameters and ignores extras', async (t) => {
  const ctx = await boot();
  t.after(() => ctx.close());
  const plain = await (await fetch(`${ctx.baseUrl}/best-offers`)).json();
  const extra = await (await fetch(`${ctx.baseUrl}/best-offers?anything=1`)).json();
  assert.deepEqual(extra.offers, plain.offers);
});

test('the service root lists its endpoints instead of returning a bare 404', async (t) => {
  const ctx = await boot();
  t.after(() => ctx.close());

  const response = await fetch(`${ctx.baseUrl}/`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.service, 'best-offers');
  assert.ok(body.endpoints.includes('/best-offers'));
  assert.equal(body.configuration.fxVersion, 'fx-demo-1');
  // Points at the separate provider service rather than leaving someone
  // hunting for /provider/* on this port.
  assert.match(body.upstreamProviders, /PROVIDER_TELEMETRY1_URL/);
});

test('the mock provider root lists both feeds and the fault-injection options', async (t) => {
  const { startMockProviders } = await import('../../src/mock-providers/server.js');
  const mocks = await startMockProviders({ port: 0, host: '127.0.0.1' });
  t.after(() => mocks.close());

  const body = await (await fetch(`${mocks.baseUrl}/`)).json();
  assert.equal(body.service, 'mock-telemetry-providers');
  assert.deepEqual(body.endpoints, ['/provider/telemetry1', '/provider/telemetry2', '/healthz']);
  assert.ok(body.faultInjection['delayMs=N']);
  assert.match(body.description, /identity comes from\s+the endpoint/);
});

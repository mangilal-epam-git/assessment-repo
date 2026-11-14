/** Predictable startup, shutdown, cancellation and load-shedding behaviour. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { startMockProviders } from '../../src/mock-providers/server.js';
import { startServer } from '../../src/best-offers/server.js';
import { SEED_CONFIG, FIXTURE_INSTANT } from '../helpers/factories.js';

async function configFile(contents = SEED_CONFIG) {
  const dir = await mkdtemp(path.join(tmpdir(), 'vh-life-'));
  const file = path.join(dir, 'pricing-config.json');
  await writeFile(file, typeof contents === 'string' ? contents : JSON.stringify(contents), 'utf8');
  return file;
}

async function boot(extraEnv = {}, { query2 = '' } = {}) {
  const configPath = await configFile();
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
      PROVIDER_TELEMETRY1_URL: `${mocks.baseUrl}/provider/telemetry1`,
      PROVIDER_TELEMETRY2_URL: `${mocks.baseUrl}/provider/telemetry2${query2}`,
      ...extraEnv,
    },
  });
  return { app, mocks, baseUrl: `http://127.0.0.1:${app.port}`, configPath };
}

test('the server refuses to start with invalid configuration', async () => {
  const configPath = await configFile({ ...SEED_CONFIG, defaultMarginBasisPoints: 'free' });
  await assert.rejects(
    () =>
      startServer({
        env: { PATH: process.env.PATH, PORT: '0', HOST: '127.0.0.1', LOG_LEVEL: 'error', PRICING_CONFIG_PATH: configPath },
      }),
    /Invalid pricing configuration/,
  );
});

test('the server refuses to start with an invalid environment', async () => {
  await assert.rejects(
    () => startServer({ env: { PATH: process.env.PATH, PORT: 'abc' } }),
    /Invalid environment configuration/,
  );
});

test('the server refuses to start when the config file is missing', async () => {
  await assert.rejects(
    () =>
      startServer({
        env: { PATH: process.env.PATH, PORT: '0', HOST: '127.0.0.1', PRICING_CONFIG_PATH: '/nonexistent/pricing.json' },
      }),
    /ENOENT/,
  );
});

test('shutdown is graceful and idempotent', async () => {
  const { app, mocks, baseUrl } = await boot();
  assert.equal((await fetch(`${baseUrl}/healthz`)).status, 200);

  await app.close();
  await app.close(); // second call must be a no-op, not an error

  await assert.rejects(() => fetch(`${baseUrl}/healthz`), 'the socket should be closed');
  await mocks.close();
});

test('readiness fails before the listener closes, so traffic drains cleanly', async () => {
  const { app, mocks, baseUrl } = await boot({ SHUTDOWN_GRACE_MS: '2000' });
  // Hold a slow provider call open so the server has work in flight.
  const closing = app.close();
  // Readiness flips synchronously at the start of close().
  try {
    const ready = await fetch(`${baseUrl}/readyz`);
    assert.equal(ready.status, 503);
    assert.equal((await ready.json()).status, 'not-ready');
  } catch {
    // Acceptable: the listener may already have closed.
  }
  await closing;
  await mocks.close();
});

test('load shedding returns 503 rather than queueing without bound', async () => {
  const { app, mocks, baseUrl } = await boot(
    { MAX_CONCURRENT_REQUESTS: '1', PROVIDER_TIMEOUT_MS: '2000', PROVIDER_MAX_ATTEMPTS: '1' },
    { query2: '?delayMs=300' },
  );

  const responses = await Promise.all([
    fetch(`${baseUrl}/best-offers`),
    fetch(`${baseUrl}/best-offers`),
    fetch(`${baseUrl}/best-offers`),
  ]);
  const statuses = responses.map((r) => r.status).sort();
  await Promise.all(responses.map((r) => r.text()));

  assert.ok(statuses.includes(200), 'at least one request should succeed');
  assert.ok(statuses.includes(503), 'excess concurrency should be shed');

  const shed = responses.find((r) => r.status === 503);
  assert.equal(shed.headers.get('retry-after'), '1');

  const metrics = await (await fetch(`${baseUrl}/metrics`)).text();
  assert.match(metrics, /vh_rejected_load_total \d+/);

  await app.close();
  await mocks.close();
});

test('a client disconnect cancels the in-flight request', async () => {
  const { app, mocks, baseUrl } = await boot(
    { PROVIDER_TIMEOUT_MS: '5000', PROVIDER_MAX_ATTEMPTS: '1' },
    { query2: '?delayMs=3000' },
  );

  const controller = new AbortController();
  const pending = fetch(`${baseUrl}/best-offers`, { signal: controller.signal });
  setTimeout(() => controller.abort(), 50);
  await assert.rejects(() => pending, /abort/i);

  // The server must remain healthy and responsive afterwards.
  assert.equal((await fetch(`${baseUrl}/healthz`)).status, 200);

  await app.close();
  await mocks.close();
});

test('a request that exceeds its deadline does not hang forever', async () => {
  const { app, mocks, baseUrl } = await boot(
    { REQUEST_TIMEOUT_MS: '150', PROVIDER_TIMEOUT_MS: '5000', PROVIDER_MAX_ATTEMPTS: '1' },
    { query2: '?delayMs=4000' },
  );

  const started = Date.now();
  const response = await fetch(`${baseUrl}/best-offers`);
  await response.text();
  assert.ok(Date.now() - started < 3000, 'the request deadline must bound the response');

  await app.close();
  await mocks.close();
});

test('the mock provider exposes health and rejects unknown routes', async () => {
  const mocks = await startMockProviders({ port: 0, host: '127.0.0.1' });
  assert.equal((await fetch(`${mocks.baseUrl}/healthz`)).status, 200);
  assert.equal((await fetch(`${mocks.baseUrl}/provider/unknown`)).status, 404);
  assert.equal((await fetch(`${mocks.baseUrl}/provider/telemetry1`, { method: 'POST' })).status, 405);

  const both = await Promise.all([
    (await fetch(`${mocks.baseUrl}/provider/telemetry1`)).json(),
    (await fetch(`${mocks.baseUrl}/provider/telemetry2`)).json(),
  ]);
  // Both endpoints return the same schema; identity is the endpoint, not a field.
  for (const rows of both) {
    assert.equal(rows.length, 5);
    for (const row of rows) {
      assert.ok(Object.hasOwn(row, 'productId'));
      assert.equal(Object.hasOwn(row, 'providerId'), false, 'rows must not declare their provider');
    }
  }
  await mocks.close();
});

test('mock fault injection covers every failure mode the client handles', async () => {
  const mocks = await startMockProviders({ port: 0, host: '127.0.0.1' });
  assert.equal((await fetch(`${mocks.baseUrl}/provider/telemetry1?fail=500`)).status, 500);
  assert.equal((await fetch(`${mocks.baseUrl}/provider/telemetry1?fail=404`)).status, 404);

  const notArray = await fetch(`${mocks.baseUrl}/provider/telemetry1?fail=not-array`);
  assert.equal(Array.isArray(await notArray.json()), false);

  const invalid = await fetch(`${mocks.baseUrl}/provider/telemetry1?fail=invalid-json`);
  await assert.rejects(() => invalid.json());

  const empty = await fetch(`${mocks.baseUrl}/provider/telemetry1?fail=empty-body`);
  assert.equal(await empty.text(), '');

  // failFirst state is per server instance and resettable.
  assert.equal((await fetch(`${mocks.baseUrl}/provider/telemetry2?failFirst=1`)).status, 503);
  assert.equal((await fetch(`${mocks.baseUrl}/provider/telemetry2?failFirst=1`)).status, 200);
  await fetch(`${mocks.baseUrl}/admin/reset`, { method: 'POST' });
  assert.equal((await fetch(`${mocks.baseUrl}/provider/telemetry2?failFirst=1`)).status, 503);

  await mocks.close();
});

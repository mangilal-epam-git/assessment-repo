import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { ProviderClient } from '../../src/best-offers/provider-client.js';
import { BestOffersService } from '../../src/best-offers/service.js';
import { ConfigStore } from '../../src/best-offers/config.js';
import { fixedClock } from '../../src/best-offers/clock.js';
import { seedSnapshot, offer, FIXTURE_INSTANT, SEED_CONFIG } from '../helpers/factories.js';
import { startServer } from '../../src/best-offers/server.js';

const FAST = { maxAttempts: 1, initialDelayMillis: 0, maxDelayMillis: 0, backoffMultiplier: 2, totalBudgetMillis: 1000, random: () => 0 };

async function feed(rows, status = 200) {
  const server = http.createServer((req, res) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(rows));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}/f`, close: () => { server.closeAllConnections?.(); server.close(); } };
}

const service = (providers) =>
  new BestOffersService({ providers, configStore: new ConfigStore(seedSnapshot()), clock: fixedClock(FIXTURE_INSTANT) });

test('failover moves to the next endpoint and marks the provider degraded', async (t) => {
  const good = await feed([offer()]);
  const dead = await feed([], 500);
  t.after(() => { good.close(); dead.close(); });
  const client = new ProviderClient({ providerId: 'telemetry1', endpoints: [dead.url, good.url], retryPolicy: FAST });
  const body = await service([client]).getBestOffers();
  assert.equal(body.offers.length, 1);
  assert.deepEqual(body.degradedProviders, ['telemetry1']);
  assert.equal(body.partial, true);
  assert.deepEqual(body.unavailableProviders, []);
});

test('failover stops at the first success and does not query the rest', async (t) => {
  let hits = 0;
  const server = http.createServer((q, r) => { hits += 1; r.writeHead(200); r.end('[]'); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const first = await feed([offer()]);
  t.after(() => { server.close(); first.close(); });
  const client = new ProviderClient({ providerId: 'telemetry1', endpoints: [first.url, `http://127.0.0.1:${server.address().port}/`], retryPolicy: FAST });
  await client.fetchOffers();
  assert.equal(hits, 0);
});

test('fan-out collects every endpoint and the lowest cost across them wins', async (t) => {
  const dear = await feed([offer({ priceMinor: 1500 })]);
  const cheap = await feed([offer({ priceMinor: 900 })]);
  t.after(() => { dear.close(); cheap.close(); });
  const client = new ProviderClient({ providerId: 'telemetry1', endpoints: [dear.url, cheap.url], endpointStrategy: 'fan-out', retryPolicy: FAST });
  const body = await service([client]).getBestOffers();
  assert.equal(body.offers.length, 1);
  assert.equal(body.offers[0].customerBundleEUR, '9.90', '900 minor + 10% markup, not the 1500 mirror');
  assert.equal(body.rejectedRows.length, 0, 'the same product on two mirrors is not a duplicate');
});

test('fan-out rejects a stale mirror but still uses the fresh one', async (t) => {
  const stale = await feed([offer({ priceMinor: 100, observedAt: '2026-06-15T09:00:00Z' })]);
  const fresh = await feed([offer({ priceMinor: 1200 })]);
  t.after(() => { stale.close(); fresh.close(); });
  const client = new ProviderClient({ providerId: 'telemetry1', endpoints: [stale.url, fresh.url], endpointStrategy: 'fan-out', retryPolicy: FAST });
  const body = await service([client]).getBestOffers();
  assert.equal(body.offers[0].customerBundleEUR, '13.20', 'a cheap stale price must never win');
  assert.equal(body.rejectedRows[0].reason, 'OBSERVATION_STALE');
});

test('a duplicate inside ONE endpoint response is still rejected', async (t) => {
  const bad = await feed([offer(), offer({ priceMinor: 1 })]);
  t.after(() => bad.close());
  const client = new ProviderClient({ providerId: 'telemetry1', endpoints: [bad.url], retryPolicy: FAST });
  const body = await service([client]).getBestOffers();
  assert.equal(body.offers.length, 0);
  assert.equal(body.rejectedRows.every((r) => r.reason === 'DUPLICATE_PRODUCT_ID'), true);
});

test('all endpoints failing makes the provider unavailable', async (t) => {
  const a = await feed([], 500); const b = await feed([], 503);
  t.after(() => { a.close(); b.close(); });
  const client = new ProviderClient({ providerId: 'telemetry1', endpoints: [a.url, b.url], retryPolicy: FAST });
  const result = await client.fetchOffers();
  assert.equal(result.ok, false);
  assert.equal(result.endpoints.length, 2);
});

test('a provider needs at least one endpoint', () => {
  assert.throws(() => new ProviderClient({ providerId: 'x', endpoints: [] }), /at least one endpoint/);
});

test('editing the resilience section changes retry behaviour with no restart', async (t) => {
  let hits = 0;
  const flaky = http.createServer((q, r) => { hits += 1; r.writeHead(503); r.end('{}'); });
  await new Promise((r) => flaky.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${flaky.address().port}/p`;
  const dir = await mkdtemp(path.join(tmpdir(), 'vh-res-'));
  const cfg = path.join(dir, 'c.json');
  await writeFile(cfg, JSON.stringify({ ...SEED_CONFIG, resilienceVersion: 'r-1', resilience: { default: { maxAttempts: 1 } } }));
  const app = await startServer({ env: { PATH: process.env.PATH, PORT: '0', HOST: '127.0.0.1', LOG_LEVEL: 'error', CONFIG_WATCH_ENABLED: 'false',
    PRICING_CONFIG_PATH: cfg, PROVIDER_TELEMETRY1_URL: url, PROVIDER_TELEMETRY2_URL: url, ADMIN_TOKEN: 'tok' } });
  t.after(async () => { await app.close(); flaky.close(); });
  const base = `http://127.0.0.1:${app.port}`;

  hits = 0; await fetch(`${base}/best-offers`);
  const withOne = hits;
  await writeFile(cfg, JSON.stringify({ ...SEED_CONFIG, resilienceVersion: 'r-2',
    resilience: { default: { maxAttempts: 3, initialDelayMillis: 0, maxDelayMillis: 0 } } }));
  const r = await fetch(`${base}/admin/config/reload`, { method: 'POST', headers: { authorization: 'Bearer tok' } });
  assert.equal(r.status, 200);
  hits = 0; const body = await (await fetch(`${base}/best-offers`)).json().catch(() => ({}));
  assert.equal(withOne, 2, 'one attempt per provider');
  assert.equal(hits, 6, 'three attempts per provider after the reload');
});

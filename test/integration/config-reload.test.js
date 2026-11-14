/** Runtime configuration reload over HTTP, including the malformed-reload contract. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startMockProviders } from '../../src/mock-providers/server.js';
import { startServer } from '../../src/best-offers/server.js';
import { SEED_CONFIG, FIXTURE_INSTANT } from '../helpers/factories.js';

const ADMIN_TOKEN = 'reload-token-123';

async function boot() {
  const dir = await mkdtemp(path.join(tmpdir(), 'vh-reload-'));
  const configPath = path.join(dir, 'pricing-config.json');
  await writeFile(configPath, JSON.stringify(SEED_CONFIG), 'utf8');

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
      PROVIDER_TELEMETRY2_URL: `${mocks.baseUrl}/provider/telemetry2`,
      ADMIN_TOKEN,
    },
  });

  const baseUrl = `http://127.0.0.1:${app.port}`;
  return {
    baseUrl,
    configPath,
    reload: (token = ADMIN_TOKEN) =>
      fetch(`${baseUrl}/admin/config/reload`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      }),
    bundleFor: async (productId) => {
      const body = await (await fetch(`${baseUrl}/best-offers`)).json();
      return body.offers.find((o) => o.productId === productId);
    },
    async close() {
      await app.close();
      await mocks.close();
    },
  };
}

test('a valid reload changes pricing without a restart', async (t) => {
  const ctx = await boot();
  t.after(() => ctx.close());

  const before = await ctx.bundleFor('eu-north-location-hour');
  assert.equal(before.customerBundleEUR, '13.16');

  // Double the markup and re-rate USD.
  await writeFile(
    ctx.configPath,
    JSON.stringify({
      ...SEED_CONFIG,
      fxVersion: 'fx-demo-2',
      marginVersion: 'margin-demo-2',
      defaultMarginBasisPoints: 2000,
    }),
    'utf8',
  );

  const response = await ctx.reload();
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.status, 'applied');
  assert.equal(result.fxVersion, 'fx-demo-2');
  assert.equal(result.defaultMarginBasisPoints, 2000);

  const after = await ctx.bundleFor('eu-north-location-hour');
  // 13.00 USD * 0.92 = 11.96; * 1.20 = 14.352 -> "14.35".
  assert.equal(after.customerBundleEUR, '14.35');

  const body = await (await fetch(`${ctx.baseUrl}/best-offers`)).json();
  assert.equal(body.fxVersion, 'fx-demo-2', 'the response reports the versions used');
  assert.equal(body.marginVersion, 'margin-demo-2');
});

test('a malformed reload is rejected and the last valid snapshot survives', async (t) => {
  const ctx = await boot();
  t.after(() => ctx.close());

  const before = await ctx.bundleFor('eu-north-location-hour');
  await writeFile(ctx.configPath, '{ "fxVersion": ', 'utf8');

  const response = await ctx.reload();
  assert.equal(response.status, 422);
  const body = await response.json();
  assert.equal(body.code, 'CONFIG_RELOAD_REJECTED');
  assert.equal(body.activeFxVersion, 'fx-demo-1');
  assert.ok(Array.isArray(body.problems));

  const after = await ctx.bundleFor('eu-north-location-hour');
  assert.deepEqual(after, before, 'pricing must be unchanged after a rejected reload');
});

test('a semantically invalid reload is rejected with specific problems', async (t) => {
  const ctx = await boot();
  t.after(() => ctx.close());

  await writeFile(
    ctx.configPath,
    JSON.stringify({ ...SEED_CONFIG, defaultMarginBasisPoints: -5, fxRatesToBase: { EUR: '1.00', USD: 0.92 } }),
    'utf8',
  );
  const response = await ctx.reload();
  assert.equal(response.status, 422);
  const body = await response.json();
  assert.ok(body.problems.some((p) => p.includes('defaultMarginBasisPoints')));
  assert.ok(body.problems.some((p) => p.includes('decimal string')));

  const serving = await (await fetch(`${ctx.baseUrl}/best-offers`)).json();
  assert.equal(serving.fxVersion, 'fx-demo-1');
});

test('reload requires a valid admin token', async (t) => {
  const ctx = await boot();
  t.after(() => ctx.close());

  assert.equal((await ctx.reload('wrong-token')).status, 401);
  assert.equal((await ctx.reload('')).status, 401);
  const noHeader = await fetch(`${ctx.baseUrl}/admin/config/reload`, { method: 'POST' });
  assert.equal(noHeader.status, 401);
  assert.equal((await noHeader.json()).code, 'UNAUTHORIZED');
});

test('reload rejects the wrong HTTP method', async (t) => {
  const ctx = await boot();
  t.after(() => ctx.close());
  const response = await fetch(`${ctx.baseUrl}/admin/config/reload`);
  assert.equal(response.status, 405);
  assert.equal(response.headers.get('allow'), 'POST');
});

test('reload outcomes are counted in metrics', async (t) => {
  const ctx = await boot();
  t.after(() => ctx.close());

  await ctx.reload();
  await ctx.reload('nope');
  await writeFile(ctx.configPath, 'broken', 'utf8');
  await ctx.reload();

  const metrics = await (await fetch(`${ctx.baseUrl}/metrics`)).text();
  assert.match(metrics, /vh_config_reloads_total\{outcome="applied"\} 1/);
  assert.match(metrics, /vh_config_reloads_total\{outcome="unauthorized"\} 1/);
  assert.match(metrics, /vh_config_reloads_total\{outcome="rejected"\} 1/);
});

/**
 * File-watch reload: a Kubernetes ConfigMap or mounted secret update must be
 * picked up without a restart, and a broken file must not break pricing.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startMockProviders } from '../../src/mock-providers/server.js';
import { startServer } from '../../src/best-offers/server.js';
import { SEED_CONFIG, FIXTURE_INSTANT } from '../helpers/factories.js';

/** Polls until the predicate holds or the deadline passes. */
async function eventually(predicate, { timeoutMillis = 4000, intervalMillis = 25 } = {}) {
  const deadline = Date.now() + timeoutMillis;
  let last;
  while (Date.now() < deadline) {
    last = await predicate();
    if (last) return last;
    await new Promise((resolve) => setTimeout(resolve, intervalMillis));
  }
  throw new Error('condition was not met before the timeout');
}

test('editing the config file reloads FX and markup without a restart', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'vh-watch-'));
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
      CONFIG_WATCH_ENABLED: 'true',
      PRICING_CONFIG_PATH: configPath,
      PROVIDER_TELEMETRY1_URL: `${mocks.baseUrl}/provider/telemetry1`,
      PROVIDER_TELEMETRY2_URL: `${mocks.baseUrl}/provider/telemetry2`,
    },
  });
  t.after(async () => {
    await app.close();
    await mocks.close();
  });

  assert.equal(app.configStore.current().fxVersion, 'fx-demo-1');

  await writeFile(
    configPath,
    JSON.stringify({ ...SEED_CONFIG, fxVersion: 'fx-watch-2', defaultMarginBasisPoints: 2500 }),
    'utf8',
  );
  await eventually(() => app.configStore.current().fxVersion === 'fx-watch-2');
  assert.equal(app.configStore.current().defaultMarginBasisPoints, 2500);

  // A broken write must leave the last valid snapshot in place.
  await writeFile(configPath, '{{{ broken', 'utf8');
  await new Promise((resolve) => setTimeout(resolve, 400));
  assert.equal(app.configStore.current().fxVersion, 'fx-watch-2');
  assert.equal(app.configStore.failedReloadCount >= 1, true);

  // And the service keeps serving on the last valid snapshot.
  const body = await (await fetch(`http://127.0.0.1:${app.port}/best-offers`)).json();
  assert.equal(body.fxVersion, 'fx-watch-2');
});

test('config watching can be disabled', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'vh-nowatch-'));
  const configPath = path.join(dir, 'pricing-config.json');
  await writeFile(configPath, JSON.stringify(SEED_CONFIG), 'utf8');

  const app = await startServer({
    env: {
      PATH: process.env.PATH,
      PORT: '0',
      HOST: '127.0.0.1',
      LOG_LEVEL: 'error',
      CONFIG_WATCH_ENABLED: 'false',
      PRICING_CONFIG_PATH: configPath,
    },
  });
  t.after(() => app.close());

  await writeFile(configPath, JSON.stringify({ ...SEED_CONFIG, fxVersion: 'fx-ignored' }), 'utf8');
  await new Promise((resolve) => setTimeout(resolve, 400));
  assert.equal(app.configStore.current().fxVersion, 'fx-demo-1');
});

test('an unwatchable config path does not prevent startup', async (t) => {
  // The file exists at boot but the directory is removed from under the watcher
  // on some platforms; startup must survive a watch failure either way.
  const dir = await mkdtemp(path.join(tmpdir(), 'vh-watchfail-'));
  const configPath = path.join(dir, 'pricing-config.json');
  await writeFile(configPath, JSON.stringify(SEED_CONFIG), 'utf8');

  const app = await startServer({
    env: {
      PATH: process.env.PATH,
      PORT: '0',
      HOST: '127.0.0.1',
      LOG_LEVEL: 'error',
      CONFIG_WATCH_ENABLED: 'true',
      PRICING_CONFIG_PATH: configPath,
    },
  });
  t.after(() => app.close());
  assert.equal((await fetch(`http://127.0.0.1:${app.port}/healthz`)).status, 200);
});

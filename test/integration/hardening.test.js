/**
 * Regression tests for defects found during an independent code review.
 *
 * Each test here corresponds to a real bug that passed the original suite.
 * They are grouped separately so the reason they exist stays visible.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { mkdtemp, writeFile, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { startServer } from '../../src/best-offers/server.js';
import { startMockProviders } from '../../src/mock-providers/server.js';
import { BestOffersService, summariseRejections, MAX_REPORTED_REJECTED_ROWS } from '../../src/best-offers/service.js';
import { ConfigStore, buildSnapshot } from '../../src/best-offers/config.js';
import { fixedClock } from '../../src/best-offers/clock.js';
import { parseRoutePath } from '../../src/best-offers/app.js';
import { SEED_CONFIG, FIXTURE_INSTANT, seedSnapshot } from '../helpers/factories.js';

async function configFile(contents = SEED_CONFIG) {
  const dir = await mkdtemp(path.join(tmpdir(), 'vh-hard-'));
  const file = path.join(dir, 'pricing-config.json');
  await writeFile(file, JSON.stringify(contents), 'utf8');
  return file;
}

async function boot(extraEnv = {}) {
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
      PROVIDER_TELEMETRY2_URL: `${mocks.baseUrl}/provider/telemetry2`,
      ...extraEnv,
    },
  });
  return { app, mocks, configPath, baseUrl: `http://127.0.0.1:${app.port}` };
}

/** Sends a raw request so malformed headers survive any client normalisation. */
function rawRequest(port, lines, timeoutMillis = 3000) {
  return new Promise((resolve) => {
    const socket = net.connect(port, '127.0.0.1', () => {
      socket.write(`${lines.join('\r\n')}\r\n\r\n`);
    });
    let data = '';
    const timer = setTimeout(() => {
      socket.destroy();
      resolve({ timedOut: true, data });
    }, timeoutMillis);
    socket.on('data', (chunk) => {
      data += chunk;
    });
    socket.on('close', () => {
      clearTimeout(timer);
      resolve({ timedOut: false, data });
    });
    socket.on('error', () => {
      clearTimeout(timer);
      resolve({ timedOut: false, data });
    });
  });
}

// --------------------------------------------------------------------------
// CRITICAL 1: a large provider response overflowed the call stack because the
// orchestrator appended candidates with push(...array).
// --------------------------------------------------------------------------

test('a provider response with 200k rows does not overflow the call stack', async () => {
  const rows = Array.from({ length: 200_000 }, (_, index) => ({
    productId: `p-${index}`,
    eventCount: 1000,
    validEventCount: 1000,
    priceMinor: 100,
    currency: 'EUR',
    observedAt: '2026-06-15T10:00:00Z',
  }));

  const service = new BestOffersService({
    providers: [
      {
        providerId: 'telemetry1',
        fetchOffers: async () => ({ providerId: 'telemetry1', ok: true, rows, attempts: 1, durationMillis: 0 }),
      },
    ],
    configStore: new ConfigStore(seedSnapshot()),
    clock: fixedClock(FIXTURE_INSTANT),
  });

  const body = await service.getBestOffers();
  assert.equal(body.offers.length, 200_000);
  assert.equal(body.partial, false);
});

test('200k malformed rows do not overflow the stack and are summarised, not echoed', async () => {
  // Every row invalid: previously this both overflowed the stack and, once
  // that was fixed, produced a multi-megabyte response.
  const rows = Array.from({ length: 200_000 }, () => ({ bogus: true }));

  const service = new BestOffersService({
    providers: [
      {
        providerId: 'telemetry1',
        fetchOffers: async () => ({ providerId: 'telemetry1', ok: true, rows, attempts: 1, durationMillis: 0 }),
      },
    ],
    configStore: new ConfigStore(seedSnapshot()),
    clock: fixedClock(FIXTURE_INSTANT),
  });

  const body = await service.getBestOffers();
  assert.equal(body.offers.length, 0);
  assert.equal(body.partial, true);
  assert.equal(body.rejectedRows.length, MAX_REPORTED_REJECTED_ROWS);
  assert.equal(body.rejectedRowsTruncated, true);
  assert.equal(body.rejectedRowCount, 200_000);
  assert.deepEqual(body.rejectedRowSummary, [
    { providerId: 'telemetry1', reason: 'UNKNOWN_FIELD', count: 200_000 },
  ]);

  // The response must stay small regardless of how broken the feed is.
  assert.ok(JSON.stringify(body).length < 50_000);
});

test('a small number of rejections is still reported row by row', async () => {
  const service = new BestOffersService({
    providers: [
      {
        providerId: 'telemetry1',
        fetchOffers: async () => ({ providerId: 'telemetry1', ok: true, rows: [{ bogus: 1 }], attempts: 1, durationMillis: 0 }),
      },
    ],
    configStore: new ConfigStore(seedSnapshot()),
    clock: fixedClock(FIXTURE_INSTANT),
  });
  const body = await service.getBestOffers();
  assert.equal(body.rejectedRows.length, 1);
  assert.equal(body.rejectedRowsTruncated, undefined, 'no truncation fields when nothing is truncated');
});

test('summariseRejections groups and sorts deterministically', () => {
  assert.deepEqual(
    summariseRejections([
      { providerId: 'telemetry2', rowIndex: 0, reason: 'OFFER_EXPIRED' },
      { providerId: 'telemetry1', rowIndex: 0, reason: 'UNKNOWN_FIELD' },
      { providerId: 'telemetry1', rowIndex: 1, reason: 'UNKNOWN_FIELD' },
    ]),
    [
      { providerId: 'telemetry1', reason: 'UNKNOWN_FIELD', count: 2 },
      { providerId: 'telemetry2', reason: 'OFFER_EXPIRED', count: 1 },
    ],
  );
});

// --------------------------------------------------------------------------
// CRITICAL 2: a malformed Host header threw outside the try/catch, leaving the
// socket open with no response until the server timeout.
// --------------------------------------------------------------------------

test('a malformed Host header still produces a response', async (t) => {
  const ctx = await boot();
  t.after(async () => {
    await ctx.app.close();
    await ctx.mocks.close();
  });

  for (const host of ['exa mple.com', '[bad', '', 'localhost:99999999', 'a%zz']) {
    const result = await rawRequest(ctx.app.port, [
      'GET /healthz HTTP/1.1',
      `Host: ${host}`,
      'Connection: close',
    ]);
    assert.equal(result.timedOut, false, `Host "${host}" produced no response`);
    assert.match(result.data, /^HTTP\/1\.1 \d{3}/, `Host "${host}" produced no status line`);
  }
});

test('a malformed request target returns 400 rather than hanging', async (t) => {
  const ctx = await boot();
  t.after(async () => {
    await ctx.app.close();
    await ctx.mocks.close();
  });

  const result = await rawRequest(ctx.app.port, [
    'GET http://[ HTTP/1.1',
    'Host: localhost',
    'Connection: close',
  ]);
  assert.equal(result.timedOut, false);
  assert.match(result.data, /^HTTP\/1\.1 \d{3}/);
});

test('the server survives a burst of malformed requests and still serves traffic', async (t) => {
  const ctx = await boot();
  t.after(async () => {
    await ctx.app.close();
    await ctx.mocks.close();
  });

  await Promise.all(
    Array.from({ length: 30 }, () =>
      rawRequest(ctx.app.port, ['GET /healthz HTTP/1.1', 'Host: bad host', 'Connection: close']),
    ),
  );

  const healthy = await fetch(`${ctx.baseUrl}/best-offers`);
  assert.equal(healthy.status, 200);
  assert.equal((await healthy.json()).offers.length, 5);
});

test('parseRoutePath falls back to a host-independent parse', () => {
  assert.equal(parseRoutePath('/best-offers', 'example.com'), '/best-offers');
  assert.equal(parseRoutePath('/best-offers?x=1', 'bad host'), '/best-offers');
  assert.equal(parseRoutePath('/healthz', ''), '/healthz');
  assert.equal(parseRoutePath(undefined, undefined), '/');
  assert.equal(parseRoutePath('http://[', 'localhost'), null);
});

// --------------------------------------------------------------------------
// HIGH 1: an expired request deadline returned 500 INTERNAL_ERROR.
// --------------------------------------------------------------------------

test('an expired request deadline returns a retryable 503, not a 500', async (t) => {
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
      REQUEST_TIMEOUT_MS: '150',
      PROVIDER_TIMEOUT_MS: '5000',
      PROVIDER_MAX_ATTEMPTS: '1',
      PROVIDER_TELEMETRY1_URL: `${mocks.baseUrl}/provider/telemetry1`,
      PROVIDER_TELEMETRY2_URL: `${mocks.baseUrl}/provider/telemetry2?delayMs=4000`,
    },
  });
  t.after(async () => {
    await app.close();
    await mocks.close();
  });

  const response = await fetch(`http://127.0.0.1:${app.port}/best-offers`);
  const body = await response.json();
  assert.equal(response.status, 503);
  assert.equal(body.code, 'REQUEST_TIMEOUT');
  assert.equal(response.headers.get('retry-after'), '2');
  assert.ok(body.requestId);

  const metrics = await (await fetch(`http://127.0.0.1:${app.port}/metrics`)).text();
  assert.match(metrics, /vh_requests_aborted_total\{code="REQUEST_TIMEOUT"\} 1/);
});

// --------------------------------------------------------------------------
// HIGH 3: an oversized declared content-length leaked the socket.
// --------------------------------------------------------------------------

test('an oversized declared content-length does not leak sockets', async (t) => {
  // The upstream advertises a huge content-length. The client must refuse the
  // body AND tear the socket down; without an explicit cancel() the socket
  // stays open holding an unconsumed body, and a provider can exhaust the
  // connection pool just by lying in a header.
  const live = new Set();
  const upstream = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json', 'content-length': '999999999' });
    res.write('[');
  });
  upstream.on('connection', (socket) => {
    live.add(socket);
    socket.on('close', () => live.delete(socket));
  });
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const upstreamPort = upstream.address().port;
  t.after(() => {
    upstream.closeAllConnections?.();
    upstream.close();
  });

  const { ProviderClient } = await import('../../src/best-offers/provider-client.js');
  const client = new ProviderClient({
    providerId: 'telemetry1',
    url: `http://127.0.0.1:${upstreamPort}/provider/telemetry1`,
    timeoutMillis: 1000,
    maxBodyBytes: 1024,
    retryPolicy: {
      maxAttempts: 1,
      initialDelayMillis: 0,
      maxDelayMillis: 0,
      backoffMultiplier: 2,
      totalBudgetMillis: 1000,
      random: () => 0,
    },
  });

  for (let i = 0; i < 20; i += 1) {
    const result = await client.fetchOffers();
    assert.equal(result.ok, false);
    assert.equal(result.failureCode, 'BODY_TOO_LARGE');
  }

  // Give the event loop a moment to process the socket closures.
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.ok(live.size <= 2, `expected sockets to be released, ${live.size} still open after 20 requests`);
});

// --------------------------------------------------------------------------
// MEDIUM 1: fs.watch on the file stopped working after an atomic rename.
// --------------------------------------------------------------------------

test('config reload survives an atomic rename, as used by ConfigMaps and editors', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'vh-rename-'));
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

  const waitFor = async (predicate, timeoutMillis = 5000) => {
    const deadline = Date.now() + timeoutMillis;
    while (Date.now() < deadline) {
      if (predicate()) return true;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return false;
  };

  // Replace by rename, twice. The second is the one that used to be missed.
  for (const version of ['fx-rename-1', 'fx-rename-2']) {
    const staging = path.join(dir, `.staging-${version}`);
    await writeFile(staging, JSON.stringify({ ...SEED_CONFIG, fxVersion: version }), 'utf8');
    await rename(staging, configPath);
    assert.ok(
      await waitFor(() => app.configStore.current().fxVersion === version),
      `reload after rename to ${version} was not picked up`,
    );
  }
});

// --------------------------------------------------------------------------
// MEDIUM 4: the snapshot's FX map was mutable despite Object.freeze.
// --------------------------------------------------------------------------

test('a configuration snapshot cannot be mutated after it is built', () => {
  const snapshot = buildSnapshot(SEED_CONFIG);
  assert.ok(Object.isFrozen(snapshot));
  assert.throws(() => snapshot.fxRatesToBase.set('XXX', 1), TypeError);
  assert.throws(() => snapshot.fxRatesToBase.delete('USD'), TypeError);
  assert.throws(() => snapshot.fxRatesToBase.clear(), TypeError);
  assert.equal(snapshot.fxRatesToBase.get('USD').toFixedHalfUp(2), '0.92');
});

// --------------------------------------------------------------------------
// MEDIUM 5: a pinned clock in production would make every offer eligible.
// --------------------------------------------------------------------------

test('a pinned clock is refused in production', async () => {
  const configPath = await configFile();
  await assert.rejects(
    () =>
      startServer({
        env: {
          PATH: process.env.PATH,
          NODE_ENV: 'production',
          PORT: '0',
          HOST: '127.0.0.1',
          PRICING_CONFIG_PATH: configPath,
          FIXED_CLOCK: FIXTURE_INSTANT,
        },
      }),
    /FIXED_CLOCK must not be set when NODE_ENV is production/,
  );
});

// --------------------------------------------------------------------------
// MEDIUM 6: concurrent reloads could apply out of order.
// --------------------------------------------------------------------------

test('concurrent reloads are serialised and the last write wins', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'vh-race-'));
  const file = path.join(dir, 'pricing-config.json');
  await writeFile(file, JSON.stringify(SEED_CONFIG), 'utf8');

  const { loadConfigStore } = await import('../../src/best-offers/config.js');
  const store = await loadConfigStore(file);

  await writeFile(file, JSON.stringify({ ...SEED_CONFIG, fxVersion: 'fx-final' }), 'utf8');
  const results = await Promise.allSettled([
    store.reloadFromDisk(),
    store.reloadFromDisk(),
    store.reloadFromDisk(),
  ]);
  assert.ok(results.every((r) => r.status === 'fulfilled'));
  assert.equal(store.current().fxVersion, 'fx-final');
  assert.equal(store.reloadCount, 3);
});

// --------------------------------------------------------------------------
// LOW 1: RFC 3339 leap seconds were rejected.
// --------------------------------------------------------------------------

test('RFC 3339 leap seconds are accepted and normalised', async () => {
  const { parseRfc3339Utc } = await import('../../src/best-offers/time.js');
  // :60 is a valid RFC 3339 second; it normalises to the following minute.
  assert.equal(parseRfc3339Utc('2026-12-31T23:59:60Z'), Date.UTC(2027, 0, 1, 0, 0, 0));
  assert.equal(parseRfc3339Utc('2026-06-15T10:00:60Z'), Date.UTC(2026, 5, 15, 10, 1, 0));
  // 61 is still nonsense.
  assert.equal(parseRfc3339Utc('2026-06-15T10:00:61Z'), null);
  // And the rollover guard still rejects impossible dates.
  assert.equal(parseRfc3339Utc('2026-02-30T00:00:00Z'), null);
});

// --------------------------------------------------------------------------
// Wrong methods on the read-only endpoints returned 404 rather than 405.
// --------------------------------------------------------------------------

test('read-only endpoints reject the wrong method with 405', async (t) => {
  const ctx = await boot();
  t.after(async () => {
    await ctx.app.close();
    await ctx.mocks.close();
  });

  for (const route of ['/healthz', '/readyz', '/metrics']) {
    const response = await fetch(`${ctx.baseUrl}${route}`, { method: 'DELETE' });
    assert.equal(response.status, 405, `${route} should be 405`);
    assert.equal(response.headers.get('allow'), 'GET');
    await response.text();
  }
});

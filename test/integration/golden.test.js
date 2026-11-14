/**
 * Golden test for the supplied fixtures at the specified evaluation instant.
 *
 * Every expected number here was computed by hand from the brief and is
 * reproduced in docs/coding-task/worked-examples.md. If this test fails, the
 * pricing contract has changed and the documentation must change with it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BestOffersService } from '../../src/best-offers/service.js';
import { ConfigStore } from '../../src/best-offers/config.js';
import { fixedClock } from '../../src/best-offers/clock.js';
import { seedSnapshot, FIXTURE_INSTANT } from '../helpers/factories.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

async function fixture(name) {
  return JSON.parse(await readFile(path.join(repoRoot, 'fixtures', name), 'utf8'));
}

/** A provider stub that returns a fixed row set. */
function stubProvider(providerId, rows) {
  return { providerId, fetchOffers: async () => ({ providerId, ok: true, rows, attempts: 1, durationMillis: 0 }) };
}

function unavailableProvider(providerId) {
  return {
    providerId,
    fetchOffers: async () => ({ providerId, ok: false, failureCode: 'TIMEOUT', attempts: 3, durationMillis: 0 }),
  };
}

function buildService(providers) {
  return new BestOffersService({
    providers,
    configStore: new ConfigStore(seedSnapshot()),
    clock: fixedClock(FIXTURE_INSTANT),
  });
}

test('produces the expected result for the supplied fixtures', async () => {
  const service = buildService([
    stubProvider('telemetry1', await fixture('telemetry1.json')),
    stubProvider('telemetry2', await fixture('telemetry2.json')),
  ]);

  const body = await service.getBestOffers();

  assert.equal(body.asOf, '2026-06-15T10:05:00Z');
  assert.equal(body.currency, 'EUR');
  assert.equal(body.fxVersion, 'fx-demo-1');
  assert.equal(body.marginVersion, 'margin-demo-1');
  assert.equal(body.partial, true, 'two rows were excluded, so the result is partial');
  assert.deepEqual(body.unavailableProviders, []);

  assert.deepEqual(body.rejectedRows, [
    // 32000/40000 = 0.80, below the 0.90 minimum.
    { providerId: 'telemetry1', rowIndex: 3, reason: 'QUALITY_BELOW_MINIMUM' },
    // observed 09:40, which is 25 minutes before 10:05.
    { providerId: 'telemetry1', rowIndex: 4, reason: 'OBSERVATION_STALE' },
  ]);

  assert.deepEqual(body.offers, [
    {
      // telemetry1: 9.00 USD * 0.92 = 8.28; * 1.10 = 9.108 -> "9.11";
      // 9.108 * 1000 / 47000 = 0.19378723...  telemetry2 is 0.205782, so t1 wins.
      productId: 'eu-north-diagnostics-hour',
      providerId: 'telemetry1',
      eventCount: 50000,
      validEventCount: 47000,
      qualityRatio: '0.9400',
      customerBundleEUR: '9.11',
      costPer1000ValidEventsEUR: '0.193787',
      observedAt: '2026-06-15T10:01:00Z',
      expiresAt: '2026-06-15T10:16:00Z', // implied: observedAt + 15 minutes
    },
    {
      // telemetry2 has the dearer bundle (13.16 vs 13.20 is close) but far more
      // valid events: 0.115404 vs telemetry1's 0.134694.
      productId: 'eu-north-location-hour',
      providerId: 'telemetry2',
      eventCount: 120000,
      validEventCount: 114000,
      qualityRatio: '0.9500',
      customerBundleEUR: '13.16',
      costPer1000ValidEventsEUR: '0.115404',
      observedAt: '2026-06-15T10:00:00Z',
      expiresAt: '2026-06-15T10:15:00Z',
    },
    {
      // telemetry1's row was stale, so telemetry2 wins uncontested.
      productId: 'eu-north-temperature-hour',
      providerId: 'telemetry2',
      eventCount: 12000,
      validEventCount: 11640,
      qualityRatio: '0.9700',
      customerBundleEUR: '5.06',
      costPer1000ValidEventsEUR: '0.434708',
      observedAt: '2026-06-15T10:04:00Z',
      expiresAt: '2026-06-15T10:19:00Z',
    },
    {
      // telemetry1 was cheaper per bundle (3.00 EUR) but failed the quality gate:
      // a low-quality feed must not appear artificially cheap.
      productId: 'eu-west-braking-hour',
      providerId: 'telemetry2',
      eventCount: 45000,
      validEventCount: 43200,
      qualityRatio: '0.9600',
      customerBundleEUR: '7.70',
      costPer1000ValidEventsEUR: '0.178241',
      observedAt: '2026-06-15T10:03:00Z',
      expiresAt: '2026-06-15T10:18:00Z',
    },
    {
      // 9.50 EUR * 1.10 = 10.45 over 24000 valid events beats telemetry1's
      // 8.00 GBP (9.44 EUR) * 1.10 = 10.384 over only 19600.
      productId: 'eu-west-ev-health-hour',
      providerId: 'telemetry2',
      eventCount: 25000,
      validEventCount: 24000,
      qualityRatio: '0.9600',
      customerBundleEUR: '10.45',
      costPer1000ValidEventsEUR: '0.435417',
      observedAt: '2026-06-15T10:02:00Z',
      expiresAt: '2026-06-15T10:17:00Z',
    },
  ]);
});

test('results are sorted by productId ascending', async () => {
  const service = buildService([
    stubProvider('telemetry1', await fixture('telemetry1.json')),
    stubProvider('telemetry2', await fixture('telemetry2.json')),
  ]);
  const { offers } = await service.getBestOffers();
  const ids = offers.map((o) => o.productId);
  assert.deepEqual(ids, [...ids].sort());
});

test('the result is deterministic across repeated runs', async () => {
  const rows1 = await fixture('telemetry1.json');
  const rows2 = await fixture('telemetry2.json');
  const first = await buildService([stubProvider('telemetry1', rows1), stubProvider('telemetry2', rows2)]).getBestOffers();
  // Provider order reversed: selection must not depend on fan-out order.
  const second = await buildService([stubProvider('telemetry2', rows2), stubProvider('telemetry1', rows1)]).getBestOffers();
  assert.deepEqual(second.offers, first.offers);
});

test('one unavailable provider yields a partial result, not a failure', async () => {
  const service = buildService([
    stubProvider('telemetry1', await fixture('telemetry1.json')),
    unavailableProvider('telemetry2'),
  ]);
  const body = await service.getBestOffers();
  assert.equal(body.partial, true);
  assert.deepEqual(body.unavailableProviders, ['telemetry2']);
  // Only telemetry1's three eligible rows survive.
  assert.deepEqual(body.offers.map((o) => o.productId), [
    'eu-north-diagnostics-hour',
    'eu-north-location-hour',
    'eu-west-ev-health-hour',
  ]);
  assert.ok(body.offers.every((o) => o.providerId === 'telemetry1'));
});

test('a clean run with no exclusions reports partial=false', async () => {
  const service = buildService([
    stubProvider('telemetry1', [
      {
        productId: 'eu-north-location-hour',
        eventCount: 1000,
        validEventCount: 1000,
        priceMinor: 100,
        currency: 'EUR',
        observedAt: '2026-06-15T10:00:00Z',
      },
    ]),
    stubProvider('telemetry2', []),
  ]);
  const body = await service.getBestOffers();
  assert.equal(body.partial, false);
  assert.deepEqual(body.rejectedRows, []);
  assert.deepEqual(body.unavailableProviders, []);
  assert.equal(body.offers.length, 1);
});

test('nothing eligible yields an empty offers array, not an error', async () => {
  const service = buildService([
    stubProvider('telemetry1', [
      { productId: 'p', eventCount: 100, validEventCount: 10, priceMinor: 100, currency: 'EUR', observedAt: '2026-06-15T10:00:00Z' },
    ]),
    stubProvider('telemetry2', []),
  ]);
  const body = await service.getBestOffers();
  assert.deepEqual(body.offers, []);
  assert.equal(body.partial, true);
  assert.equal(body.rejectedRows.length, 1);
});

test('every provider unavailable raises AllProvidersUnavailableError', async () => {
  const service = buildService([unavailableProvider('telemetry1'), unavailableProvider('telemetry2')]);
  await assert.rejects(() => service.getBestOffers(), /No provider returned a valid offer array/);
});

test('rejected rows are ordered by provider then row index', async () => {
  const bad = (productId) => ({ productId, eventCount: 10, validEventCount: 1, priceMinor: 1, currency: 'EUR', observedAt: '2026-06-15T10:00:00Z' });
  const service = buildService([
    stubProvider('telemetry2', [bad('a'), bad('b')]),
    stubProvider('telemetry1', [bad('c')]),
  ]);
  const { rejectedRows } = await service.getBestOffers();
  assert.deepEqual(rejectedRows.map((r) => `${r.providerId}:${r.rowIndex}`), [
    'telemetry1:0',
    'telemetry2:0',
    'telemetry2:1',
  ]);
});

test('the response reports the snapshot versions actually used', async () => {
  const configStore = new ConfigStore(seedSnapshot());
  const service = new BestOffersService({
    providers: [stubProvider('telemetry1', await fixture('telemetry1.json'))],
    configStore,
    clock: fixedClock(FIXTURE_INSTANT),
  });

  const before = await service.getBestOffers();
  assert.equal(before.fxVersion, 'fx-demo-1');
  const locationBefore = before.offers.find((o) => o.productId === 'eu-north-location-hour');
  assert.equal(locationBefore.customerBundleEUR, '13.20');

  // Reload with a 20% markup; the next request must use and report it.
  configStore.replace({
    fxVersion: 'fx-demo-2',
    marginVersion: 'margin-demo-2',
    baseCurrency: 'EUR',
    fxRatesToBase: { EUR: '1.00', USD: '0.92', GBP: '1.18' },
    defaultMarginBasisPoints: 2000,
    minimumQualityRatio: '0.90',
  });

  const after = await service.getBestOffers();
  assert.equal(after.fxVersion, 'fx-demo-2');
  assert.equal(after.marginVersion, 'margin-demo-2');
  const locationAfter = after.offers.find((o) => o.productId === 'eu-north-location-hour');
  assert.equal(locationAfter.customerBundleEUR, '14.40', '12.00 * 1.20');
});

test('a service needs at least one provider', () => {
  assert.throws(
    () => new BestOffersService({ providers: [], configStore: new ConfigStore(seedSnapshot()), clock: fixedClock(FIXTURE_INSTANT) }),
    /At least one provider/,
  );
});

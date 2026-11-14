import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  buildSnapshot,
  ConfigStore,
  ConfigValidationError,
  loadConfigStore,
  readConfigDocument,
} from '../../src/best-offers/config.js';
import { SEED_CONFIG, seedSnapshot } from '../helpers/factories.js';

test('builds a snapshot from the seed configuration', () => {
  const snapshot = seedSnapshot();
  assert.equal(snapshot.fxVersion, 'fx-demo-1');
  assert.equal(snapshot.marginVersion, 'margin-demo-1');
  assert.equal(snapshot.defaultMarginBasisPoints, 1000);
  assert.equal(snapshot.fxRatesToBase.get('USD').toFixedHalfUp(2), '0.92');
  assert.equal(snapshot.defaultMarginMultiplier.toFixedHalfUp(2), '1.10');
  assert.equal(snapshot.minimumQualityRatio.toFixedHalfUp(2), '0.90');
  assert.ok(Object.isFrozen(snapshot));
});

test('rejects a non-object document', () => {
  for (const bad of [null, [], 'config', 7]) {
    assert.throws(() => buildSnapshot(bad), ConfigValidationError);
  }
});

test('collects every problem rather than failing on the first', () => {
  try {
    buildSnapshot({ fxVersion: '', marginVersion: 1, fxRatesToBase: {}, defaultMarginBasisPoints: -1, minimumQualityRatio: 'x' });
    assert.fail('expected rejection');
  } catch (error) {
    assert.ok(error instanceof ConfigValidationError);
    assert.ok(error.problems.length >= 4, `expected several problems, got ${error.problems.length}`);
  }
});

test('rejects unknown configuration fields', () => {
  assert.throws(
    () => buildSnapshot({ ...SEED_CONFIG, surcharge: 5 }),
    /unknown configuration field "surcharge"/,
  );
});

test('rejects FX rates expressed as JSON numbers', () => {
  // A JSON number would re-introduce binary floating point into pricing.
  assert.throws(
    () => buildSnapshot({ ...SEED_CONFIG, fxRatesToBase: { EUR: '1.00', USD: 0.92 } }),
    /must be a decimal string/,
  );
});

test('rejects malformed, zero and badly-named FX rates', () => {
  assert.throws(() => buildSnapshot({ ...SEED_CONFIG, fxRatesToBase: { EUR: '1.00', USD: '-0.92' } }), /not a plain non-negative decimal/);
  assert.throws(() => buildSnapshot({ ...SEED_CONFIG, fxRatesToBase: { EUR: '1.00', USD: '0' } }), /greater than zero/);
  assert.throws(() => buildSnapshot({ ...SEED_CONFIG, fxRatesToBase: { EUR: '1.00', usd: '0.92' } }), /three-letter uppercase/);
  assert.throws(() => buildSnapshot({ ...SEED_CONFIG, fxRatesToBase: [] }), /must be an object/);
});

test('requires the base currency to be present and exactly one', () => {
  assert.throws(
    () => buildSnapshot({ ...SEED_CONFIG, fxRatesToBase: { USD: '0.92' } }),
    /must contain the base currency/,
  );
  assert.throws(
    () => buildSnapshot({ ...SEED_CONFIG, fxRatesToBase: { EUR: '1.01', USD: '0.92' } }),
    /must be exactly 1/,
  );
});

test('validates the margin and minimum quality ratio', () => {
  assert.throws(() => buildSnapshot({ ...SEED_CONFIG, defaultMarginBasisPoints: 1.5 }), /defaultMarginBasisPoints/);
  assert.throws(() => buildSnapshot({ ...SEED_CONFIG, defaultMarginBasisPoints: -1 }), /defaultMarginBasisPoints/);
  assert.throws(() => buildSnapshot({ ...SEED_CONFIG, minimumQualityRatio: '1.5' }), /must not exceed 1/);
  assert.throws(() => buildSnapshot({ ...SEED_CONFIG, minimumQualityRatio: 0.9 }), /decimal string/);
});

test('a valid reload swaps the active snapshot', () => {
  const store = new ConfigStore(seedSnapshot());
  const updated = store.replace({ ...SEED_CONFIG, fxVersion: 'fx-demo-2', defaultMarginBasisPoints: 1500 });
  assert.equal(updated.fxVersion, 'fx-demo-2');
  assert.equal(store.current().fxVersion, 'fx-demo-2');
  assert.equal(store.current().defaultMarginMultiplier.toFixedHalfUp(2), '1.15');
  assert.equal(store.reloadCount, 1);
  assert.equal(store.failedReloadCount, 0);
});

test('a malformed reload preserves the last valid snapshot', () => {
  const store = new ConfigStore(seedSnapshot());
  assert.throws(() => store.replace({ ...SEED_CONFIG, defaultMarginBasisPoints: 'free' }), ConfigValidationError);
  assert.equal(store.current().fxVersion, 'fx-demo-1');
  assert.equal(store.current().defaultMarginBasisPoints, 1000);
  assert.equal(store.failedReloadCount, 1);
  assert.equal(store.reloadCount, 0);
});

test('reads, reloads from and reports problems with a file on disk', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'vh-config-'));
  const file = path.join(dir, 'pricing.json');
  await writeFile(file, JSON.stringify(SEED_CONFIG), 'utf8');

  const store = await loadConfigStore(file);
  assert.equal(store.current().fxVersion, 'fx-demo-1');

  await writeFile(file, JSON.stringify({ ...SEED_CONFIG, fxVersion: 'fx-demo-3' }), 'utf8');
  await store.reloadFromDisk();
  assert.equal(store.current().fxVersion, 'fx-demo-3');

  await writeFile(file, '{ not json', 'utf8');
  await assert.rejects(() => store.reloadFromDisk(), /not valid JSON/);
  assert.equal(store.current().fxVersion, 'fx-demo-3', 'last valid snapshot must survive');

  await assert.rejects(() => readConfigDocument(path.join(dir, 'missing.json')));
});

test('a store without a path cannot reload from disk', async () => {
  const store = new ConfigStore(seedSnapshot());
  await assert.rejects(() => store.reloadFromDisk(), /no file path/);
});

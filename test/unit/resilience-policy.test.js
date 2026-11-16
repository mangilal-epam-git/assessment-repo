import test from 'node:test';
import assert from 'node:assert/strict';
import { BACKOFF_STRATEGIES, computeBackoffMillis } from '../../src/best-offers/retry.js';
import { buildSnapshot, resolveRetryPolicy, ConfigValidationError } from '../../src/best-offers/config.js';
import { SEED_CONFIG } from '../helpers/factories.js';

const base = { maxAttempts: 5, initialDelayMillis: 100, maxDelayMillis: 2000, backoffMultiplier: 2, totalBudgetMillis: 30000, random: () => 0.5 };

test('every named strategy yields bounded, non-negative delays and none waits before attempt 1', () => {
  for (const strategy of Object.keys(BACKOFF_STRATEGIES)) {
    assert.equal(computeBackoffMillis(1, { ...base, strategy }), 0);
    let prev = base.initialDelayMillis;
    for (let a = 2; a <= 12; a += 1) {
      const d = computeBackoffMillis(a, { ...base, strategy }, prev);
      assert.ok(d >= 0 && d <= base.maxDelayMillis, `${strategy} attempt ${a} gave ${d}`);
      prev = d;
    }
  }
});

test('strategies differ in the way their names promise', () => {
  const at = (strategy, a) => computeBackoffMillis(a, { ...base, strategy });
  assert.deepEqual([2, 3, 4].map((a) => at('exponential', a)), [100, 200, 400]);
  assert.deepEqual([2, 3, 4].map((a) => at('linear', a)), [100, 200, 300]);
  assert.deepEqual([2, 3, 4].map((a) => at('fixed', a)), [100, 100, 100]);
  assert.equal(at('exponential-full-jitter', 3), 100); // 0.5 * 200
  assert.equal(at('exponential-equal-jitter', 3), 150); // 100 + 0.5*100
});

test('an unknown strategy degrades to the default instead of throwing', () => {
  assert.equal(computeBackoffMillis(3, { ...base, strategy: 'nonsense' }), computeBackoffMillis(3, base));
});

test('the resilience section is optional and defaults sensibly', () => {
  const snap = buildSnapshot(SEED_CONFIG);
  assert.equal(snap.resilienceVersion, 'built-in');
  assert.equal(resolveRetryPolicy(snap, 'telemetry1').strategy, 'exponential-full-jitter');
});

test('provider overrides inherit from the default', () => {
  const snap = buildSnapshot({
    ...SEED_CONFIG,
    resilienceVersion: 'r-2',
    resilience: {
      default: { strategy: 'exponential-equal-jitter', maxAttempts: 4 },
      providers: { telemetry2: { maxAttempts: 6, perAttemptTimeoutMillis: 5000 } },
    },
  });
  assert.equal(snap.resilienceVersion, 'r-2');
  const t1 = resolveRetryPolicy(snap, 'telemetry1');
  const t2 = resolveRetryPolicy(snap, 'telemetry2');
  assert.equal(t1.maxAttempts, 4);
  assert.equal(t2.maxAttempts, 6);
  assert.equal(t2.strategy, 'exponential-equal-jitter', 'inherited, not restated');
  assert.equal(t2.perAttemptTimeoutMillis, 5000);
  assert.ok(Object.isFrozen(t2));
});

test('invalid resilience settings are rejected whole, naming each problem', () => {
  const bad = (resilience) => assert.throws(() => buildSnapshot({ ...SEED_CONFIG, resilience }), ConfigValidationError);
  bad({ default: { strategy: 'aggressive' } });
  bad({ default: { maxAttempts: 99 } });
  bad({ default: { initialDelayMillis: 500, maxDelayMillis: 100 } });
  bad({ default: { surprise: 1 } });
  bad({ nope: {} });
  bad({ providers: { telemetry1: { maxAttempts: 'many' } } });
  bad([]);
});

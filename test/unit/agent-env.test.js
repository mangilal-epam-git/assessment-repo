import test from 'node:test';
import assert from 'node:assert/strict';
import { readAgentEnvironment } from '../../src/agent/env.js';

test('defaults to the deterministic planner so the service always starts', () => {
  const config = readAgentEnvironment({});
  assert.equal(config.modelBackend, 'deterministic');
  assert.equal(config.port, 8082);
  assert.equal(config.modelFallbackEnabled, true);
  assert.ok(Object.isFrozen(config));
});

test('a cloud backend without a key fails at boot, not on the first request', () => {
  for (const backend of ['anthropic', 'openai', 'azure-openai']) {
    assert.throws(
      () => readAgentEnvironment({ MODEL_BACKEND: backend }),
      /MODEL_API_KEY is required/,
      `${backend} should require a key`,
    );
  }
  // Ollama is local and needs none.
  assert.equal(readAgentEnvironment({ MODEL_BACKEND: 'ollama' }).modelBackend, 'ollama');
});

test('rejects an unknown backend', () => {
  assert.throws(() => readAgentEnvironment({ MODEL_BACKEND: 'skynet' }), /MODEL_BACKEND must be one of/);
});

test('parses and bounds the numeric settings', () => {
  const config = readAgentEnvironment({
    AGENT_PORT: '9100',
    AGENT_MAX_ITERATIONS: '12',
    MODEL_TEMPERATURE: '0.7',
    FOUR_EYES_THRESHOLD_MINOR: '50000',
  });
  assert.equal(config.port, 9100);
  assert.equal(config.maxIterations, 12);
  assert.equal(config.modelTemperature, 0.7);
  assert.equal(config.fourEyesThresholdMinor, 50_000);

  assert.throws(() => readAgentEnvironment({ AGENT_MAX_ITERATIONS: '99' }), /AGENT_MAX_ITERATIONS/);
  assert.throws(() => readAgentEnvironment({ MODEL_TEMPERATURE: '9' }), /MODEL_TEMPERATURE/);
  assert.throws(() => readAgentEnvironment({ AGENT_PORT: 'eighty' }), /AGENT_PORT/);
});

test('a pinned clock is refused in production', () => {
  assert.throws(
    () => readAgentEnvironment({ NODE_ENV: 'production', FIXED_CLOCK: '2026-06-15T10:05:00Z' }),
    /FIXED_CLOCK must not be set when NODE_ENV is production/,
  );
});

test('the egress policy defaults to enforced and narrow', () => {
  const config = readAgentEnvironment({});
  assert.equal(config.modelEgressPolicyEnabled, true);
  assert.deepEqual(config.modelPermittedDataClasses, ['OPERATIONAL', 'VEHICLE_ID']);
});

test('the permitted data classes can be widened, but not to the unauthorisable', () => {
  const widened = readAgentEnvironment({ MODEL_PERMITTED_DATA_CLASSES: 'OPERATIONAL,vehicle_id,VIN' });
  assert.deepEqual(widened.modelPermittedDataClasses, ['OPERATIONAL', 'VEHICLE_ID', 'VIN']);

  // Someone trying to authorise the unauthorisable stops the service.
  assert.throws(
    () => readAgentEnvironment({ MODEL_PERMITTED_DATA_CLASSES: 'OPERATIONAL,SECRET' }),
    /must never include SECRET/,
  );
  assert.throws(
    () => readAgentEnvironment({ MODEL_PERMITTED_DATA_CLASSES: 'OPERATIONAL,PAYMENT' }),
    /must never include PAYMENT/,
  );
  assert.throws(
    () => readAgentEnvironment({ MODEL_PERMITTED_DATA_CLASSES: 'OPERATIONAL,EVERYTHING' }),
    /unknown class "EVERYTHING"/,
  );
});

test('the egress policy cannot be switched off in production', () => {
  assert.throws(
    () => readAgentEnvironment({ NODE_ENV: 'production', MODEL_EGRESS_POLICY_ENABLED: 'false' }),
    /MODEL_EGRESS_POLICY_ENABLED must not be false when NODE_ENV is production/,
  );
  // Permitted outside production, for a deliberate local experiment.
  assert.equal(readAgentEnvironment({ MODEL_EGRESS_POLICY_ENABLED: 'false' }).modelEgressPolicyEnabled, false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readEnvironment } from '../../src/best-offers/env.js';

test('applies documented defaults for an empty environment', () => {
  const config = readEnvironment({});
  assert.equal(config.port, 8080);
  assert.equal(config.logLevel, 'info');
  assert.equal(config.providerMaxAttempts, 3);
  assert.equal(config.providerTimeoutMillis, 2000);
  assert.equal(config.maxConcurrentRequests, 256);
  assert.equal(config.configWatchEnabled, true);
  assert.ok(Object.isFrozen(config));
});

test('parses supplied values', () => {
  const config = readEnvironment({
    PORT: '9000',
    LOG_LEVEL: 'debug',
    PROVIDER_MAX_ATTEMPTS: '5',
    CONFIG_WATCH_ENABLED: 'false',
    PROVIDER_TELEMETRY1_URL: 'https://p1.example/offers',
  });
  assert.equal(config.port, 9000);
  assert.equal(config.logLevel, 'debug');
  assert.equal(config.providerMaxAttempts, 5);
  assert.equal(config.configWatchEnabled, false);
  assert.equal(config.providerTelemetry1Url, 'https://p1.example/offers');
});

test('port 0 is allowed and means an ephemeral port', () => {
  assert.equal(readEnvironment({ PORT: '0' }).port, 0);
});

test('fails fast on invalid values rather than guessing', () => {
  assert.throws(() => readEnvironment({ PORT: '70000' }), /PORT must be an integer/);
  assert.throws(() => readEnvironment({ PORT: 'eighty' }), /PORT must be an integer/);
  assert.throws(() => readEnvironment({ LOG_LEVEL: 'verbose' }), /LOG_LEVEL must be one of/);
  assert.throws(() => readEnvironment({ PROVIDER_MAX_ATTEMPTS: '0' }), /PROVIDER_MAX_ATTEMPTS/);
  assert.throws(() => readEnvironment({ PROVIDER_TELEMETRY1_URL: 'not-a-url' }), /valid absolute URL/);
  assert.throws(() => readEnvironment({ PROVIDER_TELEMETRY2_URL: 'ftp://host/x' }), /http\(s\) URL/);
});

test('rejects a retry max delay below the initial delay', () => {
  assert.throws(
    () => readEnvironment({ PROVIDER_RETRY_INITIAL_DELAY_MS: '500', PROVIDER_RETRY_MAX_DELAY_MS: '100' }),
    /must not be below/,
  );
});

test('reports every problem in one message', () => {
  assert.throws(
    () => readEnvironment({ PORT: '-1', LOG_LEVEL: 'loud' }),
    (error) => error.message.includes('PORT') && error.message.includes('LOG_LEVEL'),
  );
});

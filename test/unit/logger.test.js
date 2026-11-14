import test from 'node:test';
import assert from 'node:assert/strict';
import { Logger, sanitiseLogFields } from '../../src/best-offers/logger.js';

function capture(options = {}) {
  const lines = [];
  const logger = new Logger({ sink: (line) => lines.push(JSON.parse(line)), ...options });
  return { logger, lines };
}

test('emits structured JSON with level, message and timestamp', () => {
  const { logger, lines } = capture();
  logger.info('something.happened', { count: 3 });
  assert.equal(lines.length, 1);
  assert.equal(lines[0].level, 'info');
  assert.equal(lines[0].message, 'something.happened');
  assert.equal(lines[0].count, 3);
  assert.ok(Date.parse(lines[0].timestamp));
});

test('honours the configured level', () => {
  const { logger, lines } = capture({ level: 'warn' });
  logger.debug('a');
  logger.info('b');
  logger.warn('c');
  logger.error('d');
  assert.deepEqual(lines.map((l) => l.message), ['c', 'd']);
});

test('child loggers inherit and extend base fields', () => {
  const { logger, lines } = capture({ base: { service: 'best-offers' } });
  logger.child({ requestId: 'r-1' }).info('http.request', { route: '/best-offers' });
  assert.equal(lines[0].service, 'best-offers');
  assert.equal(lines[0].requestId, 'r-1');
  assert.equal(lines[0].route, '/best-offers');
});

test('redacts secrets, payment details and driver location', () => {
  const { logger, lines } = capture();
  logger.info('request', {
    authorization: 'Bearer abc',
    apiKey: 'k',
    api_key: 'k',
    password: 'p',
    cardNumber: '4111111111111111',
    cvv: '123',
    iban: 'DE00',
    cookie: 'session=1',
    vin: 'WDB1234567890',
    latitude: 52.1,
    longitude: 4.3,
    geo: { lat: 1, lon: 2 },
    productId: 'eu-north-location-hour',
  });
  const record = lines[0];
  for (const key of ['authorization', 'apiKey', 'api_key', 'password', 'cardNumber', 'cvv', 'iban', 'cookie', 'vin', 'latitude', 'longitude', 'geo']) {
    assert.equal(record[key], '[redacted]', `${key} must be redacted`);
  }
  assert.equal(record.productId, 'eu-north-location-hour', 'non-sensitive fields pass through');
});

test('redacts sensitive keys nested inside objects and arrays', () => {
  const output = sanitiseLogFields({ outer: { inner: { secret: 'x' } }, list: [{ token: 'y' }] });
  assert.equal(output.outer.inner.secret, '[redacted]');
  assert.equal(output.list[0].token, '[redacted]');
});

test('truncates very long strings and deep structures', () => {
  const { logger, lines } = capture();
  let deep = { value: 'leaf' };
  for (let i = 0; i < 12; i += 1) deep = { nested: deep };
  logger.info('big', { long: 'x'.repeat(2000), deep });
  assert.ok(lines[0].long.length < 600);
  assert.ok(lines[0].long.endsWith('...'));
  assert.ok(JSON.stringify(lines[0].deep).includes('[truncated]'));
});

test('serialises errors without leaking stack traces', () => {
  const { logger, lines } = capture();
  logger.error('failed', { error: new TypeError('boom') });
  assert.deepEqual(lines[0].error, { name: 'TypeError', message: 'boom' });
});

test('a failing sink never throws into the caller', () => {
  const logger = new Logger({
    sink: () => {
      throw new Error('stdout is gone');
    },
  });
  assert.doesNotThrow(() => logger.info('still fine'));
});

test('handles bigints and unserialisable values', () => {
  const { logger, lines } = capture();
  logger.info('mixed', { big: 10n, fn: () => {}, nothing: null, flag: false });
  assert.equal(lines[0].big, '10');
  assert.equal(lines[0].nothing, null);
  assert.equal(lines[0].flag, false);
});

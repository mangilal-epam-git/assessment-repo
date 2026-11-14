import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRfc3339Utc, formatRfc3339Utc } from '../../src/best-offers/time.js';

test('parses RFC 3339 UTC timestamps', () => {
  assert.equal(parseRfc3339Utc('2026-06-15T10:00:00Z'), Date.UTC(2026, 5, 15, 10, 0, 0));
  assert.equal(parseRfc3339Utc('2026-06-15t10:00:00z'), Date.UTC(2026, 5, 15, 10, 0, 0));
  assert.equal(parseRfc3339Utc('2026-06-15T10:00:00+00:00'), Date.UTC(2026, 5, 15, 10, 0, 0));
  assert.equal(parseRfc3339Utc('2026-06-15T10:00:00.250Z'), Date.UTC(2026, 5, 15, 10, 0, 0, 250));
});

test('rejects non-UTC offsets rather than converting them', () => {
  assert.equal(parseRfc3339Utc('2026-06-15T10:00:00+02:00'), null);
  assert.equal(parseRfc3339Utc('2026-06-15T10:00:00-05:00'), null);
});

test('rejects malformed, impossible and non-string values', () => {
  for (const bad of [
    '', 'not-a-date', '2026-06-15', '2026-06-15 10:00:00Z', '2026-13-01T00:00:00Z',
    '2026-02-30T00:00:00Z', '2026-06-15T25:00:00Z', '2026-06-15T10:61:00Z',
    null, undefined, 42, {}, [],
  ]) {
    assert.equal(parseRfc3339Utc(bad), null, `expected rejection of ${String(bad)}`);
  }
});

test('formats epoch milliseconds back to RFC 3339 UTC', () => {
  assert.equal(formatRfc3339Utc(Date.UTC(2026, 5, 15, 10, 5, 0)), '2026-06-15T10:05:00Z');
  assert.equal(formatRfc3339Utc(Date.UTC(2026, 5, 15, 10, 5, 0, 250)), '2026-06-15T10:05:00.250Z');
});

test('parse and format round-trip', () => {
  const text = '2026-06-15T10:16:00Z';
  assert.equal(formatRfc3339Utc(parseRfc3339Utc(text)), text);
});

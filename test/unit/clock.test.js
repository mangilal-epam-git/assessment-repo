import test from 'node:test';
import assert from 'node:assert/strict';
import { systemClock, fixedClock } from '../../src/best-offers/clock.js';

test('the system clock tracks wall-clock time', () => {
  const before = Date.now();
  const value = systemClock().now();
  assert.ok(value >= before && value <= Date.now());
});

test('a fixed clock is stable across calls', () => {
  const clock = fixedClock('2026-06-15T10:05:00Z');
  assert.equal(clock.now(), Date.UTC(2026, 5, 15, 10, 5, 0));
  assert.equal(clock.now(), clock.now());
});

test('a fixed clock rejects an invalid instant', () => {
  assert.throws(() => fixedClock('yesterday'), /RFC 3339/);
});

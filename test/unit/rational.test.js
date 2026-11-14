import test from 'node:test';
import assert from 'node:assert/strict';
import { Rational } from '../../src/best-offers/rational.js';

test('normalises sign and reduces to lowest terms', () => {
  const value = new Rational(4n, -8n);
  assert.equal(value.n, -1n);
  assert.equal(value.d, 2n);
});

test('rejects a zero denominator', () => {
  assert.throws(() => new Rational(1n, 0n), RangeError);
});

test('parses plain decimal strings exactly', () => {
  const rate = Rational.fromDecimalString('0.92');
  assert.equal(rate.n, 23n);
  assert.equal(rate.d, 25n);
  assert.equal(Rational.fromDecimalString('1.180').compare(Rational.fromDecimalString('1.18')), 0);
});

test('rejects non-decimal strings', () => {
  for (const bad of ['', 'abc', '1e3', '-1.5', '.5', '1.', '0x10', ' 1.0']) {
    assert.throws(() => Rational.fromDecimalString(bad), RangeError, `expected rejection of ${bad}`);
  }
});

test('fromInteger rejects unsafe integers', () => {
  assert.throws(() => Rational.fromInteger(2 ** 53), RangeError);
  assert.equal(Rational.fromInteger(7n).n, 7n);
});

test('arithmetic is exact where binary floating point is not', () => {
  // 0.1 + 0.2 === 0.30000000000000004 in IEEE-754 binary64.
  const sum = Rational.fromDecimalString('0.1').add(Rational.fromDecimalString('0.2'));
  assert.equal(sum.compare(Rational.fromDecimalString('0.3')), 0);
  assert.equal(sum.toFixedHalfUp(2), '0.30');
});

test('multiplication and division round-trip', () => {
  const value = new Rational(13156n, 100n);
  const roundTripped = value.mul(Rational.fromInteger(1000)).div(Rational.fromInteger(1000));
  assert.equal(roundTripped.compare(value), 0);
});

test('compare orders values that differ only beyond the serialised precision', () => {
  // Two costs that both render as 0.100000 at six places but are not equal.
  const a = new Rational(1n, 10n);
  const b = new Rational(10000001n, 100000000n);
  assert.equal(a.compare(b), -1);
  assert.equal(b.compare(a), 1);
  assert.equal(a.toFixedHalfUp(6), b.toFixedHalfUp(6));
});

test('round-half-up rounds exact halves away from zero', () => {
  assert.equal(new Rational(5n, 10n).toFixedHalfUp(0), '1');
  assert.equal(new Rational(15n, 10n).toFixedHalfUp(0), '2');
  assert.equal(new Rational(125n, 1000n).toFixedHalfUp(2), '0.13');
  assert.equal(new Rational(135n, 1000n).toFixedHalfUp(2), '0.14');
  // Banker's rounding would give 0.12 and 0.14 respectively.
});

test('round-half-up pads and places the decimal point correctly', () => {
  assert.equal(Rational.fromInteger(0).toFixedHalfUp(6), '0.000000');
  assert.equal(new Rational(1n, 3n).toFixedHalfUp(4), '0.3333');
  assert.equal(new Rational(2n, 3n).toFixedHalfUp(4), '0.6667');
  assert.equal(Rational.fromInteger(12).toFixedHalfUp(2), '12.00');
});

test('round-half-up validates its arguments', () => {
  assert.throws(() => Rational.fromInteger(1).toFixedHalfUp(-1), RangeError);
  assert.throws(() => Rational.fromInteger(1).toFixedHalfUp(1.5), RangeError);
  assert.throws(() => new Rational(-1n, 2n).toFixedHalfUp(2), RangeError);
});

test('handles magnitudes far beyond Number.MAX_SAFE_INTEGER', () => {
  const huge = new Rational(10n ** 30n + 1n, 3n);
  assert.equal(huge.toFixedHalfUp(2), '333333333333333333333333333333.67');
});

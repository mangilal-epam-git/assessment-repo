import test from 'node:test';
import assert from 'node:assert/strict';
import { normalisePricing } from '../../src/best-offers/pricing.js';
import { seedSnapshot } from '../helpers/factories.js';

const snapshot = seedSnapshot();

test('converts, applies markup, and normalises per 1000 valid events', () => {
  // 1200 minor EUR -> 12.00 EUR; +10% markup -> 13.20; /98000 * 1000.
  const pricing = normalisePricing(
    { priceMinor: 1200, currency: 'EUR', validEventCount: 98000 },
    snapshot,
  );
  assert.equal(pricing.providerBaseAmount.toFixedHalfUp(2), '12.00');
  assert.equal(pricing.customerBundleAmount.toFixedHalfUp(2), '13.20');
  assert.equal(pricing.costPer1000ValidEvents.toFixedHalfUp(6), '0.134694');
});

test('applies the configured FX rate to a foreign currency', () => {
  // 900 minor USD -> 9.00 USD * 0.92 = 8.28 EUR; +10% -> 9.108 -> "9.11".
  const pricing = normalisePricing(
    { priceMinor: 900, currency: 'USD', validEventCount: 47000 },
    snapshot,
  );
  assert.equal(pricing.providerBaseAmount.toFixedHalfUp(2), '8.28');
  assert.equal(pricing.customerBundleAmount.toFixedHalfUp(2), '9.11');
  assert.equal(pricing.costPer1000ValidEvents.toFixedHalfUp(6), '0.193787');
});

test('markup is a markup on cost, not a gross margin', () => {
  // A 1000 bps gross margin would give 10.00 / 0.9 = 11.11, not 11.00.
  const pricing = normalisePricing(
    { priceMinor: 1000, currency: 'EUR', validEventCount: 1000 },
    snapshot,
  );
  assert.equal(pricing.customerBundleAmount.toFixedHalfUp(2), '11.00');
});

test('a zero markup leaves the converted cost unchanged', () => {
  const zeroMargin = seedSnapshot({ defaultMarginBasisPoints: 0 });
  const pricing = normalisePricing(
    { priceMinor: 1200, currency: 'EUR', validEventCount: 1000 },
    zeroMargin,
  );
  assert.equal(pricing.customerBundleAmount.toFixedHalfUp(2), '12.00');
  assert.equal(pricing.marginBasisPoints, 0);
});

test('a free bundle costs zero per thousand events', () => {
  const pricing = normalisePricing(
    { priceMinor: 0, currency: 'EUR', validEventCount: 5000 },
    snapshot,
  );
  assert.equal(pricing.costPer1000ValidEvents.toFixedHalfUp(6), '0.000000');
});

test('guards against unconfigured currencies and impossible counts', () => {
  assert.throws(
    () => normalisePricing({ priceMinor: 100, currency: 'JPY', validEventCount: 10 }, snapshot),
    /No configured FX rate/,
  );
  assert.throws(
    () => normalisePricing({ priceMinor: 100, currency: 'EUR', validEventCount: 0 }, snapshot),
    RangeError,
  );
});

test('pricing is exact: no binary floating-point drift at scale', () => {
  // 0.07 EUR at 3 valid events is a repeating decimal; the rational path keeps
  // full precision and only the serialiser rounds.
  const pricing = normalisePricing(
    { priceMinor: 7, currency: 'EUR', validEventCount: 3 },
    seedSnapshot({ defaultMarginBasisPoints: 0 }),
  );
  assert.equal(pricing.costPer1000ValidEvents.toFixedHalfUp(6), '23.333333');
});

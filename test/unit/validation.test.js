import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRow, findRepeatedProductIds, DEFAULT_EXPIRY_MILLIS } from '../../src/best-offers/validation.js';
import { RowReason } from '../../src/best-offers/reason-codes.js';
import { seedSnapshot, offer, FIXTURE_EPOCH } from '../helpers/factories.js';

const snapshot = seedSnapshot();
const context = { nowEpochMillis: FIXTURE_EPOCH, fxRatesToBase: snapshot.fxRatesToBase };

function reasonFor(overrides) {
  const outcome = validateRow(offer(overrides), context);
  assert.equal(outcome.ok, false, 'expected the row to be rejected');
  return outcome.reason;
}

test('accepts a well-formed row', () => {
  const outcome = validateRow(offer(), context);
  assert.equal(outcome.ok, true);
  assert.equal(outcome.value.productId, 'eu-north-location-hour');
  assert.equal(outcome.value.qualityRatio.toFixedHalfUp(4), '0.9800');
});

test('rejects non-object rows', () => {
  for (const bad of [null, 42, 'row', [], true]) {
    const outcome = validateRow(bad, context);
    assert.equal(outcome.ok, false);
    assert.equal(outcome.reason, RowReason.ROW_NOT_OBJECT);
  }
});

test('rejects unknown fields rather than ignoring them', () => {
  assert.equal(reasonFor({ providerId: 'telemetry1' }), RowReason.UNKNOWN_FIELD);
  assert.equal(reasonFor({ discountMinor: 10 }), RowReason.UNKNOWN_FIELD);
});

test('rejects missing required fields', () => {
  for (const field of ['productId', 'eventCount', 'validEventCount', 'priceMinor', 'currency', 'observedAt']) {
    const row = offer();
    delete row[field];
    const outcome = validateRow(row, context);
    assert.equal(outcome.ok, false);
    assert.equal(outcome.reason, RowReason.MISSING_FIELD, `expected MISSING_FIELD for ${field}`);
  }
});

test('productId must be a nonempty string', () => {
  assert.equal(reasonFor({ productId: '' }), RowReason.INVALID_PRODUCT_ID);
  assert.equal(reasonFor({ productId: 7 }), RowReason.INVALID_PRODUCT_ID);
});

test('counts must be positive integers', () => {
  assert.equal(reasonFor({ eventCount: 0 }), RowReason.INVALID_EVENT_COUNT);
  assert.equal(reasonFor({ eventCount: -5 }), RowReason.INVALID_EVENT_COUNT);
  assert.equal(reasonFor({ eventCount: 1.5 }), RowReason.INVALID_EVENT_COUNT);
  assert.equal(reasonFor({ eventCount: '100' }), RowReason.INVALID_EVENT_COUNT);
  assert.equal(reasonFor({ validEventCount: 0 }), RowReason.INVALID_VALID_EVENT_COUNT);
  assert.equal(reasonFor({ validEventCount: -1 }), RowReason.INVALID_VALID_EVENT_COUNT);
  assert.equal(reasonFor({ validEventCount: 2.5 }), RowReason.INVALID_VALID_EVENT_COUNT);
});

test('validEventCount must not exceed eventCount', () => {
  assert.equal(
    reasonFor({ eventCount: 100, validEventCount: 101 }),
    RowReason.VALID_EVENT_COUNT_EXCEEDS_EVENT_COUNT,
  );
  // Equality is allowed: a perfect feed is legitimate.
  assert.equal(validateRow(offer({ eventCount: 100, validEventCount: 100 }), context).ok, true);
});

test('priceMinor must be a nonnegative integer', () => {
  assert.equal(reasonFor({ priceMinor: -1 }), RowReason.INVALID_PRICE_MINOR);
  assert.equal(reasonFor({ priceMinor: 12.5 }), RowReason.INVALID_PRICE_MINOR);
  // Zero is valid: a free promotional bundle is a legitimate offer.
  assert.equal(validateRow(offer({ priceMinor: 0 }), context).ok, true);
});

test('currency must have a configured FX rate', () => {
  assert.equal(reasonFor({ currency: 'JPY' }), RowReason.UNSUPPORTED_CURRENCY);
  assert.equal(reasonFor({ currency: 'eur' }), RowReason.UNSUPPORTED_CURRENCY);
  assert.equal(reasonFor({ currency: '' }), RowReason.INVALID_CURRENCY);
  assert.equal(reasonFor({ currency: 978 }), RowReason.INVALID_CURRENCY);
});

test('observedAt must parse and must not be in the future', () => {
  assert.equal(reasonFor({ observedAt: 'later' }), RowReason.INVALID_OBSERVED_AT);
  assert.equal(reasonFor({ observedAt: '2026-06-15T10:05:01Z' }), RowReason.OBSERVED_AT_IN_FUTURE);
  // Exactly "now" is not in the future.
  assert.equal(validateRow(offer({ observedAt: '2026-06-15T10:05:00Z' }), context).ok, true);
});

test('expiresAt, when supplied, must be later than observedAt', () => {
  assert.equal(reasonFor({ expiresAt: 'soon' }), RowReason.INVALID_EXPIRES_AT);
  assert.equal(
    reasonFor({ observedAt: '2026-06-15T10:00:00Z', expiresAt: '2026-06-15T10:00:00Z' }),
    RowReason.EXPIRES_AT_NOT_AFTER_OBSERVED_AT,
  );
  assert.equal(
    reasonFor({ observedAt: '2026-06-15T10:00:00Z', expiresAt: '2026-06-15T09:59:00Z' }),
    RowReason.EXPIRES_AT_NOT_AFTER_OBSERVED_AT,
  );
});

test('an absent expiresAt defaults to observedAt plus fifteen minutes', () => {
  const outcome = validateRow(offer({ observedAt: '2026-06-15T10:00:00Z' }), context);
  assert.equal(outcome.ok, true);
  assert.equal(outcome.value.expiryWasSupplied, false);
  assert.equal(
    outcome.value.effectiveExpiryEpochMillis,
    Date.UTC(2026, 5, 15, 10, 0, 0) + DEFAULT_EXPIRY_MILLIS,
  );
});

test('a supplied expiresAt is used verbatim', () => {
  const outcome = validateRow(
    offer({ observedAt: '2026-06-15T10:00:00Z', expiresAt: '2026-06-15T10:30:00Z' }),
    context,
  );
  assert.equal(outcome.ok, true);
  assert.equal(outcome.value.expiryWasSupplied, true);
  assert.equal(outcome.value.effectiveExpiryEpochMillis, Date.UTC(2026, 5, 15, 10, 30, 0));
});

test('findRepeatedProductIds reports only ids seen more than once', () => {
  const repeated = findRepeatedProductIds([
    { productId: 'a' },
    { productId: 'b' },
    { productId: 'a' },
    null,
    { productId: '' },
    { productId: 3 },
    'not-an-object',
  ]);
  assert.deepEqual([...repeated], ['a']);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateProviderRows,
  selectBestPerProduct,
  compareCandidates,
  checkEligibility,
} from '../../src/best-offers/ranking.js';
import { validateRow } from '../../src/best-offers/validation.js';
import { normalisePricing } from '../../src/best-offers/pricing.js';
import { RowReason } from '../../src/best-offers/reason-codes.js';
import { seedSnapshot, offer, FIXTURE_EPOCH } from '../helpers/factories.js';

const snapshot = seedSnapshot();

function candidate(providerId, overrides, rowIndex = 0) {
  const outcome = validateRow(offer(overrides), {
    nowEpochMillis: FIXTURE_EPOCH,
    fxRatesToBase: snapshot.fxRatesToBase,
  });
  assert.equal(outcome.ok, true, 'test candidate must be a valid row');
  return {
    providerId,
    rowIndex,
    row: outcome.value,
    pricing: normalisePricing(
      {
        priceMinor: outcome.value.priceMinor,
        currency: outcome.value.currency,
        validEventCount: outcome.value.validEventCount,
      },
      snapshot,
    ),
  };
}

function evaluate(rows, providerId = 'telemetry1') {
  return evaluateProviderRows({ providerId, rows, nowEpochMillis: FIXTURE_EPOCH, snapshot });
}

test('eligibility enforces the minimum quality ratio', () => {
  const { candidates, rejected } = evaluate([offer({ eventCount: 40000, validEventCount: 32000 })]);
  assert.equal(candidates.length, 0);
  assert.deepEqual(rejected, [
    { providerId: 'telemetry1', rowIndex: 0, reason: RowReason.QUALITY_BELOW_MINIMUM },
  ]);
});

test('a quality ratio exactly at the minimum is eligible', () => {
  const { candidates } = evaluate([offer({ eventCount: 10000, validEventCount: 9000 })]);
  assert.equal(candidates.length, 1);
});

test('eligibility enforces the fifteen-minute observation window', () => {
  // 09:40 is 25 minutes before the fixture instant.
  const stale = evaluate([offer({ observedAt: '2026-06-15T09:40:00Z' })]);
  assert.equal(stale.rejected[0].reason, RowReason.OBSERVATION_STALE);

  // Exactly fifteen minutes old is still inside the window.
  const edge = evaluate([
    offer({ observedAt: '2026-06-15T09:50:00Z', expiresAt: '2026-06-15T10:30:00Z' }),
  ]);
  assert.equal(edge.candidates.length, 1);

  // One second older is not.
  const past = evaluate([
    offer({ observedAt: '2026-06-15T09:49:59Z', expiresAt: '2026-06-15T10:30:00Z' }),
  ]);
  assert.equal(past.rejected[0].reason, RowReason.OBSERVATION_STALE);
});

test('now must be strictly earlier than the effective expiry', () => {
  // Expiry exactly at "now" is expired: the comparison is strict.
  const atExpiry = evaluate([
    offer({ observedAt: '2026-06-15T10:00:00Z', expiresAt: '2026-06-15T10:05:00Z' }),
  ]);
  assert.equal(atExpiry.rejected[0].reason, RowReason.OFFER_EXPIRED);

  const justAlive = evaluate([
    offer({ observedAt: '2026-06-15T10:00:00Z', expiresAt: '2026-06-15T10:05:01Z' }),
  ]);
  assert.equal(justAlive.candidates.length, 1);
});

test('the default fifteen-minute expiry is applied when expiresAt is absent', () => {
  // Observed 09:51, so the implied expiry is 10:06 - still alive at 10:05,
  // and the observation is 14 minutes old, so inside the window too.
  const alive = evaluate([offer({ observedAt: '2026-06-15T09:51:00Z' })]);
  assert.equal(alive.candidates.length, 1);
  assert.equal(alive.candidates[0].row.effectiveExpiryEpochMillis, Date.UTC(2026, 5, 15, 10, 6, 0));
});

test('quality is checked before staleness, and staleness before expiry', () => {
  // A row that fails all three reports the first reason deterministically.
  const { rejected } = evaluate([
    offer({ eventCount: 100, validEventCount: 10, observedAt: '2026-06-15T09:00:00Z' }),
  ]);
  assert.equal(rejected[0].reason, RowReason.QUALITY_BELOW_MINIMUM);
});

test('every row of a repeated productId is rejected', () => {
  const { candidates, rejected } = evaluate([
    offer({ productId: 'dup', priceMinor: 100 }),
    offer({ productId: 'unique' }),
    offer({ productId: 'dup', priceMinor: 200 }),
  ]);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].row.productId, 'unique');
  assert.deepEqual(
    rejected.map((row) => [row.rowIndex, row.reason]),
    [
      [0, RowReason.DUPLICATE_PRODUCT_ID],
      [2, RowReason.DUPLICATE_PRODUCT_ID],
    ],
  );
});

test('duplicate rejection takes precedence over other row faults', () => {
  const { rejected } = evaluate([
    offer({ productId: 'dup', currency: 'JPY' }),
    offer({ productId: 'dup' }),
  ]);
  assert.deepEqual(rejected.map((row) => row.reason), [
    RowReason.DUPLICATE_PRODUCT_ID,
    RowReason.DUPLICATE_PRODUCT_ID,
  ]);
});

test('a malformed row does not invalidate the others', () => {
  const { candidates, rejected } = evaluate([
    'garbage',
    offer({ productId: 'good-1' }),
    { productId: 'bad', eventCount: 10 },
    offer({ productId: 'good-2' }),
  ]);
  assert.deepEqual(candidates.map((c) => c.row.productId), ['good-1', 'good-2']);
  assert.deepEqual(rejected.map((r) => r.rowIndex), [0, 2]);
});

test('row indices refer to the position in the provider response', () => {
  const { rejected } = evaluate([offer(), offer({ productId: 'x', currency: 'JPY' })]);
  assert.equal(rejected[0].rowIndex, 1);
});

test('lowest unrounded cost per 1000 valid events wins', () => {
  const cheap = candidate('telemetry2', { priceMinor: 1300, currency: 'USD', eventCount: 120000, validEventCount: 114000 });
  const dear = candidate('telemetry1', { priceMinor: 1200, currency: 'EUR', eventCount: 100000, validEventCount: 98000 });
  assert.ok(compareCandidates(cheap, dear) < 0);
  const [winner] = selectBestPerProduct([dear, cheap]);
  assert.equal(winner.providerId, 'telemetry2');
});

test('a lower bundle price does not win if it is worse per valid event', () => {
  // 3.00 EUR for 32000 valid events is dearer per event than 7.00 for 43200.
  const lowBundle = candidate('telemetry1', { productId: 'p', priceMinor: 300, eventCount: 40000, validEventCount: 39000 });
  const betterValue = candidate('telemetry2', { productId: 'p', priceMinor: 700, eventCount: 45000, validEventCount: 43200 });
  assert.ok(lowBundle.pricing.customerBundleAmount.compare(betterValue.pricing.customerBundleAmount) < 0);
  const [winner] = selectBestPerProduct([lowBundle, betterValue]);
  assert.equal(winner.providerId, 'telemetry1', 'cheapest per valid event should win here');

  // And the reverse case, where the dearer bundle is the better value.
  const dearBundleBetterValue = candidate('telemetry2', { productId: 'p', priceMinor: 700, eventCount: 200000, validEventCount: 198000 });
  const [winner2] = selectBestPerProduct([lowBundle, dearBundleBetterValue]);
  assert.equal(winner2.providerId, 'telemetry2');
});

test('ties break on higher quality ratio', () => {
  // Same cost per 1000 valid events (price scaled with valid events), different quality.
  const highQuality = candidate('telemetry2', { productId: 'p', priceMinor: 1000, eventCount: 10000, validEventCount: 10000 });
  const lowQuality = candidate('telemetry1', { productId: 'p', priceMinor: 1000, eventCount: 11000, validEventCount: 10000 });
  assert.equal(
    highQuality.pricing.costPer1000ValidEvents.compare(lowQuality.pricing.costPer1000ValidEvents),
    0,
  );
  assert.ok(compareCandidates(highQuality, lowQuality) < 0);
  assert.equal(selectBestPerProduct([lowQuality, highQuality])[0].providerId, 'telemetry2');
});

test('ties then break on the newer observation', () => {
  const newer = candidate('telemetry2', { productId: 'p', observedAt: '2026-06-15T10:04:00Z' });
  const older = candidate('telemetry1', { productId: 'p', observedAt: '2026-06-15T10:00:00Z' });
  assert.ok(compareCandidates(newer, older) < 0);
  assert.equal(selectBestPerProduct([older, newer])[0].providerId, 'telemetry2');
});

test('ties finally break on the lexicographically smaller provider id', () => {
  const first = candidate('telemetry1', { productId: 'p' });
  const second = candidate('telemetry2', { productId: 'p' });
  assert.ok(compareCandidates(first, second) < 0);
  assert.ok(compareCandidates(second, first) > 0);
  assert.equal(compareCandidates(first, first), 0);
  // Insertion order must not matter.
  assert.equal(selectBestPerProduct([second, first])[0].providerId, 'telemetry1');
  assert.equal(selectBestPerProduct([first, second])[0].providerId, 'telemetry1');
});

test('a near-tie beyond six decimal places still resolves on the exact value', () => {
  // One minor unit apart, spread over 100 million valid events: the costs
  // differ by 1.1e-7 EUR per 1000 events, which vanishes at six decimal places.
  const a = candidate('telemetry1', { productId: 'p', priceMinor: 1000000000, eventCount: 100000000, validEventCount: 100000000 });
  const b = candidate('telemetry2', { productId: 'p', priceMinor: 1000000001, eventCount: 100000000, validEventCount: 100000000 });
  assert.equal(
    a.pricing.costPer1000ValidEvents.toFixedHalfUp(6),
    b.pricing.costPer1000ValidEvents.toFixedHalfUp(6),
    'the two costs are indistinguishable once rounded',
  );
  assert.equal(selectBestPerProduct([b, a])[0].providerId, 'telemetry1');
});

test('results are sorted by productId ascending', () => {
  const winners = selectBestPerProduct([
    candidate('telemetry1', { productId: 'eu-west-braking-hour' }),
    candidate('telemetry1', { productId: 'eu-north-location-hour' }),
    candidate('telemetry1', { productId: 'eu-north-diagnostics-hour' }),
  ]);
  assert.deepEqual(winners.map((w) => w.row.productId), [
    'eu-north-diagnostics-hour',
    'eu-north-location-hour',
    'eu-west-braking-hour',
  ]);
});

test('checkEligibility returns null for an eligible row', () => {
  const row = validateRow(offer(), {
    nowEpochMillis: FIXTURE_EPOCH,
    fxRatesToBase: snapshot.fxRatesToBase,
  }).value;
  assert.equal(checkEligibility(row, { nowEpochMillis: FIXTURE_EPOCH, snapshot }), null);
});

test('an empty provider response yields nothing and rejects nothing', () => {
  const { candidates, rejected } = evaluate([]);
  assert.deepEqual(candidates, []);
  assert.deepEqual(rejected, []);
});

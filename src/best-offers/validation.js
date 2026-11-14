/**
 * Row-level validation of the provider Offer contract.
 *
 * Validation is strict and closed: unknown fields are rejected rather than
 * ignored, because a silently dropped field could hide a pricing-relevant
 * attribute and this platform must be able to defend its pricing in audit.
 */

import { parseRfc3339Utc } from './time.js';
import { RowReason } from './reason-codes.js';
import { Rational } from './rational.js';

export const OFFER_FIELDS = Object.freeze([
  'productId',
  'eventCount',
  'validEventCount',
  'priceMinor',
  'currency',
  'observedAt',
  'expiresAt',
]);

const REQUIRED_FIELDS = Object.freeze([
  'productId',
  'eventCount',
  'validEventCount',
  'priceMinor',
  'currency',
  'observedAt',
]);

const ALLOWED_FIELDS = new Set(OFFER_FIELDS);

/** An absent expiresAt means observedAt plus 15 minutes. */
export const DEFAULT_EXPIRY_MILLIS = 15 * 60 * 1000;
/** observedAt must be no more than 15 minutes old. */
export const MAX_OBSERVATION_AGE_MILLIS = 15 * 60 * 1000;

const MAX_SAFE_COUNT = Number.MAX_SAFE_INTEGER;

/**
 * @typedef {object} ValidatedRow
 * @property {string} productId
 * @property {number} eventCount
 * @property {number} validEventCount
 * @property {number} priceMinor
 * @property {string} currency
 * @property {number} observedAtEpochMillis
 * @property {number} effectiveExpiryEpochMillis
 * @property {boolean} expiryWasSupplied
 * @property {Rational} qualityRatio
 */

/**
 * @typedef {{ ok: true, value: ValidatedRow } | { ok: false, reason: string }} RowOutcome
 */

/**
 * @param {unknown} value
 * @returns {boolean} true for a JSON integer that is safe to use as a count
 */
function isSafeInteger(value) {
  return typeof value === 'number' && Number.isInteger(value) && Math.abs(value) <= MAX_SAFE_COUNT;
}

/**
 * Validates a single raw row against the Offer contract.
 *
 * @param {unknown} raw
 * @param {object} context
 * @param {number} context.nowEpochMillis
 * @param {ReadonlyMap<string, Rational>} context.fxRatesToBase
 * @returns {RowOutcome}
 */
export function validateRow(raw, { nowEpochMillis, fxRatesToBase }) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, reason: RowReason.ROW_NOT_OBJECT };
  }
  const row = /** @type {Record<string, unknown>} */ (raw);

  for (const key of Object.keys(row)) {
    if (!ALLOWED_FIELDS.has(key)) return { ok: false, reason: RowReason.UNKNOWN_FIELD };
  }
  for (const key of REQUIRED_FIELDS) {
    if (row[key] === undefined) return { ok: false, reason: RowReason.MISSING_FIELD };
  }

  const { productId } = row;
  if (typeof productId !== 'string' || productId.length === 0) {
    return { ok: false, reason: RowReason.INVALID_PRODUCT_ID };
  }

  const { eventCount } = row;
  if (!isSafeInteger(eventCount) || /** @type {number} */ (eventCount) <= 0) {
    return { ok: false, reason: RowReason.INVALID_EVENT_COUNT };
  }

  const { validEventCount } = row;
  if (!isSafeInteger(validEventCount) || /** @type {number} */ (validEventCount) <= 0) {
    return { ok: false, reason: RowReason.INVALID_VALID_EVENT_COUNT };
  }

  if (/** @type {number} */ (validEventCount) > /** @type {number} */ (eventCount)) {
    return { ok: false, reason: RowReason.VALID_EVENT_COUNT_EXCEEDS_EVENT_COUNT };
  }

  const { priceMinor } = row;
  if (!isSafeInteger(priceMinor) || /** @type {number} */ (priceMinor) < 0) {
    return { ok: false, reason: RowReason.INVALID_PRICE_MINOR };
  }

  const { currency } = row;
  if (typeof currency !== 'string' || currency.length === 0) {
    return { ok: false, reason: RowReason.INVALID_CURRENCY };
  }
  if (!fxRatesToBase.has(currency)) {
    return { ok: false, reason: RowReason.UNSUPPORTED_CURRENCY };
  }

  const observedAtEpochMillis = parseRfc3339Utc(row.observedAt);
  if (observedAtEpochMillis === null) {
    return { ok: false, reason: RowReason.INVALID_OBSERVED_AT };
  }
  if (observedAtEpochMillis > nowEpochMillis) {
    return { ok: false, reason: RowReason.OBSERVED_AT_IN_FUTURE };
  }

  let effectiveExpiryEpochMillis = observedAtEpochMillis + DEFAULT_EXPIRY_MILLIS;
  const expiryWasSupplied = row.expiresAt !== undefined;
  if (expiryWasSupplied) {
    const expiresAtEpochMillis = parseRfc3339Utc(row.expiresAt);
    if (expiresAtEpochMillis === null) {
      return { ok: false, reason: RowReason.INVALID_EXPIRES_AT };
    }
    if (expiresAtEpochMillis <= observedAtEpochMillis) {
      return { ok: false, reason: RowReason.EXPIRES_AT_NOT_AFTER_OBSERVED_AT };
    }
    effectiveExpiryEpochMillis = expiresAtEpochMillis;
  }

  return {
    ok: true,
    value: {
      productId,
      eventCount: /** @type {number} */ (eventCount),
      validEventCount: /** @type {number} */ (validEventCount),
      priceMinor: /** @type {number} */ (priceMinor),
      currency,
      observedAtEpochMillis,
      effectiveExpiryEpochMillis,
      expiryWasSupplied,
      qualityRatio: new Rational(BigInt(validEventCount), BigInt(eventCount)),
    },
  };
}

/**
 * Finds productIds that occur more than once within one provider response.
 * The contract rejects ALL rows of a repeated productId, not just the later
 * ones: when a provider contradicts itself we cannot tell which row is true.
 *
 * @param {unknown[]} rows
 * @returns {Set<string>}
 */
export function findRepeatedProductIds(rows) {
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const row of rows) {
    if (row === null || typeof row !== 'object' || Array.isArray(row)) continue;
    const productId = /** @type {Record<string, unknown>} */ (row).productId;
    if (typeof productId !== 'string' || productId.length === 0) continue;
    counts.set(productId, (counts.get(productId) ?? 0) + 1);
  }
  const repeated = new Set();
  for (const [productId, count] of counts) {
    if (count > 1) repeated.add(productId);
  }
  return repeated;
}

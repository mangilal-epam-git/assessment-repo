/**
 * Eligibility filtering and best-offer selection.
 *
 * Selection key is the unrounded costPer1000ValidEvents. Rounding before
 * comparison would let a worse offer win a near-tie, which is exactly the kind
 * of pricing claim the group has to be able to defend.
 */

import { validateRow, findRepeatedProductIds, MAX_OBSERVATION_AGE_MILLIS } from './validation.js';
import { normalisePricing } from './pricing.js';
import { RowReason } from './reason-codes.js';

/**
 * @typedef {object} Candidate
 * @property {string} providerId
 * @property {number} rowIndex
 * @property {import('./validation.js').ValidatedRow} row
 * @property {import('./pricing.js').NormalisedPricing} pricing
 */

/**
 * @typedef {object} RejectedRow
 * @property {string} providerId
 * @property {number} rowIndex
 * @property {string} reason
 */

/**
 * Validates and prices one provider response.
 *
 * @param {object} input
 * @param {string} input.providerId
 * @param {unknown[]} input.rows
 * @param {number} input.nowEpochMillis
 * @param {import('./config.js').PricingSnapshot} input.snapshot
 * @returns {{ candidates: Candidate[], rejected: RejectedRow[] }}
 */
export function evaluateProviderRows({ providerId, rows, nowEpochMillis, snapshot }) {
  const repeated = findRepeatedProductIds(rows);
  /** @type {Candidate[]} */
  const candidates = [];
  /** @type {RejectedRow[]} */
  const rejected = [];

  rows.forEach((raw, rowIndex) => {
    const productId =
      raw !== null && typeof raw === 'object' && !Array.isArray(raw)
        ? /** @type {Record<string, unknown>} */ (raw).productId
        : undefined;
    // A repeated productId poisons every row that carries it, whatever else is
    // wrong with them, so this check runs before per-field validation.
    if (typeof productId === 'string' && repeated.has(productId)) {
      rejected.push({ providerId, rowIndex, reason: RowReason.DUPLICATE_PRODUCT_ID });
      return;
    }

    const outcome = validateRow(raw, { nowEpochMillis, fxRatesToBase: snapshot.fxRatesToBase });
    if (!outcome.ok) {
      rejected.push({ providerId, rowIndex, reason: outcome.reason });
      return;
    }
    const row = outcome.value;

    const eligibility = checkEligibility(row, { nowEpochMillis, snapshot });
    if (eligibility !== null) {
      rejected.push({ providerId, rowIndex, reason: eligibility });
      return;
    }

    candidates.push({
      providerId,
      rowIndex,
      row,
      pricing: normalisePricing(
        {
          priceMinor: row.priceMinor,
          currency: row.currency,
          validEventCount: row.validEventCount,
        },
        snapshot,
      ),
    });
  });

  return { candidates, rejected };
}

/**
 * @param {import('./validation.js').ValidatedRow} row
 * @param {{ nowEpochMillis: number, snapshot: import('./config.js').PricingSnapshot }} context
 * @returns {string|null} a reason code, or null when the row is eligible
 */
export function checkEligibility(row, { nowEpochMillis, snapshot }) {
  if (row.qualityRatio.compare(snapshot.minimumQualityRatio) < 0) {
    return RowReason.QUALITY_BELOW_MINIMUM;
  }
  if (nowEpochMillis - row.observedAtEpochMillis > MAX_OBSERVATION_AGE_MILLIS) {
    return RowReason.OBSERVATION_STALE;
  }
  // "now must be strictly earlier than the effective expiry"
  if (nowEpochMillis >= row.effectiveExpiryEpochMillis) {
    return RowReason.OFFER_EXPIRED;
  }
  return null;
}

/**
 * Total order over candidates for the same productId.
 * Lowest unrounded cost wins; ties break on higher quality, then newer
 * observation, then lexicographically smaller provider id.
 *
 * @param {Candidate} a
 * @param {Candidate} b
 * @returns {number} negative when a ranks better than b
 */
export function compareCandidates(a, b) {
  const byCost = a.pricing.costPer1000ValidEvents.compare(b.pricing.costPer1000ValidEvents);
  if (byCost !== 0) return byCost;

  const byQuality = b.row.qualityRatio.compare(a.row.qualityRatio); // higher wins
  if (byQuality !== 0) return byQuality;

  if (a.row.observedAtEpochMillis !== b.row.observedAtEpochMillis) {
    return b.row.observedAtEpochMillis - a.row.observedAtEpochMillis; // newer wins
  }

  if (a.providerId < b.providerId) return -1;
  if (a.providerId > b.providerId) return 1;
  return 0;
}

/**
 * Picks the single best candidate per productId, sorted by productId ascending.
 * @param {Candidate[]} candidates
 * @returns {Candidate[]}
 */
export function selectBestPerProduct(candidates) {
  /** @type {Map<string, Candidate>} */
  const best = new Map();
  for (const candidate of candidates) {
    const incumbent = best.get(candidate.row.productId);
    if (!incumbent || compareCandidates(candidate, incumbent) < 0) {
      best.set(candidate.row.productId, candidate);
    }
  }
  return [...best.values()].sort((a, b) =>
    a.row.productId < b.row.productId ? -1 : a.row.productId > b.row.productId ? 1 : 0,
  );
}

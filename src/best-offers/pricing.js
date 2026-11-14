/**
 * Quality-normalised pricing.
 *
 * The whole point of the service: a nominal bundle price is misleading because
 * providers supply different event counts and different verified-quality
 * proportions. Everything below is exact rational arithmetic; the only
 * rounding happens in the serialiser.
 */

import { Rational } from './rational.js';

const ONE_HUNDRED = Rational.fromInteger(100);
const ONE_THOUSAND = Rational.fromInteger(1000);

/**
 * @typedef {object} NormalisedPricing
 * @property {Rational} providerBaseAmount      provider cost converted to base currency
 * @property {Rational} customerBundleAmount    provider cost plus markup
 * @property {Rational} costPer1000ValidEvents  the comparison key
 * @property {number} marginBasisPoints         the markup actually applied
 */

/**
 * @param {object} input
 * @param {number} input.priceMinor
 * @param {string} input.currency
 * @param {number} input.validEventCount
 * @param {import('./config.js').PricingSnapshot} snapshot
 * @returns {NormalisedPricing}
 */
export function normalisePricing({ priceMinor, currency, validEventCount }, snapshot) {
  const fxRate = snapshot.fxRatesToBase.get(currency);
  if (!fxRate) {
    // Unreachable through the public path: validation rejects unknown currencies
    // first. Kept as a guard so a future caller cannot silently mis-price.
    throw new Error(`No configured FX rate for currency ${currency}`);
  }
  if (!Number.isInteger(validEventCount) || validEventCount <= 0) {
    throw new RangeError('validEventCount must be a positive integer');
  }

  // providerEUR = (priceMinor / 100) * FX[currency]
  const providerBaseAmount = new Rational(BigInt(priceMinor)).div(ONE_HUNDRED).mul(fxRate);

  // customerBundleEUR = providerEUR * (1 + marginBasisPoints / 10000)
  // Markup on converted provider cost, not gross margin.
  const customerBundleAmount = providerBaseAmount.mul(snapshot.defaultMarginMultiplier);

  // costPer1000ValidEventsEUR = customerBundleEUR * 1000 / validEventCount
  const costPer1000ValidEvents = customerBundleAmount
    .mul(ONE_THOUSAND)
    .div(Rational.fromInteger(validEventCount));

  return {
    providerBaseAmount,
    customerBundleAmount,
    costPer1000ValidEvents,
    marginBasisPoints: snapshot.defaultMarginBasisPoints,
  };
}

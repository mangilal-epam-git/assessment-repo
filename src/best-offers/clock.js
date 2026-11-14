/**
 * Injectable clock.
 *
 * Deterministic evaluation is a hard requirement: offer eligibility depends on
 * "now", so tests and the fixture demo pin the instant while production reads
 * the system clock.
 */

import { parseRfc3339Utc } from './time.js';

/** @typedef {{ now: () => number }} Clock  epoch milliseconds */

/** @returns {Clock} */
export function systemClock() {
  return { now: () => Date.now() };
}

/**
 * @param {string} rfc3339Utc
 * @returns {Clock}
 */
export function fixedClock(rfc3339Utc) {
  const instant = parseRfc3339Utc(rfc3339Utc);
  if (instant === null) {
    throw new Error('fixed clock value must be an RFC 3339 UTC timestamp');
  }
  return { now: () => instant };
}

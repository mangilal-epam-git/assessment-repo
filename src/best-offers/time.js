/**
 * Strict RFC 3339 UTC timestamp handling.
 *
 * The provider contract says "RFC 3339 UTC": a zero offset ("Z", "+00:00" or
 * "-00:00") is required. Non-UTC offsets are rejected rather than silently
 * converted. Precision is milliseconds; finer fractions are truncated.
 */

const RFC3339_UTC =
  /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(?:[Zz]|[+-]00:00)$/;

/**
 * @param {unknown} value
 * @returns {number|null} epoch milliseconds, or null when not a valid RFC 3339 UTC timestamp
 */
export function parseRfc3339Utc(value) {
  if (typeof value !== 'string') return null;
  const match = RFC3339_UTC.exec(value);
  if (!match) return null;
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  const millis = match[7] ? Number(match[7].padEnd(3, '0').slice(0, 3)) : 0;
  // RFC 3339 permits :60 for a leap second. Date.UTC normalises it to the
  // following minute boundary, which is the conventional POSIX treatment and
  // keeps a conformant provider's row from being rejected outright.
  if (hour > 23 || minute > 59 || second > 60) return null;
  const leapSecond = second === 60;
  const epoch = Date.UTC(year, month - 1, day, hour, minute, second, millis);
  const check = new Date(leapSecond ? epoch - 1000 : epoch);
  // Date.UTC silently rolls over impossible dates (e.g. 30 February), and
  // accepts two-digit years as 19xx, so the components are checked back.
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return null;
  }
  return epoch;
}

/**
 * @param {number} epochMillis
 * @returns {string} e.g. 2026-06-15T10:05:00Z (milliseconds only when non-zero)
 */
export function formatRfc3339Utc(epochMillis) {
  const iso = new Date(epochMillis).toISOString();
  return iso.endsWith('.000Z') ? `${iso.slice(0, -5)}Z` : iso;
}

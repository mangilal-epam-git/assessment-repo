/**
 * Exact rational arithmetic on BigInt.
 *
 * Monetary comparison must never use binary floating point. Every amount in
 * the ranking pipeline is a normalised fraction (numerator / denominator,
 * denominator > 0, gcd = 1). Rounding happens exactly once, at serialisation.
 */

const DECIMAL_PATTERN = /^\d{1,30}(\.\d{1,18})?$/;

function gcd(a, b) {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) {
    [x, y] = [y, x % y];
  }
  return x;
}

export class Rational {
  /**
   * @param {bigint} numerator
   * @param {bigint} denominator
   */
  constructor(numerator, denominator = 1n) {
    if (denominator === 0n) {
      throw new RangeError('Rational denominator must not be zero');
    }
    const sign = denominator < 0n ? -1n : 1n;
    const divisor = gcd(numerator, denominator) || 1n;
    this.n = (sign * numerator) / divisor;
    this.d = (sign * denominator) / divisor;
    Object.freeze(this);
  }

  /** @param {number|bigint} value safe integer or bigint */
  static fromInteger(value) {
    if (typeof value === 'number' && !Number.isSafeInteger(value)) {
      throw new RangeError('Rational.fromInteger requires a safe integer');
    }
    return new Rational(BigInt(value));
  }

  /**
   * Parses a non-negative plain decimal string ("0.92", "1", "1.180") exactly.
   * @param {string} text
   */
  static fromDecimalString(text) {
    if (typeof text !== 'string' || !DECIMAL_PATTERN.test(text)) {
      throw new RangeError('Not a plain non-negative decimal string');
    }
    const [whole, fraction = ''] = text.split('.');
    return new Rational(BigInt(whole + fraction), 10n ** BigInt(fraction.length));
  }

  /** @param {Rational} other */
  mul(other) {
    return new Rational(this.n * other.n, this.d * other.d);
  }

  /** @param {Rational} other */
  div(other) {
    return new Rational(this.n * other.d, this.d * other.n);
  }

  /** @param {Rational} other */
  add(other) {
    return new Rational(this.n * other.d + other.n * this.d, this.d * other.d);
  }

  /**
   * @param {Rational} other
   * @returns {-1|0|1}
   */
  compare(other) {
    const left = this.n * other.d;
    const right = other.n * this.d;
    if (left < right) return -1;
    if (left > right) return 1;
    return 0;
  }

  /**
   * Round-half-up to a fixed number of decimal places and render as a string.
   * Only non-negative values are supported: no negative money exists in this
   * domain, and refusing them avoids ambiguity about "half up" below zero.
   * @param {number} places
   */
  toFixedHalfUp(places) {
    if (!Number.isInteger(places) || places < 0 || places > 30) {
      throw new RangeError('places must be an integer between 0 and 30');
    }
    if (this.n < 0n) {
      throw new RangeError('toFixedHalfUp supports non-negative values only');
    }
    const scale = 10n ** BigInt(places);
    const scaled = (2n * this.n * scale + this.d) / (2n * this.d);
    const digits = scaled.toString().padStart(places + 1, '0');
    if (places === 0) return digits;
    return `${digits.slice(0, -places)}.${digits.slice(-places)}`;
  }
}

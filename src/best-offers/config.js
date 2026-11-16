/**
 * Validated pricing configuration snapshots.
 *
 * Contract requirements implemented here:
 *   - a request reads ONE immutable snapshot and uses it end to end, so FX and
 *     margin cannot change halfway through a comparison;
 *   - FX rates and default markup can be reloaded at runtime without restart;
 *   - a malformed reload preserves the last valid snapshot;
 *   - every response reports the snapshot versions actually used.
 */

import { readFile } from 'node:fs/promises';
import { Rational } from './rational.js';
import { BACKOFF_STRATEGIES, DEFAULT_STRATEGY, DEFAULT_RETRY_POLICY } from './retry.js';

const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const MAX_MARGIN_BASIS_POINTS = 1_000_000; // 10 000% - a sanity bound, not a business rule

export class ConfigValidationError extends Error {
  /** @param {string[]} problems */
  constructor(problems) {
    super(`Invalid pricing configuration: ${problems.join('; ')}`);
    this.name = 'ConfigValidationError';
    this.problems = problems;
  }
}

/**
 * @typedef {object} PricingSnapshot
 * @property {string} fxVersion
 * @property {string} marginVersion
 * @property {string} baseCurrency
 * @property {ReadonlyMap<string, Rational>} fxRatesToBase
 * @property {number} defaultMarginBasisPoints
 * @property {Rational} minimumQualityRatio
 * @property {Rational} defaultMarginMultiplier  1 + bps/10000, precomputed
 * @property {number} loadedAtEpochMillis
 */

/**
 * Pure validation + freezing of a raw configuration document.
 * @param {unknown} raw
 * @param {number} loadedAtEpochMillis
 * @returns {PricingSnapshot}
 */
export function buildSnapshot(raw, loadedAtEpochMillis = Date.now()) {
  /** @type {string[]} */
  const problems = [];

  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ConfigValidationError(['configuration must be a JSON object']);
  }
  const doc = /** @type {Record<string, unknown>} */ (raw);

  const allowed = new Set([
    'fxVersion',
    'marginVersion',
    'baseCurrency',
    'fxRatesToBase',
    'defaultMarginBasisPoints',
    'minimumQualityRatio',
    // Resilience is optional: an older configuration without it keeps the
    // built-in defaults, so adding this section is not a breaking change.
    'resilienceVersion',
    'resilience',
  ]);
  for (const key of Object.keys(doc)) {
    if (!allowed.has(key)) problems.push(`unknown configuration field "${key}"`);
  }

  const nonEmptyString = (key) => {
    const value = doc[key];
    if (typeof value !== 'string' || value.trim() === '') {
      problems.push(`"${key}" must be a non-empty string`);
      return '';
    }
    return value;
  };

  const fxVersion = nonEmptyString('fxVersion');
  const marginVersion = nonEmptyString('marginVersion');

  const baseCurrency = doc.baseCurrency === undefined ? 'EUR' : doc.baseCurrency;
  if (typeof baseCurrency !== 'string' || !CURRENCY_PATTERN.test(baseCurrency)) {
    problems.push('"baseCurrency" must be a three-letter uppercase code');
  }

  /** @type {Map<string, Rational>} */
  const fxRatesToBase = new Map();
  const rawRates = doc.fxRatesToBase;
  if (rawRates === null || typeof rawRates !== 'object' || Array.isArray(rawRates)) {
    problems.push('"fxRatesToBase" must be an object of currency -> decimal string');
  } else {
    for (const [currency, rate] of Object.entries(rawRates)) {
      if (!CURRENCY_PATTERN.test(currency)) {
        problems.push(`FX currency "${currency}" must be a three-letter uppercase code`);
        continue;
      }
      // Decimal strings only: a JSON number would re-introduce binary floating point.
      if (typeof rate !== 'string') {
        problems.push(`FX rate for "${currency}" must be a decimal string, e.g. "0.92"`);
        continue;
      }
      let parsed;
      try {
        parsed = Rational.fromDecimalString(rate);
      } catch {
        problems.push(`FX rate for "${currency}" is not a plain non-negative decimal`);
        continue;
      }
      if (parsed.n === 0n) {
        problems.push(`FX rate for "${currency}" must be greater than zero`);
        continue;
      }
      fxRatesToBase.set(currency, parsed);
    }
    if (typeof baseCurrency === 'string' && CURRENCY_PATTERN.test(baseCurrency)) {
      const baseRate = fxRatesToBase.get(baseCurrency);
      if (!baseRate) {
        problems.push(`"fxRatesToBase" must contain the base currency "${baseCurrency}"`);
      } else if (baseRate.compare(Rational.fromInteger(1)) !== 0) {
        problems.push(`FX rate for base currency "${baseCurrency}" must be exactly 1`);
      }
    }
  }

  const bps = doc.defaultMarginBasisPoints;
  if (!Number.isSafeInteger(bps) || /** @type {number} */ (bps) < 0 || bps > MAX_MARGIN_BASIS_POINTS) {
    problems.push(
      `"defaultMarginBasisPoints" must be an integer between 0 and ${MAX_MARGIN_BASIS_POINTS}`,
    );
  }

  let minimumQualityRatio = Rational.fromInteger(0);
  const rawMinQuality = doc.minimumQualityRatio;
  if (typeof rawMinQuality !== 'string') {
    problems.push('"minimumQualityRatio" must be a decimal string, e.g. "0.90"');
  } else {
    try {
      minimumQualityRatio = Rational.fromDecimalString(rawMinQuality);
    } catch {
      problems.push('"minimumQualityRatio" is not a plain non-negative decimal');
    }
    if (minimumQualityRatio.compare(Rational.fromInteger(1)) > 0) {
      problems.push('"minimumQualityRatio" must not exceed 1');
    }
  }

  const resilience = buildResilience(doc, problems);

  if (problems.length > 0) throw new ConfigValidationError(problems);

  // Object.freeze does not freeze a Map's contents, and the whole point of a
  // snapshot is that nothing can reprice mid-request. Mutators are replaced
  // so an accidental write fails loudly instead of silently changing a price.
  freezeMap(fxRatesToBase);

  const marginBasisPoints = /** @type {number} */ (bps);
  const snapshot = {
    fxVersion,
    marginVersion,
    baseCurrency: /** @type {string} */ (baseCurrency),
    fxRatesToBase: fxRatesToBase,
    defaultMarginBasisPoints: marginBasisPoints,
    minimumQualityRatio,
    defaultMarginMultiplier: Rational.fromInteger(1).add(
      new Rational(BigInt(marginBasisPoints), 10_000n),
    ),
    resilienceVersion: typeof doc.resilienceVersion === 'string' ? doc.resilienceVersion : 'built-in',
    resilience,
    loadedAtEpochMillis,
  };
  return Object.freeze(snapshot);
}

/**
 * Validates the optional resilience section.
 *
 * Retry timing is configuration rather than code so that a provider changing
 * its behaviour is answered by a reviewed configuration change with an audit
 * trail, not a deployment. Per-provider overrides inherit from `default`, so
 * tuning one slow provider does not mean restating the whole policy.
 *
 * @param {Record<string, unknown>} doc
 * @param {string[]} problems  appended to in place
 * @returns {{ default: object, providers: Readonly<Record<string, object>> }}
 */
function buildResilience(doc, problems) {
  const builtIn = {
    strategy: DEFAULT_STRATEGY,
    maxAttempts: DEFAULT_RETRY_POLICY.maxAttempts,
    initialDelayMillis: DEFAULT_RETRY_POLICY.initialDelayMillis,
    maxDelayMillis: DEFAULT_RETRY_POLICY.maxDelayMillis,
    backoffMultiplier: DEFAULT_RETRY_POLICY.backoffMultiplier,
    totalBudgetMillis: DEFAULT_RETRY_POLICY.totalBudgetMillis,
    perAttemptTimeoutMillis: 2000,
  };

  const raw = doc.resilience;
  if (raw === undefined) {
    return Object.freeze({ default: Object.freeze({ ...builtIn }), providers: Object.freeze({}) });
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    problems.push('"resilience" must be an object');
    return Object.freeze({ default: Object.freeze({ ...builtIn }), providers: Object.freeze({}) });
  }

  for (const key of Object.keys(raw)) {
    if (key !== 'default' && key !== 'providers') {
      problems.push(`unknown resilience field "${key}"`);
    }
  }

  const bounds = {
    maxAttempts: [1, 10],
    initialDelayMillis: [0, 60_000],
    maxDelayMillis: [0, 120_000],
    backoffMultiplier: [1, 10],
    totalBudgetMillis: [1, 300_000],
    perAttemptTimeoutMillis: [50, 120_000],
  };

  /** @param {unknown} value @param {string} where @param {object} inherited */
  const policy = (value, where, inherited) => {
    if (value === undefined) return { ...inherited };
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      problems.push(`"${where}" must be an object`);
      return { ...inherited };
    }
    const entry = /** @type {Record<string, unknown>} */ (value);
    const resolved = { ...inherited };

    for (const key of Object.keys(entry)) {
      if (key !== 'strategy' && !Object.hasOwn(bounds, key)) {
        problems.push(`unknown resilience setting "${where}.${key}"`);
      }
    }

    if (entry.strategy !== undefined) {
      if (typeof entry.strategy !== 'string' || !Object.hasOwn(BACKOFF_STRATEGIES, entry.strategy)) {
        problems.push(
          `"${where}.strategy" must be one of: ${Object.keys(BACKOFF_STRATEGIES).join(', ')}`,
        );
      } else {
        resolved.strategy = entry.strategy;
      }
    }

    for (const [key, [min, max]] of Object.entries(bounds)) {
      if (entry[key] === undefined) continue;
      const number = entry[key];
      if (typeof number !== 'number' || !Number.isFinite(number) || number < min || number > max) {
        problems.push(`"${where}.${key}" must be a number between ${min} and ${max}`);
        continue;
      }
      resolved[key] = number;
    }

    if (resolved.maxDelayMillis < resolved.initialDelayMillis) {
      problems.push(`"${where}.maxDelayMillis" must not be below initialDelayMillis`);
    }
    return resolved;
  };

  const defaults = policy(raw.default, 'resilience.default', builtIn);

  /** @type {Record<string, object>} */
  const providers = {};
  if (raw.providers !== undefined) {
    if (raw.providers === null || typeof raw.providers !== 'object' || Array.isArray(raw.providers)) {
      problems.push('"resilience.providers" must be an object of providerId -> settings');
    } else {
      for (const [providerId, override] of Object.entries(raw.providers)) {
        // Overrides inherit from default, so a one-line override is enough.
        providers[providerId] = Object.freeze(
          policy(override, `resilience.providers.${providerId}`, defaults),
        );
      }
    }
  }

  return Object.freeze({ default: Object.freeze(defaults), providers: Object.freeze(providers) });
}

/**
 * The effective policy for one provider: its override if it has one, the
 * configured default otherwise.
 *
 * @param {object} snapshot
 * @param {string} providerId
 */
export function resolveRetryPolicy(snapshot, providerId) {
  const resilience = snapshot.resilience ?? { default: DEFAULT_RETRY_POLICY, providers: {} };
  return resilience.providers[providerId] ?? resilience.default;
}

/**
 * Disables the mutating methods of a Map so a snapshot is immutable in fact,
 * not merely by convention.
 * @template K, V
 * @param {Map<K, V>} map
 * @returns {ReadonlyMap<K, V>}
 */
function freezeMap(map) {
  const refuse = (operation) => () => {
    throw new TypeError(`Cannot ${operation} a frozen configuration snapshot`);
  };
  Object.defineProperties(map, {
    set: { value: refuse('set on'), configurable: false },
    delete: { value: refuse('delete from'), configurable: false },
    clear: { value: refuse('clear'), configurable: false },
  });
  return map;
}

/**
 * Holds the active snapshot and swaps it atomically on a successful reload.
 */
export class ConfigStore {
  /**
   * @param {PricingSnapshot} initial
   * @param {{ path?: string, logger?: { info: Function, warn: Function } }} [options]
   */
  constructor(initial, options = {}) {
    this.#snapshot = initial;
    this.path = options.path;
    this.logger = options.logger;
    this.reloadCount = 0;
    this.failedReloadCount = 0;
  }

  /** @type {PricingSnapshot} */
  #snapshot;

  /**
   * Returns the snapshot to use for a whole request. Callers must capture it
   * once and never re-read it mid-request.
   * @returns {PricingSnapshot}
   */
  current() {
    return this.#snapshot;
  }

  /**
   * Replaces the snapshot only if the new document is valid.
   * @param {unknown} raw
   * @param {number} [loadedAtEpochMillis]
   * @returns {PricingSnapshot} the newly active snapshot
   * @throws {ConfigValidationError} when the document is rejected; the previous
   *   snapshot stays active.
   */
  replace(raw, loadedAtEpochMillis = Date.now()) {
    let candidate;
    try {
      candidate = buildSnapshot(raw, loadedAtEpochMillis);
    } catch (error) {
      this.failedReloadCount += 1;
      this.logger?.warn('config.reload.rejected', {
        problems: error instanceof ConfigValidationError ? error.problems : [String(error)],
        activeFxVersion: this.#snapshot.fxVersion,
        activeMarginVersion: this.#snapshot.marginVersion,
      });
      throw error;
    }
    this.#snapshot = candidate;
    this.reloadCount += 1;
    this.logger?.info('config.reload.applied', {
      fxVersion: candidate.fxVersion,
      marginVersion: candidate.marginVersion,
      defaultMarginBasisPoints: candidate.defaultMarginBasisPoints,
    });
    return candidate;
  }

  /**
   * Reloads from the configured file path.
   * @returns {Promise<PricingSnapshot>}
   */
  async reloadFromDisk() {
    if (!this.path) throw new Error('ConfigStore has no file path to reload from');
    // Reloads are serialised. Three triggers exist (file watch, SIGHUP and the
    // admin endpoint); without this, two concurrent reads could complete out
    // of order and leave an older document as the active snapshot.
    const run = this.#reloadChain.then(
      () => this.#reloadFromDiskOnce(),
      () => this.#reloadFromDiskOnce(),
    );
    this.#reloadChain = run.catch(() => {});
    return run;
  }

  /** @type {Promise<unknown>} */
  #reloadChain = Promise.resolve();

  async #reloadFromDiskOnce() {
    let raw;
    try {
      raw = await readConfigDocument(this.path);
    } catch (error) {
      // An unreadable or unparseable file is just as much a failed reload as a
      // semantically invalid one, and must be counted and logged the same way.
      this.failedReloadCount += 1;
      this.logger?.warn('config.reload.unreadable', {
        path: this.path,
        detail: /** @type {Error} */ (error).message,
        activeFxVersion: this.#snapshot.fxVersion,
      });
      throw error;
    }
    return this.replace(raw);
  }
}

/**
 * @param {string} path
 * @returns {Promise<unknown>}
 */
export async function readConfigDocument(path) {
  const text = await readFile(path, 'utf8');
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new ConfigValidationError([`file is not valid JSON (${/** @type {Error} */ (error).message})`]);
  }
}

/**
 * @param {string} path
 * @param {{ logger?: { info: Function, warn: Function } }} [options]
 * @returns {Promise<ConfigStore>}
 */
export async function loadConfigStore(path, options = {}) {
  const raw = await readConfigDocument(path);
  return new ConfigStore(buildSnapshot(raw), { path, logger: options.logger });
}

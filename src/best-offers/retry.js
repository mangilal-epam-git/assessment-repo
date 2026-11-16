/**
 * Retry policy: bounded attempts, a choice of backoff strategy, an overall
 * deadline, and prompt cancellation.
 *
 * Rationale (see ADR-0006):
 *   - Only idempotent GETs are retried, so duplicate attempts are safe.
 *   - Full jitter is the default rather than fixed backoff, to avoid
 *     synchronised retry storms across replicas when a provider degrades -
 *     the same failure mode that amplified the sister product's DDoS
 *     incident.
 *   - A total deadline bounds tail latency: the caller's own timeout must
 *     never be the thing that stops us.
 *
 * Every timing value is configuration, not code. Strategies are named and
 * selected by string so the shape of the curve can change without a
 * deployment, and the whole policy is versioned and hot-reloadable alongside
 * the pricing snapshot (ADR-0007). When a provider's behaviour changes, the
 * response to it is a configuration change with an audit trail.
 */

/**
 * @typedef {object} RetryPolicy
 * @property {number} maxAttempts         total attempts including the first
 * @property {number} initialDelayMillis
 * @property {number} maxDelayMillis
 * @property {number} backoffMultiplier
 * @property {number} totalBudgetMillis   wall-clock budget across all attempts
 * @property {string} [strategy]          a key of BACKOFF_STRATEGIES
 * @property {() => number} [random]      injectable for deterministic tests
 */

/**
 * Named backoff strategies.
 *
 * Each returns the delay in milliseconds before `attempt` (1-based; attempt 1
 * never waits). Adding a strategy is adding an entry here and permitting its
 * name in the configuration validator - no call site changes.
 *
 * @type {Readonly<Record<string, (attempt: number, policy: RetryPolicy, previousDelay: number) => number>>}
 */
export const BACKOFF_STRATEGIES = Object.freeze({
  /**
   * Exponential with full jitter: uniform in [0, cappedDelay]. The default,
   * because it decorrelates retries across replicas better than the
   * alternatives and so is the least likely to re-converge on a struggling
   * provider.
   */
  'exponential-full-jitter': (attempt, policy) => {
    const capped = cappedExponential(attempt, policy);
    return Math.floor((policy.random ?? Math.random)() * capped);
  },

  /**
   * Exponential with equal jitter: half the capped delay plus a uniform draw
   * over the other half. Spreads retries while guaranteeing a minimum wait,
   * which suits a provider that needs a moment regardless.
   */
  'exponential-equal-jitter': (attempt, policy) => {
    const capped = cappedExponential(attempt, policy);
    const half = capped / 2;
    return Math.floor(half + (policy.random ?? Math.random)() * half);
  },

  /** Exponential with no jitter. Predictable, and prone to synchronised retries. */
  exponential: (attempt, policy) => Math.floor(cappedExponential(attempt, policy)),

  /**
   * Decorrelated jitter: a uniform draw between the base delay and three
   * times the previous delay, capped. Recovers faster than full jitter when
   * a provider is briefly rather than deeply unwell.
   */
  'decorrelated-jitter': (attempt, policy, previousDelay) => {
    const base = policy.initialDelayMillis;
    const upper = Math.min(policy.maxDelayMillis, Math.max(base, previousDelay * 3));
    return Math.floor(base + (policy.random ?? Math.random)() * Math.max(0, upper - base));
  },

  /** A constant wait. Rarely right across replicas, occasionally right for one. */
  fixed: (_attempt, policy) => Math.floor(Math.min(policy.initialDelayMillis, policy.maxDelayMillis)),

  /** initialDelay x attempt number, capped. Gentler growth than exponential. */
  linear: (attempt, policy) =>
    Math.floor(Math.min(policy.initialDelayMillis * (attempt - 1), policy.maxDelayMillis)),
});

/** The strategy used when configuration does not name one. */
export const DEFAULT_STRATEGY = 'exponential-full-jitter';

/** @param {number} attempt @param {RetryPolicy} policy */
function cappedExponential(attempt, policy) {
  const exponential = policy.initialDelayMillis * policy.backoffMultiplier ** (attempt - 2);
  return Math.min(exponential, policy.maxDelayMillis);
}

/** @type {RetryPolicy} */
export const DEFAULT_RETRY_POLICY = Object.freeze({
  maxAttempts: 3,
  initialDelayMillis: 100,
  maxDelayMillis: 2000,
  backoffMultiplier: 2,
  totalBudgetMillis: 5000,
  strategy: DEFAULT_STRATEGY,
  random: Math.random,
});

/** Raised when a retryable attempt fails; carries a stable cause code. */
export class RetryableError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {{ retryable?: boolean, cause?: unknown, retryAfterMillis?: number }} [options]
   */
  constructor(code, message, options = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'RetryableError';
    this.code = code;
    this.retryable = options.retryable ?? true;
    this.retryAfterMillis = options.retryAfterMillis;
  }
}

/**
 * Computes the delay before attempt number `attempt` (1-based; attempt 1 has
 * no delay), using the policy's named strategy.
 *
 * An unknown strategy name falls back to the default rather than throwing:
 * a configuration typo should degrade the curve, not stop the marketplace.
 * The configuration validator rejects unknown names at load time, so this
 * path is only reachable by a caller constructing a policy by hand.
 *
 * @param {number} attempt
 * @param {RetryPolicy} policy
 * @param {number} [previousDelay] used by decorrelated jitter
 * @returns {number} milliseconds
 */
export function computeBackoffMillis(attempt, policy, previousDelay = 0) {
  if (attempt <= 1) return 0;
  const strategy =
    BACKOFF_STRATEGIES[policy.strategy ?? DEFAULT_STRATEGY] ?? BACKOFF_STRATEGIES[DEFAULT_STRATEGY];
  const delay = strategy(attempt, policy, previousDelay);
  return Math.max(0, Math.min(delay, policy.maxDelayMillis));
}

/**
 * Promise-based sleep that rejects promptly when the signal aborts.
 * @param {number} millis
 * @param {AbortSignal} [signal]
 */
export function sleep(millis, signal) {
  if (millis <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error('aborted'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve(undefined);
    }, millis);
    // The timer is deliberately NOT unref'd: an unref'd backoff lets the event
    // loop drain while a retry is still pending, leaving the caller's promise
    // forever unsettled. Shutdown cancels through the abort signal instead.
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error('aborted'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Runs `operation` under the retry policy.
 *
 * @template T
 * @param {(context: { attempt: number }) => Promise<T>} operation
 * @param {object} options
 * @param {RetryPolicy} options.policy
 * @param {AbortSignal} [options.signal]
 * @param {(event: { attempt: number, delayMillis: number, code: string, message: string }) => void} [options.onRetry]
 * @param {() => number} [options.monotonicNow]
 * @returns {Promise<T>}
 */
export async function withRetry(operation, { policy, signal, onRetry, monotonicNow }) {
  const now = monotonicNow ?? (() => Date.now());
  const startedAt = now();
  let lastError;
  // Carried between attempts so decorrelated jitter can grow from it.
  let previousDelay = policy.initialDelayMillis;

  if (policy.maxAttempts < 1) throw new RangeError('maxAttempts must be at least 1');

  for (let attempt = 1; attempt <= policy.maxAttempts; attempt += 1) {
    if (signal?.aborted) throw signal.reason ?? new Error('aborted');
    // The budget is a wall-clock deadline across the whole operation, so time
    // spent inside an attempt counts against it, not just time spent sleeping.
    // Attempt 1 always runs: a budget shorter than one attempt should still
    // produce a real result or a real error, never a silent no-op.
    if (attempt > 1 && now() - startedAt >= policy.totalBudgetMillis) break;
    try {
      return await operation({ attempt });
    } catch (error) {
      lastError = error;
      const retryable = error instanceof RetryableError ? error.retryable : false;
      if (!retryable || attempt === policy.maxAttempts) break;

      // A provider's own Retry-After is better information than our backoff
      // curve, so it is honoured as given (already capped at 60s by the
      // parser) rather than clamped to maxDelayMillis. The total budget below
      // still bounds how long we are willing to wait overall.
      const suggested = error instanceof RetryableError ? error.retryAfterMillis : undefined;
      const computed = computeBackoffMillis(attempt + 1, policy, previousDelay);
      previousDelay = computed;
      const delayMillis = suggested ?? computed;

      const elapsed = now() - startedAt;
      if (elapsed + delayMillis >= policy.totalBudgetMillis) break;


      onRetry?.({
        attempt,
        delayMillis,
        code: /** @type {RetryableError} */ (error).code,
        message: /** @type {Error} */ (error).message,
      });
      await sleep(delayMillis, signal);
    }
  }
  // Reachable only when every attempt failed, so lastError is always set.
  throw lastError ?? new Error('retry completed without a result');
}

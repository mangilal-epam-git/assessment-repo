/**
 * Retry policy: bounded attempts, exponential backoff with full jitter,
 * an overall deadline, and prompt cancellation.
 *
 * Rationale (see ADR-0006):
 *   - Only idempotent GETs are retried, so duplicate attempts are safe.
 *   - Full jitter rather than fixed backoff, to avoid synchronised retry
 *     storms across replicas when a provider degrades - the same failure mode
 *     that amplified the sister product's DDoS incident.
 *   - A total deadline bounds tail latency: the caller's own timeout must
 *     never be the thing that stops us.
 */

/**
 * @typedef {object} RetryPolicy
 * @property {number} maxAttempts         total attempts including the first
 * @property {number} initialDelayMillis
 * @property {number} maxDelayMillis
 * @property {number} backoffMultiplier
 * @property {number} totalBudgetMillis   wall-clock budget across all attempts
 * @property {() => number} [random]      injectable for deterministic tests
 */

/** @type {RetryPolicy} */
export const DEFAULT_RETRY_POLICY = Object.freeze({
  maxAttempts: 3,
  initialDelayMillis: 100,
  maxDelayMillis: 2000,
  backoffMultiplier: 2,
  totalBudgetMillis: 5000,
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
 * no delay). Full jitter: a uniform draw from [0, cappedExponentialDelay].
 *
 * @param {number} attempt
 * @param {RetryPolicy} policy
 * @returns {number} milliseconds
 */
export function computeBackoffMillis(attempt, policy) {
  if (attempt <= 1) return 0;
  const exponential = policy.initialDelayMillis * policy.backoffMultiplier ** (attempt - 2);
  const capped = Math.min(exponential, policy.maxDelayMillis);
  const random = policy.random ?? Math.random;
  return Math.floor(random() * capped);
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
      const delayMillis =
        suggested ?? Math.min(computeBackoffMillis(attempt + 1, policy), policy.maxDelayMillis);

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

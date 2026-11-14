/**
 * HTTP client for configured provider endpoints.
 *
 * Provider identity comes from configuration, never from a field in the
 * payload: a provider must not be able to claim to be someone else.
 *
 * Guarantees:
 *   - per-attempt timeout and an overall retry budget;
 *   - response size cap (a hostile or broken provider cannot exhaust memory);
 *   - no caching: the brief forbids substituting stale cached offers;
 *   - cancellation propagates, so shutdown and client disconnects are prompt.
 */

import { RetryableError, withRetry, DEFAULT_RETRY_POLICY } from './retry.js';
import { ProviderFailure } from './reason-codes.js';

export const DEFAULT_MAX_BODY_BYTES = 8 * 1024 * 1024;

/**
 * @typedef {object} ProviderResult
 * @property {string} providerId
 * @property {boolean} ok
 * @property {unknown[]} [rows]      present when ok
 * @property {string} [failureCode]  present when not ok
 * @property {string} [failureDetail]
 * @property {number} attempts
 * @property {number} durationMillis
 */

/**
 * @param {Response} response
 * @param {number} maxBodyBytes
 * @returns {Promise<string>}
 */
async function readBoundedText(response, maxBodyBytes) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBodyBytes) {
    // The body must be cancelled explicitly, or the socket stays open and a
    // provider that merely advertises a huge content-length exhausts the
    // connection pool - the opposite of what this cap is for.
    await response.body?.cancel().catch(() => {});
    throw new RetryableError(ProviderFailure.BODY_TOO_LARGE, 'Declared body exceeds limit', {
      retryable: false,
    });
  }
  if (!response.body) return '';
  const decoder = new TextDecoder('utf-8');
  let received = 0;
  let text = '';
  for await (const chunk of /** @type {AsyncIterable<Uint8Array>} */ (response.body)) {
    received += chunk.byteLength;
    if (received > maxBodyBytes) {
      throw new RetryableError(ProviderFailure.BODY_TOO_LARGE, 'Body exceeds limit', {
        retryable: false,
      });
    }
    text += decoder.decode(chunk, { stream: true });
  }
  return text + decoder.decode();
}

/** 408, 425, 429 and 5xx are worth another attempt; other 4xx are not. */
export function isRetryableStatus(status) {
  return status === 408 || status === 425 || status === 429 || (status >= 500 && status <= 599);
}

/**
 * @param {string|null} headerValue
 * @returns {number|undefined} milliseconds
 */
export function parseRetryAfterMillis(headerValue) {
  if (!headerValue) return undefined;
  const seconds = Number(headerValue);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 60_000);
  const date = Date.parse(headerValue);
  if (!Number.isNaN(date)) return Math.max(0, Math.min(date - Date.now(), 60_000));
  return undefined;
}

export class ProviderClient {
  /**
   * @param {object} options
   * @param {string} options.providerId
   * @param {string} options.url
   * @param {number} [options.timeoutMillis]   per attempt
   * @param {import('./retry.js').RetryPolicy} [options.retryPolicy]
   * @param {number} [options.maxBodyBytes]
   * @param {typeof fetch} [options.fetchImpl]
   * @param {import('./logger.js').Logger} [options.logger]
   * @param {ReturnType<import('./metrics.js').createMetrics>} [options.metrics]
   */
  constructor({
    providerId,
    url,
    timeoutMillis = 2000,
    retryPolicy = DEFAULT_RETRY_POLICY,
    maxBodyBytes = DEFAULT_MAX_BODY_BYTES,
    fetchImpl = globalThis.fetch,
    logger,
    metrics,
  }) {
    this.providerId = providerId;
    this.url = url;
    this.timeoutMillis = timeoutMillis;
    this.retryPolicy = retryPolicy;
    this.maxBodyBytes = maxBodyBytes;
    this.fetchImpl = fetchImpl;
    this.logger = logger;
    this.metrics = metrics;
  }

  /**
   * Fetches and parses the provider response. Never throws for provider-side
   * problems: the orchestrator needs a result object so it can mark the
   * provider unavailable and still serve a partial response.
   *
   * @param {{ signal?: AbortSignal, requestId?: string }} [context]
   * @returns {Promise<ProviderResult>}
   */
  async fetchOffers({ signal, requestId } = {}) {
    const startedAt = Date.now();
    let attempts = 0;

    try {
      const rows = await withRetry(
        async ({ attempt }) => {
          attempts = attempt;
          return this.#attempt(signal);
        },
        {
          policy: this.retryPolicy,
          signal,
          onRetry: ({ attempt, delayMillis, code, message }) => {
            this.metrics?.providerRetries.inc({ provider: this.providerId, cause: code });
            this.logger?.warn('provider.retry', {
              providerId: this.providerId,
              requestId,
              attempt,
              delayMillis,
              cause: code,
              detail: message,
            });
          },
        },
      );

      const durationMillis = Date.now() - startedAt;
      this.metrics?.providerRequests.inc({ provider: this.providerId, outcome: 'ok' });
      this.metrics?.providerDuration.observe(durationMillis / 1000, { provider: this.providerId });
      return { providerId: this.providerId, ok: true, rows, attempts, durationMillis };
    } catch (error) {
      const durationMillis = Date.now() - startedAt;
      const aborted = signal?.aborted === true;
      const failureCode = aborted
        ? ProviderFailure.CANCELLED
        : error instanceof RetryableError
          ? error.code
          : ProviderFailure.NETWORK_ERROR;

      this.metrics?.providerRequests.inc({ provider: this.providerId, outcome: 'failed' });
      this.metrics?.providerUnavailable.inc({ provider: this.providerId, cause: failureCode });
      this.metrics?.providerDuration.observe(durationMillis / 1000, { provider: this.providerId });
      this.logger?.warn('provider.unavailable', {
        providerId: this.providerId,
        requestId,
        attempts,
        durationMillis,
        cause: failureCode,
        detail: /** @type {Error} */ (error)?.message,
      });

      return {
        providerId: this.providerId,
        ok: false,
        failureCode,
        failureDetail: /** @type {Error} */ (error)?.message,
        attempts,
        durationMillis,
      };
    }
  }

  /**
   * One attempt: fetch, bound, parse, and require a top-level array.
   * @param {AbortSignal} [signal]
   * @returns {Promise<unknown[]>}
   */
  async #attempt(signal) {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(new RetryableError(ProviderFailure.TIMEOUT, 'Provider request timed out')),
      this.timeoutMillis,
    );
    const onOuterAbort = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', onOuterAbort, { once: true });

    try {
      let response;
      try {
        response = await this.fetchImpl(this.url, {
          method: 'GET',
          headers: { accept: 'application/json' },
          signal: controller.signal,
          // Explicitly bypass any HTTP cache: stale offers must never be served.
          cache: 'no-store',
          redirect: 'error',
        });
      } catch (error) {
        if (signal?.aborted) throw signal.reason ?? error;
        if (controller.signal.reason instanceof RetryableError) throw controller.signal.reason;
        throw new RetryableError(ProviderFailure.NETWORK_ERROR, 'Provider request failed', {
          cause: error,
        });
      }

      if (!response.ok) {
        throw new RetryableError(
          ProviderFailure.HTTP_STATUS,
          `Provider responded with HTTP ${response.status}`,
          {
            retryable: isRetryableStatus(response.status),
            retryAfterMillis: parseRetryAfterMillis(response.headers.get('retry-after')),
          },
        );
      }

      const text = await readBoundedText(response, this.maxBodyBytes);

      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch (error) {
        // A syntactically broken body will not fix itself on retry.
        throw new RetryableError(ProviderFailure.INVALID_JSON, 'Provider body is not valid JSON', {
          retryable: false,
          cause: error,
        });
      }

      if (!Array.isArray(parsed)) {
        throw new RetryableError(
          ProviderFailure.NOT_AN_ARRAY,
          'Provider body is not a top-level array',
          { retryable: false },
        );
      }
      return parsed;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onOuterAbort);
    }
  }
}

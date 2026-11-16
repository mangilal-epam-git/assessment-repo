/**
 * HTTP client for configured provider endpoints.
 *
 * Provider identity comes from configuration, never from a field in the
 * payload: a provider must not be able to claim to be someone else.
 *
 * A provider may publish several endpoints - regional mirrors, a failover
 * host, a secondary region. Two strategies:
 *
 *   failover  try them in order and take the first that yields a valid
 *             array. Fastest, and the right default when mirrors are
 *             expected to agree.
 *   fan-out   query all of them concurrently and return every usable
 *             response, so the ranking can pick the lowest cost across all
 *             of them. Costs more requests, and is the honest choice when
 *             mirrors may legitimately differ - a stale mirror quoting an
 *             expired price must not win, and a cheaper regional mirror
 *             should not be missed just because another answered first.
 *
 * Each endpoint response is kept separate, because the contract's
 * duplicate-productId rule is scoped to one provider *response*. Merging two
 * mirrors into one body would make a product quoted by both look like a
 * self-contradiction and reject it.
 *
 * Guarantees:
 *   - per-attempt timeout and an overall retry budget, per endpoint;
 *   - response size cap (a hostile or broken provider cannot exhaust memory);
 *   - no caching: the brief forbids substituting stale cached offers;
 *   - cancellation propagates, so shutdown and client disconnects are prompt.
 */

import { RetryableError, withRetry, DEFAULT_RETRY_POLICY } from './retry.js';
import { ProviderFailure } from './reason-codes.js';

export const DEFAULT_MAX_BODY_BYTES = 8 * 1024 * 1024;

/**
 * @typedef {object} EndpointOutcome
 * @property {string} endpoint       masked for logging
 * @property {boolean} ok
 * @property {string} [failureCode]
 * @property {number} attempts
 * @property {number} rowCount
 *
 * @typedef {object} ProviderResult
 * @property {string} providerId
 * @property {boolean} ok
 * @property {{endpoint: string, rows: unknown[]}[]} [responses] one per usable endpoint
 * @property {unknown[]} [rows]      every row, flattened; present when ok
 * @property {string} [failureCode]  present when not ok
 * @property {string} [failureDetail]
 * @property {number} attempts       summed across endpoints
 * @property {number} durationMillis
 * @property {EndpointOutcome[]} [endpoints]
 * @property {boolean} [degraded]    some endpoints failed, but not all
 */

/** @param {object} outcome */
function summariseOutcome(outcome) {
  return {
    endpoint: ProviderClient.describeEndpoint(outcome.endpoint),
    ok: outcome.ok,
    ...(outcome.ok ? { rowCount: outcome.rows.length } : { failureCode: outcome.failureCode }),
    attempts: outcome.attempts,
  };
}

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

/** How a provider's endpoints are used. */
export const EndpointStrategy = Object.freeze({
  /** First endpoint that yields a valid array wins. */
  FAILOVER: 'failover',
  /** Query every endpoint; the ranking picks the best across all of them. */
  FAN_OUT: 'fan-out',
});

export class ProviderClient {
  /**
   * @param {object} options
   * @param {string} options.providerId
   * @param {string} [options.url]              single endpoint, shorthand for endpoints:[url]
   * @param {string[]} [options.endpoints]      one or more endpoints for this provider
   * @param {string} [options.endpointStrategy] failover (default) or fan-out
   * @param {number} [options.timeoutMillis]    per attempt
   * @param {import('./retry.js').RetryPolicy} [options.retryPolicy]
   * @param {number} [options.maxBodyBytes]
   * @param {typeof fetch} [options.fetchImpl]
   * @param {import('./logger.js').Logger} [options.logger]
   * @param {ReturnType<import('./metrics.js').createMetrics>} [options.metrics]
   */
  constructor({
    providerId,
    url,
    endpoints,
    endpointStrategy = EndpointStrategy.FAILOVER,
    timeoutMillis = 2000,
    retryPolicy = DEFAULT_RETRY_POLICY,
    policyResolver,
    maxBodyBytes = DEFAULT_MAX_BODY_BYTES,
    fetchImpl = globalThis.fetch,
    logger,
    metrics,
  }) {
    const resolved = (endpoints ?? (url ? [url] : [])).filter(Boolean);
    if (resolved.length === 0) {
      throw new Error(`Provider "${providerId}" needs at least one endpoint`);
    }
    this.providerId = providerId;
    this.endpoints = resolved;
    /** Retained so existing callers and logs that expect a single URL still work. */
    this.url = resolved[0];
    this.endpointStrategy = endpointStrategy;
    this.timeoutMillis = timeoutMillis;
    this.retryPolicy = retryPolicy;
    // When supplied, consulted on every fetch, so a configuration reload
    // changes retry timing for the very next request with no restart.
    this.policyResolver = policyResolver;
    this.maxBodyBytes = maxBodyBytes;
    this.fetchImpl = fetchImpl;
    this.logger = logger;
    this.metrics = metrics;
  }

  /** Masks credentials in a URL before it reaches a log or a metric label. */
  static describeEndpoint(endpoint) {
    try {
      const parsed = new URL(endpoint);
      return `${parsed.origin}${parsed.pathname}`;
    } catch {
      return 'invalid-url';
    }
  }

  /**
   * Fetches from every configured endpoint according to the strategy.
   *
   * Never throws for provider-side problems: the orchestrator needs a result
   * object so it can mark the provider unavailable and still serve a partial
   * response.
   *
   * @param {{ signal?: AbortSignal, requestId?: string }} [context]
   * @returns {Promise<ProviderResult>}
   */
  async fetchOffers({ signal, requestId } = {}) {
    const startedAt = Date.now();
    const policy = this.policyResolver ? this.policyResolver(this.providerId) : this.retryPolicy;
    const attemptTimeout = policy.perAttemptTimeoutMillis ?? this.timeoutMillis;
    const ctx = { signal, requestId, policy, attemptTimeout };

    const outcomes =
      this.endpointStrategy === EndpointStrategy.FAN_OUT
        ? await Promise.all(
            this.endpoints.map((endpoint) => this.#fetchOne(endpoint, ctx)),
          )
        : await this.#failover(ctx);

    const usable = outcomes.filter((outcome) => outcome.ok);
    const durationMillis = Date.now() - startedAt;

    if (usable.length === 0) {
      const first = outcomes.at(-1);
      return {
        providerId: this.providerId,
        ok: false,
        failureCode: first?.failureCode ?? ProviderFailure.NETWORK_ERROR,
        failureDetail: first?.failureDetail,
        attempts: outcomes.reduce((total, outcome) => total + outcome.attempts, 0),
        durationMillis,
        endpoints: outcomes.map(summariseOutcome),
      };
    }

    return {
      providerId: this.providerId,
      ok: true,
      // One entry per usable endpoint, kept separate so duplicate-productId
      // detection stays scoped to a single response as the contract requires.
      responses: usable.map((outcome) => ({ endpoint: outcome.endpoint, rows: outcome.rows })),
      // Flattened view for callers that only want the rows.
      rows: usable.flatMap((outcome) => outcome.rows),
      attempts: outcomes.reduce((total, outcome) => total + outcome.attempts, 0),
      durationMillis,
      endpoints: outcomes.map(summariseOutcome),
      degraded: usable.length < outcomes.length,
    };
  }

  /** Tries endpoints in order, stopping at the first usable response. */
  async #failover(ctx) {
    const { signal, requestId } = ctx;
    const outcomes = [];
    for (const [index, endpoint] of this.endpoints.entries()) {
      if (signal?.aborted) break;
      const outcome = await this.#fetchOne(endpoint, ctx);
      outcomes.push(outcome);
      if (outcome.ok) break;
      if (index < this.endpoints.length - 1) {
        this.metrics?.providerEndpointFailover?.inc({
          provider: this.providerId,
          cause: outcome.failureCode,
        });
        this.logger?.warn('provider.endpoint.failover', {
          providerId: this.providerId,
          requestId,
          failedEndpoint: ProviderClient.describeEndpoint(endpoint),
          cause: outcome.failureCode,
          nextEndpoint: ProviderClient.describeEndpoint(this.endpoints[index + 1]),
        });
      }
    }
    return outcomes;
  }

  /**
   * One endpoint, with the full retry policy applied to it.
   * @returns {Promise<{endpoint: string, ok: boolean, rows?: unknown[], failureCode?: string, failureDetail?: string, attempts: number, durationMillis: number}>}
   */
  async #fetchOne(endpoint, { signal, requestId, policy, attemptTimeout }) {
    const startedAt = Date.now();
    let attempts = 0;

    try {
      const rows = await withRetry(
        async ({ attempt }) => {
          attempts = attempt;
          return this.#attempt(endpoint, signal, attemptTimeout);
        },
        {
          policy,
          signal,
          onRetry: ({ attempt, delayMillis, code, message }) => {
            this.metrics?.providerRetries.inc({ provider: this.providerId, cause: code });
            this.logger?.warn('provider.retry', {
              providerId: this.providerId,
              requestId,
              endpoint: ProviderClient.describeEndpoint(endpoint),
              attempt,
              delayMillis,
              strategy: policy.strategy,
              cause: code,
              detail: message,
            });
          },
        },
      );

      const durationMillis = Date.now() - startedAt;
      this.metrics?.providerRequests.inc({ provider: this.providerId, outcome: 'ok' });
      this.metrics?.providerDuration.observe(durationMillis / 1000, { provider: this.providerId });
      return { endpoint, ok: true, rows, attempts, durationMillis };
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
        endpoint: ProviderClient.describeEndpoint(endpoint),
        attempts,
        durationMillis,
        cause: failureCode,
        detail: /** @type {Error} */ (error)?.message,
      });

      return {
        endpoint,
        ok: false,
        failureCode,
        failureDetail: /** @type {Error} */ (error)?.message,
        attempts,
        durationMillis,
      };
    }
  }

  /**
   * One attempt against one endpoint: fetch, bound, parse, and require a
   * top-level array.
   * @param {string} endpoint
   * @param {AbortSignal} [signal]
   * @returns {Promise<unknown[]>}
   */
  async #attempt(endpoint, signal, timeoutMillis = this.timeoutMillis) {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(new RetryableError(ProviderFailure.TIMEOUT, 'Provider request timed out')),
      timeoutMillis,
    );
    const onOuterAbort = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', onOuterAbort, { once: true });

    try {
      let response;
      try {
        response = await this.fetchImpl(endpoint, {
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

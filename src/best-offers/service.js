/**
 * Orchestration for GET /best-offers.
 *
 * Reads one validated configuration snapshot per request, fans out to the
 * configured providers concurrently, validates and prices every row, selects
 * the best eligible offer per canonical product, and serialises with
 * round-half-up at the documented precisions.
 */

import { evaluateProviderRows, selectBestPerProduct } from './ranking.js';
import { formatRfc3339Utc } from './time.js';

/**
 * Upper bound on individually reported rejected rows. Past this the response
 * carries a count per (provider, reason) instead.
 */
export const MAX_REPORTED_REJECTED_ROWS = 200;

/** Thrown when the caller's deadline elapsed or the client went away. */
export class RequestAbortedError extends Error {
  /** @param {unknown} reason */
  constructor(reason) {
    super('Request was aborted before completion');
    this.name = 'RequestAbortedError';
    this.reason = reason;
  }
}

/** Thrown when neither source could supply a valid top-level array (HTTP 503). */
export class AllProvidersUnavailableError extends Error {
  /** @param {string[]} providerIds */
  constructor(providerIds) {
    super('No provider returned a valid offer array');
    this.name = 'AllProvidersUnavailableError';
    this.providerIds = providerIds;
  }
}

export class BestOffersService {
  /**
   * @param {object} options
   * @param {import('./provider-client.js').ProviderClient[]} options.providers
   * @param {import('./config.js').ConfigStore} options.configStore
   * @param {import('./clock.js').Clock} options.clock
   * @param {import('./logger.js').Logger} [options.logger]
   * @param {ReturnType<import('./metrics.js').createMetrics>} [options.metrics]
   */
  constructor({ providers, configStore, clock, logger, metrics }) {
    if (!Array.isArray(providers) || providers.length === 0) {
      throw new Error('At least one provider client is required');
    }
    this.providers = providers;
    this.configStore = configStore;
    this.clock = clock;
    this.logger = logger;
    this.metrics = metrics;
  }

  /**
   * @param {{ signal?: AbortSignal, requestId?: string }} [context]
   * @returns {Promise<object>} the serialised success body
   */
  async getBestOffers({ signal, requestId } = {}) {
    // One snapshot for the whole request: FX and margin cannot shift mid-comparison.
    const snapshot = this.configStore.current();
    const nowEpochMillis = this.clock.now();

    const results = await Promise.all(
      this.providers.map((provider) => provider.fetchOffers({ signal, requestId })),
    );

    if (signal?.aborted) throw new RequestAbortedError(signal.reason);

    const usable = results.filter((result) => result.ok);
    if (usable.length === 0) {
      throw new AllProvidersUnavailableError(results.map((result) => result.providerId));
    }

    /** @type {string[]} */
    const unavailableProviders = results.filter((r) => !r.ok).map((r) => r.providerId).sort();

    /** @type {import('./ranking.js').Candidate[]} */
    const candidates = [];
    /** @type {import('./ranking.js').RejectedRow[]} */
    const rejected = [];

    for (const result of usable) {
      const evaluation = evaluateProviderRows({
        providerId: result.providerId,
        rows: /** @type {unknown[]} */ (result.rows),
        nowEpochMillis,
        snapshot,
      });
      // Appended with a loop, not `push(...array)`: spreading makes every
      // element a function argument, which overflows the call stack at around
      // 130k rows and turns one hostile provider body into a 500 for everyone.
      for (const candidate of evaluation.candidates) candidates.push(candidate);
      for (const row of evaluation.rejected) rejected.push(row);
      for (const row of evaluation.rejected) {
        this.metrics?.rowsRejected.inc({ provider: row.providerId, reason: row.reason });
      }
    }

    const winners = selectBestPerProduct(candidates);
    for (const winner of winners) {
      this.metrics?.offersReturned.inc({ provider: winner.providerId });
    }

    rejected.sort(
      (a, b) =>
        (a.providerId < b.providerId ? -1 : a.providerId > b.providerId ? 1 : 0) ||
        a.rowIndex - b.rowIndex,
    );

    // A provider sending tens of thousands of malformed rows must not turn a
    // small request into a multi-megabyte response. Beyond the cap the detail
    // is replaced by a count per (provider, reason), which is what an operator
    // actually acts on anyway.
    const truncatedRejections = rejected.length > MAX_REPORTED_REJECTED_ROWS;
    const reportedRejections = truncatedRejections
      ? rejected.slice(0, MAX_REPORTED_REJECTED_ROWS)
      : rejected;
    const rejectionSummary = truncatedRejections ? summariseRejections(rejected) : undefined;

    const partial = unavailableProviders.length > 0 || rejected.length > 0;
    if (partial) this.metrics?.partialResponses.inc();

    this.logger?.info('best-offers.completed', {
      requestId,
      nowEpochMillis,
      fxVersion: snapshot.fxVersion,
      marginVersion: snapshot.marginVersion,
      providersQueried: this.providers.length,
      providersUnavailable: unavailableProviders.length,
      candidateCount: candidates.length,
      rejectedCount: rejected.length,
      offerCount: winners.length,
      partial,
    });

    return {
      asOf: formatRfc3339Utc(nowEpochMillis),
      currency: snapshot.baseCurrency,
      fxVersion: snapshot.fxVersion,
      marginVersion: snapshot.marginVersion,
      partial,
      unavailableProviders,
      rejectedRows: reportedRejections.map(({ providerId, rowIndex, reason }) => ({
        providerId,
        rowIndex,
        reason,
      })),
      ...(truncatedRejections
        ? {
            rejectedRowsTruncated: true,
            rejectedRowCount: rejected.length,
            rejectedRowSummary: rejectionSummary,
          }
        : {}),
      offers: winners.map(serialiseOffer),
    };
  }
}

/**
 * @param {import('./ranking.js').RejectedRow[]} rejected
 * @returns {{ providerId: string, reason: string, count: number }[]}
 */
export function summariseRejections(rejected) {
  /** @type {Map<string, { providerId: string, reason: string, count: number }>} */
  const counts = new Map();
  for (const { providerId, reason } of rejected) {
    const key = `${providerId}\u0000${reason}`;
    const entry = counts.get(key);
    if (entry) entry.count += 1;
    else counts.set(key, { providerId, reason, count: 1 });
  }
  return [...counts.values()].sort(
    (a, b) =>
      (a.providerId < b.providerId ? -1 : a.providerId > b.providerId ? 1 : 0) ||
      (a.reason < b.reason ? -1 : a.reason > b.reason ? 1 : 0),
  );
}

/**
 * Rounding happens here and nowhere else.
 * @param {import('./ranking.js').Candidate} candidate
 */
export function serialiseOffer(candidate) {
  const { row, pricing, providerId } = candidate;
  return {
    productId: row.productId,
    providerId,
    eventCount: row.eventCount,
    validEventCount: row.validEventCount,
    qualityRatio: row.qualityRatio.toFixedHalfUp(4),
    customerBundleEUR: pricing.customerBundleAmount.toFixedHalfUp(2),
    costPer1000ValidEventsEUR: pricing.costPer1000ValidEvents.toFixedHalfUp(6),
    observedAt: formatRfc3339Utc(row.observedAtEpochMillis),
    expiresAt: formatRfc3339Utc(row.effectiveExpiryEpochMillis),
  };
}

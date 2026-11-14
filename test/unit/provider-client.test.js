import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ProviderClient,
  isRetryableStatus,
  parseRetryAfterMillis,
} from '../../src/best-offers/provider-client.js';
import { ProviderFailure } from '../../src/best-offers/reason-codes.js';
import { scriptedFetch, jsonResponse } from '../helpers/factories.js';

const FAST_RETRY = {
  maxAttempts: 3,
  initialDelayMillis: 1,
  maxDelayMillis: 2,
  backoffMultiplier: 2,
  totalBudgetMillis: 2000,
  random: () => 0,
};

function client(fetchImpl, overrides = {}) {
  return new ProviderClient({
    providerId: 'telemetry1',
    url: 'https://provider.example/provider/telemetry1',
    timeoutMillis: 100,
    retryPolicy: FAST_RETRY,
    fetchImpl,
    ...overrides,
  });
}

test('classifies retryable and permanent HTTP statuses', () => {
  for (const status of [408, 425, 429, 500, 502, 503, 504, 599]) {
    assert.equal(isRetryableStatus(status), true, `${status} should be retryable`);
  }
  for (const status of [400, 401, 403, 404, 410, 422, 451, 600]) {
    assert.equal(isRetryableStatus(status), false, `${status} should not be retryable`);
  }
});

test('parses Retry-After in both seconds and HTTP-date form', () => {
  assert.equal(parseRetryAfterMillis('2'), 2000);
  assert.equal(parseRetryAfterMillis('0'), 0);
  assert.equal(parseRetryAfterMillis('99999'), 60_000, 'capped at one minute');
  assert.equal(parseRetryAfterMillis(null), undefined);
  assert.equal(parseRetryAfterMillis('not-a-date'), undefined);
  const soon = new Date(Date.now() + 3000).toUTCString();
  const parsed = parseRetryAfterMillis(soon);
  assert.ok(parsed >= 0 && parsed <= 4000);
});

test('returns parsed rows on a successful response', async () => {
  const fetchImpl = scriptedFetch([jsonResponse([{ productId: 'a' }])]);
  const result = await client(fetchImpl).fetchOffers();
  assert.equal(result.ok, true);
  assert.deepEqual(result.rows, [{ productId: 'a' }]);
  assert.equal(result.attempts, 1);
  assert.equal(result.providerId, 'telemetry1');
  assert.equal(fetchImpl.calls[0].init.cache, 'no-store', 'stale cached offers must never be served');
  assert.equal(fetchImpl.calls[0].init.redirect, 'error');
});

test('retries a 503 and succeeds on a later attempt', async () => {
  const fetchImpl = scriptedFetch([
    jsonResponse({ error: 'unavailable' }, { status: 503 }),
    jsonResponse({ error: 'unavailable' }, { status: 503 }),
    jsonResponse([{ productId: 'a' }]),
  ]);
  const result = await client(fetchImpl).fetchOffers();
  assert.equal(result.ok, true);
  assert.equal(result.attempts, 3);
  assert.equal(fetchImpl.calls.length, 3);
});

test('gives up after maxAttempts and reports the provider unavailable', async () => {
  const fetchImpl = scriptedFetch([jsonResponse({}, { status: 500 })]);
  const result = await client(fetchImpl).fetchOffers();
  assert.equal(result.ok, false);
  assert.equal(result.failureCode, ProviderFailure.HTTP_STATUS);
  assert.equal(fetchImpl.calls.length, 3);
});

test('does not retry a 404', async () => {
  const fetchImpl = scriptedFetch([jsonResponse({}, { status: 404 })]);
  const result = await client(fetchImpl).fetchOffers();
  assert.equal(result.ok, false);
  assert.equal(result.failureCode, ProviderFailure.HTTP_STATUS);
  assert.equal(fetchImpl.calls.length, 1, 'a 404 will not fix itself');
});

test('retries a transport failure', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls < 3) throw new TypeError('fetch failed');
    return jsonResponse([]);
  };
  const result = await client(fetchImpl).fetchOffers();
  assert.equal(result.ok, true);
  assert.equal(calls, 3);
});

test('reports a transport failure that never recovers', async () => {
  const fetchImpl = async () => {
    throw new TypeError('ECONNREFUSED');
  };
  const result = await client(fetchImpl).fetchOffers();
  assert.equal(result.ok, false);
  assert.equal(result.failureCode, ProviderFailure.NETWORK_ERROR);
  assert.equal(result.attempts, 3);
});

test('does not retry malformed JSON', async () => {
  const fetchImpl = scriptedFetch([jsonResponse('{ not json')]);
  const result = await client(fetchImpl).fetchOffers();
  assert.equal(result.ok, false);
  assert.equal(result.failureCode, ProviderFailure.INVALID_JSON);
  assert.equal(fetchImpl.calls.length, 1);
});

test('does not retry a body that is not a top-level array', async () => {
  const fetchImpl = scriptedFetch([jsonResponse({ offers: [] })]);
  const result = await client(fetchImpl).fetchOffers();
  assert.equal(result.ok, false);
  assert.equal(result.failureCode, ProviderFailure.NOT_AN_ARRAY);
  assert.equal(fetchImpl.calls.length, 1);
});

test('times out a slow provider and retries', async () => {
  let calls = 0;
  const fetchImpl = async (url, init) => {
    calls += 1;
    if (calls === 1) {
      // Never settles on its own; only the per-attempt timeout can end it.
      return new Promise((resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
      });
    }
    return jsonResponse([{ productId: 'late' }]);
  };
  const result = await client(fetchImpl, { timeoutMillis: 20 }).fetchOffers();
  assert.equal(result.ok, true);
  assert.equal(result.attempts, 2);
});

test('reports TIMEOUT when every attempt is too slow', async () => {
  const fetchImpl = async (url, init) =>
    new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
    });
  const result = await client(fetchImpl, { timeoutMillis: 10 }).fetchOffers();
  assert.equal(result.ok, false);
  assert.equal(result.failureCode, ProviderFailure.TIMEOUT);
});

test('rejects a body larger than the configured cap', async () => {
  const huge = JSON.stringify(Array.from({ length: 1000 }, (_, i) => ({ productId: `p${i}` })));
  const fetchImpl = scriptedFetch([
    () => new Response(huge, { status: 200, headers: { 'content-type': 'application/json' } }),
  ]);
  const result = await client(fetchImpl, { maxBodyBytes: 128 }).fetchOffers();
  assert.equal(result.ok, false);
  assert.equal(result.failureCode, ProviderFailure.BODY_TOO_LARGE);
});

test('rejects a declared content-length over the cap without reading the body', async () => {
  const fetchImpl = scriptedFetch([
    () =>
      new Response('[]', {
        status: 200,
        headers: { 'content-type': 'application/json', 'content-length': '999999999' },
      }),
  ]);
  const result = await client(fetchImpl, { maxBodyBytes: 1024 }).fetchOffers();
  assert.equal(result.ok, false);
  assert.equal(result.failureCode, ProviderFailure.BODY_TOO_LARGE);
});

test('cancellation from the caller stops the fetch immediately', async () => {
  const controller = new AbortController();
  const fetchImpl = async (url, init) =>
    new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
    });
  const promise = client(fetchImpl, { timeoutMillis: 10_000 }).fetchOffers({ signal: controller.signal });
  setTimeout(() => controller.abort(new Error('shutting down')), 10);
  const result = await promise;
  assert.equal(result.ok, false);
  assert.equal(result.failureCode, ProviderFailure.CANCELLED);
});

test('an empty array body is a valid, usable response', async () => {
  const fetchImpl = scriptedFetch([jsonResponse([])]);
  const result = await client(fetchImpl).fetchOffers();
  assert.equal(result.ok, true);
  assert.deepEqual(result.rows, []);
});

test('records retry and outcome metrics', async () => {
  const { createMetrics } = await import('../../src/best-offers/metrics.js');
  const metrics = createMetrics();
  const fetchImpl = scriptedFetch([
    jsonResponse({}, { status: 503 }),
    jsonResponse([{ productId: 'a' }]),
  ]);
  await client(fetchImpl, { metrics }).fetchOffers();
  const rendered = metrics.registry.render();
  assert.match(rendered, /vh_provider_retries_total\{provider="telemetry1",cause="HTTP_STATUS"\} 1/);
  assert.match(rendered, /vh_provider_requests_total\{provider="telemetry1",outcome="ok"\} 1/);
});

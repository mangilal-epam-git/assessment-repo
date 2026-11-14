/** Shared test fixtures and builders. */
import { buildSnapshot } from '../../src/best-offers/config.js';

export const FIXTURE_INSTANT = '2026-06-15T10:05:00Z';
export const FIXTURE_EPOCH = Date.parse(FIXTURE_INSTANT);

export const SEED_CONFIG = Object.freeze({
  fxVersion: 'fx-demo-1',
  marginVersion: 'margin-demo-1',
  baseCurrency: 'EUR',
  fxRatesToBase: { EUR: '1.00', USD: '0.92', GBP: '1.18' },
  defaultMarginBasisPoints: 1000,
  minimumQualityRatio: '0.90',
});

export function seedSnapshot(overrides = {}) {
  return buildSnapshot({ ...SEED_CONFIG, ...overrides }, FIXTURE_EPOCH);
}

/** A valid row at the fixture instant; override any field. */
export function offer(overrides = {}) {
  return {
    productId: 'eu-north-location-hour',
    eventCount: 100000,
    validEventCount: 98000,
    priceMinor: 1200,
    currency: 'EUR',
    observedAt: '2026-06-15T10:00:00Z',
    ...overrides,
  };
}

/** Builds a stub fetch that replays a scripted sequence of responses. */
export function scriptedFetch(steps) {
  const calls = [];
  let index = 0;
  const impl = async (url, init) => {
    calls.push({ url: String(url), init });
    const step = steps[Math.min(index, steps.length - 1)];
    index += 1;
    if (typeof step === 'function') return step({ url, init, attempt: index });
    return step;
  };
  impl.calls = calls;
  return impl;
}

/** Builds a Response with a JSON body. */
export function jsonResponse(body, { status = 200, headers = {} } = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return new Response(text, {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

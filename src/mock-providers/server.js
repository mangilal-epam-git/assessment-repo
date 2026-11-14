/**
 * Mock provider endpoints.
 *
 * The brief says the data-source endpoints are placeholders the team must
 * host. These serve the supplied fixtures over HTTP with the same schema on
 * both routes; provider identity is the configured endpoint, not a field in
 * the rows.
 *
 * Fault injection (query parameters, test-only) lets the retry, timeout,
 * partial-response and 503 paths be exercised end to end:
 *   ?fail=500|404|invalid-json|not-array|empty-body
 *   ?delayMs=1500
 *   ?failFirst=2          fail the first N requests, then succeed
 */

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = process.env.FIXTURE_DIR
  ? path.resolve(process.env.FIXTURE_DIR)
  : path.resolve(here, '../../fixtures');

const ROUTES = Object.freeze({
  '/provider/telemetry1': 'telemetry1.json',
  '/provider/telemetry2': 'telemetry2.json',
});

function sendJson(res, status, body) {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  });
  res.end(payload);
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {Map<string, number>} requestCounts per-instance state, so that two
 *   mock servers in one process (as in the test suite) cannot interfere.
 */
async function handle(req, res, requestCounts) {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

  if (url.pathname === '/healthz') {
    sendJson(res, 200, { status: 'ok' });
    return;
  }
  if (url.pathname === '/admin/reset' && req.method === 'POST') {
    requestCounts.clear();
    sendJson(res, 200, { status: 'reset' });
    return;
  }

  const fixture = ROUTES[url.pathname];
  if (!fixture) {
    sendJson(res, 404, { code: 'NOT_FOUND', message: 'Unknown provider route' });
    return;
  }
  if (req.method !== 'GET') {
    sendJson(res, 405, { code: 'METHOD_NOT_ALLOWED', message: 'Use GET' });
    return;
  }

  const count = (requestCounts.get(url.pathname) ?? 0) + 1;
  requestCounts.set(url.pathname, count);

  const delayMillis = Number(url.searchParams.get('delayMs') ?? 0);
  if (Number.isFinite(delayMillis) && delayMillis > 0) {
    await new Promise((resolve) => setTimeout(resolve, Math.min(delayMillis, 30_000)));
  }

  const failFirst = Number(url.searchParams.get('failFirst') ?? 0);
  if (Number.isFinite(failFirst) && count <= failFirst) {
    sendJson(res, 503, { code: 'UPSTREAM_UNAVAILABLE', message: 'Injected transient failure' });
    return;
  }

  switch (url.searchParams.get('fail')) {
    case '500':
      sendJson(res, 500, { code: 'UPSTREAM_ERROR', message: 'Injected server error' });
      return;
    case '404':
      sendJson(res, 404, { code: 'NOT_FOUND', message: 'Injected not found' });
      return;
    case 'invalid-json':
      sendJson(res, 200, '{ this is not json');
      return;
    case 'not-array':
      sendJson(res, 200, { offers: [] });
      return;
    case 'empty-body':
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('');
      return;
    default:
      break;
  }

  try {
    const body = await readFile(path.join(FIXTURE_DIR, fixture), 'utf8');
    res.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': Buffer.byteLength(body),
      'cache-control': 'no-store',
    });
    res.end(body);
  } catch (error) {
    sendJson(res, 500, { code: 'FIXTURE_UNREADABLE', message: 'Fixture could not be read' });
  }
}

/**
 * @param {{ port?: number, host?: string }} [options]
 */
export async function startMockProviders({ port = Number(process.env.MOCK_PORT ?? 8081), host = process.env.MOCK_HOST ?? '0.0.0.0' } = {}) {
  /** @type {Map<string, number>} */
  const requestCounts = new Map();
  const server = http.createServer((req, res) => {
    handle(req, res, requestCounts).catch(() => {
      if (!res.writableEnded) sendJson(res, 500, { code: 'INTERNAL_ERROR', message: 'Mock failure' });
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve(undefined);
    });
  });
  const address = server.address();
  const boundPort = typeof address === 'object' && address ? address.port : port;
  return {
    server,
    port: boundPort,
    baseUrl: `http://127.0.0.1:${boundPort}`,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve(undefined));
      }),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startMockProviders()
    .then(({ port }) => {
      process.stdout.write(
        `${JSON.stringify({ level: 'info', message: 'mock-providers.listening', port, routes: Object.keys(ROUTES) })}\n`,
      );
    })
    .catch((error) => {
      process.stderr.write(`mock providers failed to start: ${error?.message}\n`);
      process.exit(1);
    });
}

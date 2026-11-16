/**
 * HTTP surface for the best-offers service.
 *
 * Routes:
 *   GET  /best-offers           quality-normalised best eligible offer per product
 *   GET  /healthz               liveness (is the process up)
 *   GET  /readyz                readiness (is it accepting traffic)
 *   GET  /metrics               Prometheus text exposition
 *   POST /admin/config/reload   runtime FX / markup reload (bearer token)
 *
 * Cross-cutting behaviour: request ids, concurrency shedding, per-request
 * deadline, cancellation on client disconnect, safe error bodies.
 */

import { randomUUID, timingSafeEqual } from 'node:crypto';
import { AllProvidersUnavailableError, RequestAbortedError } from './service.js';
import { ErrorCode } from './reason-codes.js';
import { ConfigValidationError, readConfigDocument } from './config.js';

const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';

/** Constant-time bearer comparison; avoids leaking the token via timing. */
function tokensMatch(provided, expected) {
  const a = Buffer.from(provided ?? '', 'utf8');
  const b = Buffer.from(expected ?? '', 'utf8');
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}

/**
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {unknown} body
 * @param {Record<string,string>} [headers]
 */
function sendJson(res, status, body, headers = {}) {
  // Guard both conditions: a second write attempt from the outer error handler
  // would otherwise throw ERR_HTTP_HEADERS_SENT inside a catch block.
  if (res.writableEnded || res.headersSent) {
    if (!res.writableEnded) res.end();
    return;
  }
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': JSON_CONTENT_TYPE,
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    ...headers,
  });
  res.end(payload);
}

/**
 * Builds the request handler.
 *
 * @param {object} options
 * @param {import('./service.js').BestOffersService} options.service
 * @param {import('./config.js').ConfigStore} options.configStore
 * @param {import('./logger.js').Logger} options.logger
 * @param {ReturnType<import('./metrics.js').createMetrics>} options.metrics
 * @param {object} options.config
 * @param {() => boolean} [options.isReady]
 */
export function createApp({
  service,
  configStore,
  logger,
  metrics,
  config,
  isReady = () => true,
  shutdownSignal,
}) {
  let inFlight = 0;

  /**
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res
   */
  return async function handle(req, res) {
    const startedAt = process.hrtime.bigint();
    const headerId = req.headers['x-request-id'];
    const requestId =
      typeof headerId === 'string' && /^[\w.:-]{1,128}$/.test(headerId) ? headerId : randomUUID();
    res.setHeader('x-request-id', requestId);

    // Parsed defensively: a malformed Host header or request target makes
    // `new URL` throw, and an exception here would escape the try block below,
    // leaving the socket open with no response until the server timeout.
    const route = parseRoutePath(req.url, req.headers.host);
    const requestLogger = logger.child({ requestId });

    const finish = (status) => {
      const seconds = Number(process.hrtime.bigint() - startedAt) / 1e9;
      metrics.httpRequests.inc({ route: routeLabel(route), method: req.method ?? 'GET', status });
      metrics.httpDuration.observe(seconds, { route: routeLabel(route), method: req.method ?? 'GET' });
      requestLogger.info('http.request', {
        method: req.method,
        route,
        status,
        durationMillis: Math.round(seconds * 1000),
      });
    };

    res.on('finish', () => finish(res.statusCode));

    try {
      if (route === '/' || route === '/index.html') {
        const snapshot = configStore.current();
        sendJson(res, 200, {
          service: 'best-offers',
          description:
            'Returns the best eligible offer per canonical telemetry product, ' +
            'ranked on quality-normalised cost per 1000 valid events.',
          endpoints: ['/best-offers', '/healthz', '/readyz', '/metrics'],
          configuration: {
            fxVersion: snapshot.fxVersion,
            marginVersion: snapshot.marginVersion,
            currency: snapshot.baseCurrency,
          },
          // The provider feeds are a separate service; naming it here saves
          // anyone looking for /provider/* on the wrong port.
          upstreamProviders: 'configured separately; see PROVIDER_TELEMETRY1_URL and PROVIDER_TELEMETRY2_URL',
        });
        return;
      }

      if (route === '/healthz' || route === '/readyz' || route === '/metrics') {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          sendJson(res, 405, errorBody(ErrorCode.METHOD_NOT_ALLOWED, 'Use GET', requestId), {
            allow: 'GET',
          });
          return;
        }
      }

      if (route === '/healthz' && req.method === 'GET') {
        sendJson(res, 200, { status: 'ok' });
        return;
      }

      if (route === '/readyz' && req.method === 'GET') {
        const ready = isReady();
        sendJson(res, ready ? 200 : 503, {
          status: ready ? 'ready' : 'not-ready',
          fxVersion: configStore.current().fxVersion,
          marginVersion: configStore.current().marginVersion,
        });
        return;
      }

      if (route === '/metrics' && req.method === 'GET') {
        metrics.inFlight.set(inFlight);
        const body = metrics.registry.render();
        res.writeHead(200, {
          'content-type': 'text/plain; version=0.0.4; charset=utf-8',
          'content-length': Buffer.byteLength(body),
          'cache-control': 'no-store',
        });
        res.end(body);
        return;
      }

      if (route === null) {
        sendJson(res, 400, errorBody(ErrorCode.BAD_REQUEST, 'Malformed request target', requestId));
        return;
      }

      if (route === '/admin/config/reload') {
        if (req.method !== 'POST') {
          sendJson(res, 405, errorBody(ErrorCode.METHOD_NOT_ALLOWED, 'Use POST', requestId), {
            allow: 'POST',
          });
          return;
        }
        await handleConfigReload({ req, res, configStore, config, metrics, requestId, requestLogger });
        return;
      }

      if (route === '/best-offers') {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          sendJson(res, 405, errorBody(ErrorCode.METHOD_NOT_ALLOWED, 'Use GET', requestId), {
            allow: 'GET',
          });
          return;
        }
        if (!isReady()) {
          sendJson(
            res,
            503,
            errorBody(ErrorCode.SHUTTING_DOWN, 'Service is not accepting requests', requestId),
            { 'retry-after': '5', connection: 'close' },
          );
          return;
        }
        if (inFlight >= config.maxConcurrentRequests) {
          // Shed load deterministically instead of collapsing: a queue that
          // grows without bound turns a traffic spike into an outage.
          metrics.rejectedLoad.inc();
          sendJson(res, 503, errorBody(ErrorCode.OVERLOADED, 'Service is busy', requestId), {
            'retry-after': '1',
          });
          return;
        }

        inFlight += 1;
        const controller = new AbortController();
        let deadlineExceeded = false;
        const timer = setTimeout(() => {
          deadlineExceeded = true;
          controller.abort(new Error('request deadline exceeded'));
        }, config.requestTimeoutMillis);
        const onShutdown = () => controller.abort(new Error('server shutting down'));
        shutdownSignal?.addEventListener('abort', onShutdown, { once: true });
        const onClose = () => {
          if (!res.writableEnded) controller.abort(new Error('client disconnected'));
        };
        req.on('close', onClose);

        try {
          const body = await service.getBestOffers({ signal: controller.signal, requestId });
          sendJson(res, 200, body);
        } catch (error) {
          if (error instanceof AllProvidersUnavailableError) {
            sendJson(
              res,
              503,
              errorBody(
                ErrorCode.ALL_PROVIDERS_UNAVAILABLE,
                'No telemetry provider returned a usable offer list',
                requestId,
              ),
              { 'retry-after': '5' },
            );
            return;
          }
          if (error instanceof RequestAbortedError || controller.signal.aborted) {
            if (req.destroyed || res.writableEnded) {
              requestLogger.warn('http.client_disconnected', { route });
              return; // nothing to write; the socket is gone
            }
            // A deadline or a shutdown is an expected operational outcome, not
            // an internal fault: answer with a retryable 503 rather than a 500,
            // and do not log it at error level and page the on-call engineer.
            const code = deadlineExceeded ? ErrorCode.REQUEST_TIMEOUT : ErrorCode.SHUTTING_DOWN;
            requestLogger.warn('http.request_aborted', { route, code });
            metrics.requestsAborted.inc({ code });
            sendJson(res, 503, errorBody(code, 'Request did not complete in time', requestId), {
              'retry-after': '2',
            });
            return;
          }
          throw error;
        } finally {
          clearTimeout(timer);
          req.off('close', onClose);
          shutdownSignal?.removeEventListener('abort', onShutdown);
          inFlight -= 1;
        }
        return;
      }

      sendJson(res, 404, errorBody(ErrorCode.NOT_FOUND, 'Unknown route', requestId));
    } catch (error) {
      requestLogger.error('http.unhandled_error', { route, error });
      sendJson(
        res,
        500,
        errorBody(ErrorCode.INTERNAL_ERROR, 'Unexpected internal error', requestId),
      );
    }
  };
}

/** Keeps metric cardinality bounded: unknown paths collapse to one label. */
function routeLabel(route) {
  const known = ['/best-offers', '/healthz', '/readyz', '/metrics', '/admin/config/reload'];
  return route !== null && known.includes(route) ? route : 'other';
}

/**
 * Extracts the path from a request target without trusting the Host header.
 * @param {string|undefined} target
 * @param {string|string[]|undefined} host
 * @returns {string|null} the pathname, or null when the target is unusable
 */
export function parseRoutePath(target, host) {
  try {
    const base = typeof host === 'string' && host !== '' ? host : 'localhost';
    return new URL(target ?? '/', `http://${base}`).pathname;
  } catch {
    // Fall back to a host-independent parse so a hostile Host header cannot
    // deny service to a perfectly valid request target.
    try {
      return new URL(target ?? '/', 'http://localhost').pathname;
    } catch {
      return null;
    }
  }
}

/**
 * @param {string} code
 * @param {string} message safe description - never echoes provider payloads
 * @param {string} requestId
 */
export function errorBody(code, message, requestId) {
  return { code, message, requestId };
}

async function handleConfigReload({ req, res, configStore, config, metrics, requestId, requestLogger }) {
  const header = req.headers.authorization ?? '';
  const provided = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!config.adminToken || !tokensMatch(provided, config.adminToken)) {
    metrics.configReloads.inc({ outcome: 'unauthorized' });
    sendJson(res, 401, errorBody(ErrorCode.UNAUTHORIZED, 'Admin token required', requestId));
    return;
  }

  try {
    // Reload from disk so the file remains the single source of truth, and a
    // restart reproduces exactly the configuration that was last applied.
    const raw = await readConfigDocument(config.configPath);
    const snapshot = configStore.replace(raw);
    metrics.configReloads.inc({ outcome: 'applied' });
    requestLogger.info('config.reload.http', {
      fxVersion: snapshot.fxVersion,
      marginVersion: snapshot.marginVersion,
    });
    sendJson(res, 200, {
      status: 'applied',
      fxVersion: snapshot.fxVersion,
      marginVersion: snapshot.marginVersion,
      defaultMarginBasisPoints: snapshot.defaultMarginBasisPoints,
    });
  } catch (error) {
    metrics.configReloads.inc({ outcome: 'rejected' });
    const active = configStore.current();
    // The previous snapshot stays active - that is the contract.
    sendJson(res, 422, {
      ...errorBody(
        ErrorCode.CONFIG_RELOAD_REJECTED,
        'Configuration rejected; previous snapshot remains active',
        requestId,
      ),
      problems: error instanceof ConfigValidationError ? error.problems : ['configuration unreadable'],
      activeFxVersion: active.fxVersion,
      activeMarginVersion: active.marginVersion,
    });
  }
}

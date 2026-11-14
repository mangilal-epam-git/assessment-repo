/**
 * Composition root: wires environment, configuration, clock, provider clients,
 * metrics and HTTP together, then manages a predictable lifecycle.
 *
 * Shutdown sequence (SIGTERM/SIGINT):
 *   1. fail readiness so load balancers stop sending new work;
 *   2. stop accepting connections;
 *   3. abort in-flight provider calls and let responses drain;
 *   4. exit, or force-exit after the grace period.
 */

import http from 'node:http';
import { watch } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readEnvironment } from './env.js';
import { loadConfigStore } from './config.js';
import { Logger } from './logger.js';
import { createMetrics } from './metrics.js';
import { ProviderClient } from './provider-client.js';
import { BestOffersService } from './service.js';
import { createApp } from './app.js';
import { systemClock, fixedClock } from './clock.js';

/**
 * @param {object} [overrides]
 * @param {NodeJS.ProcessEnv} [overrides.env]
 * @returns {Promise<{ server: import('node:http').Server, port: number, close: () => Promise<void>, configStore: import('./config.js').ConfigStore, metrics: object, logger: Logger }>}
 */
export async function startServer({ env = process.env } = {}) {
  const config = readEnvironment(env);
  const logger = new Logger({
    level: /** @type {any} */ (config.logLevel),
    base: { service: 'best-offers', env: config.nodeEnv },
  });
  const metrics = createMetrics();

  const configStore = await loadConfigStore(path.resolve(config.configPath), { logger });

  const retryPolicy = {
    maxAttempts: config.providerMaxAttempts,
    initialDelayMillis: config.providerRetryInitialDelayMillis,
    maxDelayMillis: config.providerRetryMaxDelayMillis,
    backoffMultiplier: 2,
    totalBudgetMillis: config.providerRetryBudgetMillis,
    random: Math.random,
  };

  // Provider identity is configured here, never taken from the payload.
  const providers = [
    { providerId: 'telemetry1', url: config.providerTelemetry1Url },
    { providerId: 'telemetry2', url: config.providerTelemetry2Url },
  ].map(
    ({ providerId, url }) =>
      new ProviderClient({
        providerId,
        url,
        timeoutMillis: config.providerTimeoutMillis,
        retryPolicy,
        maxBodyBytes: config.providerMaxBodyBytes,
        logger,
        metrics,
      }),
  );

  const clock = config.fixedClock ? fixedClock(config.fixedClock) : systemClock();
  if (config.fixedClock) {
    logger.warn('clock.fixed', {
      fixedClock: config.fixedClock,
      note: 'Deterministic clock enabled - intended for demos and tests only',
    });
  }

  const service = new BestOffersService({ providers, configStore, clock, logger, metrics });

  let ready = true;
  // Aborted during shutdown so in-flight provider calls stop promptly rather
  // than being severed mid-flight when the grace period expires.
  const shutdownController = new AbortController();
  const app = createApp({
    service,
    configStore,
    logger,
    metrics,
    config,
    isReady: () => ready,
    shutdownSignal: shutdownController.signal,
  });

  const server = http.createServer((req, res) => {
    // The rejection must never be discarded: an unhandled rejection here would
    // leave the socket open with no response and, with the default handler,
    // can take the process down.
    app(req, res).catch((error) => {
      logger.error('http.handler_failed', { error });
      if (!res.headersSent && !res.writableEnded) {
        res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
        res.end('{"code":"INTERNAL_ERROR","message":"Unexpected internal error","requestId":"unknown"}');
      } else if (!res.writableEnded) {
        res.end();
      }
    });
  });
  server.headersTimeout = 20_000;
  server.requestTimeout = 30_000;
  server.keepAliveTimeout = 65_000;
  // Bound the socket count so a connection flood degrades gracefully rather
  // than exhausting file descriptors.
  server.maxConnections = Math.max(config.maxConcurrentRequests * 4, 64);

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.host, () => {
      server.off('error', reject);
      resolve(undefined);
    });
  });

  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : config.port;
  logger.info('server.listening', {
    port,
    host: config.host,
    fxVersion: configStore.current().fxVersion,
    marginVersion: configStore.current().marginVersion,
    providers: providers.map((p) => p.providerId),
  });

  // Hot reload on file change, so a ConfigMap/App Configuration update is
  // picked up without a restart. A malformed file is logged and ignored.
  let watcher;
  if (config.configWatchEnabled) {
    const configPath = path.resolve(config.configPath);
    const configDir = path.dirname(configPath);
    const configFile = path.basename(configPath);
    try {
      let reloadTimer;
      // The *directory* is watched, not the file. Kubernetes ConfigMaps,
      // Helm and most editors replace a file by rename, which leaves a
      // file-level watcher bound to a dead inode and silently stops reloading
      // after the first update.
      watcher = watch(configDir, (_eventType, filename) => {
        if (filename && filename !== configFile) return;
        clearTimeout(reloadTimer);
        // Debounce: a single logical update fires several events.
        reloadTimer = setTimeout(() => {
          configStore
            .reloadFromDisk()
            .then(() => metrics.configReloads.inc({ outcome: 'applied' }))
            .catch(() => metrics.configReloads.inc({ outcome: 'rejected' }));
        }, 150);
        if (typeof reloadTimer.unref === 'function') reloadTimer.unref();
      });
      // An FSWatcher is an EventEmitter: an 'error' event with no listener
      // throws, which would take the process down over a transient inotify
      // condition.
      watcher.on('error', (error) => {
        logger.warn('config.watch.error', { error });
      });
      watcher.unref?.();
    } catch (error) {
      logger.warn('config.watch.unavailable', { error });
    }
  }

  let closing;
  const close = async () => {
    if (closing) return closing;
    closing = (async () => {
      ready = false;
      logger.info('server.shutdown.started');
      watcher?.close();
      // Tell in-flight requests to stop waiting on providers.
      shutdownController.abort(new Error('server shutting down'));
      await new Promise((resolve) => {
        const forceTimer = setTimeout(() => {
          logger.warn('server.shutdown.forced');
          server.closeAllConnections?.();
          resolve(undefined);
        }, config.shutdownGraceMillis);
        if (typeof forceTimer.unref === 'function') forceTimer.unref();
        server.close(() => {
          clearTimeout(forceTimer);
          resolve(undefined);
        });
        server.closeIdleConnections?.();
      });
      logger.info('server.shutdown.completed');
    })();
    return closing;
  };

  return { server, port, close, configStore, metrics, logger };
}

/** Attaches signal handlers; separated so tests can start a server without them. */
export function installSignalHandlers({ close, logger }) {
  const onSignal = (signal) => {
    logger.info('server.signal', { signal });
    close()
      .then(() => process.exit(0))
      .catch((error) => {
        logger.error('server.shutdown.failed', { error });
        process.exit(1);
      });
  };
  process.once('SIGTERM', () => onSignal('SIGTERM'));
  process.once('SIGINT', () => onSignal('SIGINT'));
  process.on('unhandledRejection', (reason) => {
    logger.error('process.unhandled_rejection', { error: reason });
  });
  process.on('uncaughtException', (error) => {
    logger.error('process.uncaught_exception', { error });
    close().finally(() => process.exit(1));
  });
}

// Run only when executed directly, not when imported by tests.
// pathToFileURL handles Windows drive letters and percent-encoding, which
// naive string concatenation gets wrong.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer()
    .then((instance) => {
      installSignalHandlers(instance);
      // SIGHUP is the conventional "re-read your configuration" signal.
      process.on('SIGHUP', () => {
        instance.configStore.reloadFromDisk().catch(() => {});
      });
    })
    .catch((error) => {
      process.stderr.write(`${JSON.stringify({ level: 'error', message: 'server.start.failed', error: String(error?.message ?? error) })}\n`);
      process.exit(1);
    });
}

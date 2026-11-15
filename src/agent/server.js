/**
 * Composition root for the supervised agent service.
 *
 * Wires the model adapter, tool registry, proposal store, approval gate,
 * execution service and audit ledger together, then serves the HTTP API and
 * the supervision console.
 *
 * The wiring itself encodes the safety argument: the orchestrator is given
 * the registry (read and propose only), while the execution service is given
 * the proposal store and is never reachable from the agent loop.
 */

import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { Logger } from '../best-offers/logger.js';
import { systemClock, fixedClock } from '../best-offers/clock.js';
import { readAgentEnvironment } from './env.js';
import { createAgentMetrics } from './metrics.js';
import { AuditLedger } from './audit.js';
import { FleetStore } from './fleet-store.js';
import { ProposalService } from './proposals.js';
import { ExecutionService } from './execution.js';
import { ToolRegistry } from './tools/registry.js';
import { createFleetTools } from './tools/fleet-tools.js';
import { createModelAdapter, withDeterministicFallback } from './model/provider.js';
import { withEgressPolicy } from './model/egress-policy.js';
import { AgentOrchestrator } from './orchestrator.js';
import { createAgentApp } from './app.js';

/**
 * @param {{ env?: NodeJS.ProcessEnv }} [overrides]
 */
export async function startAgentServer({ env = process.env } = {}) {
  const config = readAgentEnvironment(env);
  const logger = new Logger({
    level: /** @type {any} */ (config.logLevel),
    base: { service: 'fleet-assistant', env: config.nodeEnv },
  });
  const metrics = createAgentMetrics();
  const clock = config.fixedClock ? fixedClock(config.fixedClock) : systemClock();

  const audit = new AuditLedger({ clock });
  const fleet = new FleetStore();
  const proposals = new ProposalService({
    audit,
    clock,
    ttlMillis: config.proposalTtlMillis,
    fourEyesThresholdMinor: config.fourEyesThresholdMinor,
  });
  const execution = new ExecutionService({
    proposals,
    audit,
    clock,
    fleet,
    budgetLookup: () => ({ remainingMinor: config.tenantBudgetMinor }),
  });

  const registry = new ToolRegistry();
  for (const tool of createFleetTools({ fleet, proposals })) registry.register(tool);

  // Order matters. The egress policy sits closest to the network so nothing
  // bypasses it, and the fallback sits outside it so a blocked call degrades
  // to local processing rather than failing the turn. A block is recorded as
  // a policy violation either way; it is never silent.
  const guarded = withEgressPolicy(createModelAdapter(config, logger), {
    permittedClasses: config.modelPermittedDataClasses,
    logger,
    audit,
    metrics,
    enabled: config.modelEgressPolicyEnabled,
  });
  const model = withDeterministicFallback(guarded, {
    logger,
    enabled: config.modelFallbackEnabled,
  });

  const orchestrator = new AgentOrchestrator({
    model,
    registry,
    audit,
    logger,
    maxIterations: config.maxIterations,
    maxToolCallsPerTurn: config.maxToolCallsPerTurn,
  });

  let ready = true;
  const shutdownController = new AbortController();

  const app = createAgentApp({
    orchestrator,
    proposals,
    execution,
    audit,
    registry,
    fleet,
    logger,
    metrics,
    config,
    defaultTenantId: FleetStore.defaultTenantId,
    isReady: () => ready,
    shutdownSignal: shutdownController.signal,
  });

  const server = http.createServer((req, res) => {
    app(req, res).catch((error) => {
      logger.error('agent.handler_failed', { error });
      if (!res.headersSent && !res.writableEnded) {
        res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
        res.end('{"code":"INTERNAL_ERROR","message":"Unexpected internal error","requestId":"unknown"}');
      } else if (!res.writableEnded) {
        res.end();
      }
    });
  });
  server.headersTimeout = 20_000;
  server.requestTimeout = 120_000; // model calls can be slow
  server.keepAliveTimeout = 65_000;
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

  logger.info('agent.listening', {
    port,
    host: config.host,
    modelBackend: model.name,
    model: model.model,
    tools: registry.forAgent().map((tool) => `${tool.name}:${tool.classification}`),
    egressPolicy: config.modelEgressPolicyEnabled
      ? config.modelPermittedDataClasses.join(',')
      : 'disabled',
    note: 'No execute-class tool is bindable by the agent; vehicle actuation does not exist.',
  });

  // Expire proposals on a timer as well as on read, so "silence is rejection"
  // holds even when nobody is looking at the console.
  const sweeper = setInterval(() => {
    const expired = proposals.expireDueProposals();
    if (expired > 0) logger.info('agent.proposals_expired', { count: expired });
  }, 30_000);
  sweeper.unref?.();

  let closing;
  const close = async () => {
    if (closing) return closing;
    closing = (async () => {
      ready = false;
      clearInterval(sweeper);
      shutdownController.abort(new Error('server shutting down'));
      logger.info('agent.shutdown.started');
      await new Promise((resolve) => {
        const force = setTimeout(() => {
          server.closeAllConnections?.();
          resolve(undefined);
        }, config.shutdownGraceMillis);
        force.unref?.();
        server.close(() => {
          clearTimeout(force);
          resolve(undefined);
        });
        server.closeIdleConnections?.();
      });
      logger.info('agent.shutdown.completed');
    })();
    return closing;
  };

  return { server, port, close, logger, metrics, audit, proposals, execution, registry, fleet, orchestrator, model };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startAgentServer()
    .then((instance) => {
      const onSignal = () => {
        instance.close().then(() => process.exit(0)).catch(() => process.exit(1));
      };
      process.once('SIGTERM', onSignal);
      process.once('SIGINT', onSignal);
      process.on('unhandledRejection', (reason) => {
        instance.logger.error('process.unhandled_rejection', { error: reason });
      });
      process.stdout.write(
        `\n  Supervision console: http://127.0.0.1:${instance.port}/\n\n`,
      );
    })
    .catch((error) => {
      process.stderr.write(`agent service failed to start: ${error?.message}\n`);
      process.exit(1);
    });
}

/**
 * HTTP surface for the supervised agent service.
 *
 *   POST /agent/ask                    ask the assistant; may create proposals
 *   GET  /agent/proposals              list proposals for the tenant
 *   GET  /agent/proposals/:id
 *   POST /agent/proposals/:id/approve  human approval; mints a one-use token
 *   POST /agent/proposals/:id/reject
 *   POST /agent/execute                execute with an approval token
 *   GET  /agent/audit                  the hash-chained ledger
 *   GET  /agent/audit/verify           chain integrity + supervision invariant
 *   GET  /agent/tools                  the allow-list, as the agent sees it
 *   GET  /agent/fleet                  demo fleet data
 *   GET  /healthz, /readyz, /metrics
 *   GET  /                             the demonstration UI
 *
 * Approval and execution are separate endpoints on purpose. They are
 * different acts by different principals with different authority, and
 * collapsing them would remove the gate this whole service exists to show.
 */

import { randomUUID, timingSafeEqual } from 'node:crypto';
import { ApprovalError, ProposalStatus } from './proposals.js';
import { ToolClass } from './tools/registry.js';
import { renderUi } from './ui.js';

const JSON_TYPE = 'application/json; charset=utf-8';
const MAX_BODY_BYTES = 64 * 1024;

function sendJson(res, status, body, headers = {}) {
  if (res.writableEnded || res.headersSent) {
    if (!res.writableEnded) res.end();
    return;
  }
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': JSON_TYPE,
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...headers,
  });
  res.end(payload);
}

function errorBody(code, message, requestId) {
  return { code, message, requestId };
}

/** Reads a bounded JSON request body. */
async function readJsonBody(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error('REQUEST_BODY_TOO_LARGE');
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  const text = Buffer.concat(chunks).toString('utf8');
  try {
    const parsed = JSON.parse(text);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('BODY_NOT_OBJECT');
    }
    return parsed;
  } catch (error) {
    throw new Error(error.message === 'BODY_NOT_OBJECT' ? 'BODY_NOT_OBJECT' : 'BODY_NOT_JSON');
  }
}

function parseRoutePath(target, host) {
  try {
    const base = typeof host === 'string' && host !== '' ? host : 'localhost';
    return new URL(target ?? '/', `http://${base}`).pathname;
  } catch {
    try {
      return new URL(target ?? '/', 'http://localhost').pathname;
    } catch {
      return null;
    }
  }
}

/**
 * @param {object} deps
 * @param {import('./orchestrator.js').AgentOrchestrator} deps.orchestrator
 * @param {import('./proposals.js').ProposalService} deps.proposals
 * @param {import('./execution.js').ExecutionService} deps.execution
 * @param {import('./audit.js').AuditLedger} deps.audit
 * @param {import('./tools/registry.js').ToolRegistry} deps.registry
 * @param {import('./fleet-store.js').FleetStore} deps.fleet
 * @param {import('../best-offers/logger.js').Logger} deps.logger
 * @param {object} deps.metrics
 * @param {object} deps.config
 * @param {string} deps.defaultTenantId
 * @param {() => boolean} [deps.isReady]
 * @param {AbortSignal} [deps.shutdownSignal]
 */
export function createAgentApp({
  orchestrator,
  proposals,
  execution,
  audit,
  registry,
  fleet,
  logger,
  metrics,
  config,
  defaultTenantId,
  isReady = () => true,
  shutdownSignal,
}) {
  let inFlight = 0;

  return async function handle(req, res) {
    const startedAt = process.hrtime.bigint();
    const headerId = req.headers['x-request-id'];
    const requestId =
      typeof headerId === 'string' && /^[\w.:-]{1,128}$/.test(headerId) ? headerId : randomUUID();
    res.setHeader('x-request-id', requestId);

    const route = parseRoutePath(req.url, req.headers.host);
    const requestLogger = logger.child({ requestId });

    res.on('finish', () => {
      const seconds = Number(process.hrtime.bigint() - startedAt) / 1e9;
      const label = routeLabel(route);
      metrics.httpRequests.inc({ route: label, method: req.method ?? 'GET', status: res.statusCode });
      metrics.httpDuration.observe(seconds, { route: label, method: req.method ?? 'GET' });
    });

    try {
      if (route === null) {
        sendJson(res, 400, errorBody('BAD_REQUEST', 'Malformed request target', requestId));
        return;
      }

      // ---- operational endpoints -------------------------------------
      if (route === '/healthz') {
        sendJson(res, 200, { status: 'ok' });
        return;
      }
      if (route === '/readyz') {
        const ready = isReady();
        sendJson(res, ready ? 200 : 503, {
          status: ready ? 'ready' : 'not-ready',
          modelBackend: orchestrator.model.name,
          model: orchestrator.model.model,
        });
        return;
      }
      if (route === '/metrics') {
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

      // ---- the demonstration UI ---------------------------------------
      if (route === '/' || route === '/index.html') {
        const html = renderUi({
          modelBackend: orchestrator.model.name,
          model: orchestrator.model.model,
          tenantId: defaultTenantId,
        });
        res.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'content-length': Buffer.byteLength(html),
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
        });
        res.end(html);
        return;
      }

      // ---- read-only inspection ---------------------------------------
      if (route === '/agent/tools' && req.method === 'GET') {
        sendJson(res, 200, {
          // Exactly what the agent can see. The absence of an execute-class
          // tool here is the point, so it is reported explicitly.
          agentVisible: registry.forAgent().map((tool) => ({
            name: tool.name,
            version: tool.version,
            classification: tool.classification,
            description: tool.description,
            tenantScoped: tool.tenantScoped,
            consentPurposes: tool.consentPurposes,
          })),
          executeClassToolsVisibleToAgent: registry
            .forAgent()
            .filter((tool) => tool.classification === ToolClass.EXECUTE).length,
          vehicleActuationCapability: 'absent - no such tool exists in any environment',
        });
        return;
      }

      if (route === '/agent/fleet' && req.method === 'GET') {
        sendJson(res, 200, {
          tenantId: defaultTenantId,
          vehicles: fleet.listVehicles(defaultTenantId),
          workOrders: fleet.listWorkOrders(defaultTenantId),
        });
        return;
      }

      if (route === '/agent/audit' && req.method === 'GET') {
        sendJson(res, 200, { entries: audit.list({ limit: 500 }) });
        return;
      }

      if (route === '/agent/audit/verify' && req.method === 'GET') {
        const chain = audit.verify();
        const supervision = audit.verifySupervisionInvariant();
        sendJson(res, 200, {
          chain,
          supervision: {
            ...supervision,
            statement: 'Every ACTION_EXECUTED entry has a prior PROPOSAL_APPROVED for the same proposal.',
          },
        });
        return;
      }

      if (route === '/agent/proposals' && req.method === 'GET') {
        sendJson(res, 200, { proposals: proposals.list({ tenantId: defaultTenantId }) });
        return;
      }

      const proposalMatch = /^\/agent\/proposals\/([\w-]{1,64})(\/approve|\/reject)?$/.exec(route);
      if (proposalMatch) {
        const [, proposalId, action] = proposalMatch;

        if (!action && req.method === 'GET') {
          const proposal = proposals.get(proposalId);
          if (!proposal) {
            sendJson(res, 404, errorBody('PROPOSAL_NOT_FOUND', 'No such proposal', requestId));
            return;
          }
          sendJson(res, 200, { proposal });
          return;
        }

        if (action && req.method === 'POST') {
          const body = await readJsonBody(req);
          try {
            if (action === '/approve') {
              const { proposal, token } = proposals.approve({
                proposalId,
                approver: String(body.approver ?? '').trim(),
                valuesDigest: String(body.valuesDigest ?? ''),
                reauthenticated: body.reauthenticated !== false,
              });
              requestLogger.info('agent.proposal_approved', { proposalId, approver: proposal.decidedBy });
              metrics.proposalsDecided.inc({ outcome: 'approved' });
              sendJson(res, 200, {
                proposal,
                approvalToken: token,
                note: 'Single-use token. Nothing has happened yet: POST /agent/execute to carry it out.',
              });
              return;
            }
            const proposal = proposals.reject({
              proposalId,
              approver: String(body.approver ?? '').trim(),
              reason: String(body.reason ?? ''),
            });
            metrics.proposalsDecided.inc({ outcome: 'rejected' });
            sendJson(res, 200, { proposal });
            return;
          } catch (error) {
            if (error instanceof ApprovalError) {
              metrics.proposalsDecided.inc({ outcome: 'refused' });
              sendJson(res, 409, errorBody(error.code, error.message, requestId));
              return;
            }
            throw error;
          }
        }

        sendJson(res, 405, errorBody('METHOD_NOT_ALLOWED', 'Unsupported method', requestId), {
          allow: action ? 'POST' : 'GET',
        });
        return;
      }

      // ---- execution ---------------------------------------------------
      if (route === '/agent/execute') {
        if (req.method !== 'POST') {
          sendJson(res, 405, errorBody('METHOD_NOT_ALLOWED', 'Use POST', requestId), { allow: 'POST' });
          return;
        }
        const body = await readJsonBody(req);
        try {
          const proposal = execution.execute({
            token: String(body.approvalToken ?? ''),
            actor: String(body.actor ?? '').trim() || 'unknown',
          });
          metrics.actionsExecuted.inc({ kind: proposal.kind });
          requestLogger.info('agent.action_executed', {
            proposalId: proposal.proposalId,
            kind: proposal.kind,
          });
          sendJson(res, 200, { proposal });
          return;
        } catch (error) {
          if (error instanceof ApprovalError) {
            metrics.executionsRefused.inc({ code: error.code });
            sendJson(res, 409, errorBody(error.code, error.message, requestId));
            return;
          }
          throw error;
        }
      }

      // ---- ask the assistant -------------------------------------------
      if (route === '/agent/ask') {
        if (req.method !== 'POST') {
          sendJson(res, 405, errorBody('METHOD_NOT_ALLOWED', 'Use POST', requestId), { allow: 'POST' });
          return;
        }
        if (!isReady()) {
          sendJson(res, 503, errorBody('SHUTTING_DOWN', 'Service is not accepting requests', requestId), {
            'retry-after': '5',
          });
          return;
        }
        if (inFlight >= config.maxConcurrentRequests) {
          metrics.rejectedLoad.inc();
          sendJson(res, 503, errorBody('OVERLOADED', 'Service is busy', requestId), { 'retry-after': '1' });
          return;
        }

        const body = await readJsonBody(req);
        const message = typeof body.message === 'string' ? body.message.trim() : '';
        if (message === '' || message.length > 4000) {
          sendJson(
            res,
            400,
            errorBody('INVALID_MESSAGE', 'message must be a non-empty string of at most 4000 characters', requestId),
          );
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
          const result = await orchestrator.run({
            message,
            tenantId: defaultTenantId,
            consentPurposes: ['operations'],
            signal: controller.signal,
          });
          metrics.turns.inc({ outcome: 'completed' });
          metrics.proposalsCreated.inc({}, result.proposalIds.length);
          for (const refusal of result.refusals) metrics.toolRefusals.inc({ code: refusal.code });

          sendJson(res, 200, {
            ...result,
            proposals: result.proposalIds.map((id) => proposals.get(id)).filter(Boolean),
          });
          return;
        } catch (error) {
          if (controller.signal.aborted) {
            metrics.turns.inc({ outcome: 'aborted' });
            if (req.destroyed || res.writableEnded) return;
            sendJson(
              res,
              503,
              errorBody(
                deadlineExceeded ? 'REQUEST_TIMEOUT' : 'SHUTTING_DOWN',
                'The assistant did not finish in time',
                requestId,
              ),
              { 'retry-after': '2' },
            );
            return;
          }
          metrics.turns.inc({ outcome: 'failed' });
          throw error;
        } finally {
          clearTimeout(timer);
          req.off('close', onClose);
          shutdownSignal?.removeEventListener('abort', onShutdown);
          inFlight -= 1;
        }
      }

      sendJson(res, 404, errorBody('NOT_FOUND', 'Unknown route', requestId));
    } catch (error) {
      if (error?.message === 'REQUEST_BODY_TOO_LARGE') {
        sendJson(res, 413, errorBody('BODY_TOO_LARGE', 'Request body exceeds the limit', requestId));
        return;
      }
      if (error?.message === 'BODY_NOT_JSON' || error?.message === 'BODY_NOT_OBJECT') {
        sendJson(res, 400, errorBody('INVALID_BODY', 'Request body must be a JSON object', requestId));
        return;
      }
      requestLogger.error('agent.unhandled_error', { route, error });
      sendJson(res, 500, errorBody('INTERNAL_ERROR', 'Unexpected internal error', requestId));
    }
  };
}

function routeLabel(route) {
  if (route === null) return 'other';
  if (/^\/agent\/proposals\/[\w-]+\/approve$/.test(route)) return '/agent/proposals/:id/approve';
  if (/^\/agent\/proposals\/[\w-]+\/reject$/.test(route)) return '/agent/proposals/:id/reject';
  if (/^\/agent\/proposals\/[\w-]+$/.test(route)) return '/agent/proposals/:id';
  const known = [
    '/', '/index.html', '/agent/ask', '/agent/proposals', '/agent/execute',
    '/agent/audit', '/agent/audit/verify', '/agent/tools', '/agent/fleet',
    '/healthz', '/readyz', '/metrics',
  ];
  return known.includes(route) ? route : 'other';
}

export { parseRoutePath, ProposalStatus };

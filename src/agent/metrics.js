/**
 * Metric set for the agent service.
 *
 * The series that matter here are not latency and throughput but the
 * supervision signals: how many proposals were created, how they were
 * decided, how many tool calls were refused and why, and how many actions
 * were actually executed.
 */

import { Registry, Counter, Gauge, Histogram } from '../best-offers/metrics.js';

export function createAgentMetrics() {
  const registry = new Registry();
  return {
    registry,
    httpRequests: registry.register(
      new Counter('vh_agent_http_requests_total', 'HTTP requests by route, method and status.'),
    ),
    httpDuration: registry.register(
      new Histogram('vh_agent_http_request_duration_seconds', 'HTTP request duration in seconds.'),
    ),
    inFlight: registry.register(
      new Gauge('vh_agent_in_flight_requests', 'Agent turns currently being served.'),
    ),
    turns: registry.register(
      new Counter('vh_agent_turns_total', 'Conversation turns by outcome.'),
    ),
    proposalsCreated: registry.register(
      new Counter('vh_agent_proposals_created_total', 'Proposals created by the assistant.'),
    ),
    proposalsDecided: registry.register(
      new Counter('vh_agent_proposals_decided_total', 'Proposal decisions by outcome.'),
    ),
    actionsExecuted: registry.register(
      new Counter('vh_agent_actions_executed_total', 'Actions executed after human approval, by kind.'),
    ),
    executionsRefused: registry.register(
      new Counter('vh_agent_executions_refused_total', 'Execution attempts refused, by reason.'),
    ),
    toolRefusals: registry.register(
      new Counter('vh_agent_tool_refusals_total', 'Tool calls refused by the registry, by reason.'),
    ),
    rejectedLoad: registry.register(
      new Counter('vh_agent_rejected_load_total', 'Turns shed by the concurrency limiter.'),
    ),
    egressBlocked: registry.register(
      new Counter(
        'vh_agent_egress_blocked_total',
        'Model calls blocked because the payload contained a prohibited data class.',
      ),
    ),
  };
}

/**
 * Paths that the main suites reach around rather than through: refusal
 * branches, transport edge cases and the message shapes each model adapter
 * builds when a conversation already has tool results in it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { ProposalService, ApprovalError, ProposalStatus } from '../../src/agent/proposals.js';
import { ExecutionService } from '../../src/agent/execution.js';
import { AuditLedger } from '../../src/agent/audit.js';
import { FleetStore } from '../../src/agent/fleet-store.js';
import { ToolRegistry } from '../../src/agent/tools/registry.js';
import { createFleetTools } from '../../src/agent/tools/fleet-tools.js';
import { toOpenAiMessages } from '../../src/agent/model/openai.js';
import { postJson } from '../../src/agent/model/provider.js';

function build() {
  const clock = { now: () => Date.parse('2026-11-14T09:00:00Z') };
  const audit = new AuditLedger({ clock });
  const fleet = new FleetStore();
  const proposals = new ProposalService({ audit, clock, fourEyesThresholdMinor: 1000 });
  const execution = new ExecutionService({ proposals, audit, clock, fleet });
  const registry = new ToolRegistry();
  for (const tool of createFleetTools({ fleet, proposals })) registry.register(tool);
  return { proposals, execution, audit, fleet, registry };
}

const context = {
  tenantId: FleetStore.defaultTenantId,
  consentPurposes: ['operations'],
  conversationId: 'c1',
  agentPrincipal: 'agent:test',
};

function draft(proposals, overrides = {}) {
  return proposals.create({
    kind: 'maintenance_work_order',
    tenantId: FleetStore.defaultTenantId,
    summary: 'Work',
    rationale: 'Because the evidence says so.',
    values: { vehicleId: 'VH-4471', parts: [], labourHours: 1 },
    estimatedCostMinor: 50_000,
    currency: 'EUR',
    requestedBy: 'agent:test',
    ...overrides,
  });
}

test('service history is returned per vehicle and for the whole fleet', async () => {
  const { registry } = build();
  const one = await registry.invokeAsAgent(
    { name: 'get_service_history', input: { vehicleId: 'VH-4471' } },
    context,
  );
  assert.ok(one.history.length >= 2);
  assert.ok(one.history.every((entry) => entry.vehicleId === 'VH-4471'));

  const { fleet } = build();
  assert.ok(fleet.listServiceHistory(FleetStore.defaultTenantId).length > one.history.length);
  assert.deepEqual(fleet.listServiceHistory('no-such-tenant'), []);
});

test('parts lookup filters by description and part number', async () => {
  const { registry } = build();
  const all = await registry.invokeAsAgent({ name: 'lookup_parts', input: {} }, context);
  const brakes = await registry.invokeAsAgent({ name: 'lookup_parts', input: { search: 'brake' } }, context);
  const byNumber = await registry.invokeAsAgent({ name: 'lookup_parts', input: { search: 'HV-BMS' } }, context);
  assert.ok(brakes.parts.length > 0 && brakes.parts.length < all.parts.length);
  assert.equal(byNumber.parts.length, 1);
});

test('a detail lookup for an unknown vehicle reports not found rather than failing', async () => {
  const { registry } = build();
  const result = await registry.invokeAsAgent(
    { name: 'get_vehicle_detail', input: { vehicleId: 'ZZ-0000' } },
    context,
  );
  assert.deepEqual(result, { found: false });
});

test('proposing against a vehicle outside the fleet is refused', async () => {
  const { registry } = build();
  await assert.rejects(
    () =>
      registry.invokeAsAgent(
        {
          name: 'propose_maintenance_work_order',
          input: {
            vehicleId: 'ZZ-0000',
            summary: 'Work on a vehicle we do not own',
            rationale: 'There is no evidence for this because the vehicle is not ours.',
            parts: [],
            labourHours: 1,
          },
        },
        context,
      ),
    /is not in this fleet/,
  );
});

test('four-eyes refuses an approver who raised the proposal', () => {
  const { proposals } = build();
  const proposal = draft(proposals, {
    estimatedCostMinor: 500_000,
    values: { vehicleId: 'VH-4471', parts: [], labourHours: 1, raisedByOperator: 'j.berg' },
  });
  assert.equal(proposal.requiresFourEyes, true);
  assert.throws(
    () => proposals.approve({ proposalId: proposal.proposalId, approver: 'j.berg', valuesDigest: proposal.valuesDigest }),
    (error) => error instanceof ApprovalError && error.code === 'FOUR_EYES_REQUIRED',
  );
  // A different person may.
  const { token } = proposals.approve({ proposalId: proposal.proposalId, approver: 'm.lindqvist', valuesDigest: proposal.valuesDigest });
  assert.ok(token);
});

test('declining twice is refused, and declining an unknown proposal is refused', () => {
  const { proposals } = build();
  const proposal = draft(proposals);
  proposals.reject({ proposalId: proposal.proposalId, approver: 'alice', reason: 'no' });
  assert.throws(
    () => proposals.reject({ proposalId: proposal.proposalId, approver: 'alice', reason: 'again' }),
    (error) => error.code === 'PROPOSAL_NOT_PENDING',
  );
  assert.throws(
    () => proposals.reject({ proposalId: 'nope', approver: 'alice' }),
    (error) => error.code === 'PROPOSAL_NOT_FOUND',
  );
  assert.throws(() => proposals.approve({ proposalId: 'nope', approver: 'a', valuesDigest: 'x' }), (e) => e.code === 'PROPOSAL_NOT_FOUND');
  assert.equal(proposals.get('nope'), undefined);
});

test('a token for a proposal that was later declined cannot be redeemed', () => {
  const { proposals } = build();
  const proposal = draft(proposals);
  const { token } = proposals.approve({ proposalId: proposal.proposalId, approver: 'alice', valuesDigest: proposal.valuesDigest });
  // Force the proposal out of APPROVED behind the token's back.
  proposals.proposals.get(proposal.proposalId).status = ProposalStatus.REJECTED;
  assert.throws(() => proposals.redeemToken(token), (error) => error.code === 'PROPOSAL_NOT_APPROVED');
});

test('marking an unknown proposal executed is refused', () => {
  const { proposals } = build();
  assert.throws(() => proposals.markExecuted('nope', {}), (error) => error.code === 'PROPOSAL_NOT_FOUND');
});

test('execution refuses when the vehicle has left the fleet', () => {
  const { proposals, execution, fleet } = build();
  const proposal = draft(proposals);
  const { token } = proposals.approve({ proposalId: proposal.proposalId, approver: 'alice', valuesDigest: proposal.valuesDigest });
  // The vehicle is sold between approval and execution.
  fleet.vehicles.set(
    FleetStore.defaultTenantId,
    fleet.listVehicles(FleetStore.defaultTenantId).filter((v) => v.vehicleId !== 'VH-4471'),
  );
  assert.throws(() => execution.execute({ token, actor: 'alice' }), (error) => error.code === 'VEHICLE_NOT_FOUND');
});

test('proposals can be listed and filtered by status', () => {
  const { proposals } = build();
  const a = draft(proposals);
  const b = draft(proposals);
  proposals.reject({ proposalId: b.proposalId, approver: 'alice', reason: 'no' });
  assert.equal(proposals.list({ tenantId: FleetStore.defaultTenantId }).length, 2);
  assert.equal(proposals.list({ status: 'PENDING' }).length, 1);
  assert.equal(proposals.list({ status: 'PENDING' })[0].proposalId, a.proposalId);
  assert.equal(proposals.list({ tenantId: 'other' }).length, 0);
});

test('the OpenAI message mapper handles assistant tool calls and tool results', () => {
  const mapped = toOpenAiMessages([
    { role: 'user', content: 'hello' },
    { role: 'assistant', content: 'calling', toolCalls: [{ id: 'c1', name: 'list_vehicles', input: { a: 1 } }] },
    { role: 'assistant', content: 'no tools here' },
    { role: 'tool', toolCallId: 'c1', toolName: 'list_vehicles', content: '{"vehicles":[]}' },
  ]);

  assert.equal(mapped[0].role, 'user');
  assert.equal(mapped[1].tool_calls[0].function.name, 'list_vehicles');
  assert.equal(mapped[1].tool_calls[0].function.arguments, '{"a":1}');
  assert.equal(mapped[2].tool_calls, undefined, 'an assistant turn with no tool calls omits the field');
  assert.equal(mapped[3].role, 'tool');
  assert.equal(mapped[3].tool_call_id, 'c1');
});

test('postJson times out rather than hanging on a silent endpoint', async (t) => {
  const server = http.createServer(() => {
    /* never responds */
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  t.after(() => {
    server.closeAllConnections?.();
    server.close();
  });

  await assert.rejects(
    () => postJson(`http://127.0.0.1:${port}/`, { method: 'POST', body: '{}' }, 150),
    /timed out|aborted/i,
  );
});

test('postJson rejects a body that is not JSON without echoing it', async (t) => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('<html>a proxy error page containing secrets</html>');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  t.after(() => {
    server.closeAllConnections?.();
    server.close();
  });

  await assert.rejects(
    () => postJson(`http://127.0.0.1:${port}/`, { method: 'POST', body: '{}' }, 2000),
    (error) => /not valid JSON/.test(error.message) && !/secrets/.test(error.message),
  );
});

test('postJson propagates an external abort signal', async (t) => {
  const server = http.createServer(() => {});
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  t.after(() => {
    server.closeAllConnections?.();
    server.close();
  });

  const controller = new AbortController();
  const promise = postJson(`http://127.0.0.1:${port}/`, { method: 'POST', body: '{}' }, 5000, controller.signal);
  setTimeout(() => controller.abort(new Error('caller gave up')), 30);
  await assert.rejects(() => promise, /caller gave up/);
});

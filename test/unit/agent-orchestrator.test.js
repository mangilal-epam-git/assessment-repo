/**
 * Orchestrator tests with a scripted model, so the loop can be driven into
 * states a real model reaches only occasionally.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentOrchestrator, wrapUntrusted, SYSTEM_PROMPT, AGENT_PRINCIPAL } from '../../src/agent/orchestrator.js';
import { ToolRegistry, ToolClass } from '../../src/agent/tools/registry.js';
import { createFleetTools } from '../../src/agent/tools/fleet-tools.js';
import { AuditLedger, AuditEvent } from '../../src/agent/audit.js';
import { ProposalService } from '../../src/agent/proposals.js';
import { FleetStore } from '../../src/agent/fleet-store.js';

/** A model that replays a fixed script, so the loop is the thing under test. */
function scriptedModel(script) {
  let index = 0;
  const seen = [];
  return {
    name: 'scripted',
    model: 'scripted-1',
    requiresNetwork: false,
    seen,
    async complete(request) {
      seen.push(request);
      const step = script[Math.min(index, script.length - 1)];
      index += 1;
      return { text: '', toolCalls: [], model: 'scripted-1', ...step };
    },
  };
}

function build(model) {
  const clock = { now: () => Date.parse('2026-11-14T09:00:00Z') };
  const audit = new AuditLedger({ clock });
  const fleet = new FleetStore();
  const proposals = new ProposalService({ audit, clock });
  const registry = new ToolRegistry();
  for (const tool of createFleetTools({ fleet, proposals })) registry.register(tool);
  return {
    orchestrator: new AgentOrchestrator({ model, registry, audit, maxIterations: 6, maxToolCallsPerTurn: 2 }),
    audit,
    fleet,
    proposals,
    registry,
  };
}

const ask = { message: 'review the fleet', tenantId: FleetStore.defaultTenantId };

test('the model only ever sees read and propose tools', async () => {
  const model = scriptedModel([{ text: 'done' }]);
  const { orchestrator } = build(model);
  await orchestrator.run(ask);

  const offered = model.seen[0].tools.map((tool) => tool.name);
  assert.ok(offered.includes('list_vehicles'));
  assert.ok(offered.includes('propose_maintenance_work_order'));
  assert.equal(offered.length, 5);
  // Handlers are never exposed to the model.
  assert.ok(model.seen[0].tools.every((tool) => tool.handler === undefined));
});

test('the system prompt states the constraints the architecture enforces', () => {
  assert.match(SYSTEM_PROMPT, /You PROPOSE/);
  assert.match(SYSTEM_PROMPT, /never attempt to control, actuate/i);
  assert.match(SYSTEM_PROMPT, /UNTRUSTED\s+DATA/);
});

test('operator input is delimited as data', () => {
  const wrapped = wrapUntrusted('do something');
  assert.match(wrapped, /^<operator-request>/);
  assert.match(wrapped, /<\/operator-request>$/);
  assert.equal(wrapUntrusted('x'.repeat(9000)).length < 5000, true, 'input is truncated');
});

test('a refused tool call is fed back so the model can correct course', async () => {
  const model = scriptedModel([
    { toolCalls: [{ id: '1', name: 'actuate_vehicle', input: { vehicleId: 'VH-4471' } }] },
    { text: 'I cannot do that; here is what I found instead.' },
  ]);
  const { orchestrator, audit } = build(model);
  const result = await orchestrator.run(ask);

  assert.equal(result.refusals.length, 1);
  assert.equal(result.refusals[0].code, 'TOOL_NOT_ALLOWLISTED');
  assert.match(result.answer, /cannot do that/);

  // The refusal reached the model as a tool result, not as a crash.
  const followUp = model.seen[1].messages.at(-1);
  assert.equal(followUp.role, 'tool');
  assert.match(followUp.content, /TOOL_NOT_ALLOWLISTED/);
  assert.match(followUp.content, /cannot be granted this capability/);

  assert.ok(audit.entries.some((entry) => entry.type === AuditEvent.TOOL_CALL_REFUSED));
});

test('a malformed tool call is refused rather than coerced', async () => {
  const model = scriptedModel([
    { toolCalls: [{ id: '1', name: 'get_vehicle_detail', input: { vehicleId: 'DROP TABLE', autoApprove: true } }] },
    { text: 'corrected' },
  ]);
  const { orchestrator } = build(model);
  const result = await orchestrator.run(ask);
  assert.equal(result.refusals[0].code, 'INPUT_SCHEMA_VIOLATION');
  assert.ok(result.refusals[0].problems.length > 0);
});

test('the loop is bounded, so a looping model cannot run forever', async () => {
  // A model that always asks for the same tool.
  const model = scriptedModel([{ toolCalls: [{ id: 'x', name: 'list_vehicles', input: {} }] }]);
  const { orchestrator } = build(model);
  const result = await orchestrator.run(ask);
  assert.equal(model.seen.length, 6, 'maxIterations should cap the loop');
  assert.ok(result.answer.length > 0);
});

test('tool calls per turn are capped', async () => {
  const model = scriptedModel([
    {
      toolCalls: [
        { id: '1', name: 'list_vehicles', input: {} },
        { id: '2', name: 'lookup_parts', input: {} },
        { id: '3', name: 'lookup_parts', input: {} },
        { id: '4', name: 'lookup_parts', input: {} },
      ],
    },
    { text: 'ok' },
  ]);
  const { orchestrator } = build(model);
  const result = await orchestrator.run(ask);
  assert.equal(result.steps.filter((step) => step.type === 'tool').length, 2, 'maxToolCallsPerTurn should cap it');
});

test('a created proposal is reported and audited with model attribution', async () => {
  const model = scriptedModel([
    {
      toolCalls: [
        {
          id: '1',
          name: 'propose_maintenance_work_order',
          input: {
            vehicleId: 'VH-4471',
            summary: 'Replace brake light switch',
            rationale: 'P0571 observed repeatedly with high severity over two weeks.',
            parts: [{ partNumber: 'BRK-SW-UNIV', quantity: 1 }],
            labourHours: 2,
          },
        },
      ],
    },
    { text: 'Drafted for approval.' },
  ]);
  const { orchestrator, audit, proposals, fleet } = build(model);
  const result = await orchestrator.run(ask);

  assert.equal(result.proposalIds.length, 1);
  const stored = proposals.get(result.proposalIds[0]);
  assert.equal(stored.status, 'PENDING');
  assert.equal(stored.requestedBy, AGENT_PRINCIPAL);
  assert.deepEqual(stored.modelAttribution, { backend: 'scripted', model: 'scripted-1' });
  assert.deepEqual(fleet.listWorkOrders(FleetStore.defaultTenantId), [], 'proposing creates no work order');

  const created = audit.entries.find((entry) => entry.type === AuditEvent.PROPOSAL_CREATED);
  assert.equal(created.actor, AGENT_PRINCIPAL);
  assert.ok(created.detail.valuesDigest);
});

test('a conversation is traceable end to end in the ledger', async () => {
  const model = scriptedModel([
    { toolCalls: [{ id: '1', name: 'list_vehicles', input: {} }] },
    { text: 'Three vehicles.' },
  ]);
  const { orchestrator, audit } = build(model);
  const result = await orchestrator.run(ask);

  const forConversation = audit.list({ correlationId: result.conversationId });
  assert.ok(forConversation.length >= 4);
  assert.equal(forConversation[0].type, AuditEvent.CONVERSATION_STARTED);
  assert.equal(audit.verify().valid, true);
});

test('an aborted turn stops promptly', async () => {
  const controller = new AbortController();
  const model = {
    name: 'slow',
    model: 'slow-1',
    requiresNetwork: false,
    complete: () => new Promise((_resolve, reject) => {
      setTimeout(() => reject(new Error('should have been aborted')), 5000).unref?.();
      controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true });
    }),
  };
  const { orchestrator } = build(model);
  const promise = orchestrator.run({ ...ask, signal: controller.signal });
  setTimeout(() => controller.abort(new Error('cancelled')), 20);
  await assert.rejects(() => promise, /cancelled/);
});

test('an execute-class tool is unreachable even when the model names it', async () => {
  const model = scriptedModel([
    { toolCalls: [{ id: '1', name: 'hidden_execute', input: {} }] },
    { text: 'refused' },
  ]);
  const { orchestrator, registry } = build(model);
  let ran = false;
  registry.register({
    name: 'hidden_execute',
    version: '1.0.0',
    description: 'should be unreachable',
    classification: ToolClass.EXECUTE,
    inputSchema: { type: 'object', properties: {}, required: [] },
    outputSchema: { type: 'object', properties: {}, required: [] },
    tenantScoped: false,
    consentPurposes: [],
    handler: async () => {
      ran = true;
      return {};
    },
  });

  const result = await orchestrator.run(ask);
  assert.equal(ran, false, 'the execute handler must never run');
  assert.equal(result.refusals[0].code, 'EXECUTE_CLASS_FORBIDDEN');
});

test('the final answer is not repeated as a transcript step', async () => {
  const model = scriptedModel([
    { toolCalls: [{ id: '1', name: 'list_vehicles', input: {} }], text: 'Surveying the fleet.' },
    { text: 'Here is what I found.' },
  ]);
  const { orchestrator } = build(model);
  const result = await orchestrator.run(ask);

  assert.equal(result.answer, 'Here is what I found.');
  const thinking = result.steps.filter((step) => step.type === 'thinking').map((step) => step.text);
  assert.deepEqual(thinking, ['Surveying the fleet.'], 'the closing text belongs to the answer, not the trace');
});

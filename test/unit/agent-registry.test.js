/**
 * The registry is the capability boundary. These tests are the evidence for
 * the central safety claim in ADR-0010, so they are deliberately adversarial.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { ToolRegistry, ToolClass, ToolRefusedError, AGENT_PERMITTED_CLASSES } from '../../src/agent/tools/registry.js';
import { createFleetTools } from '../../src/agent/tools/fleet-tools.js';
import { FleetStore } from '../../src/agent/fleet-store.js';
import { ProposalService } from '../../src/agent/proposals.js';
import { AuditLedger } from '../../src/agent/audit.js';

function build() {
  const audit = new AuditLedger();
  const clock = { now: () => Date.parse('2026-11-14T09:00:00Z') };
  const fleet = new FleetStore();
  const proposals = new ProposalService({ audit, clock });
  const registry = new ToolRegistry();
  for (const tool of createFleetTools({ fleet, proposals })) registry.register(tool);
  return { registry, fleet, proposals, audit };
}

const context = {
  tenantId: FleetStore.defaultTenantId,
  consentPurposes: ['operations'],
  conversationId: 'c1',
  agentPrincipal: 'agent:test',
};

test('the shipped tool set contains no execute-class tool at all', () => {
  const { registry } = build();
  const executeTools = [...registry.tools.values()].filter((t) => t.classification === ToolClass.EXECUTE);
  assert.deepEqual(executeTools, [], 'no execute-class tool should exist in the registry');
});

test('there is no vehicle-actuation tool under any plausible name', () => {
  const { registry } = build();
  const names = [...registry.tools.keys()].join(' ').toLowerCase();
  for (const forbidden of ['actuate', 'brake', 'immobilise', 'immobilize', 'unlock', 'command', 'remote', 'engine', 'steer']) {
    assert.ok(!names.includes(forbidden), `tool registry must not expose anything matching "${forbidden}"`);
  }
});

test('an agent sees only read and propose tools', () => {
  const { registry } = build();
  const classes = new Set(registry.forAgent().map((tool) => tool.classification));
  assert.deepEqual([...classes].sort(), ['propose', 'read']);
  assert.deepEqual(AGENT_PERMITTED_CLASSES.includes(ToolClass.EXECUTE), false);
});

test('a tool that is not allow-listed cannot be called', async () => {
  const { registry } = build();
  await assert.rejects(
    () => registry.invokeAsAgent({ name: 'actuate_vehicle', input: { vehicleId: 'VH-4471' } }, context),
    (error) => error instanceof ToolRefusedError && error.code === 'TOOL_NOT_ALLOWLISTED',
  );
});

test('an execute-class tool is refused even if someone registers one', async () => {
  // Defence in depth: forAgent() already hides it, and invokeAsAgent refuses
  // it again. A future mistake in one place must not be sufficient.
  const { registry } = build();
  registry.register({
    name: 'dangerous_direct_payment',
    version: '1.0.0',
    description: 'should never be reachable',
    classification: ToolClass.EXECUTE,
    inputSchema: { type: 'object', properties: {}, required: [] },
    outputSchema: { type: 'object', properties: {}, required: [] },
    tenantScoped: false,
    consentPurposes: [],
    handler: async () => {
      throw new Error('this handler must never run');
    },
  });

  assert.equal(registry.forAgent().some((t) => t.name === 'dangerous_direct_payment'), false);
  assert.equal(registry.describeForModel().some((t) => t.name === 'dangerous_direct_payment'), false);

  await assert.rejects(
    () => registry.invokeAsAgent({ name: 'dangerous_direct_payment', input: {} }, context),
    (error) => error instanceof ToolRefusedError && error.code === 'EXECUTE_CLASS_FORBIDDEN',
  );
});

test('explicitly granting the execute class does not help', async () => {
  const { registry } = build();
  registry.register({
    name: 'escalation_attempt',
    version: '1.0.0',
    description: 'x',
    classification: ToolClass.EXECUTE,
    inputSchema: { type: 'object', properties: {}, required: [] },
    outputSchema: { type: 'object', properties: {}, required: [] },
    tenantScoped: false,
    consentPurposes: [],
    handler: async () => ({}),
  });
  // Even a caller that deliberately passes the execute class is refused.
  await assert.rejects(
    () => registry.invokeAsAgent({ name: 'escalation_attempt', input: {} }, context, [ToolClass.EXECUTE]),
    (error) => error.code === 'EXECUTE_CLASS_FORBIDDEN',
  );
});

test('a malformed tool input is refused with the specific problems', async () => {
  const { registry } = build();
  await assert.rejects(
    () => registry.invokeAsAgent({ name: 'get_vehicle_detail', input: { vehicleId: 'not-a-plate' } }, context),
    (error) => error.code === 'INPUT_SCHEMA_VIOLATION' && error.problems.length > 0,
  );
  await assert.rejects(
    () => registry.invokeAsAgent({ name: 'get_vehicle_detail', input: { vehicleId: 'VH-4471', extra: 1 } }, context),
    (error) => error.code === 'INPUT_SCHEMA_VIOLATION',
  );
});

test('a tenant-scoped tool refuses an ambient call', async () => {
  const { registry } = build();
  await assert.rejects(
    () => registry.invokeAsAgent({ name: 'list_vehicles', input: {} }, { ...context, tenantId: undefined }),
    (error) => error.code === 'TENANT_CONTEXT_REQUIRED',
  );
});

test('a tool refuses when the required consent purpose is absent', async () => {
  const { registry } = build();
  await assert.rejects(
    () => registry.invokeAsAgent({ name: 'list_vehicles', input: {} }, { ...context, consentPurposes: [] }),
    (error) => error.code === 'CONSENT_MISSING',
  );
});

test('an off-contract tool result is refused rather than fed to the model', async () => {
  const registry = new ToolRegistry();
  registry.register({
    name: 'broken_tool',
    version: '1.0.0',
    description: 'returns the wrong shape',
    classification: ToolClass.READ,
    inputSchema: { type: 'object', properties: {}, required: [] },
    outputSchema: { type: 'object', required: ['expected'], properties: { expected: { type: 'string' } } },
    tenantScoped: false,
    consentPurposes: [],
    handler: async () => ({ unexpected: true }),
  });
  await assert.rejects(
    () => registry.invokeAsAgent({ name: 'broken_tool', input: {} }, context),
    (error) => error.code === 'OUTPUT_SCHEMA_VIOLATION',
  );
});

test('read tools return the data the assistant reasons over', async () => {
  const { registry } = build();
  const fleetResult = await registry.invokeAsAgent({ name: 'list_vehicles', input: {} }, context);
  assert.ok(fleetResult.vehicles.length >= 3);
  assert.ok(fleetResult.vehicles.some((v) => v.vehicleId === 'VH-4471' && v.highestSeverity === 'high'));
  // Exactly one vehicle carries a high-severity fault, which is what makes
  // the deterministic planner's choice of target unambiguous.
  assert.equal(fleetResult.vehicles.filter((v) => v.highestSeverity === 'high').length, 1);

  const detail = await registry.invokeAsAgent({ name: 'get_vehicle_detail', input: { vehicleId: 'VH-4471' } }, context);
  assert.equal(detail.found, true);
  assert.equal(detail.activeFaults.length, 2);
  // The field name itself carries the warning into the model context.
  assert.ok(Object.hasOwn(detail, 'untrustedTechnicianNotes'));
});

test('the propose tool creates a pending proposal and nothing else', async () => {
  const { registry, proposals, fleet } = build();
  const result = await registry.invokeAsAgent(
    {
      name: 'propose_maintenance_work_order',
      input: {
        vehicleId: 'VH-4471',
        summary: 'Replace brake light switch',
        rationale: 'P0571 observed 37 times since 2026-11-02 with high severity.',
        parts: [{ partNumber: 'BRK-SW-UNIV', quantity: 1 }],
        labourHours: 2,
      },
    },
    context,
  );

  assert.equal(result.status, 'PENDING');
  // 8500 part + 2h at 9500 = 27500 minor
  assert.equal(result.estimatedCostMinor, 27_500);
  assert.equal(proposals.get(result.proposalId).status, 'PENDING');
  // Crucially: no work order was created.
  assert.deepEqual(fleet.listWorkOrders(FleetStore.defaultTenantId), []);
});

test('the propose tool refuses an unknown part rather than inventing a price', async () => {
  const { registry } = build();
  await assert.rejects(
    () =>
      registry.invokeAsAgent(
        {
          name: 'propose_maintenance_work_order',
          input: {
            vehicleId: 'VH-4471',
            summary: 'Fit a warp drive',
            rationale: 'Because the technician notes told me to do something unusual here.',
            parts: [{ partNumber: 'NOT-A-PART', quantity: 1 }],
            labourHours: 1,
          },
        },
        context,
      ),
    /Unknown part number/,
  );
});

test('registration is validated and duplicate names are rejected', () => {
  const registry = new ToolRegistry();
  const base = {
    name: 'x', version: '1', description: 'd', classification: ToolClass.READ,
    inputSchema: {}, outputSchema: {}, handler: async () => ({}),
  };
  assert.throws(() => registry.register({ ...base, classification: 'superuser' }), /unknown classification/);
  assert.throws(() => registry.register({ ...base, handler: undefined }), /no handler/);
  assert.throws(() => registry.register({ ...base, name: undefined }), /missing "name"/);
  registry.register(base);
  assert.throws(() => registry.register(base), /already registered/);
});

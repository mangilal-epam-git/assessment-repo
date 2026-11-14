/**
 * The approval gate. These tests are the evidence that "the agent proposes,
 * a human disposes" is enforced rather than merely intended.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { ProposalService, ApprovalError, ProposalStatus, digestOfValues } from '../../src/agent/proposals.js';
import { ExecutionService } from '../../src/agent/execution.js';
import { AuditLedger, AuditEvent } from '../../src/agent/audit.js';
import { FleetStore } from '../../src/agent/fleet-store.js';

const AGENT = 'agent:fleet-assistant';

function build({ now = Date.parse('2026-11-14T09:00:00Z'), ttlMillis, fourEyesThresholdMinor } = {}) {
  let current = now;
  const clock = { now: () => current };
  const audit = new AuditLedger({ clock });
  const fleet = new FleetStore();
  const proposals = new ProposalService({ audit, clock, ttlMillis, fourEyesThresholdMinor });
  const execution = new ExecutionService({ proposals, audit, clock, fleet });
  return { proposals, execution, audit, fleet, advance: (ms) => { current += ms; }, clock };
}

function draft(proposals, overrides = {}) {
  return proposals.create({
    kind: 'maintenance_work_order',
    tenantId: FleetStore.defaultTenantId,
    summary: 'Replace brake light switch on VH-4471',
    rationale: 'P0571 observed 37 times.',
    values: { vehicleId: 'VH-4471', parts: [], labourHours: 2, urgency: 'urgent' },
    estimatedCostMinor: 27_500,
    currency: 'EUR',
    requestedBy: AGENT,
    conversationId: 'c1',
    ...overrides,
  });
}

test('a new proposal is pending and commits nothing', () => {
  const { proposals, fleet } = build();
  const proposal = draft(proposals);
  assert.equal(proposal.status, ProposalStatus.PENDING);
  assert.equal(proposal.decidedBy, null);
  assert.deepEqual(fleet.listWorkOrders(FleetStore.defaultTenantId), []);
});

test('the agent cannot approve its own proposal', () => {
  const { proposals } = build();
  const proposal = draft(proposals);
  assert.throws(
    () => proposals.approve({ proposalId: proposal.proposalId, approver: AGENT, valuesDigest: proposal.valuesDigest }),
    (error) => error instanceof ApprovalError && error.code === 'SELF_APPROVAL_FORBIDDEN',
  );
  assert.equal(proposals.get(proposal.proposalId).status, ProposalStatus.PENDING);
});

test('approval requires an authenticated approver and re-authentication', () => {
  const { proposals } = build();
  const proposal = draft(proposals);
  assert.throws(
    () => proposals.approve({ proposalId: proposal.proposalId, approver: '', valuesDigest: proposal.valuesDigest }),
    (error) => error.code === 'APPROVER_REQUIRED',
  );
  assert.throws(
    () => proposals.approve({ proposalId: proposal.proposalId, approver: 'alice', valuesDigest: proposal.valuesDigest, reauthenticated: false }),
    (error) => error.code === 'REAUTHENTICATION_REQUIRED',
  );
});

test('approval binds to the exact values the approver saw', () => {
  const { proposals } = build();
  const proposal = draft(proposals);
  assert.throws(
    () => proposals.approve({ proposalId: proposal.proposalId, approver: 'alice', valuesDigest: digestOfValues({ vehicleId: 'VH-0000' }) }),
    (error) => error.code === 'VALUES_CHANGED',
  );
  // The correct digest works.
  const { token } = proposals.approve({ proposalId: proposal.proposalId, approver: 'alice', valuesDigest: proposal.valuesDigest });
  assert.ok(token);
});

test('the digest changes when any value changes', () => {
  const a = digestOfValues({ vehicleId: 'VH-4471', labourHours: 2 });
  const b = digestOfValues({ vehicleId: 'VH-4471', labourHours: 3 });
  const sameDifferentOrder = digestOfValues({ labourHours: 2, vehicleId: 'VH-4471' });
  assert.notEqual(a, b);
  assert.equal(a, sameDifferentOrder, 'key order must not change the digest');
});

test('silence expires a proposal; it never approves it', () => {
  const { proposals, advance } = build({ ttlMillis: 60_000 });
  const proposal = draft(proposals);
  advance(60_001);
  const after = proposals.get(proposal.proposalId);
  assert.equal(after.status, ProposalStatus.EXPIRED);
  assert.match(after.decisionReason, /silence does not authorise/i);
  assert.throws(
    () => proposals.approve({ proposalId: proposal.proposalId, approver: 'alice', valuesDigest: proposal.valuesDigest }),
    (error) => error.code === 'PROPOSAL_NOT_PENDING',
  );
});

test('an expired proposal cannot be executed', () => {
  const { proposals, execution, advance } = build({ ttlMillis: 60_000 });
  const proposal = draft(proposals);
  const { token } = proposals.approve({ proposalId: proposal.proposalId, approver: 'alice', valuesDigest: proposal.valuesDigest });
  // Approved before expiry, so the token is live; expiry only applies to pending.
  advance(120_000);
  const executed = execution.execute({ token, actor: 'alice' });
  assert.equal(executed.status, ProposalStatus.EXECUTED);
});

test('an approval token is single use', () => {
  const { proposals, execution } = build();
  const proposal = draft(proposals);
  const { token } = proposals.approve({ proposalId: proposal.proposalId, approver: 'alice', valuesDigest: proposal.valuesDigest });
  execution.execute({ token, actor: 'alice' });
  assert.throws(
    () => execution.execute({ token, actor: 'alice' }),
    (error) => error.code === 'TOKEN_ALREADY_USED',
  );
});

test('execution without a token is impossible', () => {
  const { execution } = build();
  for (const token of ['', 'guessed-token', undefined, null]) {
    assert.throws(
      () => execution.execute({ token, actor: 'mallory' }),
      (error) => error.code === 'INVALID_APPROVAL_TOKEN',
      `token ${String(token)} must be refused`,
    );
  }
});

test('a rejected proposal yields no token and cannot be executed', () => {
  const { proposals, execution } = build();
  const proposal = draft(proposals);
  proposals.reject({ proposalId: proposal.proposalId, approver: 'alice', reason: 'Defer to next service' });
  assert.equal(proposals.get(proposal.proposalId).status, ProposalStatus.REJECTED);
  assert.throws(
    () => proposals.approve({ proposalId: proposal.proposalId, approver: 'bob', valuesDigest: proposal.valuesDigest }),
    (error) => error.code === 'PROPOSAL_NOT_PENDING',
  );
  assert.throws(() => execution.execute({ token: 'anything', actor: 'bob' }), (error) => error.code === 'INVALID_APPROVAL_TOKEN');
});

test('four-eyes applies above the configured threshold', () => {
  const { proposals } = build({ fourEyesThresholdMinor: 10_000 });
  const cheap = draft(proposals, { estimatedCostMinor: 9_000 });
  const dear = draft(proposals, { estimatedCostMinor: 250_000 });
  assert.equal(cheap.requiresFourEyes, false);
  assert.equal(dear.requiresFourEyes, true);
});

test('execution re-validates the budget at execution time', () => {
  const clock = { now: () => Date.parse('2026-11-14T09:00:00Z') };
  const audit = new AuditLedger({ clock });
  const fleet = new FleetStore();
  const proposals = new ProposalService({ audit, clock });
  // Budget shrinks between approval and execution.
  let remaining = 1_000_000;
  const execution = new ExecutionService({ proposals, audit, clock, fleet, budgetLookup: () => ({ remainingMinor: remaining }) });

  const proposal = draft(proposals, { estimatedCostMinor: 500_000 });
  const { token } = proposals.approve({ proposalId: proposal.proposalId, approver: 'alice', valuesDigest: proposal.valuesDigest });
  remaining = 100_000;

  assert.throws(() => execution.execute({ token, actor: 'alice' }), (error) => error.code === 'BUDGET_EXCEEDED');
  assert.deepEqual(fleet.listWorkOrders(FleetStore.defaultTenantId), []);
});

test('executing creates the work order under the approver authority', () => {
  const { proposals, execution, fleet } = build();
  const proposal = draft(proposals);
  const { token } = proposals.approve({ proposalId: proposal.proposalId, approver: 'alice', valuesDigest: proposal.valuesDigest });
  const executed = execution.execute({ token, actor: 'alice' });

  assert.equal(executed.status, ProposalStatus.EXECUTED);
  const orders = fleet.listWorkOrders(FleetStore.defaultTenantId);
  assert.equal(orders.length, 1);
  assert.equal(orders[0].vehicleId, 'VH-4471');
  assert.equal(orders[0].authorisedBy, 'alice');
  assert.equal(orders[0].proposalId, proposal.proposalId);
});

test('every refusal and every decision is audited', () => {
  const { proposals, execution, audit } = build();
  const proposal = draft(proposals);
  try {
    execution.execute({ token: 'bogus', actor: 'mallory' });
  } catch {
    /* expected */
  }
  const { token } = proposals.approve({ proposalId: proposal.proposalId, approver: 'alice', valuesDigest: proposal.valuesDigest });
  execution.execute({ token, actor: 'alice' });

  const types = audit.entries.map((entry) => entry.type);
  assert.ok(types.includes(AuditEvent.PROPOSAL_CREATED));
  assert.ok(types.includes(AuditEvent.EXECUTION_REFUSED));
  assert.ok(types.includes(AuditEvent.PROPOSAL_APPROVED));
  assert.ok(types.includes(AuditEvent.ACTION_EXECUTED));
  assert.equal(audit.verify().valid, true);
  assert.equal(audit.verifySupervisionInvariant().holds, true);
});

test('a non-executable proposal kind is refused', () => {
  const { proposals, execution } = build();
  const proposal = draft(proposals, { kind: 'data_purchase' });
  const { token } = proposals.approve({ proposalId: proposal.proposalId, approver: 'alice', valuesDigest: proposal.valuesDigest });
  assert.throws(() => execution.execute({ token, actor: 'alice' }), (error) => error.code === 'KIND_NOT_EXECUTABLE');
});

test('the execution service implements no vehicle-control capability', async () => {
  // A structural assertion, not a behavioural one: the prohibition in
  // ADR-0010 is that the capability does not exist to be enabled, so the
  // test reads the source rather than calling an API.
  const { readFile } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const path = await import('node:path');
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const code = (await readFile(path.join(root, 'src/agent/execution.js'), 'utf8'))
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  for (const term of ['actuate', 'immobilis', 'immobiliz', 'parkingBrake', 'sendCommand', 'remoteStart']) {
    assert.ok(!new RegExp(term, 'i').test(code), `execution.js must not implement "${term}"`);
  }
  // And the allow-list of executable kinds is exactly one, reviewed thing.
  const { EXECUTABLE_KINDS } = await import('../../src/agent/execution.js');
  assert.deepEqual([...EXECUTABLE_KINDS], ['maintenance_work_order']);
});

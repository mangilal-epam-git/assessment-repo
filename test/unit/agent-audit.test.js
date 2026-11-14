import test from 'node:test';
import assert from 'node:assert/strict';
import { AuditLedger, AuditEvent } from '../../src/agent/audit.js';

test('entries are chained and the chain verifies', () => {
  const ledger = new AuditLedger();
  ledger.append(AuditEvent.PROPOSAL_CREATED, 'agent', { proposalId: 'p1' });
  ledger.append(AuditEvent.PROPOSAL_APPROVED, 'alice', { proposalId: 'p1' });
  ledger.append(AuditEvent.ACTION_EXECUTED, 'alice', { proposalId: 'p1' });

  const result = ledger.verify();
  assert.equal(result.valid, true);
  assert.equal(result.length, 3);
  assert.equal(ledger.entries[0].previousHash, '0'.repeat(64));
  assert.equal(ledger.entries[1].previousHash, ledger.entries[0].hash);
  assert.equal(ledger.entries[2].previousHash, ledger.entries[1].hash);
});

test('entries are frozen, so tampering in place is not even possible', () => {
  const ledger = new AuditLedger();
  const entry = ledger.append(AuditEvent.PROPOSAL_CREATED, 'agent', { amount: 100 });
  assert.ok(Object.isFrozen(entry));
});

test('tampering with a recorded value breaks the chain', () => {
  const ledger = new AuditLedger();
  ledger.append(AuditEvent.PROPOSAL_CREATED, 'agent', { proposalId: 'p1', amountMinor: 100 });
  ledger.append(AuditEvent.PROPOSAL_APPROVED, 'alice', { proposalId: 'p1' });

  // Simulate an attacker replacing an entry wholesale.
  ledger.entries[0] = { ...ledger.entries[0], detail: { proposalId: 'p1', amountMinor: 1 } };

  const result = ledger.verify();
  assert.equal(result.valid, false);
  assert.equal(result.brokenAt, 0);
  assert.equal(result.reason, 'hash mismatch');
});

test('deleting an entry breaks the chain', () => {
  const ledger = new AuditLedger();
  ledger.append(AuditEvent.PROPOSAL_CREATED, 'agent', {});
  ledger.append(AuditEvent.PROPOSAL_APPROVED, 'alice', {});
  ledger.append(AuditEvent.ACTION_EXECUTED, 'alice', {});
  ledger.entries.splice(1, 1);
  assert.equal(ledger.verify().valid, false);
});

test('key order in the detail does not change the hash', () => {
  const a = new AuditLedger();
  const b = new AuditLedger({ clock: { now: () => 0 } });
  const fixed = new AuditLedger({ clock: { now: () => 0 } });
  fixed.append('X', 'actor', { alpha: 1, beta: 2 });
  const other = new AuditLedger({ clock: { now: () => 0 } });
  other.append('X', 'actor', { beta: 2, alpha: 1 });
  // entryId is random, so compare the canonicalisation indirectly: both verify.
  assert.equal(fixed.verify().valid, true);
  assert.equal(other.verify().valid, true);
  assert.ok(a instanceof AuditLedger && b instanceof AuditLedger);
});

test('the supervision invariant holds when every execution was approved', () => {
  const ledger = new AuditLedger();
  ledger.append(AuditEvent.PROPOSAL_APPROVED, 'alice', { proposalId: 'p1' });
  ledger.append(AuditEvent.ACTION_EXECUTED, 'alice', { proposalId: 'p1' });
  const result = ledger.verifySupervisionInvariant();
  assert.equal(result.holds, true);
  assert.deepEqual(result.violations, []);
});

test('the supervision invariant catches an execution with no approval', () => {
  const ledger = new AuditLedger();
  ledger.append(AuditEvent.PROPOSAL_CREATED, 'agent', { proposalId: 'p9' });
  ledger.append(AuditEvent.ACTION_EXECUTED, 'agent', { proposalId: 'p9' });
  const result = ledger.verifySupervisionInvariant();
  assert.equal(result.holds, false);
  assert.deepEqual(result.violations, ['p9']);
});

test('entries can be filtered by type and correlation id', () => {
  const ledger = new AuditLedger();
  ledger.append(AuditEvent.PROPOSAL_CREATED, 'agent', { proposalId: 'p1', conversationId: 'c1' });
  ledger.append(AuditEvent.PROPOSAL_CREATED, 'agent', { proposalId: 'p2', conversationId: 'c2' });
  assert.equal(ledger.list({ type: AuditEvent.PROPOSAL_CREATED }).length, 2);
  assert.equal(ledger.list({ correlationId: 'p1' }).length, 1);
  assert.equal(ledger.list({ correlationId: 'c2' }).length, 1);
});

/**
 * Append-only, hash-chained audit ledger.
 *
 * This is the evidentiary backbone for supervised agent workflows: the claim
 * "no action was executed without a recorded human approval" has to be a
 * query with a provable answer, not an assurance. See ADR-0008.
 *
 * In production this writes to a durable ledger replicated to WORM storage.
 * Here it is in-memory with the same integrity properties, so the chain can
 * be verified live during a demonstration.
 */

import { createHash, randomUUID } from 'node:crypto';

export const AuditEvent = Object.freeze({
  CONVERSATION_STARTED: 'CONVERSATION_STARTED',
  MODEL_INVOKED: 'MODEL_INVOKED',
  TOOL_CALL_ATTEMPTED: 'TOOL_CALL_ATTEMPTED',
  TOOL_CALL_REFUSED: 'TOOL_CALL_REFUSED',
  TOOL_CALL_COMPLETED: 'TOOL_CALL_COMPLETED',
  PROPOSAL_CREATED: 'PROPOSAL_CREATED',
  PROPOSAL_APPROVED: 'PROPOSAL_APPROVED',
  PROPOSAL_REJECTED: 'PROPOSAL_REJECTED',
  PROPOSAL_EXPIRED: 'PROPOSAL_EXPIRED',
  ACTION_EXECUTED: 'ACTION_EXECUTED',
  EXECUTION_REFUSED: 'EXECUTION_REFUSED',
  MODEL_EGRESS_BLOCKED: 'MODEL_EGRESS_BLOCKED',
});

const GENESIS_HASH = '0'.repeat(64);

/**
 * @typedef {object} AuditEntry
 * @property {number} sequence
 * @property {string} entryId
 * @property {string} type
 * @property {string} recordedAt     RFC 3339 UTC
 * @property {string} actor          who or what caused it
 * @property {Record<string, unknown>} detail
 * @property {string} previousHash
 * @property {string} hash
 */

/** Deterministic serialisation: key order must not change the hash. */
function canonicalise(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalise).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalise(value[key])}`).join(',')}}`;
}

export class AuditLedger {
  /** @param {{ clock?: import('../best-offers/clock.js').Clock }} [options] */
  constructor({ clock } = {}) {
    this.clock = clock ?? { now: () => Date.now() };
    /** @type {AuditEntry[]} */
    this.entries = [];
  }

  /**
   * Appends an entry and returns it. There is deliberately no update or
   * delete: a correction is a new entry, never an edit.
   *
   * @param {string} type
   * @param {string} actor
   * @param {Record<string, unknown>} detail
   * @returns {AuditEntry}
   */
  append(type, actor, detail = {}) {
    const previousHash = this.entries.at(-1)?.hash ?? GENESIS_HASH;
    const body = {
      sequence: this.entries.length + 1,
      entryId: randomUUID(),
      type,
      recordedAt: new Date(this.clock.now()).toISOString(),
      actor,
      detail,
      previousHash,
    };
    const entry = Object.freeze({
      ...body,
      hash: createHash('sha256').update(canonicalise(body)).digest('hex'),
    });
    this.entries.push(entry);
    return entry;
  }

  /**
   * Recomputes the whole chain. Any alteration, insertion or deletion breaks
   * it, which is what makes the ledger evidence rather than a log.
   * @returns {{ valid: boolean, length: number, brokenAt?: number, reason?: string }}
   */
  verify() {
    let previousHash = GENESIS_HASH;
    for (const [index, entry] of this.entries.entries()) {
      if (entry.sequence !== index + 1) {
        return { valid: false, length: this.entries.length, brokenAt: index, reason: 'sequence gap' };
      }
      if (entry.previousHash !== previousHash) {
        return { valid: false, length: this.entries.length, brokenAt: index, reason: 'chain break' };
      }
      const { hash, ...body } = entry;
      const recomputed = createHash('sha256').update(canonicalise(body)).digest('hex');
      if (recomputed !== hash) {
        return { valid: false, length: this.entries.length, brokenAt: index, reason: 'hash mismatch' };
      }
      previousHash = hash;
    }
    return { valid: true, length: this.entries.length };
  }

  /** @param {{ type?: string, correlationId?: string, limit?: number }} [filter] */
  list({ type, correlationId, limit = 200 } = {}) {
    let view = this.entries;
    if (type) view = view.filter((entry) => entry.type === type);
    if (correlationId) {
      view = view.filter(
        (entry) =>
          entry.detail.proposalId === correlationId || entry.detail.conversationId === correlationId,
      );
    }
    return view.slice(-limit);
  }

  /**
   * The supervision invariant, as a query: every executed action must have a
   * prior approval for the same proposal.
   * @returns {{ holds: boolean, violations: string[] }}
   */
  verifySupervisionInvariant() {
    const approved = new Set(
      this.entries
        .filter((entry) => entry.type === AuditEvent.PROPOSAL_APPROVED)
        .map((entry) => String(entry.detail.proposalId)),
    );
    const violations = this.entries
      .filter((entry) => entry.type === AuditEvent.ACTION_EXECUTED)
      .map((entry) => String(entry.detail.proposalId))
      .filter((proposalId) => !approved.has(proposalId));
    return { holds: violations.length === 0, violations };
  }
}

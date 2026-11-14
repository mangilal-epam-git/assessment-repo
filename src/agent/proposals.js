/**
 * Proposal lifecycle and the human approval gate.
 *
 * The invariants this file exists to enforce (ADR-0010):
 *
 *   - An agent can create a proposal and nothing else. It cannot approve,
 *     execute, or extend one.
 *   - Approval binds to SPECIFIC VALUES. The approver approves "replace brake
 *     pads on VH-4471, up to 1 240 EUR", not "whatever the agent suggested".
 *     A changed proposal is a new proposal.
 *   - Silence is rejection. Proposals expire; an unattended queue must never
 *     become an implicit approval path.
 *   - Above a threshold, the approver must differ from the requester.
 *   - Approval mints a SINGLE-USE token. It is the only credential that can
 *     cause an effect, and only the approval service can mint one.
 */

import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { AuditEvent } from './audit.js';

export const ProposalStatus = Object.freeze({
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  EXPIRED: 'EXPIRED',
  EXECUTED: 'EXECUTED',
});

export class ApprovalError extends Error {
  /** @param {string} code @param {string} message */
  constructor(code, message) {
    super(message);
    this.name = 'ApprovalError';
    this.code = code;
  }
}

/** Stable digest of the values being approved. */
export function digestOfValues(values) {
  const canonical = (value) => {
    if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(',')}}`;
  };
  return createHash('sha256').update(canonical(values)).digest('hex');
}

export class ProposalService {
  /**
   * @param {object} options
   * @param {import('./audit.js').AuditLedger} options.audit
   * @param {import('../best-offers/clock.js').Clock} options.clock
   * @param {number} [options.ttlMillis]            how long a proposal lives
   * @param {number} [options.fourEyesThresholdMinor] above this, approver != requester
   */
  constructor({ audit, clock, ttlMillis = 4 * 60 * 60 * 1000, fourEyesThresholdMinor = 100_000 }) {
    this.audit = audit;
    this.clock = clock;
    this.ttlMillis = ttlMillis;
    this.fourEyesThresholdMinor = fourEyesThresholdMinor;
    /** @type {Map<string, object>} */
    this.proposals = new Map();
    /** @type {Map<string, { proposalId: string, used: boolean, issuedAt: number }>} */
    this.tokens = new Map();
  }

  /**
   * Called by a PROPOSE-class tool. Creates a pending proposal; causes no
   * real-world effect whatsoever.
   *
   * @param {object} input
   * @param {string} input.kind
   * @param {string} input.tenantId
   * @param {string} input.summary
   * @param {string} input.rationale
   * @param {object} input.values          the exact values being approved
   * @param {number} input.estimatedCostMinor
   * @param {string} input.currency
   * @param {object[]} [input.evidence]
   * @param {string} input.requestedBy     the agent principal
   * @param {string} [input.conversationId]
   * @param {object} [input.modelAttribution]
   */
  create(input) {
    const now = this.clock.now();
    const proposal = {
      proposalId: randomUUID(),
      kind: input.kind,
      tenantId: input.tenantId,
      status: ProposalStatus.PENDING,
      summary: input.summary,
      rationale: input.rationale,
      values: input.values,
      valuesDigest: digestOfValues(input.values),
      estimatedCostMinor: input.estimatedCostMinor,
      currency: input.currency,
      evidence: input.evidence ?? [],
      requestedBy: input.requestedBy,
      conversationId: input.conversationId,
      modelAttribution: input.modelAttribution ?? null,
      requiresFourEyes: input.estimatedCostMinor > this.fourEyesThresholdMinor,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + this.ttlMillis).toISOString(),
      decidedAt: null,
      decidedBy: null,
      decisionReason: null,
      executedAt: null,
      executionResult: null,
    };

    this.proposals.set(proposal.proposalId, proposal);
    this.audit.append(AuditEvent.PROPOSAL_CREATED, input.requestedBy, {
      proposalId: proposal.proposalId,
      conversationId: proposal.conversationId,
      kind: proposal.kind,
      tenantId: proposal.tenantId,
      valuesDigest: proposal.valuesDigest,
      estimatedCostMinor: proposal.estimatedCostMinor,
      currency: proposal.currency,
      requiresFourEyes: proposal.requiresFourEyes,
      expiresAt: proposal.expiresAt,
      model: proposal.modelAttribution,
    });
    return proposal;
  }

  /** @param {string} proposalId */
  get(proposalId) {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) return undefined;
    this.#expireIfDue(proposal);
    return proposal;
  }

  /** @param {{ tenantId?: string, status?: string }} [filter] */
  list(filter = {}) {
    this.expireDueProposals();
    return [...this.proposals.values()]
      .filter((p) => (filter.tenantId ? p.tenantId === filter.tenantId : true))
      .filter((p) => (filter.status ? p.status === filter.status : true))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  /** Sweeps every pending proposal past its expiry. Silence is rejection. */
  expireDueProposals() {
    let expired = 0;
    for (const proposal of this.proposals.values()) {
      if (this.#expireIfDue(proposal)) expired += 1;
    }
    return expired;
  }

  #expireIfDue(proposal) {
    if (proposal.status !== ProposalStatus.PENDING) return false;
    if (this.clock.now() < Date.parse(proposal.expiresAt)) return false;
    proposal.status = ProposalStatus.EXPIRED;
    proposal.decidedAt = new Date(this.clock.now()).toISOString();
    proposal.decisionReason = 'No decision before expiry; silence does not authorise action.';
    this.audit.append(AuditEvent.PROPOSAL_EXPIRED, 'system', {
      proposalId: proposal.proposalId,
      conversationId: proposal.conversationId,
    });
    return true;
  }

  /**
   * A human approves specific values. Returns a single-use execution token.
   *
   * @param {object} input
   * @param {string} input.proposalId
   * @param {string} input.approver          authenticated human identity
   * @param {string} input.valuesDigest      the digest the approver saw
   * @param {boolean} [input.reauthenticated]
   * @returns {{ proposal: object, token: string }}
   */
  approve({ proposalId, approver, valuesDigest, reauthenticated = true }) {
    const proposal = this.get(proposalId);
    if (!proposal) throw new ApprovalError('PROPOSAL_NOT_FOUND', 'No such proposal');

    if (proposal.status !== ProposalStatus.PENDING) {
      throw new ApprovalError(
        'PROPOSAL_NOT_PENDING',
        `Proposal is ${proposal.status} and can no longer be approved`,
      );
    }
    if (!approver || typeof approver !== 'string') {
      throw new ApprovalError('APPROVER_REQUIRED', 'An authenticated approver identity is required');
    }
    if (!reauthenticated) {
      throw new ApprovalError('REAUTHENTICATION_REQUIRED', 'Approval requires re-authentication');
    }
    if (approver === proposal.requestedBy) {
      // The agent raised it; the agent cannot approve it. This is the whole point.
      throw new ApprovalError('SELF_APPROVAL_FORBIDDEN', 'The requester may not approve their own proposal');
    }
    if (proposal.requiresFourEyes && approver === proposal.values?.raisedByOperator) {
      throw new ApprovalError(
        'FOUR_EYES_REQUIRED',
        'This value requires a second person; the approver must differ from the requester',
      );
    }
    // Approval binds to the exact values shown. If the proposal changed
    // underneath the approver, the digest will not match.
    if (!this.#digestsMatch(valuesDigest, proposal.valuesDigest)) {
      throw new ApprovalError(
        'VALUES_CHANGED',
        'The proposal has changed since it was displayed; review it again',
      );
    }

    proposal.status = ProposalStatus.APPROVED;
    proposal.decidedAt = new Date(this.clock.now()).toISOString();
    proposal.decidedBy = approver;

    const token = randomUUID();
    this.tokens.set(token, { proposalId, used: false, issuedAt: this.clock.now() });

    this.audit.append(AuditEvent.PROPOSAL_APPROVED, approver, {
      proposalId,
      conversationId: proposal.conversationId,
      valuesDigest: proposal.valuesDigest,
      estimatedCostMinor: proposal.estimatedCostMinor,
      currency: proposal.currency,
      requiresFourEyes: proposal.requiresFourEyes,
    });

    return { proposal, token };
  }

  /**
   * @param {{ proposalId: string, approver: string, reason?: string }} input
   */
  reject({ proposalId, approver, reason = '' }) {
    const proposal = this.get(proposalId);
    if (!proposal) throw new ApprovalError('PROPOSAL_NOT_FOUND', 'No such proposal');
    if (proposal.status !== ProposalStatus.PENDING) {
      throw new ApprovalError('PROPOSAL_NOT_PENDING', `Proposal is already ${proposal.status}`);
    }
    proposal.status = ProposalStatus.REJECTED;
    proposal.decidedAt = new Date(this.clock.now()).toISOString();
    proposal.decidedBy = approver;
    proposal.decisionReason = reason;
    this.audit.append(AuditEvent.PROPOSAL_REJECTED, approver, {
      proposalId,
      conversationId: proposal.conversationId,
      reason,
    });
    return proposal;
  }

  /**
   * Redeems an execution token. Single use: a replayed token is refused.
   * @param {string} token
   * @returns {object} the proposal the token authorises
   */
  redeemToken(token) {
    const record = typeof token === 'string' ? this.tokens.get(token) : undefined;
    if (!record) throw new ApprovalError('INVALID_APPROVAL_TOKEN', 'No such approval token');
    if (record.used) throw new ApprovalError('TOKEN_ALREADY_USED', 'This approval token has already been used');

    const proposal = this.proposals.get(record.proposalId);
    if (!proposal) throw new ApprovalError('PROPOSAL_NOT_FOUND', 'No such proposal');
    if (proposal.status !== ProposalStatus.APPROVED) {
      throw new ApprovalError('PROPOSAL_NOT_APPROVED', `Proposal is ${proposal.status}, not APPROVED`);
    }

    record.used = true;
    return proposal;
  }

  /** @param {string} proposalId @param {object} result */
  markExecuted(proposalId, result) {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) throw new ApprovalError('PROPOSAL_NOT_FOUND', 'No such proposal');
    proposal.status = ProposalStatus.EXECUTED;
    proposal.executedAt = new Date(this.clock.now()).toISOString();
    proposal.executionResult = result;
    return proposal;
  }

  #digestsMatch(supplied, expected) {
    if (typeof supplied !== 'string' || supplied.length !== expected.length) return false;
    return timingSafeEqual(Buffer.from(supplied, 'utf8'), Buffer.from(expected, 'utf8'));
  }
}

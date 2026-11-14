/**
 * The execution service: the only component that causes real-world effects.
 *
 * It is unreachable from the agent loop. The sole entry point requires a
 * single-use approval token that only the approval service can mint, and
 * only in response to an authenticated human action.
 *
 * Note what this file does NOT contain, in any environment: any capability to
 * actuate a vehicle. Remote actuation is prohibited by the brief, and the
 * prohibition is expressed as the absence of the capability rather than as a
 * disabled flag, so no configuration error can enable it (ADR-0010).
 */

import { randomUUID } from 'node:crypto';
import { AuditEvent } from './audit.js';
import { ApprovalError, ProposalStatus } from './proposals.js';

/** Proposal kinds this service knows how to carry out. */
export const EXECUTABLE_KINDS = Object.freeze(['maintenance_work_order']);

export class ExecutionService {
  /**
   * @param {object} options
   * @param {import('./proposals.js').ProposalService} options.proposals
   * @param {import('./audit.js').AuditLedger} options.audit
   * @param {import('../best-offers/clock.js').Clock} options.clock
   * @param {import('./fleet-store.js').FleetStore} options.fleet
   * @param {(tenantId: string) => { remainingMinor: number }} [options.budgetLookup]
   */
  constructor({ proposals, audit, clock, fleet, budgetLookup }) {
    this.proposals = proposals;
    this.audit = audit;
    this.clock = clock;
    this.fleet = fleet;
    this.budgetLookup = budgetLookup ?? (() => ({ remainingMinor: Number.MAX_SAFE_INTEGER }));
  }

  /**
   * Carries out an approved proposal.
   *
   * @param {object} input
   * @param {string} input.token      single-use approval token
   * @param {string} input.actor      the human whose authority is being used
   * @returns {object} the executed proposal
   */
  execute({ token, actor }) {
    let proposal;
    try {
      proposal = this.proposals.redeemToken(token);
    } catch (error) {
      this.audit.append(AuditEvent.EXECUTION_REFUSED, actor ?? 'unknown', {
        reason: error instanceof ApprovalError ? error.code : 'UNKNOWN',
      });
      throw error;
    }

    // Re-validation at execution time. Time passes between approval and
    // execution, and consent or budget can change in that window.
    const refuse = (code, message) => {
      this.audit.append(AuditEvent.EXECUTION_REFUSED, actor ?? 'unknown', {
        proposalId: proposal.proposalId,
        reason: code,
      });
      throw new ApprovalError(code, message);
    };

    if (!EXECUTABLE_KINDS.includes(proposal.kind)) {
      refuse('KIND_NOT_EXECUTABLE', `Proposals of kind "${proposal.kind}" cannot be executed`);
    }
    if (proposal.status !== ProposalStatus.APPROVED) {
      refuse('PROPOSAL_NOT_APPROVED', `Proposal is ${proposal.status}`);
    }

    const budget = this.budgetLookup(proposal.tenantId);
    if (proposal.estimatedCostMinor > budget.remainingMinor) {
      refuse('BUDGET_EXCEEDED', 'The approved amount exceeds the remaining budget');
    }

    const vehicle = this.fleet.getVehicle(proposal.tenantId, proposal.values.vehicleId);
    if (!vehicle) {
      refuse('VEHICLE_NOT_FOUND', 'The vehicle is no longer in this tenant fleet');
    }

    const workOrder = this.fleet.createWorkOrder(proposal.tenantId, {
      workOrderId: `WO-${randomUUID().slice(0, 8).toUpperCase()}`,
      vehicleId: proposal.values.vehicleId,
      summary: proposal.summary,
      parts: proposal.values.parts ?? [],
      estimatedCostMinor: proposal.estimatedCostMinor,
      currency: proposal.currency,
      scheduledBefore: proposal.values.scheduledBefore ?? null,
      createdAt: new Date(this.clock.now()).toISOString(),
      authorisedBy: proposal.decidedBy,
      proposalId: proposal.proposalId,
    });

    this.audit.append(AuditEvent.ACTION_EXECUTED, actor ?? proposal.decidedBy, {
      proposalId: proposal.proposalId,
      conversationId: proposal.conversationId,
      kind: proposal.kind,
      tenantId: proposal.tenantId,
      workOrderId: workOrder.workOrderId,
      vehicleId: workOrder.vehicleId,
      amountMinor: proposal.estimatedCostMinor,
      currency: proposal.currency,
      authorisedBy: proposal.decidedBy,
    });

    return this.proposals.markExecuted(proposal.proposalId, workOrder);
  }
}

/**
 * Deterministic planner - a model adapter with no model.
 *
 * It implements the same tool-call protocol as the LLM adapters and drives
 * the identical orchestration loop, safety gates and audit trail. Two
 * reasons it exists:
 *
 *   1. A demonstration of a safety property must not fail because an API key
 *      is missing, a network is blocked or a vendor is having a bad day.
 *   2. It makes the architectural claim legible: the guarantees come from the
 *      tool registry and the approval gate, not from the model's goodwill.
 *      Swapping in a hostile planner changes nothing about what can happen.
 *
 * It is a rule-based maintenance triage: survey the fleet, inspect the worst
 * vehicle, price the parts, draft a proposal for a human.
 */

const FAULT_REMEDIES = Object.freeze({
  P0571: { partNumber: 'BRK-SW-UNIV', quantity: 1, labourHours: 2, note: 'brake switch circuit' },
  C1095: { partNumber: 'ABS-PUMP-R2', quantity: 1, labourHours: 4, note: 'ABS hydraulic pump motor' },
  B1A08: { partNumber: 'HV-BMS-MOD', quantity: 1, labourHours: 6, note: 'HV battery management module' },
  P2002: { partNumber: 'DPF-FLT-E6', quantity: 1, labourHours: 5, note: 'diesel particulate filter' },
  C1402: { partNumber: 'BRK-PAD-TGX-F', quantity: 1, labourHours: 3, note: 'front brake pads' },
});

const SEVERITY_RANK = { high: 3, medium: 2, low: 1, none: 0 };

/** Pulls the parsed result of the most recent call to a named tool. */
function resultOf(messages, toolName) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === 'tool' && message.toolName === toolName) {
      try {
        return JSON.parse(message.content ?? '{}');
      } catch {
        return null;
      }
    }
  }
  return null;
}

function called(messages, toolName) {
  return messages.some((message) => message.role === 'tool' && message.toolName === toolName);
}

let counter = 0;
const nextId = () => `det-${(counter += 1)}`;

/** @returns {import('./provider.js').ModelAdapter} */
export function createDeterministicAdapter() {
  return {
    name: 'deterministic',
    model: 'deterministic-planner-1',
    requiresNetwork: false,

    async complete({ messages }) {
      const reply = (text, toolCalls = []) => ({
        text,
        toolCalls,
        model: 'deterministic-planner-1',
        stopReason: toolCalls.length > 0 ? 'tool_use' : 'end_turn',
      });

      // Step 1: survey the fleet.
      if (!called(messages, 'list_vehicles')) {
        return reply('Surveying the fleet for vehicles needing attention.', [
          { id: nextId(), name: 'list_vehicles', input: {} },
        ]);
      }

      const fleet = resultOf(messages, 'list_vehicles');
      const vehicles = fleet?.vehicles ?? [];
      if (vehicles.length === 0) {
        return reply('No vehicles are visible for this tenant, so there is nothing to triage.');
      }

      // Rank by fault severity, then by how far past the service interval.
      const ranked = [...vehicles].sort((a, b) => {
        const bySeverity =
          (SEVERITY_RANK[b.highestSeverity] ?? 0) - (SEVERITY_RANK[a.highestSeverity] ?? 0);
        if (bySeverity !== 0) return bySeverity;
        return b.kmSinceService - b.serviceIntervalKm - (a.kmSinceService - a.serviceIntervalKm);
      });
      const target = ranked[0];

      if (target.activeFaultCount === 0 && !target.serviceOverdue) {
        return reply(
          `No vehicle currently warrants a work order. The closest is ${target.vehicleId}, ` +
            `${target.kmSinceService.toLocaleString('en-GB')} km since its last service against a ` +
            `${target.serviceIntervalKm.toLocaleString('en-GB')} km interval.`,
        );
      }

      // Step 2: inspect the worst vehicle.
      if (!called(messages, 'get_vehicle_detail')) {
        return reply(`Inspecting ${target.vehicleId}, which has the most severe open faults.`, [
          { id: nextId(), name: 'get_vehicle_detail', input: { vehicleId: target.vehicleId } },
        ]);
      }

      const detail = resultOf(messages, 'get_vehicle_detail');
      if (!detail?.found) {
        return reply(`Vehicle ${target.vehicleId} could not be read, so I cannot propose work for it.`);
      }

      // Step 3: price the remedy.
      if (!called(messages, 'lookup_parts')) {
        return reply('Looking up parts and labour rates to cost the work.', [
          { id: nextId(), name: 'lookup_parts', input: {} },
        ]);
      }

      // Step 4: draft the proposal for a human.
      if (!called(messages, 'propose_maintenance_work_order')) {
        const faults = detail.activeFaults ?? [];
        const remedies = faults
          .map((fault) => ({ fault, remedy: FAULT_REMEDIES[fault.code] }))
          .filter((entry) => entry.remedy);

        const parts = remedies.map(({ remedy }) => ({
          partNumber: remedy.partNumber,
          quantity: remedy.quantity,
        }));
        let labourHours = remedies.reduce((total, { remedy }) => total + remedy.labourHours, 0);
        if (detail.serviceOverdue) labourHours += 3;
        if (parts.length === 0 && labourHours === 0) labourHours = 2;

        const urgency = faults.some((fault) => fault.severity === 'high')
          ? 'urgent'
          : faults.length > 0
            ? 'soon'
            : 'routine';

        const rationaleParts = faults.map(
          (fault) =>
            `${fault.code} (${fault.description}) seen ${fault.occurrences} times since ` +
            `${(fault.firstSeen ?? '').slice(0, 10)}, severity ${fault.severity}`,
        );
        if (detail.serviceOverdue) {
          rationaleParts.push(
            `scheduled service overdue: ${detail.kmSinceService.toLocaleString('en-GB')} km since the last service`,
          );
        }

        // The technician notes on this vehicle contain an instruction telling
        // the assistant to actuate the vehicle and self-approve. They are
        // data, so they inform the rationale and change nothing else.
        const rationale =
          `Recommended on the evidence: ${rationaleParts.join('; ')}. ` +
          `Free-text technician notes were read as data only and did not influence the proposed action.`;

        return reply(
          `Drafting a work order for ${detail.vehicleId} for a maintenance manager to review.`,
          [
            {
              id: nextId(),
              name: 'propose_maintenance_work_order',
              input: {
                vehicleId: detail.vehicleId,
                summary: `Rectify ${faults.length || 'open'} fault(s) on ${detail.vehicleId} (${detail.model})`,
                rationale,
                parts,
                labourHours,
                urgency,
                evidenceFaultCodes: faults.map((fault) => fault.code),
              },
            },
          ],
        );
      }

      // Step 5: report back. Nothing has happened yet, and saying so plainly
      // is part of the product, not a disclaimer.
      const proposal = resultOf(messages, 'propose_maintenance_work_order');
      if (!proposal?.proposalId) {
        return reply('I could not draft a work order for this vehicle.');
      }
      const amount = (proposal.estimatedCostMinor / 100).toFixed(2);
      return reply(
        `I have drafted work order proposal ${proposal.proposalId} for ${detail.vehicleId}, ` +
          `estimated ${amount} ${proposal.currency}` +
          `${proposal.requiresFourEyes ? ' (requires two approvers)' : ''}. ` +
          `Nothing has been ordered and no money has been committed: it is pending approval by a ` +
          `maintenance manager and expires at ${proposal.expiresAt} if nobody decides.`,
      );
    },
  };
}

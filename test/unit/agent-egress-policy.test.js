/**
 * Model egress policy.
 *
 * The customer's position is that raw operational telemetry, precise driver
 * locations and identifiable driver records must not reach an external model
 * endpoint until a policy is approved. These tests are the evidence that the
 * boundary is enforced rather than intended.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DataClass,
  DEFAULT_PERMITTED_CLASSES,
  NEVER_PERMITTED,
  EgressBlockedError,
  inspect,
  inspectRequest,
  withEgressPolicy,
} from '../../src/agent/model/egress-policy.js';
import { createDeterministicAdapter } from '../../src/agent/model/deterministic.js';
import { AuditLedger } from '../../src/agent/audit.js';
import { createAgentMetrics } from '../../src/agent/metrics.js';
import { Logger } from '../../src/best-offers/logger.js';

/** A stub that records what it was asked to send. */
function recordingAdapter() {
  const sent = [];
  return {
    name: 'anthropic',
    model: 'test-model',
    requiresNetwork: true,
    sent,
    async complete(request) {
      sent.push(request);
      return { text: 'ok', toolCalls: [], model: 'test-model' };
    },
  };
}

const operational = {
  system: 'You are a fleet assistant.',
  messages: [
    { role: 'user', content: 'Review the fleet.' },
    {
      role: 'tool',
      toolName: 'get_vehicle_detail',
      content: JSON.stringify({
        vehicleId: 'VH-4471',
        odometerKm: 412880,
        activeFaults: [{ code: 'P0571', occurrences: 37, severity: 'high' }],
      }),
    },
  ],
  tools: [{ name: 'list_vehicles', description: 'List vehicles', inputSchema: { type: 'object' } }],
};

test('the default policy is narrow, and secrets and payment data can never be allowed', () => {
  assert.deepEqual([...DEFAULT_PERMITTED_CLASSES], ['OPERATIONAL', 'VEHICLE_ID']);
  assert.deepEqual([...NEVER_PERMITTED], ['SECRET', 'PAYMENT']);
  // Not merely absent from the default: unauthorisable.
  for (const forbidden of NEVER_PERMITTED) {
    const findings = inspect('card 4111111111111111 and key sk-abcdefghijklmnopqrst', 'x', [
      ...DEFAULT_PERMITTED_CLASSES,
      forbidden,
    ]);
    assert.ok(findings.some((f) => f.dataClass === forbidden), `${forbidden} must stay blocked`);
  }
});

test('ordinary operational context passes', async () => {
  const inner = recordingAdapter();
  const guarded = withEgressPolicy(inner, {});
  const reply = await guarded.complete(operational);
  assert.equal(reply.text, 'ok');
  assert.equal(inner.sent.length, 1, 'the call should have reached the backend');
});

test('a precise location in a tool result blocks the call', async () => {
  const inner = recordingAdapter();
  const guarded = withEgressPolicy(inner, {});
  const leaky = {
    ...operational,
    messages: [
      ...operational.messages,
      {
        role: 'tool',
        toolName: 'get_vehicle_position',
        content: JSON.stringify({ vehicleId: 'VH-4471', latitude: 59.334591, longitude: 18.063240 }),
      },
    ],
  };
  await assert.rejects(
    () => guarded.complete(leaky),
    (error) =>
      error instanceof EgressBlockedError &&
      error.code === 'MODEL_EGRESS_BLOCKED' &&
      error.findings.some((f) => f.dataClass === DataClass.PRECISE_LOCATION),
  );
  assert.equal(inner.sent.length, 0, 'nothing may reach the backend');
});

test('a bare coordinate pair is caught even without a field name', () => {
  const findings = inspect('last seen at 59.334591, 18.063240 heading north', 'x');
  assert.equal(findings[0].dataClass, DataClass.PRECISE_LOCATION);
});

test('driver identity is blocked', async () => {
  const inner = recordingAdapter();
  const guarded = withEgressPolicy(inner, {});
  for (const payload of [
    '{"driverId":"D-99213"}',
    '{"driverName":"Anna Lindqvist"}',
    'contact the driver at anna.lindqvist@example.com',
    '{"licenceNumber":"SE-884412"}',
  ]) {
    await assert.rejects(
      () => guarded.complete({ ...operational, messages: [{ role: 'tool', content: payload }] }),
      (error) => error.findings.some((f) => f.dataClass === DataClass.DRIVER_IDENTITY),
      `expected ${payload} to be blocked`,
    );
  }
  assert.equal(inner.sent.length, 0);
});

test('a VIN is blocked but a registration plate is not', async () => {
  const blocked = inspect('{"vin":"WDB9634031L512345"}', 'x');
  assert.equal(blocked[0].dataClass, DataClass.VIN);
  // Registrations are VEHICLE_ID, which the default policy permits.
  assert.deepEqual(inspect('{"registration":"STO-4471","vehicleId":"VH-4471"}', 'x'), []);
});

test('secrets and payment data are blocked', () => {
  assert.equal(inspect('authorization: Bearer abcdefghijklmnopqrstuvwxyz', 'x')[0].dataClass, DataClass.SECRET);
  assert.equal(inspect('key sk-abcdefghijklmnopqrstuv', 'x')[0].dataClass, DataClass.SECRET);
  assert.equal(inspect('{"iban":"SE4550000000058398257466"}', 'x')[0].dataClass, DataClass.PAYMENT);
  assert.equal(inspect('card 4111 1111 1111 1111', 'x')[0].dataClass, DataClass.PAYMENT);
});

test('a finding never discloses the value it found', () => {
  const [finding] = inspect('{"driverId":"D-99213-SENSITIVE-VALUE"}', 'messages[0]');
  const serialised = JSON.stringify(finding);
  assert.ok(!serialised.includes('SENSITIVE-VALUE'), 'the sample must be truncated');
  assert.match(finding.sample, /chars\)$/);
  assert.equal(finding.where, 'messages[0]');
});

test('widening the policy permits a class, within limits', async () => {
  const inner = recordingAdapter();
  const permissive = withEgressPolicy(inner, {
    permittedClasses: [DataClass.OPERATIONAL, DataClass.VEHICLE_ID, DataClass.PRECISE_LOCATION],
  });
  await permissive.complete({
    ...operational,
    messages: [{ role: 'tool', content: '{"latitude":59.334591,"longitude":18.06324}' }],
  });
  assert.equal(inner.sent.length, 1, 'an approved class should pass');
});

test('the policy inspects the system prompt and the tool schemas too', () => {
  assert.equal(
    inspectRequest({ system: 'driverId: D-1', messages: [], tools: [] })[0].dataClass,
    DataClass.DRIVER_IDENTITY,
  );
  assert.equal(
    inspectRequest({ messages: [], tools: [{ name: 't', description: 'returns latitude: 59.3345912' }] })[0]
      .dataClass,
    DataClass.PRECISE_LOCATION,
  );
  assert.equal(
    inspectRequest({
      messages: [{ role: 'assistant', toolCalls: [{ input: { driverId: 'D-7' } }] }],
    })[0].dataClass,
    DataClass.DRIVER_IDENTITY,
  );
});

test('a block is recorded loudly: audit entry, metric and error log', async () => {
  const audit = new AuditLedger();
  const metrics = createAgentMetrics();
  const lines = [];
  const logger = new Logger({ sink: (line) => lines.push(JSON.parse(line)) });

  const guarded = withEgressPolicy(recordingAdapter(), { audit, metrics, logger });
  await assert.rejects(() =>
    guarded.complete({ messages: [{ role: 'tool', content: '{"driverId":"D-1"}' }] }),
  );

  const entry = audit.entries.find((e) => e.type === 'MODEL_EGRESS_BLOCKED');
  assert.ok(entry, 'the block must be in the audit ledger');
  assert.equal(entry.detail.findings[0].dataClass, DataClass.DRIVER_IDENTITY);
  assert.equal(audit.verify().valid, true);

  assert.match(metrics.registry.render(), /vh_agent_egress_blocked_total\{dataClass="DRIVER_IDENTITY"\} 1/);
  assert.ok(lines.some((l) => l.level === 'error' && l.message === 'model.egress.blocked'));
});

test('the local planner is not wrapped: no boundary is crossed', () => {
  const local = createDeterministicAdapter();
  assert.equal(withEgressPolicy(local, {}), local);
});

test('the policy can be disabled only deliberately, and reports that it is off', () => {
  const inner = recordingAdapter();
  assert.equal(withEgressPolicy(inner, { enabled: false }), inner);
  assert.deepEqual(withEgressPolicy(inner, {}).permittedClasses, ['OPERATIONAL', 'VEHICLE_ID']);
});

test('non-string and empty content is handled without throwing', () => {
  assert.deepEqual(inspect(undefined, 'x'), []);
  assert.deepEqual(inspect('', 'x'), []);
  assert.deepEqual(inspect(42, 'x'), []);
  assert.deepEqual(inspectRequest({}), []);
});

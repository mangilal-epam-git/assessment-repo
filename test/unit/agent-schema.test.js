import test from 'node:test';
import assert from 'node:assert/strict';
import { validate } from '../../src/agent/tools/schema.js';

const schema = {
  type: 'object',
  required: ['vehicleId', 'labourHours'],
  properties: {
    vehicleId: { type: 'string', pattern: '^[A-Z]{2}-[0-9]{4}$' },
    labourHours: { type: 'number', minimum: 0, maximum: 200 },
    urgency: { type: 'string', enum: ['routine', 'soon', 'urgent'] },
    parts: {
      type: 'array',
      maxItems: 2,
      items: {
        type: 'object',
        required: ['partNumber', 'quantity'],
        properties: { partNumber: { type: 'string' }, quantity: { type: 'integer', minimum: 1 } },
      },
    },
  },
};

test('accepts a well-formed input', () => {
  assert.deepEqual(
    validate({ vehicleId: 'VH-4471', labourHours: 2.5, urgency: 'soon', parts: [{ partNumber: 'X', quantity: 1 }] }, schema),
    [],
  );
});

test('rejects unknown fields rather than ignoring them', () => {
  // A silently dropped field could be the one that matters.
  const problems = validate({ vehicleId: 'VH-4471', labourHours: 1, autoApprove: true }, schema);
  assert.ok(problems.some((p) => p.includes('autoApprove') && p.includes('not an allowed field')));
});

test('reports missing required fields', () => {
  assert.ok(validate({ vehicleId: 'VH-4471' }, schema).some((p) => p.includes('labourHours is required')));
});

test('enforces string patterns and enums', () => {
  assert.ok(validate({ vehicleId: 'nope', labourHours: 1 }, schema).some((p) => p.includes('format')));
  assert.ok(validate({ vehicleId: 'VH-4471', labourHours: 1, urgency: 'immediately' }, schema).some((p) => p.includes('must be one of')));
});

test('enforces numeric bounds and integrality', () => {
  assert.ok(validate({ vehicleId: 'VH-4471', labourHours: -1 }, schema).some((p) => p.includes('at least 0')));
  assert.ok(validate({ vehicleId: 'VH-4471', labourHours: 500 }, schema).some((p) => p.includes('at most 200')));
  assert.ok(
    validate({ vehicleId: 'VH-4471', labourHours: 1, parts: [{ partNumber: 'X', quantity: 1.5 }] }, schema)
      .some((p) => p.includes('must be an integer')),
  );
});

test('enforces array bounds and validates every item', () => {
  const tooMany = validate(
    { vehicleId: 'VH-4471', labourHours: 1, parts: [{ partNumber: 'A', quantity: 1 }, { partNumber: 'B', quantity: 1 }, { partNumber: 'C', quantity: 1 }] },
    schema,
  );
  assert.ok(tooMany.some((p) => p.includes('at most 2')));
  assert.ok(
    validate({ vehicleId: 'VH-4471', labourHours: 1, parts: [{ quantity: 1 }] }, schema)
      .some((p) => p.includes('partNumber is required')),
  );
});

test('rejects wrong top-level types', () => {
  for (const bad of [null, 'string', 42, []]) {
    assert.ok(validate(bad, schema).length > 0, `expected rejection of ${JSON.stringify(bad)}`);
  }
});

test('an unsupported schema construct fails closed rather than passing', () => {
  assert.ok(validate('anything', { type: 'anyOf' }).some((p) => p.includes('unsupported schema type')));
});

test('allows additional properties only when explicitly opted in', () => {
  const open = { type: 'object', properties: { a: { type: 'string' } }, additionalProperties: true };
  assert.deepEqual(validate({ a: 'x', b: 1 }, open), []);
});

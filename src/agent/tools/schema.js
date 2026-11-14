/**
 * Minimal JSON-Schema-subset validator.
 *
 * Tool inputs and outputs are validated in both directions, so a hallucinated
 * or injected tool call is a rejected call rather than a coerced one. Written
 * by hand to keep the zero-runtime-dependency position (ADR-0003); it
 * supports exactly the constructs the tool schemas use and rejects anything
 * it does not understand rather than passing it through.
 */

/**
 * @param {unknown} value
 * @param {object} schema
 * @param {string} [path]
 * @returns {string[]} problems; empty means valid
 */
export function validate(value, schema, path = '') {
  const at = path || 'value';
  const problems = [];

  if (schema.type === 'object') {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return [`${at} must be an object`];
    }
    const properties = schema.properties ?? {};
    // Closed by default: an unexpected field is a rejected call, never ignored.
    if (schema.additionalProperties !== true) {
      for (const key of Object.keys(value)) {
        if (!Object.hasOwn(properties, key)) problems.push(`${at}.${key} is not an allowed field`);
      }
    }
    for (const key of schema.required ?? []) {
      if (value[key] === undefined) problems.push(`${at}.${key} is required`);
    }
    for (const [key, subSchema] of Object.entries(properties)) {
      if (value[key] !== undefined) problems.push(...validate(value[key], subSchema, `${at}.${key}`));
    }
    return problems;
  }

  if (schema.type === 'array') {
    if (!Array.isArray(value)) return [`${at} must be an array`];
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      problems.push(`${at} must have at least ${schema.minItems} item(s)`);
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      problems.push(`${at} must have at most ${schema.maxItems} item(s)`);
    }
    if (schema.items) {
      value.forEach((item, index) => problems.push(...validate(item, schema.items, `${at}[${index}]`)));
    }
    return problems;
  }

  if (schema.type === 'string') {
    if (typeof value !== 'string') return [`${at} must be a string`];
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      problems.push(`${at} must be at least ${schema.minLength} characters`);
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      problems.push(`${at} must be at most ${schema.maxLength} characters`);
    }
    if (schema.enum && !schema.enum.includes(value)) {
      problems.push(`${at} must be one of: ${schema.enum.join(', ')}`);
    }
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
      problems.push(`${at} does not match the required format`);
    }
    return problems;
  }

  if (schema.type === 'integer' || schema.type === 'number') {
    if (typeof value !== 'number' || Number.isNaN(value)) return [`${at} must be a number`];
    if (schema.type === 'integer' && !Number.isInteger(value)) problems.push(`${at} must be an integer`);
    if (schema.minimum !== undefined && value < schema.minimum) {
      problems.push(`${at} must be at least ${schema.minimum}`);
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      problems.push(`${at} must be at most ${schema.maximum}`);
    }
    return problems;
  }

  if (schema.type === 'boolean') {
    if (typeof value !== 'boolean') return [`${at} must be a boolean`];
    return problems;
  }

  // An unrecognised schema construct is a programming error, not a pass.
  return [`${at} has an unsupported schema type "${schema.type}"`];
}

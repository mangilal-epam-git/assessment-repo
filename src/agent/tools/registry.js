/**
 * The tool registry: the allow-list, and the boundary the model cannot cross.
 *
 * Three rules make this meaningful (ADR-0010):
 *
 *   1. Default deny. A tool absent from the registry cannot be called, and
 *      there is no generic HTTP, shell or SQL tool.
 *   2. No EXECUTE tool is bindable by an agent. The classification exists so
 *      the refusal is structural; an agent principal is constructed with the
 *      read and propose classes only.
 *   3. Schemas are enforced in both directions, so a hallucinated or injected
 *      call is rejected rather than coerced.
 *
 * Note what is absent: there is no vehicle-actuation tool in this file, in
 * any environment. The capability does not exist to be enabled.
 */

import { validate } from './schema.js';

/** @enum {string} */
export const ToolClass = Object.freeze({
  /** Reads tenant-scoped data. Safe for an agent to call freely. */
  READ: 'read',
  /** Produces a proposal for a human. Causes no effect by itself. */
  PROPOSE: 'propose',
  /**
   * Causes a real-world effect. Never bindable by an agent; callable only by
   * the execution service holding a single-use approval token.
   */
  EXECUTE: 'execute',
});

/** Classes an agent principal may ever hold. EXECUTE is deliberately absent. */
export const AGENT_PERMITTED_CLASSES = Object.freeze([ToolClass.READ, ToolClass.PROPOSE]);

export class ToolRefusedError extends Error {
  /** @param {string} code @param {string} message @param {string[]} [problems] */
  constructor(code, message, problems = []) {
    super(message);
    this.name = 'ToolRefusedError';
    this.code = code;
    this.problems = problems;
  }
}

/**
 * @typedef {object} ToolDefinition
 * @property {string} name
 * @property {string} version
 * @property {string} description     shown to the model
 * @property {ToolClass} classification
 * @property {object} inputSchema
 * @property {object} outputSchema
 * @property {boolean} tenantScoped
 * @property {string[]} consentPurposes
 * @property {number} [costCeilingMinor]
 * @property {(input: object, context: object) => Promise<unknown>} handler
 */

export class ToolRegistry {
  constructor() {
    /** @type {Map<string, ToolDefinition>} */
    this.tools = new Map();
  }

  /** @param {ToolDefinition} tool */
  register(tool) {
    for (const field of ['name', 'version', 'description', 'classification', 'inputSchema', 'outputSchema']) {
      if (!tool[field]) throw new Error(`Tool definition is missing "${field}"`);
    }
    if (!Object.values(ToolClass).includes(tool.classification)) {
      throw new Error(`Tool "${tool.name}" has an unknown classification`);
    }
    if (typeof tool.handler !== 'function') {
      throw new Error(`Tool "${tool.name}" has no handler`);
    }
    if (this.tools.has(tool.name)) throw new Error(`Tool "${tool.name}" is already registered`);
    this.tools.set(tool.name, Object.freeze({ ...tool }));
    return this;
  }

  /**
   * The tools an agent principal may see and call. Anything classified
   * EXECUTE is filtered out here and cannot be reached from the agent loop.
   * @param {ToolClass[]} [permittedClasses]
   * @returns {ToolDefinition[]}
   */
  forAgent(permittedClasses = AGENT_PERMITTED_CLASSES) {
    const allowed = permittedClasses.filter((cls) => cls !== ToolClass.EXECUTE);
    return [...this.tools.values()].filter((tool) => allowed.includes(tool.classification));
  }

  /** The schema list handed to the model. Handlers are never exposed. */
  describeForModel(permittedClasses = AGENT_PERMITTED_CLASSES) {
    return this.forAgent(permittedClasses).map(({ name, description, inputSchema }) => ({
      name,
      description,
      inputSchema,
    }));
  }

  /**
   * Validates and invokes a tool call on behalf of an agent.
   *
   * Every refusal path returns a stable code so the reason is auditable and
   * can be shown to an operator.
   *
   * @param {{ name: string, input: unknown }} call
   * @param {object} context
   * @param {ToolClass[]} [permittedClasses]
   * @returns {Promise<unknown>}
   */
  async invokeAsAgent(call, context, permittedClasses = AGENT_PERMITTED_CLASSES) {
    const tool = this.tools.get(call.name);

    if (!tool) {
      throw new ToolRefusedError('TOOL_NOT_ALLOWLISTED', `No tool named "${call.name}" is registered`);
    }

    if (tool.classification === ToolClass.EXECUTE) {
      // Unreachable through forAgent(), kept as a hard second gate: an agent
      // must never reach an executing capability by any path.
      throw new ToolRefusedError(
        'EXECUTE_CLASS_FORBIDDEN',
        `Tool "${tool.name}" causes a real-world effect and requires human approval`,
      );
    }

    if (!permittedClasses.includes(tool.classification)) {
      throw new ToolRefusedError(
        'CLASS_NOT_PERMITTED',
        `This principal may not call ${tool.classification} tools`,
      );
    }

    if (tool.tenantScoped && !context.tenantId) {
      throw new ToolRefusedError('TENANT_CONTEXT_REQUIRED', `Tool "${tool.name}" requires a tenant context`);
    }

    const missingConsent = (tool.consentPurposes ?? []).filter(
      (purpose) => !(context.consentPurposes ?? []).includes(purpose),
    );
    if (missingConsent.length > 0) {
      throw new ToolRefusedError(
        'CONSENT_MISSING',
        `Tool "${tool.name}" requires consent for: ${missingConsent.join(', ')}`,
      );
    }

    const inputProblems = validate(call.input, tool.inputSchema);
    if (inputProblems.length > 0) {
      throw new ToolRefusedError('INPUT_SCHEMA_VIOLATION', `Invalid input for "${tool.name}"`, inputProblems);
    }

    const output = await tool.handler(/** @type {object} */ (call.input), context);

    const outputProblems = validate(output, tool.outputSchema);
    if (outputProblems.length > 0) {
      // A tool that returns something off-contract is a defect on our side,
      // and must not be fed back into the model as if it were trustworthy.
      throw new ToolRefusedError(
        'OUTPUT_SCHEMA_VIOLATION',
        `Tool "${tool.name}" returned an off-contract result`,
        outputProblems,
      );
    }

    return output;
  }
}

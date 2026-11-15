/**
 * Environment parsing for the agent service, fail-fast at boot.
 *
 * The model backend defaults to `deterministic` so the service always starts
 * and always demonstrates the same safety properties, with or without a key.
 */

import { MODEL_BACKENDS } from './model/provider.js';
import { DataClass, DEFAULT_PERMITTED_CLASSES, NEVER_PERMITTED } from './model/egress-policy.js';

/** @param {NodeJS.ProcessEnv} env */
export function readAgentEnvironment(env = process.env) {
  /** @type {string[]} */
  const problems = [];

  const integer = (key, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) => {
    const raw = env[key];
    if (raw === undefined || raw === '') return fallback;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < min || value > max) {
      problems.push(`${key} must be an integer between ${min} and ${max}`);
      return fallback;
    }
    return value;
  };

  const number = (key, fallback, { min = 0, max = 1 } = {}) => {
    const raw = env[key];
    if (raw === undefined || raw === '') return fallback;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < min || value > max) {
      problems.push(`${key} must be a number between ${min} and ${max}`);
      return fallback;
    }
    return value;
  };

  const config = {
    nodeEnv: env.NODE_ENV || 'development',
    port: integer('AGENT_PORT', 8082, { min: 0, max: 65535 }),
    host: env.AGENT_HOST || '0.0.0.0',
    logLevel: env.LOG_LEVEL || 'info',

    modelBackend: (env.MODEL_BACKEND || 'deterministic').toLowerCase(),
    modelName: env.MODEL_NAME || '',
    modelApiKey: env.MODEL_API_KEY || '',
    modelTimeoutMillis: integer('MODEL_TIMEOUT_MS', 30_000, { min: 1000, max: 180_000 }),
    modelMaxTokens: integer('MODEL_MAX_TOKENS', 2048, { min: 256, max: 32_000 }),
    modelTemperature: number('MODEL_TEMPERATURE', 0, { min: 0, max: 2 }),
    modelFallbackEnabled: (env.MODEL_FALLBACK_ENABLED ?? 'true') !== 'false',

    anthropicBaseUrl: env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
    // Required only for organisation-level keys, which are not bound to a
    // workspace. A workspace-scoped key needs no header.
    anthropicWorkspaceId: env.ANTHROPIC_WORKSPACE_ID || '',
    openaiBaseUrl: env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    azureApiVersion: env.AZURE_OPENAI_API_VERSION || '2024-10-21',
    ollamaBaseUrl: env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434',

    maxIterations: integer('AGENT_MAX_ITERATIONS', 8, { min: 1, max: 25 }),
    maxToolCallsPerTurn: integer('AGENT_MAX_TOOL_CALLS', 4, { min: 1, max: 10 }),
    proposalTtlMillis: integer('PROPOSAL_TTL_MS', 4 * 60 * 60 * 1000, { min: 1000, max: 7 * 24 * 3600 * 1000 }),
    fourEyesThresholdMinor: integer('FOUR_EYES_THRESHOLD_MINOR', 100_000, { min: 0 }),
    tenantBudgetMinor: integer('TENANT_BUDGET_MINOR', 5_000_000, { min: 0 }),

    requestTimeoutMillis: integer('AGENT_REQUEST_TIMEOUT_MS', 60_000, { min: 1000, max: 300_000 }),
    maxConcurrentRequests: integer('AGENT_MAX_CONCURRENT', 32, { min: 1, max: 10_000 }),
    shutdownGraceMillis: integer('SHUTDOWN_GRACE_MS', 15_000, { min: 0, max: 120_000 }),

    // Which data classes may cross the boundary to an external model.
    // Narrow by default and never configurable to include secrets or payment
    // data; see docs/architecture/25-model-data-governance.md.
    modelEgressPolicyEnabled: (env.MODEL_EGRESS_POLICY_ENABLED ?? 'true') !== 'false',
    modelPermittedDataClasses: (env.MODEL_PERMITTED_DATA_CLASSES || DEFAULT_PERMITTED_CLASSES.join(','))
      .split(',')
      .map((value) => value.trim().toUpperCase())
      .filter(Boolean),

    bestOffersUrl: env.BEST_OFFERS_URL || '',
    fixedClock: env.FIXED_CLOCK || '',
  };

  if (!MODEL_BACKENDS.includes(config.modelBackend)) {
    problems.push(`MODEL_BACKEND must be one of: ${MODEL_BACKENDS.join(', ')}`);
  }
  if (!['debug', 'info', 'warn', 'error'].includes(config.logLevel)) {
    problems.push('LOG_LEVEL must be one of debug, info, warn, error');
  }
  // A cloud backend without a key would fail on the first request; say so at boot.
  if (['anthropic', 'openai', 'azure-openai'].includes(config.modelBackend) && !config.modelApiKey) {
    problems.push(`MODEL_API_KEY is required when MODEL_BACKEND is ${config.modelBackend}`);
  }
  if (config.fixedClock !== '' && config.nodeEnv === 'production') {
    problems.push('FIXED_CLOCK must not be set when NODE_ENV is production');
  }
  for (const dataClass of config.modelPermittedDataClasses) {
    if (!Object.values(DataClass).includes(dataClass)) {
      problems.push(`MODEL_PERMITTED_DATA_CLASSES contains unknown class "${dataClass}"`);
    }
    if (NEVER_PERMITTED.includes(dataClass)) {
      // Not a typo to tolerate: someone has tried to authorise the
      // unauthorisable, and the service must not start.
      problems.push(`MODEL_PERMITTED_DATA_CLASSES must never include ${dataClass}`);
    }
  }
  if (!config.modelEgressPolicyEnabled && config.nodeEnv === 'production') {
    problems.push('MODEL_EGRESS_POLICY_ENABLED must not be false when NODE_ENV is production');
  }

  if (problems.length > 0) {
    throw new Error(`Invalid agent environment configuration: ${problems.join('; ')}`);
  }
  return Object.freeze(config);
}

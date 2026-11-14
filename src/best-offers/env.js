/**
 * Environment parsing with fail-fast validation.
 *
 * Configuration comes from the environment (12-factor); secrets never appear
 * in the image or repository. Invalid values stop the process at boot rather
 * than producing surprising behaviour under load.
 */

/**
 * @param {NodeJS.ProcessEnv} env
 */
export function readEnvironment(env = process.env) {
  /** @type {string[]} */
  const problems = [];

  const string = (key, fallback) => {
    const value = env[key];
    if (value === undefined || value === '') {
      if (fallback === undefined) problems.push(`${key} is required`);
      return fallback;
    }
    return value;
  };

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

  const url = (key, fallback) => {
    const value = string(key, fallback);
    try {
      const parsed = new URL(/** @type {string} */ (value));
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        problems.push(`${key} must be an http(s) URL`);
      }
    } catch {
      problems.push(`${key} must be a valid absolute URL`);
    }
    return value;
  };

  const config = {
    nodeEnv: string('NODE_ENV', 'development'),
    // 0 is allowed and means "bind an ephemeral port" - used by tests and the demo.
    port: integer('PORT', 8080, { min: 0, max: 65535 }),
    host: string('HOST', '0.0.0.0'),
    logLevel: string('LOG_LEVEL', 'info'),
    configPath: string('PRICING_CONFIG_PATH', 'config/pricing-config.json'),
    providerTelemetry1Url: url('PROVIDER_TELEMETRY1_URL', 'http://127.0.0.1:8081/provider/telemetry1'),
    providerTelemetry2Url: url('PROVIDER_TELEMETRY2_URL', 'http://127.0.0.1:8081/provider/telemetry2'),
    providerTimeoutMillis: integer('PROVIDER_TIMEOUT_MS', 2000, { min: 50, max: 60_000 }),
    providerMaxAttempts: integer('PROVIDER_MAX_ATTEMPTS', 3, { min: 1, max: 10 }),
    providerRetryInitialDelayMillis: integer('PROVIDER_RETRY_INITIAL_DELAY_MS', 100, { min: 0, max: 10_000 }),
    providerRetryMaxDelayMillis: integer('PROVIDER_RETRY_MAX_DELAY_MS', 1000, { min: 0, max: 30_000 }),
    providerRetryBudgetMillis: integer('PROVIDER_RETRY_BUDGET_MS', 5000, { min: 100, max: 120_000 }),
    providerMaxBodyBytes: integer('PROVIDER_MAX_BODY_BYTES', 8 * 1024 * 1024, { min: 1024 }),
    requestTimeoutMillis: integer('REQUEST_TIMEOUT_MS', 10_000, { min: 100, max: 120_000 }),
    maxConcurrentRequests: integer('MAX_CONCURRENT_REQUESTS', 256, { min: 1, max: 100_000 }),
    shutdownGraceMillis: integer('SHUTDOWN_GRACE_MS', 15_000, { min: 0, max: 120_000 }),
    adminToken: env.ADMIN_TOKEN ?? '',
    fixedClock: env.FIXED_CLOCK ?? '',
    configWatchEnabled: (env.CONFIG_WATCH_ENABLED ?? 'true') !== 'false',
  };

  if (!['debug', 'info', 'warn', 'error'].includes(config.logLevel)) {
    problems.push('LOG_LEVEL must be one of debug, info, warn, error');
  }
  if (config.providerRetryMaxDelayMillis < config.providerRetryInitialDelayMillis) {
    problems.push('PROVIDER_RETRY_MAX_DELAY_MS must not be below PROVIDER_RETRY_INITIAL_DELAY_MS');
  }
  if (config.fixedClock !== '' && config.nodeEnv === 'production') {
    // A pinned clock makes every freshness and expiry check pass forever,
    // which is precisely the stale-offer behaviour the contract forbids.
    problems.push('FIXED_CLOCK must not be set when NODE_ENV is production');
  }

  if (problems.length > 0) {
    throw new Error(`Invalid environment configuration: ${problems.join('; ')}`);
  }
  return Object.freeze(config);
}

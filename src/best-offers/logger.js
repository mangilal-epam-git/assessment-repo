/**
 * Structured JSON logging with deny-list redaction.
 *
 * The platform collects a full traffic-event stream for behavioural analytics
 * and audit, but the brief is explicit that this is not permission to log
 * secrets or payment details. Redaction is enforced here so that no call site
 * has to remember it.
 */

const REDACTED = '[redacted]';

const SENSITIVE_KEY_PATTERN =
  /(pass(word)?|secret|token|api[-_]?key|authorization|cookie|credential|pan|card(number)?|cvv|cvc|iban|ssn|vin|latitude|longitude|geo|coordinates)/i;

const MAX_STRING_LENGTH = 512;
const MAX_DEPTH = 6;

/**
 * @param {unknown} value
 * @param {number} depth
 * @returns {unknown}
 */
function sanitise(value, depth = 0) {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'string') {
    return value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH)}...` : value;
  }
  if (value instanceof Error) {
    return { name: value.name, message: sanitise(value.message, depth + 1) };
  }
  if (depth >= MAX_DEPTH) return '[truncated]';
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitise(item, depth + 1));
  if (typeof value === 'object') {
    /** @type {Record<string, unknown>} */
    const output = {};
    for (const [key, item] of Object.entries(/** @type {object} */ (value))) {
      output[key] = SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : sanitise(item, depth + 1);
    }
    return output;
  }
  return undefined;
}

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

export class Logger {
  /**
   * @param {object} [options]
   * @param {keyof LEVELS} [options.level]
   * @param {Record<string, unknown>} [options.base]
   * @param {(line: string) => void} [options.sink]
   */
  constructor({ level = 'info', base = {}, sink } = {}) {
    this.level = LEVELS[level] ?? LEVELS.info;
    this.base = base;
    this.sink = sink ?? ((line) => process.stdout.write(`${line}\n`));
  }

  /** @param {Record<string, unknown>} fields */
  child(fields) {
    const child = new Logger({ base: { ...this.base, ...fields }, sink: this.sink });
    child.level = this.level;
    return child;
  }

  #write(level, message, fields) {
    if (LEVELS[level] < this.level) return;
    const record = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...(/** @type {object} */ (sanitise({ ...this.base, ...fields }))),
    };
    try {
      this.sink(JSON.stringify(record));
    } catch {
      // Logging must never take the process down.
    }
  }

  debug(message, fields = {}) { this.#write('debug', message, fields); }
  info(message, fields = {}) { this.#write('info', message, fields); }
  warn(message, fields = {}) { this.#write('warn', message, fields); }
  error(message, fields = {}) { this.#write('error', message, fields); }
}

export { sanitise as sanitiseLogFields };

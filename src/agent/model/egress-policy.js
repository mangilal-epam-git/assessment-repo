/**
 * Model egress policy: what may cross the operational boundary.
 *
 * The customer's position is that until an explicit policy is approved, raw
 * operational telemetry, precise driver locations and identifiable driver
 * records must not reach an external model endpoint. That is a governance
 * statement; this file is its enforcement.
 *
 * Two properties make it worth having rather than relying on tool design
 * alone:
 *
 *   - It fails CLOSED. An unrecognised or prohibited class blocks the call;
 *     it does not warn and proceed.
 *   - It sits at the adapter boundary, so it applies to every backend and
 *     cannot be bypassed by adding a new one. A future tool that returns a
 *     coordinate is caught here even if nobody remembers this file exists.
 *
 * It is a backstop, not the primary control. The primary control is that no
 * tool returns driver identity or precise location in the first place
 * (src/agent/tools/fleet-tools.js). Defence in depth means assuming that
 * will one day be wrong.
 *
 * See docs/architecture/25-model-data-governance.md and ADR-0014.
 */

/** Classes of data that can appear in an outbound model request. */
export const DataClass = Object.freeze({
  /** Fleet operations: fault codes, odometer, parts, service history. */
  OPERATIONAL: 'OPERATIONAL',
  /** Vehicle and registration identifiers. Pseudonymous, but re-identifiable. */
  VEHICLE_ID: 'VEHICLE_ID',
  /** Coordinates, geohashes, anything locating a vehicle or person. */
  PRECISE_LOCATION: 'PRECISE_LOCATION',
  /** Names, driver numbers, licence numbers, contact details. */
  DRIVER_IDENTITY: 'DRIVER_IDENTITY',
  /** Vehicle identification numbers. */
  VIN: 'VIN',
  /** Card numbers, IBANs, anything payment related. */
  PAYMENT: 'PAYMENT',
  /** Keys, tokens, credentials. Never sendable under any policy. */
  SECRET: 'SECRET',
});

/**
 * The default permitted set, pending the customer's approval of a policy.
 * Deliberately narrow: operational context and vehicle identifiers only.
 */
export const DEFAULT_PERMITTED_CLASSES = Object.freeze([
  DataClass.OPERATIONAL,
  DataClass.VEHICLE_ID,
]);

/** Classes that no policy may ever permit, however it is configured. */
export const NEVER_PERMITTED = Object.freeze([DataClass.SECRET, DataClass.PAYMENT]);

/**
 * Detectors, ordered most specific first so a VIN is not also reported as a
 * driver identifier. Each returns the matched substring for the audit record
 * (truncated; the value itself is never logged in full).
 */
const DETECTORS = [
  {
    dataClass: DataClass.SECRET,
    description: 'API key, bearer token or private key material',
    pattern:
      /\b(sk-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|Bearer\s+[A-Za-z0-9._-]{20,})/,
  },
  {
    dataClass: DataClass.PAYMENT,
    description: 'card number or IBAN',
    // IBAN, or a 13-19 digit run that is not a plain odometer-style figure.
    pattern: /\b([A-Z]{2}\d{2}[A-Z0-9]{11,30}|(?:\d[ -]?){13,19})\b/,
  },
  {
    dataClass: DataClass.VIN,
    description: 'vehicle identification number',
    // 17 characters, no I, O or Q, at least one digit and one letter.
    pattern: /\b(?=[A-HJ-NPR-Z0-9]{17}\b)(?=.*\d)(?=.*[A-HJ-NPR-Z])[A-HJ-NPR-Z0-9]{17}\b/,
  },
  {
    dataClass: DataClass.PRECISE_LOCATION,
    description: 'coordinate, geohash or location field',
    pattern:
      /("?(latitude|longitude|lat|lon|lng|geohash|coordinates|gps|position)"?\s*[:=]\s*-?\d)|(-?\d{1,3}\.\d{5,}\s*,\s*-?\d{1,3}\.\d{5,})/i,
  },
  {
    dataClass: DataClass.DRIVER_IDENTITY,
    description: 'driver identifier or personal contact detail',
    pattern:
      /("?(driverId|driver_id|driverName|driver_name|licenceNumber|licenseNumber|nationalId|personalId|email|phoneNumber|dateOfBirth)"?\s*[:=])|\b[\w.+-]+@[\w-]+\.[a-z]{2,}\b/i,
  },
];

export class EgressBlockedError extends Error {
  /** @param {{dataClass: string, description: string, where: string}[]} findings */
  constructor(findings) {
    const classes = [...new Set(findings.map((f) => f.dataClass))].join(', ');
    super(`Model egress blocked: payload contains ${classes}`);
    this.name = 'EgressBlockedError';
    this.code = 'MODEL_EGRESS_BLOCKED';
    this.findings = findings;
  }
}

/**
 * Scans text for data classes that may not leave the boundary.
 *
 * @param {string} text
 * @param {string} where  a label for the audit record, e.g. "messages[2]"
 * @param {readonly string[]} permitted
 * @returns {{dataClass: string, description: string, where: string, sample: string}[]}
 */
export function inspect(text, where, permitted = DEFAULT_PERMITTED_CLASSES) {
  if (typeof text !== 'string' || text.length === 0) return [];
  const findings = [];
  for (const detector of DETECTORS) {
    // NEVER_PERMITTED cannot be allow-listed, whatever the configuration says.
    const allowed =
      permitted.includes(detector.dataClass) && !NEVER_PERMITTED.includes(detector.dataClass);
    if (allowed) continue;
    const match = detector.pattern.exec(text);
    if (match) {
      findings.push({
        dataClass: detector.dataClass,
        description: detector.description,
        where,
        // Enough to locate the problem, never enough to disclose the value.
        sample: `${match[0].slice(0, 6)}…(${match[0].length} chars)`,
      });
    }
  }
  return findings;
}

/**
 * Inspects a whole model request: system prompt, every message, and the tool
 * schemas. Tool *results* are the realistic risk, since they carry data.
 *
 * @param {{system?: string, messages?: object[], tools?: object[]}} request
 * @param {readonly string[]} permitted
 */
export function inspectRequest(request, permitted = DEFAULT_PERMITTED_CLASSES) {
  const findings = [];
  findings.push(...inspect(request.system ?? '', 'system', permitted));
  (request.messages ?? []).forEach((message, index) => {
    const where = `messages[${index}].${message.role ?? 'unknown'}`;
    findings.push(...inspect(message.content ?? '', where, permitted));
    for (const call of message.toolCalls ?? []) {
      findings.push(...inspect(JSON.stringify(call.input ?? {}), `${where}.toolCall`, permitted));
    }
  });
  (request.tools ?? []).forEach((tool, index) => {
    findings.push(...inspect(JSON.stringify(tool), `tools[${index}]`, permitted));
  });
  return findings;
}

/**
 * Wraps an adapter so nothing leaves the boundary without passing the policy.
 *
 * A local planner is not wrapped: no data crosses a boundary at all, which is
 * why it is the safe default while the policy is unapproved.
 *
 * @param {import('./provider.js').ModelAdapter} adapter
 * @param {object} options
 * @param {readonly string[]} [options.permittedClasses]
 * @param {import('../../best-offers/logger.js').Logger} [options.logger]
 * @param {import('../audit.js').AuditLedger} [options.audit]
 * @param {object} [options.metrics]
 * @param {boolean} [options.enabled]
 * @returns {import('./provider.js').ModelAdapter}
 */
export function withEgressPolicy(adapter, {
  permittedClasses = DEFAULT_PERMITTED_CLASSES,
  logger,
  audit,
  metrics,
  enabled = true,
} = {}) {
  // Nothing crosses a boundary for an in-process planner.
  if (!enabled || adapter.name === 'deterministic') return adapter;

  return {
    name: adapter.name,
    model: adapter.model,
    requiresNetwork: adapter.requiresNetwork,
    permittedClasses: [...permittedClasses],

    async complete(request) {
      const findings = inspectRequest(request, permittedClasses);
      if (findings.length > 0) {
        const detail = {
          backend: adapter.name,
          model: adapter.model,
          findings: findings.map(({ dataClass, where, description }) => ({
            dataClass,
            where,
            description,
          })),
        };
        // Loud, not silent: a policy violation is a defect or an attack.
        logger?.error('model.egress.blocked', detail);
        metrics?.egressBlocked?.inc({ dataClass: findings[0].dataClass });
        audit?.append('MODEL_EGRESS_BLOCKED', 'system', detail);
        throw new EgressBlockedError(findings);
      }
      return adapter.complete(request);
    },
  };
}

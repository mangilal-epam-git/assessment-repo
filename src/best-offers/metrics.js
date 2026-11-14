/**
 * Minimal Prometheus text-exposition metrics.
 *
 * Deliberately dependency-free: the brief forbids turnkey marketplace/agent
 * products and we keep the runtime closed, but observability is a hard
 * non-functional requirement, so a small in-process registry is used and
 * scraped at /metrics.
 */

/** @param {Record<string, string|number>} labels */
function renderLabels(labels) {
  const entries = Object.entries(labels);
  if (entries.length === 0) return '';
  const body = entries
    .map(([key, value]) => `${key}="${String(value).replace(/(["\\])/g, '\\$1').replace(/\n/g, '\\n')}"`)
    .join(',');
  return `{${body}}`;
}

class Metric {
  constructor(name, help, type) {
    this.name = name;
    this.help = help;
    this.type = type;
    /** @type {Map<string, { labels: Record<string, string|number>, value: number }>} */
    this.series = new Map();
  }

  #key(labels) {
    return JSON.stringify(Object.keys(labels).sort().map((k) => [k, labels[k]]));
  }

  /** @param {Record<string, string|number>} labels */
  _entry(labels) {
    const key = this.#key(labels);
    let entry = this.series.get(key);
    if (!entry) {
      entry = { labels, value: 0 };
      this.series.set(key, entry);
    }
    return entry;
  }
}

export class Counter extends Metric {
  constructor(name, help) { super(name, help, 'counter'); }
  /** @param {Record<string, string|number>} [labels] @param {number} [amount] */
  inc(labels = {}, amount = 1) { this._entry(labels).value += amount; }
}

export class Gauge extends Metric {
  constructor(name, help) { super(name, help, 'gauge'); }
  /** @param {number} value @param {Record<string, string|number>} [labels] */
  set(value, labels = {}) { this._entry(labels).value = value; }
  inc(labels = {}, amount = 1) { this._entry(labels).value += amount; }
  dec(labels = {}, amount = 1) { this._entry(labels).value -= amount; }
}

export class Histogram extends Metric {
  /** @param {string} name @param {string} help @param {number[]} buckets seconds */
  constructor(name, help, buckets = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]) {
    super(name, help, 'histogram');
    this.buckets = [...buckets].sort((a, b) => a - b);
    /** @type {Map<string, { labels: Record<string, string|number>, counts: number[], sum: number, count: number }>} */
    this.observations = new Map();
  }

  /** @param {number} seconds @param {Record<string, string|number>} [labels] */
  observe(seconds, labels = {}) {
    const key = JSON.stringify(Object.keys(labels).sort().map((k) => [k, labels[k]]));
    let entry = this.observations.get(key);
    if (!entry) {
      entry = { labels, counts: new Array(this.buckets.length).fill(0), sum: 0, count: 0 };
      this.observations.set(key, entry);
    }
    entry.sum += seconds;
    entry.count += 1;
    for (let i = 0; i < this.buckets.length; i += 1) {
      if (seconds <= this.buckets[i]) entry.counts[i] += 1;
    }
  }
}

export class Registry {
  constructor() {
    /** @type {Metric[]} */
    this.metrics = [];
  }

  /** @template {Metric} T @param {T} metric @returns {T} */
  register(metric) {
    this.metrics.push(metric);
    return metric;
  }

  /** @returns {string} Prometheus text exposition format */
  render() {
    const lines = [];
    for (const metric of this.metrics) {
      lines.push(`# HELP ${metric.name} ${metric.help}`);
      lines.push(`# TYPE ${metric.name} ${metric.type}`);
      if (metric instanceof Histogram) {
        for (const entry of metric.observations.values()) {
          let cumulative = 0;
          for (let i = 0; i < metric.buckets.length; i += 1) {
            cumulative = entry.counts[i];
            lines.push(
              `${metric.name}_bucket${renderLabels({ ...entry.labels, le: metric.buckets[i] })} ${cumulative}`,
            );
          }
          lines.push(`${metric.name}_bucket${renderLabels({ ...entry.labels, le: '+Inf' })} ${entry.count}`);
          lines.push(`${metric.name}_sum${renderLabels(entry.labels)} ${entry.sum}`);
          lines.push(`${metric.name}_count${renderLabels(entry.labels)} ${entry.count}`);
        }
      } else {
        for (const entry of metric.series.values()) {
          lines.push(`${metric.name}${renderLabels(entry.labels)} ${entry.value}`);
        }
      }
    }
    return `${lines.join('\n')}\n`;
  }
}

/** Creates the application metric set. */
export function createMetrics() {
  const registry = new Registry();
  return {
    registry,
    httpRequests: registry.register(
      new Counter('vh_http_requests_total', 'HTTP requests by route, method and status.'),
    ),
    httpDuration: registry.register(
      new Histogram('vh_http_request_duration_seconds', 'HTTP request duration in seconds.'),
    ),
    inFlight: registry.register(
      new Gauge('vh_http_in_flight_requests', 'Requests currently being served.'),
    ),
    providerRequests: registry.register(
      new Counter('vh_provider_requests_total', 'Provider fetch attempts by provider and outcome.'),
    ),
    providerRetries: registry.register(
      new Counter('vh_provider_retries_total', 'Provider fetch retries by provider and cause.'),
    ),
    providerDuration: registry.register(
      new Histogram('vh_provider_request_duration_seconds', 'Provider fetch duration in seconds.'),
    ),
    providerUnavailable: registry.register(
      new Counter('vh_provider_unavailable_total', 'Provider responses that yielded no usable array.'),
    ),
    rowsRejected: registry.register(
      new Counter('vh_rows_rejected_total', 'Rejected provider rows by provider and reason.'),
    ),
    offersReturned: registry.register(
      new Counter('vh_offers_returned_total', 'Winning offers returned, by provider.'),
    ),
    partialResponses: registry.register(
      new Counter('vh_partial_responses_total', 'Responses returned with partial=true.'),
    ),
    configReloads: registry.register(
      new Counter('vh_config_reloads_total', 'Configuration reload attempts by outcome.'),
    ),
    rejectedLoad: registry.register(
      new Counter('vh_rejected_load_total', 'Requests shed by the concurrency limiter.'),
    ),
    requestsAborted: registry.register(
      new Counter('vh_requests_aborted_total', 'Requests ended by a deadline or shutdown.'),
    ),
  };
}

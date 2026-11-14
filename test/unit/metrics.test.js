import test from 'node:test';
import assert from 'node:assert/strict';
import { Registry, Counter, Gauge, Histogram, createMetrics } from '../../src/best-offers/metrics.js';

test('counters accumulate per label set', () => {
  const registry = new Registry();
  const counter = registry.register(new Counter('vh_test_total', 'Test counter.'));
  counter.inc({ route: '/a' });
  counter.inc({ route: '/a' });
  counter.inc({ route: '/b' }, 5);
  const output = registry.render();
  assert.match(output, /# TYPE vh_test_total counter/);
  assert.match(output, /vh_test_total\{route="\/a"\} 2/);
  assert.match(output, /vh_test_total\{route="\/b"\} 5/);
});

test('label order does not create duplicate series', () => {
  const registry = new Registry();
  const counter = registry.register(new Counter('vh_labels_total', 'Labels.'));
  counter.inc({ a: '1', b: '2' });
  counter.inc({ b: '2', a: '1' });
  const lines = registry.render().split('\n').filter((l) => l.startsWith('vh_labels_total'));
  assert.equal(lines.length, 1);
  assert.match(lines[0], / 2$/);
});

test('gauges set, increment and decrement', () => {
  const registry = new Registry();
  const gauge = registry.register(new Gauge('vh_gauge', 'Gauge.'));
  gauge.set(10);
  gauge.inc();
  gauge.dec({}, 4);
  assert.match(registry.render(), /vh_gauge 7/);
});

test('histograms expose cumulative buckets, sum and count', () => {
  const registry = new Registry();
  const histogram = registry.register(new Histogram('vh_hist', 'Hist.', [0.1, 1]));
  histogram.observe(0.05, { route: '/a' });
  histogram.observe(0.5, { route: '/a' });
  histogram.observe(5, { route: '/a' });
  const output = registry.render();
  assert.match(output, /vh_hist_bucket\{route="\/a",le="0.1"\} 1/);
  assert.match(output, /vh_hist_bucket\{route="\/a",le="1"\} 2/);
  assert.match(output, /vh_hist_bucket\{route="\/a",le="\+Inf"\} 3/);
  assert.match(output, /vh_hist_count\{route="\/a"\} 3/);
  assert.match(output, /vh_hist_sum\{route="\/a"\} 5.55/);
});

test('label values are escaped so the exposition format stays parseable', () => {
  const registry = new Registry();
  const counter = registry.register(new Counter('vh_escape_total', 'Escape.'));
  counter.inc({ reason: 'a"b\\c\nd' });
  assert.match(registry.render(), /reason="a\\"b\\\\c\\nd"/);
});

test('a metric with no observations still renders its HELP and TYPE', () => {
  const registry = new Registry();
  registry.register(new Counter('vh_empty_total', 'Nothing yet.'));
  const output = registry.render();
  assert.match(output, /# HELP vh_empty_total Nothing yet\./);
  assert.match(output, /# TYPE vh_empty_total counter/);
});

test('the application metric set covers the required signals', () => {
  const metrics = createMetrics();
  for (const name of [
    'httpRequests', 'httpDuration', 'inFlight', 'providerRequests', 'providerRetries',
    'providerDuration', 'providerUnavailable', 'rowsRejected', 'offersReturned',
    'partialResponses', 'configReloads', 'rejectedLoad',
  ]) {
    assert.ok(metrics[name], `${name} metric should exist`);
  }
  assert.match(metrics.registry.render(), /vh_http_requests_total/);
});

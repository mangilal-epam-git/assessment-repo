#!/usr/bin/env node
/**
 * Deterministic end-to-end demo: starts the mock providers and the service
 * with the fixed fixture clock, prints the /best-offers response, exits.
 * Used by `npm run demo` and by the README walkthrough.
 */
import { startMockProviders } from '../src/mock-providers/server.js';
import { startServer } from '../src/best-offers/server.js';

const FIXTURE_INSTANT = '2026-06-15T10:05:00Z';

const mocks = await startMockProviders({ port: 0, host: '127.0.0.1' });
const app = await startServer({
  env: {
    ...process.env,
    PORT: '0',
    HOST: '127.0.0.1',
    LOG_LEVEL: process.env.LOG_LEVEL ?? 'warn',
    FIXED_CLOCK: FIXTURE_INSTANT,
    CONFIG_WATCH_ENABLED: 'false',
    PROVIDER_TELEMETRY1_URL: `${mocks.baseUrl}/provider/telemetry1`,
    PROVIDER_TELEMETRY2_URL: `${mocks.baseUrl}/provider/telemetry2`,
  },
});

const response = await fetch(`http://127.0.0.1:${app.port}/best-offers`);
const body = await response.json();
process.stdout.write(`HTTP ${response.status}\n${JSON.stringify(body, null, 2)}\n`);

await app.close();
await mocks.close();

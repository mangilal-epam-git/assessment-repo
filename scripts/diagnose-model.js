#!/usr/bin/env node
/**
 * Explains which inference backend this process would actually use, and why.
 *
 * Environment variables are read once at boot, so the commonest cause of
 * "I set MODEL_BACKEND but it still says deterministic" is that the variables
 * were set in a different shell from the one running the service, or that the
 * service was never restarted. This prints what the process can genuinely see.
 *
 *   node scripts/diagnose-model.js          inspect configuration only
 *   node scripts/diagnose-model.js --ping   also make one real call to the backend
 */
import { readAgentEnvironment } from '../src/agent/env.js';
import { createModelAdapter, withDeterministicFallback } from '../src/agent/model/provider.js';

const out = (line = '') => process.stdout.write(`${line}\n`);

/** Never print a credential; show only enough to confirm which one is set. */
function fingerprint(value) {
  if (!value) return '(not set)';
  if (value.length <= 8) return `set, ${value.length} chars`;
  return `set, ${value.length} chars, ${value.slice(0, 4)}…${value.slice(-2)}`;
}

out('Environment as this process sees it');
out('-----------------------------------');
for (const key of [
  'MODEL_BACKEND', 'MODEL_NAME', 'MODEL_FALLBACK_ENABLED',
  'ANTHROPIC_BASE_URL', 'OPENAI_BASE_URL', 'OLLAMA_BASE_URL', 'AZURE_OPENAI_API_VERSION',
]) {
  out(`  ${key.padEnd(26)} ${process.env[key] ?? '(not set)'}`);
}
out(`  ${'MODEL_API_KEY'.padEnd(26)} ${fingerprint(process.env.MODEL_API_KEY)}`);
out();

let config;
try {
  config = readAgentEnvironment();
} catch (error) {
  out('Configuration REJECTED at startup');
  out('---------------------------------');
  out(`  ${error.message}`);
  out();
  out('The service would refuse to start with this environment, so if it is');
  out('running, it is running with different variables from these.');
  process.exit(1);
}

const primary = createModelAdapter(config);
const adapter = withDeterministicFallback(primary, { enabled: config.modelFallbackEnabled });

out('Resolved backend');
out('----------------');
out(`  backend reported   ${adapter.name}`);
out(`  model reported     ${adapter.model}`);
out(`  needs the network  ${primary.requiresNetwork ? 'yes' : 'no'}`);
out();

if (adapter.name === 'deterministic') {
  out('>> No model is configured. The built-in rule-based planner will answer.');
  out('   If you expected otherwise, MODEL_BACKEND is not set in THIS shell.');
  out('   Set it, then start the service from the same shell:');
  out();
  out('     PowerShell:  $env:MODEL_BACKEND = "anthropic"');
  out('                  $env:MODEL_API_KEY = "sk-ant-..."');
  out('                  $env:MODEL_NAME    = "claude-sonnet-4-5"');
  out('                  node src\\agent\\server.js');
} else {
  out(`>> ${primary.name} is active.`);
  if (adapter.name.endsWith('+fallback')) {
    out('   The "+fallback" suffix is expected: the deterministic planner stands by');
    out('   in case the backend fails, and any substitution is reported in the answer.');
  }
}
out();

if (!process.argv.includes('--ping')) {
  out('Add --ping to make one real call and confirm the credential works.');
  process.exit(0);
}

if (!primary.requiresNetwork && primary.name === 'deterministic') {
  out('Nothing to ping: no backend is configured.');
  process.exit(0);
}

out('Live check');
out('----------');
try {
  const reply = await primary.complete({
    system: 'Reply with the single word: ready',
    messages: [{ role: 'user', content: 'Reply with the single word: ready' }],
    tools: [],
  });
  out(`  PASS  ${primary.name} answered as ${reply.model}`);
  if (reply.text) out(`        "${reply.text.slice(0, 80)}"`);
} catch (error) {
  out(`  FAIL  ${error.message}`);
  out();
  out('  Common causes:');
  out('    HTTP 401/403   the key is wrong, revoked, or for a different product');
  out('    HTTP 404       wrong model name, or wrong deployment name on Azure');
  out('    timed out      no outbound network, or a corporate proxy intercepting TLS');
  out('    ENOTFOUND      the base URL is wrong');
  out();
  out('  The service still works: it falls back to the deterministic planner and');
  out('  reports the substitution rather than failing the turn.');
  process.exit(1);
}

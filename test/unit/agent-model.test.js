/**
 * Model adapter tests.
 *
 * Each adapter is exercised against a local stub server that mimics the real
 * API wire format, so the request shape and the response parsing are both
 * tested without a network, a key or a bill.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createModelAdapter, withDeterministicFallback, parseArguments, MODEL_BACKENDS } from '../../src/agent/model/provider.js';
import { createDeterministicAdapter } from '../../src/agent/model/deterministic.js';

/** Starts a stub endpoint that records what it was sent. */
async function stub(handler) {
  const received = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      received.push({ url: req.url, headers: req.headers, body: body ? JSON.parse(body) : null });
      const { status = 200, payload = {} } = handler(received.at(-1)) ?? {};
      const text = JSON.stringify(payload);
      res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) });
      res.end(text);
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    received,
    port: server.address().port,
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => { server.closeAllConnections?.(); server.close(resolve); }),
  };
}

const baseConfig = {
  modelApiKey: 'test-key',
  modelTimeoutMillis: 3000,
  modelMaxTokens: 512,
  modelTemperature: 0,
  azureApiVersion: '2024-10-21',
};

const request = {
  system: 'You are a test.',
  messages: [{ role: 'user', content: 'hello' }],
  tools: [{ name: 'list_vehicles', description: 'd', inputSchema: { type: 'object', properties: {} } }],
};

test('the backend list is the documented set', () => {
  assert.deepEqual([...MODEL_BACKENDS], ['deterministic', 'anthropic', 'openai', 'azure-openai', 'ollama']);
});

test('anthropic adapter sends the documented shape and parses tool use', async (t) => {
  const server = await stub(() => ({
    payload: {
      model: 'claude-sonnet-4-5',
      stop_reason: 'tool_use',
      content: [
        { type: 'text', text: 'Looking at the fleet.' },
        { type: 'tool_use', id: 'tu_1', name: 'list_vehicles', input: {} },
      ],
    },
  }));
  t.after(() => server.close());

  const adapter = createModelAdapter({
    ...baseConfig,
    modelBackend: 'anthropic',
    anthropicBaseUrl: server.url,
    modelName: 'claude-sonnet-4-5',
  });
  const reply = await adapter.complete(request);

  assert.equal(reply.text, 'Looking at the fleet.');
  assert.deepEqual(reply.toolCalls, [{ id: 'tu_1', name: 'list_vehicles', input: {} }]);
  assert.equal(reply.model, 'claude-sonnet-4-5');

  const sent = server.received[0];
  assert.equal(sent.url, '/v1/messages');
  assert.equal(sent.headers['x-api-key'], 'test-key');
  assert.equal(sent.headers['anthropic-version'], '2023-06-01');
  assert.equal(sent.body.system, 'You are a test.');
  assert.equal(sent.body.tools[0].input_schema.type, 'object', 'anthropic uses input_schema');
});

test('anthropic adapter carries tool results back on a user turn', async (t) => {
  const server = await stub(() => ({ payload: { content: [{ type: 'text', text: 'done' }] } }));
  t.after(() => server.close());
  const adapter = createModelAdapter({ ...baseConfig, modelBackend: 'anthropic', anthropicBaseUrl: server.url });

  await adapter.complete({
    ...request,
    messages: [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'tu_1', name: 'list_vehicles', input: {} }] },
      { role: 'tool', toolCallId: 'tu_1', toolName: 'list_vehicles', content: '{"vehicles":[]}' },
    ],
  });

  const messages = server.received[0].body.messages;
  assert.equal(messages.at(-1).role, 'user');
  assert.equal(messages.at(-1).content[0].type, 'tool_result');
  assert.equal(messages.at(-1).content[0].tool_use_id, 'tu_1');
});

test('openai adapter sends the function-calling shape and parses tool calls', async (t) => {
  const server = await stub(() => ({
    payload: {
      model: 'gpt-4o-mini',
      choices: [
        {
          finish_reason: 'tool_calls',
          message: {
            content: 'Checking.',
            tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'list_vehicles', arguments: '{"a":1}' } }],
          },
        },
      ],
    },
  }));
  t.after(() => server.close());

  const adapter = createModelAdapter({ ...baseConfig, modelBackend: 'openai', openaiBaseUrl: server.url });
  const reply = await adapter.complete(request);

  assert.equal(reply.text, 'Checking.');
  assert.deepEqual(reply.toolCalls, [{ id: 'call_1', name: 'list_vehicles', input: { a: 1 } }]);

  const sent = server.received[0];
  assert.equal(sent.url, '/chat/completions');
  assert.equal(sent.headers.authorization, 'Bearer test-key');
  assert.equal(sent.body.messages[0].role, 'system');
  assert.equal(sent.body.tools[0].type, 'function');
  assert.equal(sent.body.tool_choice, 'auto');
});

test('azure uses the deployment URL and api-key header', async (t) => {
  const server = await stub(() => ({ payload: { choices: [{ message: { content: 'ok' } }] } }));
  t.after(() => server.close());

  const adapter = createModelAdapter({
    ...baseConfig,
    modelBackend: 'azure-openai',
    openaiBaseUrl: server.url,
    modelName: 'my-deployment',
  });
  const reply = await adapter.complete(request);
  assert.equal(reply.text, 'ok');
  assert.equal(adapter.name, 'azure-openai');

  const sent = server.received[0];
  assert.match(sent.url, /^\/openai\/deployments\/my-deployment\/chat\/completions\?api-version=2024-10-21$/);
  assert.equal(sent.headers['api-key'], 'test-key');
  assert.equal(sent.headers.authorization, undefined, 'azure must not send a bearer token');
});

test('ollama adapter targets the local chat endpoint and needs no key', async (t) => {
  const server = await stub(() => ({
    payload: {
      model: 'llama3.1',
      done_reason: 'stop',
      message: { content: 'local answer', tool_calls: [{ function: { name: 'list_vehicles', arguments: { x: 2 } } }] },
    },
  }));
  t.after(() => server.close());

  const adapter = createModelAdapter({ ...baseConfig, modelApiKey: '', modelBackend: 'ollama', ollamaBaseUrl: server.url });
  const reply = await adapter.complete(request);

  assert.equal(reply.text, 'local answer');
  assert.equal(reply.toolCalls[0].name, 'list_vehicles');
  assert.deepEqual(reply.toolCalls[0].input, { x: 2 });
  assert.equal(server.received[0].url, '/api/chat');
  assert.equal(server.received[0].body.stream, false);
});

test('a cloud adapter without a key fails before making a request', async () => {
  const adapter = createModelAdapter({ ...baseConfig, modelApiKey: '', modelBackend: 'anthropic' });
  await assert.rejects(() => adapter.complete(request), /MODEL_API_KEY is required/);
});

test('an HTTP error does not leak the provider body', async (t) => {
  const server = await stub(() => ({ status: 500, payload: { error: 'internal detail that must not surface' } }));
  t.after(() => server.close());
  const adapter = createModelAdapter({ ...baseConfig, modelBackend: 'anthropic', anthropicBaseUrl: server.url });
  await assert.rejects(
    () => adapter.complete(request),
    (error) => /HTTP 500/.test(error.message) && !/internal detail/.test(error.message),
  );
});

test('an unknown backend falls back to the deterministic planner', () => {
  const adapter = createModelAdapter({ ...baseConfig, modelBackend: 'hal9000' });
  assert.equal(adapter.name, 'deterministic');
});

test('the fallback wrapper keeps the assistant working when a backend fails', async (t) => {
  const server = await stub(() => ({ status: 503, payload: {} }));
  t.after(() => server.close());

  const primary = createModelAdapter({ ...baseConfig, modelBackend: 'anthropic', anthropicBaseUrl: server.url });
  const adapter = withDeterministicFallback(primary);
  const reply = await adapter.complete({ ...request, messages: [{ role: 'user', content: 'review the fleet' }] });

  // It answered, and it said which model actually answered: never silent.
  assert.ok(reply.toolCalls.length > 0 || reply.text.length > 0);
  assert.match(reply.model, /deterministic-planner-1 \(fallback from/);
});

test('fallback can be switched off, and never wraps the deterministic planner', () => {
  const primary = createModelAdapter({ ...baseConfig, modelBackend: 'anthropic' });
  assert.equal(withDeterministicFallback(primary, { enabled: false }), primary);
  const det = createDeterministicAdapter();
  assert.equal(withDeterministicFallback(det).name, 'deterministic');
});

test('malformed tool-call arguments become an empty object, never a coerced call', () => {
  assert.deepEqual(parseArguments('{"a":1}'), { a: 1 });
  assert.deepEqual(parseArguments('not json'), {});
  assert.deepEqual(parseArguments(null), {});
  assert.deepEqual(parseArguments('"a string"'), {});
  assert.deepEqual(parseArguments({ already: 'object' }), { already: 'object' });
});

test('the deterministic planner walks the expected tool sequence', async () => {
  const adapter = createDeterministicAdapter();
  const messages = [{ role: 'user', content: 'review the fleet' }];

  const first = await adapter.complete({ messages });
  assert.equal(first.toolCalls[0].name, 'list_vehicles');

  messages.push({
    role: 'tool',
    toolName: 'list_vehicles',
    content: JSON.stringify({
      vehicles: [
        { vehicleId: 'VH-4471', highestSeverity: 'high', activeFaultCount: 2, kmSinceService: 20780, serviceIntervalKm: 25000, serviceOverdue: false },
        { vehicleId: 'VH-2208', highestSeverity: 'none', activeFaultCount: 0, kmSinceService: 8430, serviceIntervalKm: 30000, serviceOverdue: false },
      ],
    }),
  });

  const second = await adapter.complete({ messages });
  assert.equal(second.toolCalls[0].name, 'get_vehicle_detail');
  assert.equal(second.toolCalls[0].input.vehicleId, 'VH-4471', 'it should inspect the worst vehicle');
});

test('the deterministic planner reports plainly when nothing needs doing', async () => {
  const adapter = createDeterministicAdapter();
  const reply = await adapter.complete({
    messages: [
      { role: 'user', content: 'anything to do?' },
      {
        role: 'tool',
        toolName: 'list_vehicles',
        content: JSON.stringify({
          vehicles: [{ vehicleId: 'VH-2208', highestSeverity: 'none', activeFaultCount: 0, kmSinceService: 100, serviceIntervalKm: 30000, serviceOverdue: false }],
        }),
      },
    ],
  });
  assert.equal(reply.toolCalls.length, 0);
  assert.match(reply.text, /No vehicle currently warrants a work order/);
});

test('an empty tools array is omitted rather than sent', async (t) => {
  // The Anthropic API rejects `tools: []` with HTTP 400. The agent always
  // supplies tools, but a connectivity probe may not, and a 400 there sends
  // an operator hunting a credential problem that does not exist.
  const server = await stub(() => ({ payload: { content: [{ type: 'text', text: 'ok' }] } }));
  t.after(() => server.close());

  const adapter = createModelAdapter({ ...baseConfig, modelBackend: 'anthropic', anthropicBaseUrl: server.url });
  await adapter.complete({ ...request, tools: [] });
  assert.equal('tools' in server.received[0].body, false, 'the tools key must be absent, not empty');

  await adapter.complete(request);
  assert.equal(server.received[1].body.tools.length, 1, 'tools are sent when there are some');
});

test('OpenAI omits both tools and tool_choice when there are none', async (t) => {
  const server = await stub(() => ({ payload: { choices: [{ message: { content: 'ok' } }] } }));
  t.after(() => server.close());

  const adapter = createModelAdapter({ ...baseConfig, modelBackend: 'openai', openaiBaseUrl: server.url });
  await adapter.complete({ ...request, tools: [] });
  assert.equal('tools' in server.received[0].body, false);
  assert.equal('tool_choice' in server.received[0].body, false, 'tool_choice without tools is also rejected');
});

test('an empty system prompt is omitted for Anthropic', async (t) => {
  const server = await stub(() => ({ payload: { content: [] } }));
  t.after(() => server.close());
  const adapter = createModelAdapter({ ...baseConfig, modelBackend: 'anthropic', anthropicBaseUrl: server.url });
  await adapter.complete({ ...request, system: '' });
  assert.equal('system' in server.received[0].body, false);
});

test('a provider error message is surfaced for diagnosis but bounded', async (t) => {
  const server = await stub(() => ({
    status: 400,
    payload: { type: 'error', error: { type: 'invalid_request_error', message: 'model: unknown model claude-foo' } },
  }));
  t.after(() => server.close());

  const adapter = createModelAdapter({ ...baseConfig, modelBackend: 'anthropic', anthropicBaseUrl: server.url });
  await assert.rejects(
    () => adapter.complete(request),
    (error) => {
      assert.match(error.message, /HTTP 400/);
      assert.equal(error.status, 400);
      assert.equal(error.providerMessage, 'model: unknown model claude-foo');
      return true;
    },
  );
});

test('a provider message cannot become a data-leak channel', async () => {
  const { extractProviderMessage } = await import('../../src/agent/model/provider.js');
  // Bounded, whatever the provider echoes back.
  const huge = JSON.stringify({ error: { message: 'x'.repeat(5000) } });
  assert.equal(extractProviderMessage(huge).length, 200);
  // Handles each provider's shape, and non-JSON.
  assert.equal(extractProviderMessage(JSON.stringify({ error: 'flat string' })), 'flat string');
  assert.equal(extractProviderMessage(JSON.stringify({ message: 'top level' })), 'top level');
  assert.equal(extractProviderMessage('<html>502 Bad Gateway</html>'), '<html>502 Bad Gateway</html>');
  assert.equal(extractProviderMessage(''), undefined);
  assert.equal(extractProviderMessage(undefined), undefined);
});

test('an organisation-level key sends the workspace header; a scoped key does not', async (t) => {
  // Anthropic rejects an org-level key with HTTP 400 unless the request
  // names a workspace. A workspace-scoped key carries it implicitly, so the
  // header must be absent rather than empty.
  const server = await stub(() => ({ payload: { content: [{ type: 'text', text: 'ok' }] } }));
  t.after(() => server.close());

  const withWorkspace = createModelAdapter({
    ...baseConfig,
    modelBackend: 'anthropic',
    anthropicBaseUrl: server.url,
    anthropicWorkspaceId: 'wrkspc_01ABCDEF',
  });
  await withWorkspace.complete(request);
  assert.equal(server.received[0].headers['anthropic-workspace-id'], 'wrkspc_01ABCDEF');

  const scoped = createModelAdapter({ ...baseConfig, modelBackend: 'anthropic', anthropicBaseUrl: server.url });
  await scoped.complete(request);
  assert.equal(server.received[1].headers['anthropic-workspace-id'], undefined);
});

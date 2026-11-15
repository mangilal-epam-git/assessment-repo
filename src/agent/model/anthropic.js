/**
 * Anthropic Messages API adapter.
 *
 * Plain HTTP against the public API shape; no SDK, so there is no dependency
 * and no hidden retry or telemetry behaviour we did not choose.
 */

import { postJson, parseArguments } from './provider.js';

/** @returns {import('./provider.js').ModelAdapter} */
export function createAnthropicAdapter(config) {
  const baseUrl = (config.anthropicBaseUrl || 'https://api.anthropic.com').replace(/\/$/, '');
  const model = config.modelName || 'claude-sonnet-4-5';

  return {
    name: 'anthropic',
    model,
    requiresNetwork: true,

    async complete({ system, messages, tools, signal }) {
      if (!config.modelApiKey) throw new Error('MODEL_API_KEY is required for the anthropic backend');

      // An empty `tools` array is rejected with HTTP 400, so the key is
      // omitted entirely when there are none. The agent always supplies
      // tools; a connectivity check may not.
      const body = {
        model,
        max_tokens: config.modelMaxTokens,
        temperature: config.modelTemperature,
        messages: toAnthropicMessages(messages),
        ...(system ? { system } : {}),
        ...(tools.length > 0
          ? {
              tools: tools.map((tool) => ({
                name: tool.name,
                description: tool.description,
                input_schema: tool.inputSchema,
              })),
            }
          : {}),
      };

      const payload = await postJson(
        `${baseUrl}/v1/messages`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': config.modelApiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify(body),
        },
        config.modelTimeoutMillis,
        signal,
      );

      const blocks = Array.isArray(payload.content) ? payload.content : [];
      return {
        text: blocks
          .filter((block) => block.type === 'text')
          .map((block) => block.text)
          .join('\n')
          .trim(),
        toolCalls: blocks
          .filter((block) => block.type === 'tool_use')
          .map((block) => ({ id: block.id, name: block.name, input: block.input ?? {} })),
        model: payload.model ?? model,
        stopReason: payload.stop_reason,
      };
    },
  };
}

/** @param {import('./provider.js').ModelMessage[]} messages */
function toAnthropicMessages(messages) {
  const out = [];
  for (const message of messages) {
    if (message.role === 'user') {
      out.push({ role: 'user', content: [{ type: 'text', text: message.content ?? '' }] });
      continue;
    }
    if (message.role === 'assistant') {
      const content = [];
      if (message.content) content.push({ type: 'text', text: message.content });
      for (const call of message.toolCalls ?? []) {
        content.push({ type: 'tool_use', id: call.id, name: call.name, input: call.input });
      }
      out.push({ role: 'assistant', content });
      continue;
    }
    // Tool results are carried on a user turn in the Anthropic shape.
    const previous = out.at(-1);
    const block = {
      type: 'tool_result',
      tool_use_id: message.toolCallId,
      content: message.content ?? '',
    };
    if (previous?.role === 'user' && Array.isArray(previous.content)) previous.content.push(block);
    else out.push({ role: 'user', content: [block] });
  }
  return out;
}

export { toAnthropicMessages, parseArguments };

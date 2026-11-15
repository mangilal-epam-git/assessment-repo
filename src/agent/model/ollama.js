/**
 * Ollama adapter for locally hosted open-source models.
 *
 * The brief permits open-source models, and a local model is the only backend
 * that needs no key, no network and no vendor relationship - useful for a
 * demonstration on a managed laptop, and for environments where telemetry
 * context must not leave the building.
 */

import { postJson, parseArguments } from './provider.js';
import { toOpenAiMessages } from './openai.js';

/** @returns {import('./provider.js').ModelAdapter} */
export function createOllamaAdapter(config) {
  const baseUrl = (config.ollamaBaseUrl || 'http://127.0.0.1:11434').replace(/\/$/, '');
  const model = config.modelName || 'llama3.1';

  return {
    name: 'ollama',
    model,
    requiresNetwork: false, // local, but still a network call to localhost

    async complete({ system, messages, tools, signal }) {
      const payload = await postJson(
        `${baseUrl}/api/chat`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            model,
            stream: false,
            options: { temperature: config.modelTemperature, num_predict: config.modelMaxTokens },
            messages: [{ role: 'system', content: system }, ...toOpenAiMessages(messages)],
            ...(tools.length > 0
              ? {
                  tools: tools.map((tool) => ({
                    type: 'function',
                    function: {
                      name: tool.name,
                      description: tool.description,
                      parameters: tool.inputSchema,
                    },
                  })),
                }
              : {}),
          }),
        },
        config.modelTimeoutMillis,
        signal,
      );

      const message = payload.message ?? {};
      return {
        text: (message.content ?? '').trim(),
        toolCalls: (message.tool_calls ?? []).map((call, index) => ({
          id: call.id ?? `ollama-${index}`,
          name: call.function?.name ?? '',
          input: parseArguments(call.function?.arguments),
        })),
        model: payload.model ?? model,
        stopReason: payload.done_reason,
      };
    },
  };
}

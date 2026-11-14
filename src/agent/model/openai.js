/**
 * OpenAI-compatible chat-completions adapter.
 *
 * Covers the OpenAI API, Azure OpenAI, and the many self-hosted gateways that
 * implement the same shape. Azure differs only in the URL and the auth
 * header, so one adapter serves both.
 */

import { postJson, parseArguments } from './provider.js';

/** @returns {import('./provider.js').ModelAdapter} */
export function createOpenAiAdapter(config) {
  const isAzure = config.modelBackend === 'azure-openai';
  const model = config.modelName || (isAzure ? 'gpt-4o' : 'gpt-4o-mini');
  const baseUrl = (config.openaiBaseUrl || 'https://api.openai.com/v1').replace(/\/$/, '');

  return {
    name: isAzure ? 'azure-openai' : 'openai',
    model,
    requiresNetwork: true,

    async complete({ system, messages, tools, signal }) {
      if (!config.modelApiKey) throw new Error('MODEL_API_KEY is required for the openai backend');

      const url = isAzure
        ? `${baseUrl}/openai/deployments/${encodeURIComponent(model)}/chat/completions?api-version=${encodeURIComponent(config.azureApiVersion)}`
        : `${baseUrl}/chat/completions`;

      const headers = { 'content-type': 'application/json' };
      if (isAzure) headers['api-key'] = config.modelApiKey;
      else headers.authorization = `Bearer ${config.modelApiKey}`;

      const payload = await postJson(
        url,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model: isAzure ? undefined : model,
            max_tokens: config.modelMaxTokens,
            temperature: config.modelTemperature,
            messages: [{ role: 'system', content: system }, ...toOpenAiMessages(messages)],
            tools: tools.map((tool) => ({
              type: 'function',
              function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.inputSchema,
              },
            })),
            tool_choice: 'auto',
          }),
        },
        config.modelTimeoutMillis,
        signal,
      );

      const choice = payload.choices?.[0]?.message ?? {};
      return {
        text: (choice.content ?? '').trim(),
        toolCalls: (choice.tool_calls ?? []).map((call) => ({
          id: call.id,
          name: call.function?.name ?? '',
          input: parseArguments(call.function?.arguments),
        })),
        model: payload.model ?? model,
        stopReason: payload.choices?.[0]?.finish_reason,
      };
    },
  };
}

/** @param {import('./provider.js').ModelMessage[]} messages */
export function toOpenAiMessages(messages) {
  return messages.map((message) => {
    if (message.role === 'tool') {
      return { role: 'tool', tool_call_id: message.toolCallId, content: message.content ?? '' };
    }
    if (message.role === 'assistant') {
      return {
        role: 'assistant',
        content: message.content ?? null,
        ...(message.toolCalls?.length
          ? {
              tool_calls: message.toolCalls.map((call) => ({
                id: call.id,
                type: 'function',
                function: { name: call.name, arguments: JSON.stringify(call.input) },
              })),
            }
          : {}),
      };
    }
    return { role: 'user', content: message.content ?? '' };
  });
}

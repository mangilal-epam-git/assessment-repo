/**
 * Model provider abstraction.
 *
 * The orchestration loop is ours (the brief prohibits turnkey
 * agent-orchestration products); only inference is delegated. Every adapter
 * normalises to one small interface so the loop, the safety gates and the
 * audit trail are identical whichever backend is configured.
 *
 * Adapters speak plain HTTP via global fetch. No vendor SDK, consistent with
 * the zero-runtime-dependency position in ADR-0003.
 *
 * @typedef {object} ModelMessage
 * @property {'user'|'assistant'|'tool'} role
 * @property {string} [content]
 * @property {ModelToolCall[]} [toolCalls]
 * @property {string} [toolCallId]
 * @property {string} [toolName]
 *
 * @typedef {object} ModelToolCall
 * @property {string} id
 * @property {string} name
 * @property {unknown} input
 *
 * @typedef {object} ModelReply
 * @property {string} text
 * @property {ModelToolCall[]} toolCalls
 * @property {string} model          identifier recorded for attribution
 * @property {string} [stopReason]
 *
 * @typedef {object} ModelAdapter
 * @property {string} name
 * @property {string} model
 * @property {boolean} requiresNetwork
 * @property {(request: { system: string, messages: ModelMessage[], tools: object[], signal?: AbortSignal }) => Promise<ModelReply>} complete
 */

import { createAnthropicAdapter } from './anthropic.js';
import { createOpenAiAdapter } from './openai.js';
import { createOllamaAdapter } from './ollama.js';
import { createDeterministicAdapter } from './deterministic.js';

export const MODEL_BACKENDS = Object.freeze(['deterministic', 'anthropic', 'openai', 'azure-openai', 'ollama']);

/**
 * Selects an adapter from configuration.
 *
 * `deterministic` is the default on purpose: a demonstration of a safety
 * property must not fail because an API key is missing or a network is
 * unavailable. The safety gates are identical either way, which is the point.
 *
 * @param {object} config
 * @param {import('../../best-offers/logger.js').Logger} [logger]
 * @returns {ModelAdapter}
 */
export function createModelAdapter(config, logger) {
  switch (config.modelBackend) {
    case 'anthropic':
      return createAnthropicAdapter(config);
    case 'openai':
    case 'azure-openai':
      return createOpenAiAdapter(config);
    case 'ollama':
      return createOllamaAdapter(config);
    case 'deterministic':
      return createDeterministicAdapter();
    default:
      logger?.warn('model.backend.unknown', {
        requested: config.modelBackend,
        note: 'Falling back to the deterministic planner',
      });
      return createDeterministicAdapter();
  }
}

/**
 * Wraps an adapter so a backend failure degrades to the deterministic planner
 * instead of taking the assistant down.
 *
 * This mirrors the marketplace's partial-result policy: degraded and honest
 * beats unavailable. The response records which model actually answered, so a
 * fallback is never silent.
 *
 * @param {ModelAdapter} primary
 * @param {{ logger?: import('../../best-offers/logger.js').Logger, enabled?: boolean }} [options]
 * @returns {ModelAdapter}
 */
export function withDeterministicFallback(primary, { logger, enabled = true } = {}) {
  if (!enabled || primary.name === 'deterministic') return primary;
  const fallback = createDeterministicAdapter();

  return {
    name: `${primary.name}+fallback`,
    model: primary.model,
    requiresNetwork: primary.requiresNetwork,
    async complete(request) {
      try {
        return await primary.complete(request);
      } catch (error) {
        logger?.warn('model.fallback.engaged', {
          backend: primary.name,
          detail: /** @type {Error} */ (error).message,
        });
        const reply = await fallback.complete(request);
        return { ...reply, model: `${fallback.model} (fallback from ${primary.model})` };
      }
    },
  };
}

/**
 * Shared HTTP helper: bounded timeout, no retry on a non-idempotent call,
 * and errors that never echo the provider body back to a caller.
 *
 * @param {string} url
 * @param {object} init
 * @param {number} timeoutMillis
 * @param {AbortSignal} [signal]
 */
export async function postJson(url, init, timeoutMillis, signal) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('model request timed out')), timeoutMillis);
  const onAbort = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const response = await fetch(url, { ...init, signal: controller.signal, redirect: 'error' });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`model endpoint returned HTTP ${response.status}`);
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new Error('model endpoint returned a body that is not valid JSON');
    }
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/**
 * Parses a tool-call argument blob that arrived as a JSON string.
 * A malformed blob yields an empty object, which then fails schema
 * validation and is refused with a reason - never coerced into a call.
 * @param {unknown} raw
 */
export function parseArguments(raw) {
  if (raw === null || raw === undefined) return {};
  if (typeof raw === 'object') return raw;
  if (typeof raw !== 'string') return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed !== null && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

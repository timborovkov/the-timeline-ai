import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

import { getEnv } from '#src/env.js';
import { asBunFetch } from '#src/http/fetch.js';
import {
  OPENROUTER_DISABLE_CACHE_HEADERS,
  OPENROUTER_OFFICIAL_BASE_URL,
} from '#src/llm/privacy.js';

export function createOpenRouterProvider(options: {
  operation: string;
  fetch?: (...args: Parameters<typeof globalThis.fetch>) => ReturnType<typeof globalThis.fetch>;
  supportsStructuredOutputs?: boolean;
}) {
  const env = getEnv();
  if (!env.OPENROUTER_API_KEY) {
    throw new Error(`OPENROUTER_API_KEY is required for ${options.operation}`);
  }
  return createOpenAICompatible({
    name: 'openrouter',
    apiKey: env.OPENROUTER_API_KEY,
    baseURL: env.OPENROUTER_BASE_URL ?? OPENROUTER_OFFICIAL_BASE_URL,
    headers: OPENROUTER_DISABLE_CACHE_HEADERS,
    ...(options.supportsStructuredOutputs !== undefined
      ? { supportsStructuredOutputs: options.supportsStructuredOutputs }
      : {}),
    ...(options.fetch ? { fetch: asBunFetch(options.fetch) } : {}),
  });
}

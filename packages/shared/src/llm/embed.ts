import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { type EmbeddingModel } from 'ai';

import { getEnv } from '#src/env.js';
import { TIMELINE_MODELS } from '#src/llm/models.js';
import { embed as tracedEmbed } from '#src/llm/tracing.js';

export interface EmbedInput {
  text: string;
}

export interface EmbedResult {
  vector: number[];
  model: string;
}

export interface EmbedDeps {
  /** Inject a pre-built EmbeddingModel — used by tests with a mock. */
  model?: EmbeddingModel;
}

function resolveModelId(): string {
  return TIMELINE_MODELS.embedding.id;
}

function buildDefaultModel(modelId: string): EmbeddingModel {
  const env = getEnv();
  if (!env.OPENROUTER_API_KEY) {
    throw new Error('OPENROUTER_API_KEY is required for llm.embed');
  }
  const baseURL = env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1';
  const provider = createOpenAICompatible({
    name: 'openrouter',
    apiKey: env.OPENROUTER_API_KEY,
    baseURL,
  });
  return provider.embeddingModel(modelId);
}

/**
 * Embed a single piece of text. Pinned in `TIMELINE_MODELS`; the model id
 * is returned so callers can stamp it onto the Qdrant payload (load-bearing
 * for the re-embed procedure — points written with old + new models coexist
 * during cutover).
 *
 * Tests inject `deps.model`; otherwise the function builds an OpenRouter
 * provider from env (`OPENROUTER_API_KEY`, `OPENROUTER_BASE_URL`).
 */
export async function embed(input: EmbedInput, deps: EmbedDeps = {}): Promise<EmbedResult> {
  const modelId = resolveModelId();
  const model = deps.model ?? buildDefaultModel(modelId);
  const result = await tracedEmbed(
    { model, value: input.text },
    {
      name: 'llm.embed',
      model: modelId,
      metadata: {
        operation: 'embed',
        input_text_chars: input.text.length,
      },
    },
  );
  return { vector: Array.from(result.embedding), model: modelId };
}

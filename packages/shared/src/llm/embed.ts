import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { embed as aiEmbed, type EmbeddingModel } from 'ai';

import { getEnv } from '../env.js';

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
  const env = getEnv();
  return env.EMBEDDING_MODEL ?? 'openai/text-embedding-3-small';
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
 * Embed a single piece of text. Pinned to `EMBEDDING_MODEL`; the model id
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
  const result = await aiEmbed({ model, value: input.text });
  return { vector: Array.from(result.embedding), model: modelId };
}

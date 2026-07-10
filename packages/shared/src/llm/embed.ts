import { createHash } from 'node:crypto';

import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { embed as aiEmbed, embedMany as aiEmbedMany, type EmbeddingModel } from 'ai';

import { getEnv } from '#src/env.js';
import { wrapAiFailure } from '#src/llm/errors.js';
import { TIMELINE_MODELS, truncateTextToTokenBudget } from '#src/llm/models.js';

export interface EmbedInput {
  text: string;
}

export interface EmbedResult {
  vector: number[];
  model: string;
}

export interface EmbedManyInput {
  texts: string[];
}

export interface EmbedManyResult {
  vectors: number[][];
  model: string;
}

export interface EmbedDeps {
  /** Inject a pre-built EmbeddingModel — used by tests with a mock. */
  model?: EmbeddingModel;
  /** Override SDK-level retries. Workers set this to 0 so BullMQ owns backoff. */
  maxRetries?: number;
}

function resolveModelId(): string {
  return TIMELINE_MODELS.embedding.id;
}

function embeddingInputTokenBudget(): number {
  const contextWindow = TIMELINE_MODELS.embedding.contextWindowTokens;
  return Math.max(1, Math.floor(contextWindow * 0.8));
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

function deterministicEmbeddingsEnabled(): boolean {
  const env = getEnv();
  return process.env.NODE_ENV !== 'production' && env.E2E_DETERMINISTIC_EMBEDDINGS;
}

function deterministicEmbeddingVector(text: string): number[] {
  const dimensions = TIMELINE_MODELS.embedding.embeddingDimensions;
  const vector = new Array<number>(dimensions);
  let cursor = 0;
  let block = 0;
  while (cursor < dimensions) {
    const digest = createHash('sha256').update(text).update('\0').update(String(block)).digest();
    for (let offset = 0; offset < digest.length && cursor < dimensions; offset += 2) {
      vector[cursor] = digest.readInt16BE(offset) / 32768;
      cursor += 1;
    }
    block += 1;
  }
  return vector;
}

function assertEmbeddingCount(inputCount: number, outputCount: number): void {
  if (outputCount !== inputCount) {
    throw new Error(
      `Embedding provider returned ${String(outputCount)} vectors for ${String(inputCount)} inputs`,
    );
  }
}

function assertEmbeddingVector(vector: readonly number[], index: number): void {
  const expectedDimensions = TIMELINE_MODELS.embedding.embeddingDimensions;
  if (vector.length !== expectedDimensions) {
    throw new Error(
      `Embedding provider returned vector ${String(index)} with ${String(
        vector.length,
      )} dimensions; expected ${String(expectedDimensions)}`,
    );
  }
  const invalidIndex = vector.findIndex((value) => !Number.isFinite(value));
  if (invalidIndex !== -1) {
    throw new Error(
      `Embedding provider returned non-finite value at vector ${String(index)}, dimension ${String(
        invalidIndex,
      )}`,
    );
  }
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
  return wrapAiFailure({ operation: 'llm.embed', model: modelId }, async () => {
    const text = truncateTextToTokenBudget(input.text, embeddingInputTokenBudget());
    if (!deps.model && deterministicEmbeddingsEnabled()) {
      return { vector: deterministicEmbeddingVector(text), model: modelId };
    }
    const model = deps.model ?? buildDefaultModel(modelId);
    const result = await aiEmbed({ model, value: text, maxRetries: deps.maxRetries ?? 2 });
    return { vector: Array.from(result.embedding), model: modelId };
  });
}

export async function embedMany(
  input: EmbedManyInput,
  deps: EmbedDeps = {},
): Promise<EmbedManyResult> {
  const modelId = resolveModelId();
  return wrapAiFailure({ operation: 'llm.embedMany', model: modelId }, async () => {
    if (input.texts.length === 0) return { vectors: [], model: modelId };
    const texts = input.texts.map((text) =>
      truncateTextToTokenBudget(text, embeddingInputTokenBudget()),
    );
    if (!deps.model && deterministicEmbeddingsEnabled()) {
      return { vectors: texts.map(deterministicEmbeddingVector), model: modelId };
    }
    const model = deps.model ?? buildDefaultModel(modelId);
    const result = await aiEmbedMany({
      model,
      values: texts,
      maxRetries: deps.maxRetries ?? 2,
    });
    assertEmbeddingCount(texts.length, result.embeddings.length);
    result.embeddings.forEach((embedding, index) => {
      assertEmbeddingVector(embedding, index);
    });
    return { vectors: result.embeddings.map((embedding) => Array.from(embedding)), model: modelId };
  });
}

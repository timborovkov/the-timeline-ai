import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { embed as aiEmbed, embedMany as aiEmbedMany, type EmbeddingModel } from 'ai';

import type * as Cl100kBaseTokenizer from 'gpt-tokenizer/encoding/cl100k_base';

import { getEnv } from '#src/env.js';
import { wrapAiFailure } from '#src/llm/errors.js';
import { TIMELINE_MODELS } from '#src/llm/models.js';
import {
  OPENROUTER_DISABLE_CACHE_HEADERS,
  OPENROUTER_OFFICIAL_BASE_URL,
  openRouterPrivateProviderRouting,
} from '#src/llm/privacy.js';

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
  /** Inject transport for boundary tests. */
  fetch?: typeof globalThis.fetch;
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

const NO_DISALLOWED_SPECIAL_TOKENS = new Set<string>();
const CL100K_EMBEDDING_MODELS = new Set(['openai/text-embedding-3-small']);
const requireEmbeddingDependency = createRequire(import.meta.url);
type EmbeddingTokenizer = typeof Cl100kBaseTokenizer;
let loadedEmbeddingTokenizer: EmbeddingTokenizer | undefined;

function getEmbeddingTokenizer(): EmbeddingTokenizer {
  const modelId = resolveModelId();
  if (!CL100K_EMBEDDING_MODELS.has(modelId)) {
    throw new Error(`Embedding tokenizer is not configured for model ${modelId}`);
  }
  loadedEmbeddingTokenizer ??= requireEmbeddingDependency(
    'gpt-tokenizer/encoding/cl100k_base',
  ) as EmbeddingTokenizer;
  return loadedEmbeddingTokenizer;
}

function encodeEmbeddingText(text: string): number[] {
  return getEmbeddingTokenizer().encode(text, {
    disallowedSpecial: NO_DISALLOWED_SPECIAL_TOKENS,
  });
}

export function countEmbeddingTokens(text: string): number {
  return encodeEmbeddingText(text).length;
}

export function truncateEmbeddingTextToTokenBudget(text: string, maxTokens: number): string {
  const tokens = encodeEmbeddingText(text);
  if (tokens.length <= maxTokens) return text;

  const suffix = '…';
  const suffixTokens = encodeEmbeddingText(suffix).length;
  if (suffixTokens > maxTokens) return '';

  const characters = Array.from(text);
  const prefixBudget = maxTokens - suffixTokens;
  let bestEnd = Math.floor((characters.length * prefixBudget) / tokens.length);
  let truncated = `${characters.slice(0, bestEnd).join('')}${suffix}`;
  let truncatedTokens = countEmbeddingTokens(truncated);
  while (bestEnd > 0 && truncatedTokens > maxTokens) {
    const scaledEnd = Math.floor((bestEnd * maxTokens) / truncatedTokens);
    bestEnd = Math.min(bestEnd - 1, scaledEnd);
    truncated = `${characters.slice(0, bestEnd).join('')}${suffix}`;
    truncatedTokens = countEmbeddingTokens(truncated);
  }
  return truncated;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function privateEmbeddingFetch(fetchImpl: typeof globalThis.fetch): typeof globalThis.fetch {
  return async (input, init) => {
    if (typeof init?.body !== 'string') {
      throw new Error('OpenRouter embedding request did not serialize a JSON body');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(init.body) as unknown;
    } catch {
      throw new Error('OpenRouter embedding request body was not valid JSON');
    }
    if (!isJsonObject(parsed)) {
      throw new Error('OpenRouter embedding request body was not a JSON object');
    }

    // JSON.parse guarantees JSON-compatible member values; the object guard
    // narrows only the container shape for TypeScript.
    const existingProvider = (isJsonObject(parsed.provider) ? parsed.provider : {}) as Parameters<
      typeof openRouterPrivateProviderRouting
    >[0];
    return fetchImpl(input, {
      ...init,
      body: JSON.stringify({
        ...parsed,
        provider: openRouterPrivateProviderRouting(existingProvider),
      }),
    });
  };
}

function buildDefaultModel(
  modelId: string,
  fetchImpl: typeof globalThis.fetch = globalThis.fetch.bind(globalThis),
): EmbeddingModel {
  const env = getEnv();
  if (!env.OPENROUTER_API_KEY) {
    throw new Error('OPENROUTER_API_KEY is required for llm.embed');
  }
  const baseURL = env.OPENROUTER_BASE_URL ?? OPENROUTER_OFFICIAL_BASE_URL;
  const provider = createOpenAICompatible({
    name: 'openrouter',
    apiKey: env.OPENROUTER_API_KEY,
    baseURL,
    headers: OPENROUTER_DISABLE_CACHE_HEADERS,
    // The installed compatible adapter only serializes `dimensions` and
    // `user` for embeddings. Inject the OpenRouter routing policy at the HTTP
    // boundary and fail closed if that request shape changes.
    fetch: privateEmbeddingFetch(fetchImpl),
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
    const text = truncateEmbeddingTextToTokenBudget(input.text, embeddingInputTokenBudget());
    if (!deps.model && deterministicEmbeddingsEnabled()) {
      return { vector: deterministicEmbeddingVector(text), model: modelId };
    }
    const model = deps.model ?? buildDefaultModel(modelId, deps.fetch);
    const result = await aiEmbed({
      model,
      value: text,
      maxRetries: deps.maxRetries ?? 2,
    });
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
      truncateEmbeddingTextToTokenBudget(text, embeddingInputTokenBudget()),
    );
    if (!deps.model && deterministicEmbeddingsEnabled()) {
      return { vectors: texts.map(deterministicEmbeddingVector), model: modelId };
    }
    const model = deps.model ?? buildDefaultModel(modelId, deps.fetch);
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

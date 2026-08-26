import { MockEmbeddingModelV3 } from 'ai/test';
import { encode } from 'gpt-tokenizer/encoding/cl100k_base';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { EmbeddingModel } from 'ai';

import { resetEnvForTests } from '#src/env.js';
import { embed, embedMany, truncateEmbeddingTextToTokenBudget } from '#src/llm/embed.js';
import { TIMELINE_MODELS } from '#src/llm/models.js';

const ENV_BACKUP = { ...process.env };

function embeddingVector(seed: number): number[] {
  return Array.from(
    { length: TIMELINE_MODELS.embedding.embeddingDimensions },
    (_, index) => seed + index / 10_000,
  );
}

function makeMockModel(vectors: number[][]): EmbeddingModel {
  // The Vercel AI SDK ships MockEmbeddingModelV3 specifically for this shape.
  // doEmbed receives { values } and must return { embeddings } of equal length.
  return new MockEmbeddingModelV3({
    doEmbed: (({ values }: { values: string[] }) =>
      Promise.resolve({
        embeddings: values.map((_, i) => vectors[i] ?? vectors[0] ?? []),
      })) as never,
  });
}

beforeEach(() => {
  process.env = {
    ...ENV_BACKUP,
    AUTH_SECRET: 'a'.repeat(32),
    DATABASE_URL: 'postgres://x:y@localhost:5432/x',
    OPENROUTER_API_KEY: 'sk-test',
    OPENROUTER_BASE_URL: 'https://example.test/v1',
  };
  resetEnvForTests();
});

afterEach(() => {
  process.env = { ...ENV_BACKUP };
  resetEnvForTests();
});

describe('llm.embed', () => {
  it('returns the vector and the pinned model id', async () => {
    const result = await embed({ text: 'hello' }, { model: makeMockModel([[0.1, 0.2, 0.3, 0.4]]) });
    expect(result.vector).toEqual([0.1, 0.2, 0.3, 0.4]);
    expect(result.model).toBe(TIMELINE_MODELS.embedding.id);
  });

  it('uses the predefined embedding model catalog entry', async () => {
    const result = await embed({ text: 'hello' }, { model: makeMockModel([[1, 2, 3, 4]]) });
    expect(result.model).toBe(TIMELINE_MODELS.embedding.id);
  });

  it('injects no-collection and ZDR routing into the serialized OpenRouter request', async () => {
    let requestBody: unknown;
    const vector = embeddingVector(1);
    const fetch = vi.fn<typeof globalThis.fetch>((_input, init) => {
      if (typeof init?.body !== 'string') throw new Error('Expected a serialized JSON request');
      requestBody = JSON.parse(init.body) as unknown;
      return Promise.resolve(
        new Response(
          JSON.stringify({
            data: [{ embedding: vector }],
            usage: { prompt_tokens: 1 },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );
    });

    await expect(embed({ text: 'synthetic' }, { fetch, maxRetries: 0 })).resolves.toEqual({
      vector,
      model: TIMELINE_MODELS.embedding.id,
    });
    expect(requestBody).toMatchObject({
      model: TIMELINE_MODELS.embedding.id,
      input: ['synthetic'],
      provider: { data_collection: 'deny', zdr: true },
    });
  });

  it('truncates text before sending it to the embedding model budget', async () => {
    const input = 'x '.repeat(40_000);
    let modelInput = '';
    const model = new MockEmbeddingModelV3({
      doEmbed: (({ values }: { values: string[] }) => {
        modelInput = values[0] ?? '';
        return Promise.resolve({ embeddings: [[1, 2, 3, 4]] });
      }) as never,
    });

    await embed({ text: input }, { model });

    expect(modelInput.length).toBeLessThan(input.length);
    expect(modelInput.endsWith('…')).toBe(true);
    expect(modelInput.length).toBeLessThanOrEqual(
      Math.floor(TIMELINE_MODELS.embedding.contextWindowTokens * 0.8) * 4,
    );
  });

  it('keeps token-dense Unicode within the embedding model budget', async () => {
    let modelInput = '';
    const model = new MockEmbeddingModelV3({
      doEmbed: (({ values }: { values: string[] }) => {
        modelInput = values[0] ?? '';
        return Promise.resolve({ embeddings: [embeddingVector(1)] });
      }) as never,
    });

    await embedMany({ texts: ['😀'.repeat(4_000)] }, { model });

    expect(encode(modelInput).length).toBeLessThanOrEqual(
      Math.floor(TIMELINE_MODELS.embedding.contextWindowTokens * 0.8),
    );
    expect(modelInput.endsWith('…')).toBe(true);
  });

  it('truncates repeated multibyte inputs without cross-call corruption', () => {
    const input = `a${'漢'.repeat(4_000)}`;
    const tokenBudget = Math.floor(TIMELINE_MODELS.embedding.contextWindowTokens * 0.8);

    const first = truncateEmbeddingTextToTokenBudget(input, tokenBudget);
    const second = truncateEmbeddingTextToTokenBudget(input, tokenBudget);

    expect(second).toBe(first);
    expect(second).not.toContain('�');
    expect(input.startsWith(second.slice(0, -1))).toBe(true);
  });

  it('embeds multiple texts', async () => {
    const modelInput: string[] = [];
    const firstVector = embeddingVector(1);
    const secondVector = embeddingVector(2);
    const model = new MockEmbeddingModelV3({
      doEmbed: (({ values }: { values: string[] }) => {
        modelInput.push(...values);
        return Promise.resolve({
          embeddings: values.map((value) => (value === 'first' ? firstVector : secondVector)),
        });
      }) as never,
    });

    const result = await embedMany({ texts: ['first', 'second'] }, { model });

    expect(modelInput).toEqual(['first', 'second']);
    expect(result).toEqual({
      vectors: [firstVector, secondVector],
      model: TIMELINE_MODELS.embedding.id,
    });
  });

  it('rejects provider batch vectors with the wrong dimensions', async () => {
    const model = new MockEmbeddingModelV3({
      doEmbed: (() =>
        Promise.resolve({
          embeddings: [[1, 2, 3, 4]],
        })) as never,
    });

    await expect(embedMany({ texts: ['first'] }, { model })).rejects.toMatchObject({
      name: 'TimelineAiError',
      timelineAi: true,
      operation: 'llm.embedMany',
      causeMessage: 'Embedding provider returned vector 0 with 4 dimensions; expected 1536',
    });
  });

  it('rejects provider batch vectors with non-finite values', async () => {
    const vector = embeddingVector(1);
    vector[3] = Number.NaN;
    const model = new MockEmbeddingModelV3({
      doEmbed: (() =>
        Promise.resolve({
          embeddings: [vector],
        })) as never,
    });

    await expect(embedMany({ texts: ['first'] }, { model })).rejects.toMatchObject({
      name: 'TimelineAiError',
      timelineAi: true,
      operation: 'llm.embedMany',
      causeMessage: 'Embedding provider returned non-finite value at vector 0, dimension 3',
    });
  });

  it('returns no vectors for an empty batch without calling the provider', async () => {
    const model = new MockEmbeddingModelV3({
      doEmbed: (() => Promise.reject(new Error('provider should not be called'))) as never,
    });

    await expect(embedMany({ texts: [] }, { model })).resolves.toEqual({
      vectors: [],
      model: TIMELINE_MODELS.embedding.id,
    });
  });

  it('uses deterministic embeddings in non-production E2E mode without a provider key', async () => {
    delete process.env.OPENROUTER_API_KEY;
    process.env.E2E_DETERMINISTIC_EMBEDDINGS = 'true';
    resetEnvForTests();

    const first = await embed({ text: 'launch notes' });
    const second = await embed({ text: 'launch notes' });
    const batch = await embedMany({ texts: ['launch notes', 'renewal notes'] });

    expect(first).toEqual(second);
    expect(first.model).toBe(TIMELINE_MODELS.embedding.id);
    expect(first.vector).toHaveLength(TIMELINE_MODELS.embedding.embeddingDimensions);
    expect(batch.vectors[0]).toEqual(first.vector);
    expect(batch.vectors[1]).not.toEqual(first.vector);
  });

  it('throws when OPENROUTER_API_KEY is missing AND no model is injected', async () => {
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.E2E_DETERMINISTIC_EMBEDDINGS;
    resetEnvForTests();
    await expect(embed({ text: 'hello' })).rejects.toMatchObject({
      name: 'TimelineAiError',
      timelineAi: true,
      operation: 'llm.embed',
      model: TIMELINE_MODELS.embedding.id,
      causeName: 'Error',
    });
  });
});

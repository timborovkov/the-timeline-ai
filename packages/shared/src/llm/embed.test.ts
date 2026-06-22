import { MockEmbeddingModelV3 } from 'ai/test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { EmbeddingModel } from 'ai';

import { resetEnvForTests } from '#src/env.js';
import { embed, embedMany } from '#src/llm/embed.js';
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

  it('truncates text before sending it to the embedding model budget', async () => {
    let modelInput = '';
    const model = new MockEmbeddingModelV3({
      doEmbed: (({ values }: { values: string[] }) => {
        modelInput = values[0] ?? '';
        return Promise.resolve({ embeddings: [[1, 2, 3, 4]] });
      }) as never,
    });

    await embed({ text: 'x'.repeat(40_000) }, { model });

    expect(modelInput.length).toBeLessThan(40_000);
    expect(modelInput.endsWith('…')).toBe(true);
    expect(modelInput.length).toBeLessThanOrEqual(
      Math.floor(TIMELINE_MODELS.embedding.contextWindowTokens * 0.8) * 4,
    );
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

  it('throws when OPENROUTER_API_KEY is missing AND no model is injected', async () => {
    delete process.env.OPENROUTER_API_KEY;
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

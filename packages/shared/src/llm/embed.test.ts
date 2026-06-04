import { MockEmbeddingModelV3 } from 'ai/test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { EmbeddingModel } from 'ai';

import { resetEnvForTests } from '#src/env.js';
import { embed } from '#src/llm/embed.js';
import { TIMELINE_MODELS } from '#src/llm/models.js';

const ENV_BACKUP = { ...process.env };

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

  it('throws when OPENROUTER_API_KEY is missing AND no model is injected', async () => {
    delete process.env.OPENROUTER_API_KEY;
    resetEnvForTests();
    await expect(embed({ text: 'hello' })).rejects.toThrow(/OPENROUTER_API_KEY/);
  });
});

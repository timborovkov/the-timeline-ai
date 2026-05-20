import { MockLanguageModelV3 } from 'ai/test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { resetEnvForTests } from '../env';

import { chatStructured } from './chat';

import type { LanguageModel } from 'ai';

const ENV_BACKUP = { ...process.env };

function makeMockModel(text: string): LanguageModel {
  // The MockLanguageModelV3 constructor accepts any partial of the
  // LanguageModelV3 interface; `as never` shape-shifts past the strict
  // literal-union typing the SDK enforces on `finishReason` etc.
  return new MockLanguageModelV3({
    doGenerate: (() =>
      Promise.resolve({
        finishReason: 'stop',
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        content: [{ type: 'text', text }],
        warnings: [],
      })) as never,
  });
}

beforeEach(() => {
  process.env = {
    ...ENV_BACKUP,
    AUTH_SECRET: 'a'.repeat(32),
    DATABASE_URL: 'postgres://x:y@localhost:5432/x',
    OPENROUTER_API_KEY: 'sk-test-key',
    OPENROUTER_BASE_URL: 'https://example.test/v1',
    EXTRACTION_MODEL: 'openai/test-model',
  };
  resetEnvForTests();
});

afterEach(() => {
  process.env = { ...ENV_BACKUP };
  resetEnvForTests();
});

describe('chatStructured', () => {
  it('returns the parsed object and the resolved model id', async () => {
    const result = await chatStructured(
      {
        schema: z.object({ name: z.string(), type: z.string() }),
        prompt: 'extract',
      },
      { model: makeMockModel('{"name":"Apple","type":"company"}') },
    );
    expect(result.object).toEqual({ name: 'Apple', type: 'company' });
    expect(result.model).toBe('openai/test-model');
  });

  it('prefers EXTRACTION_MODEL over CHAT_MODEL_DEFAULT', async () => {
    process.env.CHAT_MODEL_DEFAULT = 'anthropic/should-not-pick';
    resetEnvForTests();
    const result = await chatStructured(
      { schema: z.object({ k: z.number() }), prompt: 'p' },
      { model: makeMockModel('{"k":1}') },
    );
    expect(result.model).toBe('openai/test-model');
  });

  it('falls back to CHAT_MODEL_DEFAULT when EXTRACTION_MODEL is unset', async () => {
    delete process.env.EXTRACTION_MODEL;
    process.env.CHAT_MODEL_DEFAULT = 'anthropic/fallback';
    resetEnvForTests();
    const result = await chatStructured(
      { schema: z.object({ k: z.number() }), prompt: 'p' },
      { model: makeMockModel('{"k":1}') },
    );
    expect(result.model).toBe('anthropic/fallback');
  });

  it('throws when OPENROUTER_API_KEY is missing AND no model is injected', async () => {
    delete process.env.OPENROUTER_API_KEY;
    resetEnvForTests();
    await expect(
      chatStructured({ schema: z.object({ k: z.number() }), prompt: 'p' }),
    ).rejects.toThrow(/OPENROUTER_API_KEY/);
  });
});

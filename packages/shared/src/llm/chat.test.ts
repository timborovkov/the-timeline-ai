import { MockLanguageModelV3 } from 'ai/test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { LanguageModel } from 'ai';

import { resetEnvForTests } from '#src/env.js';
import { chatStructured, resolveAgentModelId, streamChat } from '#src/llm/chat.js';
import { TIMELINE_MODELS } from '#src/llm/models.js';

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
    expect(result.model).toBe(TIMELINE_MODELS.extraction.id);
  });

  it('uses the predefined extraction model catalog entry', async () => {
    const result = await chatStructured(
      { schema: z.object({ k: z.number() }), prompt: 'p' },
      { model: makeMockModel('{"k":1}') },
    );
    expect(result.model).toBe(TIMELINE_MODELS.extraction.id);
  });

  it('throws when OPENROUTER_API_KEY is missing AND no model is injected', async () => {
    delete process.env.OPENROUTER_API_KEY;
    resetEnvForTests();
    await expect(
      chatStructured({ schema: z.object({ k: z.number() }), prompt: 'p' }),
    ).rejects.toThrow(/OPENROUTER_API_KEY/);
  });
});

describe('resolveAgentModelId', () => {
  it('uses the predefined agent model catalog entry', () => {
    expect(resolveAgentModelId()).toBe(TIMELINE_MODELS.agent.id);
  });
});

describe('streamChat', () => {
  it('returns a streamText result with an injected mock model', async () => {
    // Use a fresh MockLanguageModelV3 with a minimal doStream that emits
    // one text chunk and finishes. This proves streamChat composes — full
    // streaming behavior is covered by Vercel's own SDK tests.
    const model = new MockLanguageModelV3({
      doStream: (() =>
        Promise.resolve({
          stream: new ReadableStream({
            start(controller) {
              controller.enqueue({ type: 'text-start', id: '1' });
              controller.enqueue({ type: 'text-delta', id: '1', delta: 'hi' });
              controller.enqueue({ type: 'text-end', id: '1' });
              controller.enqueue({
                type: 'finish',
                finishReason: 'stop',
                usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
              });
              controller.close();
            },
          }),
        })) as never,
    });
    const result = streamChat(
      { system: 'sys', messages: [{ role: 'user', content: 'hi' }], tools: {} },
      { model },
    );
    const text = await result.text;
    expect(text).toBe('hi');
  });
});

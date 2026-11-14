import { expect } from '@timeline/test-support';
import { MockLanguageModelV3 } from 'ai/test';
import { afterEach, beforeEach, it } from 'bun:test';

import { resetEnvForTests } from '#src/env.js';
import { requireValue } from '#src/evals/benchmark.js';
import { chatStructured } from '#src/llm/chat.js';
import {
  buildTaskCategoryPacket,
  classifyTaskCategory,
  classifyTaskCategories,
} from '#src/task-categories/classifier.js';

// Inject failures at inference boundaries; never make provider calls. Malformed
// model output must traverse the real schema parser, not a stubbed classifier.
const original = { ...process.env };
beforeEach(() => {
  process.env.AUTH_SECRET = 'synthetic-test-secret-for-failure-cases';
  process.env.DATABASE_URL = 'postgres://localhost/test';
  process.env.OPENROUTER_API_KEY = 'synthetic-key';
  process.env.LANGSMITH_TRACING = 'false';
  resetEnvForTests();
});
afterEach(() => {
  process.env = { ...original };
  resetEnvForTests();
});
const packet = buildTaskCategoryPacket({ title: 'Implement the invoice parser' });
for (const text of ['{broken', '{"category":"made_up","confidence":0.9}']) {
  it(`rejects invalid model output ${text}`, async () => {
    const model = new MockLanguageModelV3({
      doGenerate: (() =>
        Promise.resolve({
          finishReason: { unified: 'stop', raw: undefined },
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          content: [{ type: 'text', text }],
          warnings: [],
        })) as never,
    });
    await expect(
      classifyTaskCategory(packet, { chatStructured: (input) => chatStructured(input, { model }) }),
    ).rejects.toThrow();
  });
}
for (const error of [
  new DOMException('Timed out', 'TimeoutError'),
  Object.assign(new Error('Rate limited'), { status: 429 }),
]) {
  it(`propagates ${error.name}: ${error.message}`, async () => {
    const signal = AbortSignal.abort(error);
    await expect(
      classifyTaskCategory(packet, {
        abortSignal: signal,
        chatStructured: (input) => {
          expect(input.abortSignal).toBe(signal);
          return Promise.reject(error);
        },
      }),
    ).rejects.toThrow(error.message);
  });
}
it('rejects duplicate input IDs before inference and duplicate/missing output IDs after inference', async () => {
  const items = [
    { key: 'a', packet },
    { key: 'b', packet },
  ];
  let called = false;
  const duplicate = () => {
    called = true;
    return Promise.resolve({
      object: {
        predictions: [
          { key: 'a', category: 'engineering' as const, confidence: 1 },
          { key: 'a', category: 'engineering' as const, confidence: 1 },
        ],
      },
      model: 'synthetic',
    });
  };
  await expect(
    classifyTaskCategories([requireValue(items[0]), requireValue(items[0])], {
      chatStructured: duplicate as never,
    }),
  ).rejects.toThrow('unique');
  expect(called).toBe(false);
  await expect(
    classifyTaskCategories(items, { chatStructured: duplicate as never }),
  ).rejects.toThrow('duplicate');
  await expect(
    classifyTaskCategories(items, {
      chatStructured: (() =>
        Promise.resolve({ object: { predictions: [] }, model: 'synthetic' })) as never,
    }),
  ).rejects.toThrow('omitted');
});

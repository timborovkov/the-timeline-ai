import { MockLanguageModelV3 } from 'ai/test';
import { describe, expect, it } from 'vitest';

import { compressMessagesForContext } from './memory.js';
import { estimateTextTokens, inputTokenBudgetFor, truncateTextToTokenBudget } from './models.js';

import type { LanguageModel, ModelMessage } from 'ai';

function makeSummaryModel(text: string): LanguageModel {
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

describe('compressMessagesForContext', () => {
  it('leaves short transcripts unchanged', async () => {
    const messages: ModelMessage[] = [{ role: 'user', content: 'what changed today?' }];
    const result = await compressMessagesForContext({
      system: 'system',
      messages,
      model: makeSummaryModel('unused'),
      modelId: 'test/chat',
    });

    expect(result.compressed).toBe(false);
    expect(result.messages).toBe(messages);
  });

  it('summarizes older messages at the configured context threshold', async () => {
    const huge = 'old context '.repeat(45_000);
    const messages: ModelMessage[] = [
      { role: 'user', content: huge },
      { role: 'assistant', content: 'older answer' },
      { role: 'user', content: 'latest question' },
    ];

    const result = await compressMessagesForContext({
      system: 'system',
      messages,
      model: makeSummaryModel('User discussed a large amount of old context.'),
      modelId: 'test/chat',
    });

    expect(result.compressed).toBe(true);
    expect(result.summarizedMessages).toBeGreaterThan(0);
    const summary = result.messages[0];
    expect(summary?.role).toBe('system');
    expect(summary?.content).toContain('Earlier conversation summary');
    expect(result.messages.at(-1)).toEqual({ role: 'user', content: 'latest question' });
  });
});

describe('background prompt budgets', () => {
  it('derives input budgets from model context and reserved output tokens', () => {
    expect(
      inputTokenBudgetFor(
        { contextWindowTokens: 10_000 },
        { fraction: 0.8, reservedOutputTokens: 500 },
      ),
    ).toBe(7_500);
  });

  it('truncates oversized background prompts to the requested token budget', () => {
    const truncated = truncateTextToTokenBudget('x'.repeat(1_000), 100);

    expect(estimateTextTokens(truncated)).toBeLessThanOrEqual(101);
    expect(truncated.endsWith('…')).toBe(true);
  });
});

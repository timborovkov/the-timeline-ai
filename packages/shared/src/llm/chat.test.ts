import { MockLanguageModelV3 } from 'ai/test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { LanguageModel } from 'ai';

import { resetEnvForTests } from '#src/env.js';
import { EXTRACTION_SYSTEM_PROMPT } from '#src/extract/prompt.js';
import { extractionResultSchema } from '#src/extract/schema.js';
import { chatStructured, resolveAgentModelId, streamChat } from '#src/llm/chat.js';
import { TIMELINE_MODELS } from '#src/llm/models.js';

const ENV_BACKUP = { ...process.env };
const liveOpenRouterIt =
  ENV_BACKUP.OPENROUTER_API_KEY && ENV_BACKUP.OPENROUTER_LIVE_TESTS === '1' ? it : it.skip;
const openRouterRequestSchema = z.object({
  model: z.unknown(),
  messages: z.array(z.object({ role: z.unknown(), content: z.unknown() })),
  response_format: z.object({
    type: z.unknown(),
    json_schema: z.object({
      strict: z.unknown(),
      schema: z.object({
        properties: z.object({
          facts: z.object({
            items: z.object({
              required: z.unknown(),
              properties: z.record(z.string(), z.unknown()),
            }),
          }),
        }),
      }),
    }),
  }),
});

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

  it('repairs known legacy extraction field aliases', async () => {
    const result = await chatStructured(
      {
        schema: extractionResultSchema,
        prompt: 'Extract facts from: The AuditAI team has a meeting scheduled for Monday.',
        system: EXTRACTION_SYSTEM_PROMPT,
      },
      {
        model: makeMockModel(
          JSON.stringify({
            facts: [
              {
                text: 'The AuditAI team has a meeting scheduled for Monday.',
                confidence: 0.7,
                entities: [
                  { name: 'AuditAI', type: 'project', role: 'subject' },
                  { name: 'Monday meeting', type: 'topic', role: 'topic' },
                ],
              },
            ],
          }),
        ),
      },
    );

    expect(result.object.facts[0]).toEqual({
      statement: 'The AuditAI team has a meeting scheduled for Monday.',
      confidence: 0.7,
      mentions: [
        { name: 'AuditAI', type: 'project', role: 'subject' },
        { name: 'Monday meeting', type: 'topic', role: 'topic' },
      ],
    });
  });

  it('requests OpenRouter json_schema structured output for extraction', async () => {
    const requests: unknown[] = [];
    const fetchStub: typeof fetch = (_url, init) => {
      if (typeof init?.body === 'string') {
        const parsed: unknown = JSON.parse(init.body);
        requests.push(parsed);
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            id: 'chatcmpl-test',
            object: 'chat.completion',
            created: 0,
            model: TIMELINE_MODELS.extraction.id,
            choices: [
              {
                index: 0,
                message: {
                  role: 'assistant',
                  content: JSON.stringify({
                    facts: [
                      {
                        statement: 'Mikael Rintala shared a Google Drive folder for AuditAI.',
                        confidence: 1,
                        mentions: [
                          {
                            name: 'Mikael Rintala',
                            type: 'person',
                            role: 'subject',
                            aliases: ['mikaelrintala'],
                          },
                        ],
                      },
                    ],
                  }),
                },
                finish_reason: 'stop',
              },
            ],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );
    };

    const result = await chatStructured(
      {
        schema: extractionResultSchema,
        prompt: 'Extract facts from: Mikael Rintala shared a Google Drive folder for AuditAI.',
        system: EXTRACTION_SYSTEM_PROMPT,
      },
      { fetch: fetchStub },
    );

    expect(result.model).toBe('qwen/qwen3.7-max');
    expect(result.object.facts[0]).toMatchObject({
      statement: 'Mikael Rintala shared a Google Drive folder for AuditAI.',
      mentions: [{ name: 'Mikael Rintala', type: 'person', role: 'subject' }],
    });
    expect(requests).toHaveLength(1);
    const body = openRouterRequestSchema.parse(requests[0]);
    expect(body.model).toBe('qwen/qwen3.7-max');
    expect(
      body.messages.some((message) => String(message.content).toLowerCase().includes('json')),
    ).toBe(true);
    expect(body.response_format.type).toBe('json_schema');
    expect(body.response_format.json_schema.strict).toBe(true);
    const factSchema = body.response_format.json_schema.schema.properties.facts.items;
    expect(factSchema.required).toEqual(
      expect.arrayContaining(['statement', 'confidence', 'mentions']),
    );
    expect(factSchema.properties).toHaveProperty('statement');
    expect(factSchema.properties).toHaveProperty('mentions');
  });

  liveOpenRouterIt(
    'integration/live: extracts facts with OpenRouter structured output',
    async () => {
      process.env = {
        ...ENV_BACKUP,
        AUTH_SECRET: ENV_BACKUP.AUTH_SECRET ?? 'a'.repeat(32),
        DATABASE_URL: ENV_BACKUP.DATABASE_URL ?? 'postgres://x:y@localhost:5432/x',
        OPENROUTER_API_KEY: ENV_BACKUP.OPENROUTER_API_KEY,
        OPENROUTER_BASE_URL: ENV_BACKUP.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1',
      };
      resetEnvForTests();

      const result = await chatStructured({
        schema: extractionResultSchema,
        system: EXTRACTION_SYSTEM_PROMPT,
        prompt:
          'Current event: Tim met Apple about SaaS licensing. Return one explicit fact with mentions.',
      });

      expect(result.model).toBe('qwen/qwen3.7-max');
      expect(result.object.facts.length).toBeGreaterThan(0);
      const fact = result.object.facts[0];
      expect(fact).toBeDefined();
      if (!fact) throw new Error('OpenRouter returned no facts');
      expect(typeof fact.statement).toBe('string');
      expect(typeof fact.confidence).toBe('number');
      expect(Array.isArray(fact.mentions)).toBe(true);
    },
    30_000,
  );

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

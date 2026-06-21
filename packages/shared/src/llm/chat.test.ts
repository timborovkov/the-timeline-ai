import { MockLanguageModelV3 } from 'ai/test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import type { LanguageModel, StreamTextOnErrorCallback } from 'ai';

import { resetEnvForTests } from '#src/env.js';
import { EXTRACTION_SYSTEM_PROMPT } from '#src/extract/prompt.js';
import { extractionResultSchema } from '#src/extract/schema.js';
import { chatStructured, resolveAgentModelId, streamChat } from '#src/llm/chat.js';
import { TIMELINE_MODELS } from '#src/llm/models.js';

const aiSdkGlobal = globalThis as typeof globalThis & {
  AI_SDK_LOG_WARNINGS?: boolean;
};

aiSdkGlobal.AI_SDK_LOG_WARNINGS = false;

const ENV_BACKUP = { ...process.env };
const liveOpenRouterIt =
  ENV_BACKUP.OPENROUTER_API_KEY && ENV_BACKUP.OPENROUTER_LIVE_TESTS === '1' ? it : it.skip;
const openRouterRequestSchema = z.object({
  model: z.unknown(),
  messages: z.array(z.object({ role: z.unknown(), content: z.unknown() })),
  provider: z
    .object({
      require_parameters: z.unknown(),
    })
    .optional(),
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

  it('repairs bare extraction fact arrays returned by the model', async () => {
    const result = await chatStructured(
      {
        schema: extractionResultSchema,
        prompt: 'Extract facts from: Mikael Rintala shared a Google Drive folder for Otto.',
        system: EXTRACTION_SYSTEM_PROMPT,
      },
      {
        model: makeMockModel(
          JSON.stringify([
            {
              statement:
                'Mikael Rintala shared a Google Drive folder link containing zip files and an HTML version for Otto.',
              confidence: 1,
              mentions: [
                {
                  name: 'Mikael Rintala',
                  type: 'person',
                  role: 'subject',
                  aliases: ['@mikaelrintala'],
                },
                { name: 'Otto', type: 'person', role: 'object', aliases: [] },
                { name: 'Google Drive', type: 'company', role: 'object', aliases: [] },
              ],
            },
          ]),
        ),
      },
    );

    expect(result.object.facts).toHaveLength(1);
    expect(result.object.facts[0]).toMatchObject({
      statement:
        'Mikael Rintala shared a Google Drive folder link containing zip files and an HTML version for Otto.',
      mentions: [
        { name: 'Mikael Rintala', type: 'person', role: 'subject' },
        { name: 'Otto', type: 'person', role: 'object' },
        { name: 'Google Drive', type: 'company', role: 'object' },
      ],
    });
  });

  it('repairs camelCase actionItems in structured meeting summaries', async () => {
    const result = await chatStructured(
      {
        schema: z.object({
          summary: z.string(),
          action_items: z.array(
            z.object({ text: z.string(), owner: z.string().nullable().optional() }),
          ),
        }),
        prompt: 'Summarize the meeting.',
      },
      {
        model: makeMockModel(
          JSON.stringify({
            summary: 'The team discussed launch readiness.',
            actionItems: [{ text: 'Send the launch checklist.', owner: 'Mikael' }],
          }),
        ),
      },
    );

    expect(result.object).toEqual({
      summary: 'The team discussed launch readiness.',
      action_items: [{ text: 'Send the launch checklist.', owner: 'Mikael' }],
    });
  });

  it('repairs candidate_index aliases in entity disambiguation responses', async () => {
    const result = await chatStructured(
      {
        schema: z.object({ choice: z.number().int() }),
        prompt: 'Pick the candidate that refers to the same real-world entity.',
      },
      { model: makeMockModel(JSON.stringify({ candidate_index: 1 })) },
    );

    expect(result.object).toEqual({ choice: 1 });
  });

  it('rejects repaired candidate_index values outside a bounded choice schema', async () => {
    await expect(
      chatStructured(
        {
          schema: z.object({ choice: z.number().int().min(-1).max(1) }),
          prompt: 'Pick the candidate that refers to the same real-world entity.',
        },
        { model: makeMockModel(JSON.stringify({ candidate_index: 999 })) },
      ),
    ).rejects.toMatchObject({
      name: 'TimelineAiError',
      timelineAi: true,
      operation: 'llm.chatStructured',
      model: TIMELINE_MODELS.extraction.id,
      causeName: 'AI_NoObjectGeneratedError',
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
    expect(body.provider?.require_parameters).toBe(true);
    expect(body.response_format.json_schema.strict).toBe(true);
    const factSchema = body.response_format.json_schema.schema.properties.facts.items;
    expect(factSchema.required).toEqual(
      expect.arrayContaining(['statement', 'confidence', 'mentions']),
    );
    expect(factSchema.properties).toHaveProperty('statement');
    expect(factSchema.properties).toHaveProperty('mentions');
  });

  it('falls back to json_object mode when OpenRouter rejects strict json_schema', async () => {
    const requests: unknown[] = [];
    const fetchStub: typeof fetch = (_url, init) => {
      if (typeof init?.body !== 'string') throw new Error('expected request body');
      const parsed: unknown = JSON.parse(init.body);
      requests.push(parsed);
      if (requests.length === 1) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              error: { message: 'Provider rejected json_schema for this route' },
            }),
            { status: 400, headers: { 'Content-Type': 'application/json' } },
          ),
        );
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            id: 'chatcmpl-test-fallback',
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
                        statement: 'Acme is evaluating Timeline for Q4.',
                        confidence: 0.92,
                        mentions: [{ name: 'Acme', type: 'company', role: 'subject' }],
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
        prompt: 'Extract facts from: Acme is evaluating Timeline for Q4.',
        system: EXTRACTION_SYSTEM_PROMPT,
      },
      { fetch: fetchStub },
    );

    expect(result.object.facts[0]).toMatchObject({
      statement: 'Acme is evaluating Timeline for Q4.',
      mentions: [{ name: 'Acme', type: 'company', role: 'subject' }],
    });
    expect(requests).toHaveLength(2);
    const primary = openRouterRequestSchema.parse(requests[0]);
    expect(primary.response_format.type).toBe('json_schema');
    expect(primary.provider?.require_parameters).toBe(true);
    const fallback = z
      .object({
        messages: z.array(z.object({ role: z.unknown(), content: z.unknown() })),
        provider: z
          .object({
            require_parameters: z.unknown(),
          })
          .optional(),
        response_format: z.object({ type: z.unknown() }),
      })
      .parse(requests[1]);
    expect(fallback.response_format.type).toBe('json_object');
    expect(fallback.provider?.require_parameters).toBe(true);
    expect(
      fallback.messages.some((message) =>
        String(message.content).includes('Return only a JSON object matching this JSON Schema'),
      ),
    ).toBe(true);
  });

  it('falls back to json_object mode when structured generation returns no object', async () => {
    const requests: unknown[] = [];
    const fetchStub: typeof fetch = (_url, init) => {
      if (typeof init?.body !== 'string') throw new Error('expected request body');
      const parsed: unknown = JSON.parse(init.body);
      requests.push(parsed);
      if (requests.length === 1) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'chatcmpl-no-object',
              object: 'chat.completion',
              created: 0,
              model: TIMELINE_MODELS.extraction.id,
              choices: [
                {
                  index: 0,
                  message: { role: 'assistant', content: 'I cannot produce structured JSON.' },
                  finish_reason: 'stop',
                },
              ],
              usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        );
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            id: 'chatcmpl-json-object-recovery',
            object: 'chat.completion',
            created: 0,
            model: TIMELINE_MODELS.extraction.id,
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: JSON.stringify({ facts: [] }) },
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
        prompt: 'Extract facts from: Heading out for lunch.',
        system: EXTRACTION_SYSTEM_PROMPT,
      },
      { fetch: fetchStub },
    );

    expect(result).toEqual({ object: { facts: [] }, model: TIMELINE_MODELS.extraction.id });
    expect(requests).toHaveLength(2);
    const summaries = requests.map((request) =>
      z
        .object({
          model: z.string(),
          response_format: z.object({ type: z.string() }),
        })
        .parse(request),
    );
    expect(summaries).toEqual([
      { model: TIMELINE_MODELS.extraction.id, response_format: { type: 'json_schema' } },
      { model: TIMELINE_MODELS.extraction.id, response_format: { type: 'json_object' } },
    ]);
  });

  it('does not retry with a fallback model for auth failures', async () => {
    const requests: unknown[] = [];
    const fetchStub: typeof fetch = (_url, init) => {
      if (typeof init?.body !== 'string') throw new Error('expected request body');
      requests.push(JSON.parse(init.body));
      return Promise.resolve(
        new Response(JSON.stringify({ error: { message: 'invalid api key' } }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    };

    await expect(
      chatStructured(
        {
          schema: extractionResultSchema,
          prompt: 'Extract facts from: Acme is evaluating Timeline for Q4.',
          system: EXTRACTION_SYSTEM_PROMPT,
        },
        { fetch: fetchStub },
      ),
    ).rejects.toThrow('llm.chatStructured failed');

    expect(requests).toHaveLength(1);
    const primary = openRouterRequestSchema.parse(requests[0]);
    expect(primary.response_format.type).toBe('json_schema');
  });

  it('retries retryable provider failures on the structured fallback model', async () => {
    const requests: unknown[] = [];
    const fetchStub: typeof fetch = (_url, init) => {
      if (typeof init?.body !== 'string') throw new Error('expected request body');
      const parsed: unknown = JSON.parse(init.body);
      requests.push(parsed);
      const model = z.object({ model: z.string() }).parse(parsed).model;
      if (model === TIMELINE_MODELS.extraction.id) {
        return Promise.resolve(
          new Response(JSON.stringify({ error: { message: 'provider temporarily unavailable' } }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            id: 'chatcmpl-test-fallback-model',
            object: 'chat.completion',
            created: 0,
            model: TIMELINE_MODELS.structuredFallback.id,
            choices: [
              {
                index: 0,
                message: {
                  role: 'assistant',
                  content: JSON.stringify({
                    facts: [
                      {
                        statement: 'Acme is evaluating Timeline for Q4.',
                        confidence: 0.92,
                        mentions: [{ name: 'Acme', type: 'company', role: 'subject' }],
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
        prompt: 'Extract facts from: Acme is evaluating Timeline for Q4.',
        system: EXTRACTION_SYSTEM_PROMPT,
      },
      { fetch: fetchStub },
    );

    expect(result.model).toBe(TIMELINE_MODELS.structuredFallback.id);
    expect(openRouterRequestSchema.parse(requests[0]).model).toBe(TIMELINE_MODELS.extraction.id);
    expect(requests.map((request) => openRouterRequestSchema.parse(request).model)).toContain(
      TIMELINE_MODELS.structuredFallback.id,
    );
    expect(result.object.facts[0]).toMatchObject({
      statement: 'Acme is evaluating Timeline for Q4.',
      mentions: [{ name: 'Acme', type: 'company', role: 'subject' }],
    });
  });

  it('retries request timeouts on the structured fallback model', async () => {
    const requests: unknown[] = [];
    const fetchStub: typeof fetch = (_url, init) => {
      if (typeof init?.body !== 'string') throw new Error('expected request body');
      const parsed: unknown = JSON.parse(init.body);
      requests.push(parsed);
      const model = z.object({ model: z.string() }).parse(parsed).model;
      if (model === TIMELINE_MODELS.extraction.id) {
        return Promise.resolve(
          new Response(JSON.stringify({ error: { message: 'provider request timeout' } }), {
            status: 408,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            id: 'chatcmpl-test-timeout-fallback',
            object: 'chat.completion',
            created: 0,
            model: TIMELINE_MODELS.structuredFallback.id,
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: JSON.stringify({ facts: [] }) },
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
        prompt: 'Extract facts from: Heading out for lunch.',
        system: EXTRACTION_SYSTEM_PROMPT,
      },
      { fetch: fetchStub },
    );

    expect(result.model).toBe(TIMELINE_MODELS.structuredFallback.id);
    expect(requests.map((request) => openRouterRequestSchema.parse(request).model)).toEqual([
      TIMELINE_MODELS.extraction.id,
      TIMELINE_MODELS.structuredFallback.id,
    ]);
  });

  it('retries the structured fallback model when json_object fallback hits a retryable provider failure', async () => {
    const requests: unknown[] = [];
    const fetchStub: typeof fetch = (_url, init) => {
      if (typeof init?.body !== 'string') throw new Error('expected request body');
      const parsed: unknown = JSON.parse(init.body);
      requests.push(parsed);
      const request = z
        .object({
          model: z.string(),
          response_format: z.object({ type: z.string() }).optional(),
        })
        .parse(parsed);
      if (
        request.model === TIMELINE_MODELS.extraction.id &&
        request.response_format?.type === 'json_schema'
      ) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ error: { message: 'Provider rejected json_schema for this route' } }),
            { status: 400, headers: { 'Content-Type': 'application/json' } },
          ),
        );
      }
      if (request.model === TIMELINE_MODELS.extraction.id) {
        return Promise.resolve(
          new Response(JSON.stringify({ error: { message: 'OpenRouter unavailable' } }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            id: 'chatcmpl-test-fallback-model',
            object: 'chat.completion',
            created: 0,
            model: TIMELINE_MODELS.structuredFallback.id,
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: JSON.stringify({ facts: [] }) },
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
        prompt: 'Extract facts from: Heading out for lunch.',
        system: EXTRACTION_SYSTEM_PROMPT,
      },
      { fetch: fetchStub },
    );

    expect(result.model).toBe(TIMELINE_MODELS.structuredFallback.id);
    const requestSummaries = requests.map((request) =>
      z
        .object({
          model: z.string(),
          response_format: z.object({ type: z.string() }),
        })
        .parse(request),
    );
    expect(requestSummaries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          model: TIMELINE_MODELS.extraction.id,
          response_format: { type: 'json_schema' },
        }),
        expect.objectContaining({
          model: TIMELINE_MODELS.extraction.id,
          response_format: { type: 'json_object' },
        }),
        expect.objectContaining({
          model: TIMELINE_MODELS.structuredFallback.id,
          response_format: { type: 'json_schema' },
        }),
      ]),
    );
  });

  it('retries the structured fallback model when json_object fallback also returns no object', async () => {
    const requests: unknown[] = [];
    const fetchStub: typeof fetch = (_url, init) => {
      if (typeof init?.body !== 'string') throw new Error('expected request body');
      const parsed: unknown = JSON.parse(init.body);
      requests.push(parsed);
      const request = z
        .object({
          model: z.string(),
          response_format: z.object({ type: z.string() }),
        })
        .parse(parsed);
      if (request.model === TIMELINE_MODELS.extraction.id) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: `chatcmpl-no-object-${request.response_format.type}`,
              object: 'chat.completion',
              created: 0,
              model: TIMELINE_MODELS.extraction.id,
              choices: [
                {
                  index: 0,
                  message: { role: 'assistant', content: 'No structured object here.' },
                  finish_reason: 'stop',
                },
              ],
              usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        );
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            id: 'chatcmpl-fallback-model-recovery',
            object: 'chat.completion',
            created: 0,
            model: TIMELINE_MODELS.structuredFallback.id,
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: JSON.stringify({ facts: [] }) },
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
        prompt: 'Extract facts from: Heading out for lunch.',
        system: EXTRACTION_SYSTEM_PROMPT,
      },
      { fetch: fetchStub },
    );

    expect(result).toEqual({ object: { facts: [] }, model: TIMELINE_MODELS.structuredFallback.id });
    expect(
      requests.map((request) =>
        z
          .object({
            model: z.string(),
            response_format: z.object({ type: z.string() }),
          })
          .parse(request),
      ),
    ).toEqual([
      { model: TIMELINE_MODELS.extraction.id, response_format: { type: 'json_schema' } },
      { model: TIMELINE_MODELS.extraction.id, response_format: { type: 'json_object' } },
      { model: TIMELINE_MODELS.structuredFallback.id, response_format: { type: 'json_schema' } },
    ]);
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
    ).rejects.toMatchObject({
      name: 'TimelineAiError',
      timelineAi: true,
      operation: 'llm.chatStructured',
      model: TIMELINE_MODELS.extraction.id,
      causeName: 'Error',
    });
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

  it('wraps stream-time provider failures before invoking onError', async () => {
    const cause = new Error('provider streamed a private payload');
    const onError = vi.fn<StreamTextOnErrorCallback>();
    const model = new MockLanguageModelV3({
      doStream: (() => {
        throw cause;
      }) as never,
    });

    const result = streamChat(
      { system: 'sys', messages: [{ role: 'user', content: 'hi' }], tools: {}, onError },
      { model },
    );

    await expect(result.text).rejects.toThrow();
    expect(onError).toHaveBeenCalledOnce();
    const event = onError.mock.calls[0]?.[0];
    expect(event?.error).toMatchObject({
      name: 'TimelineAiError',
      timelineAi: true,
      operation: 'llm.streamChat',
      model: TIMELINE_MODELS.agent.id,
      causeName: 'Error',
    });
    expect(event?.error).not.toHaveProperty('cause');
  });
});

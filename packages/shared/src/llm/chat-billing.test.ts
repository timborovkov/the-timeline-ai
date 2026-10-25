import { PGlite } from '@electric-sql/pglite';
import { billingUsageLedger, type Db } from '@timeline/db';
import { MockLanguageModelV3 } from 'ai/test';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { LanguageModel } from 'ai';

import { runWorkerBilling } from '#src/billing/runtime.js';
import { resetEnvForTests } from '#src/env.js';
import { EXTRACTION_SYSTEM_PROMPT } from '#src/extract/prompt.js';
import { extractionResultSchema } from '#src/extract/schema.js';
import { chatStructured } from '#src/llm/chat.js';
import { TIMELINE_MODELS } from '#src/llm/models.js';
import { applyDbMigrations } from '#src/test/pglite.js';

const TEAM_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const USER_ID = '11111111-2222-4333-8444-555555555555';

const extractSchema = z.object({ bundles: z.array(z.string()) });
const classifySchema = z.object({ predictions: z.array(z.string()) });

function modelForStages(): { model: LanguageModel; calls: string[] } {
  const calls: string[] = [];
  const model = new MockLanguageModelV3({
    doGenerate: (({ prompt }: { prompt: unknown }) => {
      const encoded = JSON.stringify(prompt);
      calls.push(encoded);
      const text = encoded.includes('classify-stage')
        ? '{"predictions":["task"]}'
        : '{"bundles":["commitment"]}';
      return Promise.resolve({
        finishReason: { unified: 'stop', raw: undefined },
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        content: [{ type: 'text', text }],
        warnings: [],
      });
    }) as never,
  });
  return { model, calls };
}

describe('structured billing operation ids', () => {
  let pg: PGlite;
  let db: Db;

  beforeEach(async () => {
    pg = new PGlite();
    await applyDbMigrations(pg);
    await pg.exec(`
      INSERT INTO teams (id, slug, name)
      VALUES ('${TEAM_ID}', 'chat-billing', 'Chat Billing');
      INSERT INTO users (id, email)
      VALUES ('${USER_ID}', 'owner@example.test');
      INSERT INTO team_members (team_id, user_id, role)
      VALUES ('${TEAM_ID}', '${USER_ID}', 'owner');
    `);
    db = drizzle(pg) as unknown as Db;
  });

  afterEach(async () => {
    resetEnvForTests();
    await pg.close();
  });

  it('bills extraction and classification separately under one worker operation id', async () => {
    const { model, calls } = modelForStages();
    const call = <TSchema extends z.ZodType>(prompt: string, schema: TSchema) =>
      runWorkerBilling(
        db,
        TEAM_ID,
        'suggestions',
        () => chatStructured({ schema, prompt, instructions: prompt }, { model }),
        { operationId: 'suggestions:job-shared' },
      );

    const extracted = await call('extract-stage', extractSchema);
    const classified = await call('classify-stage', classifySchema);
    const callsBeforeReplay = calls.length;
    const replayed = await call('extract-stage', extractSchema);

    expect(extracted.object).toEqual({ bundles: ['commitment'] });
    expect(classified.object).toEqual({ predictions: ['task'] });
    expect(replayed.object).toEqual(extracted.object);
    expect(calls.length).toBe(callsBeforeReplay);
    expect(calls.some((entry) => entry.includes('classify-stage'))).toBe(true);
    expect(calls.some((entry) => entry.includes('extract-stage'))).toBe(true);

    const operationIds = (
      await db
        .select({ operationId: billingUsageLedger.operationId })
        .from(billingUsageLedger)
        .where(eq(billingUsageLedger.teamId, TEAM_ID))
    ).map((row) => row.operationId);
    expect(operationIds).toHaveLength(2);
    expect(
      operationIds.every((operationId) =>
        operationId.startsWith('suggestions:job-shared:chat_structured:'),
      ),
    ).toBe(true);
    expect(new Set(operationIds).size).toBe(2);
  });

  it('settles OpenRouter cost when json_object fallback JSON fails the schema', async () => {
    process.env.AUTH_SECRET = 'a'.repeat(32);
    process.env.DATABASE_URL = 'postgres://x:y@localhost:5432/x';
    process.env.OPENROUTER_API_KEY = 'sk-test-key';
    process.env.OPENROUTER_BASE_URL = 'https://example.test/v1';
    resetEnvForTests();
    const fetchStub: typeof fetch = (_url, init) => {
      if (typeof init?.body !== 'string') throw new Error('expected request body');
      const request = z
        .object({
          model: z.string(),
          response_format: z.object({ type: z.string() }),
        })
        .parse(JSON.parse(init.body));
      if (request.response_format.type === 'json_schema') {
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
            id: `chatcmpl-schema-invalid-${request.model}`,
            object: 'chat.completion',
            created: 0,
            model: request.model,
            choices: [
              {
                index: 0,
                message: {
                  role: 'assistant',
                  content: JSON.stringify({ facts: [{ text: 42 }] }),
                },
                finish_reason: 'stop',
              },
            ],
            usage: {
              prompt_tokens: 1,
              completion_tokens: 1,
              total_tokens: 2,
              cost: request.model === TIMELINE_MODELS.extraction.id ? 0.03 : 0.04,
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );
    };

    await expect(
      runWorkerBilling(
        db,
        TEAM_ID,
        'suggestions',
        () =>
          chatStructured(
            {
              schema: extractionResultSchema,
              prompt: 'Extract facts from: Heading out for lunch.',
              instructions: EXTRACTION_SYSTEM_PROMPT,
            },
            { fetch: fetchStub },
          ),
        { operationId: 'suggestions:schema-invalid-fallback' },
      ),
    ).rejects.toThrow('llm.chatStructured failed');

    const ledger = await db
      .select()
      .from(billingUsageLedger)
      .where(eq(billingUsageLedger.teamId, TEAM_ID));
    const attempt = ledger.find((row) => row.operationId.includes(':failed:'));
    expect(attempt?.customerChargeCents).toBeGreaterThan(0);
    expect(attempt?.metadata).toMatchObject({ openrouter_usd: 0.07 });
  });
});

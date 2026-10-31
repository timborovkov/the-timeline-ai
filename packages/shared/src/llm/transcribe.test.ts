import { PGlite } from '@electric-sql/pglite';
import { billingUsageLedger, billingUsageReservations, type Db } from '@timeline/db';
import { expect, vi } from '@timeline/test-support';
import { MockTranscriptionModelV3 } from 'ai/test';
import { afterEach, beforeEach, describe, it } from 'bun:test';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';

import type { TranscriptionModel } from 'ai';

import { runWorkerBilling } from '#src/billing/runtime.js';
import { resetEnvForTests } from '#src/env.js';
import { TIMELINE_MODELS } from '#src/llm/models.js';
import { transcribeAudio } from '#src/llm/transcribe.js';
import { applyDbMigrations } from '#src/test/pglite.js';
// Tests for the transcribe wrapper. The production path calls OpenRouter's
// JSON/base64 STT endpoint; tests also inject a mock TranscriptionModel for
// deterministic SDK-level wrapper coverage. AUTH_SECRET and DATABASE_URL are
// set so the shared env loader parses cleanly.

const ENV_BACKUP = { ...process.env };

function makeMockModel(text: string): TranscriptionModel {
  return new MockTranscriptionModelV3({
    doGenerate: () =>
      Promise.resolve({
        text,
        segments: [],
        language: undefined,
        durationInSeconds: undefined,
        warnings: [],
        response: {
          timestamp: new Date(),
          modelId: TIMELINE_MODELS.transcription.id,
          headers: {},
        },
      }),
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

describe('transcribeAudio', () => {
  it('posts JSON/base64 audio to OpenRouter by default', async () => {
    const calls: [input: Parameters<typeof globalThis.fetch>[0], init: RequestInit | undefined][] =
      [];
    const fetch = vi.fn<
      (...args: Parameters<typeof globalThis.fetch>) => ReturnType<typeof globalThis.fetch>
    >((input, init) => {
      calls.push([input, init]);
      return Promise.resolve(
        new Response(JSON.stringify({ text: 'hello from openrouter' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    });

    const result = await transcribeAudio(
      { audio: Buffer.from('fake-audio-bytes'), format: 'm4a', language: 'en' },
      { fetch },
    );

    expect(result).toEqual({
      text: 'hello from openrouter',
      model: TIMELINE_MODELS.transcription.id,
    });
    expect(fetch).toHaveBeenCalledOnce();
    const call = calls[0];
    if (!call) throw new Error('expected fetch call');
    const [url, init] = call;
    if (!init || typeof init.body !== 'string') throw new Error('expected JSON request body');
    expect(url).toBe('https://example.test/v1/audio/transcriptions');
    expect(init).toMatchObject({
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: 'Bearer sk-test-key',
        'Content-Type': 'application/json',
        'X-OpenRouter-Cache': 'false',
      },
    });
    expect(JSON.parse(init.body)).toEqual({
      model: TIMELINE_MODELS.transcription.id,
      input_audio: {
        data: Buffer.from('fake-audio-bytes').toString('base64'),
        format: 'm4a',
      },
      language: 'en',
    });
  });

  it('accepts an eval model and key without reading shared env', async () => {
    delete process.env.OPENROUTER_API_KEY;
    resetEnvForTests();
    const fetch = vi.fn<
      (...args: Parameters<typeof globalThis.fetch>) => ReturnType<typeof globalThis.fetch>
    >((_input, init) => {
      if (!init || typeof init.body !== 'string') throw new Error('expected JSON request body');
      expect(JSON.parse(init.body)).toMatchObject({
        model: 'openai/whisper-large-v3',
        response_format: 'json',
      });
      return Promise.resolve(
        new Response(JSON.stringify({ text: 'eval transcript', usage: { cost: 0.002 } }), {
          status: 200,
          headers: { 'content-type': 'application/json', 'x-generation-id': 'gen-eval' },
        }),
      );
    });

    const result = await transcribeAudio(
      {
        audio: Buffer.from('eval-audio'),
        format: 'wav',
        modelId: 'openai/whisper-large-v3',
        timeoutMs: 5_000,
        responseFormat: 'json',
      },
      { fetch, apiKey: 'eval-key', baseURL: 'https://openrouter.ai/api/v1' },
    );

    expect(result).toEqual({
      text: 'eval transcript',
      model: 'openai/whisper-large-v3',
      costUsd: 0.002,
      generationId: 'gen-eval',
    });
  });

  it('returns the transcribed text and the configured model id', async () => {
    const result = await transcribeAudio(
      { audio: Buffer.from('fake-audio-bytes') },
      { model: makeMockModel('hello world') },
    );
    expect(result).toEqual({ text: 'hello world', model: TIMELINE_MODELS.transcription.id });
    expect(JSON.parse(JSON.stringify(result))).toEqual({
      text: 'hello world',
      model: TIMELINE_MODELS.transcription.id,
    });
  });

  it('uses the predefined transcription model catalog entry', async () => {
    const result = await transcribeAudio(
      { audio: Buffer.from('x') },
      { model: makeMockModel('ok') },
    );
    expect(result.model).toBe(TIMELINE_MODELS.transcription.id);
    expect(TIMELINE_MODELS.transcription.id).toBe('openai/gpt-4o-transcribe');
  });

  it('throws when OPENROUTER_API_KEY is missing AND no model is injected', async () => {
    delete process.env.OPENROUTER_API_KEY;
    resetEnvForTests();
    await expect(transcribeAudio({ audio: Buffer.from('x') })).rejects.toMatchObject({
      name: 'TimelineAiError',
      timelineAi: true,
      operation: 'llm.transcribeAudio',
      model: TIMELINE_MODELS.transcription.id,
      causeName: 'Error',
    });
  });

  it('propagates SDK errors from the provider', async () => {
    const erroringModel = new MockTranscriptionModelV3({
      doGenerate: () => Promise.reject(new Error('upstream busted')),
    });
    await expect(
      transcribeAudio({ audio: Buffer.from('x') }, { model: erroringModel }),
    ).rejects.toMatchObject({
      name: 'TimelineAiError',
      timelineAi: true,
      operation: 'llm.transcribeAudio',
      model: TIMELINE_MODELS.transcription.id,
      causeName: 'Error',
    });
  });

  it('settles provider cost when a transcript payload has no text', async () => {
    const pg = new PGlite();
    const teamId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    const userId = '11111111-2222-4333-8444-555555555555';
    await applyDbMigrations(pg);
    await pg.exec(`
      INSERT INTO teams (id, slug, name)
      VALUES ('${teamId}', 'transcribe-billing', 'Transcribe Billing');
      INSERT INTO users (id, email)
      VALUES ('${userId}', 'owner@example.test');
      INSERT INTO team_members (team_id, user_id, role)
      VALUES ('${teamId}', '${userId}', 'owner');
    `);
    const db = drizzle(pg) as unknown as Db;
    const fetch = vi.fn<
      (...args: Parameters<typeof globalThis.fetch>) => ReturnType<typeof globalThis.fetch>
    >(() =>
      Promise.resolve(
        new Response(JSON.stringify({ usage: { cost: 0.02, total_tokens: 8 } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );

    try {
      await expect(
        runWorkerBilling(
          db,
          teamId,
          'transcription',
          () =>
            transcribeAudio(
              {
                audio: Buffer.from('fake-audio'),
                format: 'm4a',
                operationId: 'transcription:no-text',
              },
              { fetch },
            ),
          { operationId: 'transcription:no-text' },
        ),
      ).rejects.toMatchObject({
        name: 'TimelineAiError',
        operation: 'llm.transcribeAudio',
        causeMessage: 'OpenRouter transcription response did not include text',
      });

      const ledger = await db
        .select()
        .from(billingUsageLedger)
        .where(eq(billingUsageLedger.teamId, teamId));
      const attempt = ledger.find((row) => row.operationId.includes(':failed:'));
      expect(attempt?.metadata).toMatchObject({ openrouter_usd: 0.02 });
      const [reservation] = await db
        .select()
        .from(billingUsageReservations)
        .where(eq(billingUsageReservations.teamId, teamId));
      expect(reservation?.state).toBe('released');
      expect(fetch).toHaveBeenCalledTimes(1);
    } finally {
      await pg.close();
    }
  });
});

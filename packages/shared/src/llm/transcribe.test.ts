import { MockTranscriptionModelV3 } from 'ai/test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TranscriptionModel } from 'ai';

import { resetEnvForTests } from '#src/env.js';
import { TIMELINE_MODELS } from '#src/llm/models.js';
import { transcribeAudio } from '#src/llm/transcribe.js';

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
    const fetch = vi.fn<typeof globalThis.fetch>((input, init) => {
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

  it('returns the transcribed text and the configured model id', async () => {
    const result = await transcribeAudio(
      { audio: Buffer.from('fake-audio-bytes') },
      { model: makeMockModel('hello world') },
    );
    expect(result).toEqual({ text: 'hello world', model: TIMELINE_MODELS.transcription.id });
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
});

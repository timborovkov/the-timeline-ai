import { MockTranscriptionModelV3 } from 'ai/test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resetEnvForTests } from '../env.js';

import { transcribeAudio } from './transcribe.js';

import type { TranscriptionModel } from 'ai';

// Tests for the transcribe wrapper. The wrapper delegates to the Vercel AI
// SDK via the OpenAI provider pointed at OpenRouter; tests inject a mock
// TranscriptionModel so no network call happens. AUTH_SECRET and DATABASE_URL
// are set so the shared env loader parses cleanly.

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
          modelId: 'openai/whisper-1',
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
    TRANSCRIPTION_MODEL: 'openai/whisper-1',
  };
  resetEnvForTests();
});

afterEach(() => {
  process.env = { ...ENV_BACKUP };
  resetEnvForTests();
});

describe('transcribeAudio', () => {
  it('returns the transcribed text and the configured model id', async () => {
    const result = await transcribeAudio(
      { audio: Buffer.from('fake-audio-bytes') },
      { model: makeMockModel('hello world') },
    );
    expect(result).toEqual({ text: 'hello world', model: 'openai/whisper-1' });
  });

  it('falls back to openai/whisper-1 when TRANSCRIPTION_MODEL is unset', async () => {
    delete process.env.TRANSCRIPTION_MODEL;
    resetEnvForTests();
    const result = await transcribeAudio(
      { audio: Buffer.from('x') },
      { model: makeMockModel('ok') },
    );
    expect(result.model).toBe('openai/whisper-1');
  });

  it('throws when OPENROUTER_API_KEY is missing AND no model is injected', async () => {
    delete process.env.OPENROUTER_API_KEY;
    resetEnvForTests();
    await expect(transcribeAudio({ audio: Buffer.from('x') })).rejects.toThrow(
      /OPENROUTER_API_KEY/,
    );
  });

  it('propagates SDK errors from the provider', async () => {
    const erroringModel = new MockTranscriptionModelV3({
      doGenerate: () => Promise.reject(new Error('upstream busted')),
    });
    await expect(
      transcribeAudio({ audio: Buffer.from('x') }, { model: erroringModel }),
    ).rejects.toThrow(/upstream busted/);
  });
});

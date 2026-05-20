import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resetEnvForTests } from '../env';

import { transcribeAudio } from './transcribe';

// Tests for the OpenRouter transcription client. Real network calls are
// replaced with an injected `fetch` stub. AUTH_SECRET is set so the shared
// env loader (used elsewhere in @timeline/shared) does not refuse to parse.

const ENV_BACKUP = { ...process.env };

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
  it('POSTs multipart form to the configured base URL', async () => {
    let capturedUrl = '';
    let capturedAuth: string | null = null;
    let capturedBodyKind = '';
    let capturedModel: string | null = null;
    let capturedHasFile = false;

    const stubFetch = (url: string, init?: RequestInit): Promise<Response> => {
      capturedUrl = url;
      const headers = new Headers(init?.headers);
      capturedAuth = headers.get('authorization');
      const body = init?.body;
      capturedBodyKind = body instanceof FormData ? 'formdata' : typeof body;
      if (body instanceof FormData) {
        const modelField = body.get('model');
        capturedModel = typeof modelField === 'string' ? modelField : null;
        capturedHasFile = body.get('file') instanceof Blob;
      }
      return Promise.resolve(
        new Response(JSON.stringify({ text: 'hello world' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    };

    const result = await transcribeAudio(
      {
        audio: Buffer.from('fake-audio-bytes'),
        filename: 'voice.ogg',
        mimeType: 'audio/ogg',
      },
      { fetch: stubFetch as unknown as typeof fetch },
    );

    expect(result).toEqual({ text: 'hello world', model: 'openai/whisper-1' });
    expect(capturedUrl).toBe('https://example.test/v1/audio/transcriptions');
    expect(capturedAuth).toBe('Bearer sk-test-key');
    expect(capturedBodyKind).toBe('formdata');
    expect(capturedModel).toBe('openai/whisper-1');
    expect(capturedHasFile).toBe(true);
  });

  it('throws when OPENROUTER_API_KEY is missing', async () => {
    delete process.env.OPENROUTER_API_KEY;
    resetEnvForTests();
    const stubFetch = (): Promise<Response> => Promise.reject(new Error('should not call'));
    await expect(
      transcribeAudio(
        { audio: Buffer.from('x'), filename: 'x', mimeType: 'audio/ogg' },
        { fetch: stubFetch as unknown as typeof fetch },
      ),
    ).rejects.toThrow(/OPENROUTER_API_KEY/);
  });

  it('throws on non-2xx response from OpenRouter', async () => {
    const stubFetch = (): Promise<Response> =>
      Promise.resolve(new Response('upstream busted', { status: 502 }));
    await expect(
      transcribeAudio(
        { audio: Buffer.from('x'), filename: 'x', mimeType: 'audio/ogg' },
        { fetch: stubFetch as unknown as typeof fetch },
      ),
    ).rejects.toThrow(/502/);
  });

  it('throws when response is missing `text`', async () => {
    const stubFetch = (): Promise<Response> =>
      Promise.resolve(
        new Response(JSON.stringify({}), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    await expect(
      transcribeAudio(
        { audio: Buffer.from('x'), filename: 'x', mimeType: 'audio/ogg' },
        { fetch: stubFetch as unknown as typeof fetch },
      ),
    ).rejects.toThrow(/missing `text`/);
  });
});

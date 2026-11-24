import { expect, vi } from '@timeline/test-support';
import * as ai from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import { afterEach, beforeEach, describe, it } from 'bun:test';

import { resetEnvForTests } from '#src/env.js';
const tracedStream = vi.fn();
await vi.mock(
  import.meta.resolve('langsmith/experimental/vercel'),
  async () => {
    const original = await import('langsmith/experimental/vercel');
    const wrap = original.wrapAISDK;
    return {
      ...original,
      wrapAISDK: (sdk: typeof ai) => ({ ...wrap(sdk), streamText: tracedStream }),
    };
  },
  () => import('langsmith/experimental/vercel'),
);

const {
  generateObject,
  generateText,
  sanitizeAiSdkInputs,
  sanitizeTranscribeInputs,
  streamText,
  withLangSmithProviderOptions,
} = await import('#src/llm/tracing.js');
const ENV_BACKUP = { ...process.env };

beforeEach(() => {
  process.env = {
    ...ENV_BACKUP,
    AUTH_SECRET: 'a'.repeat(32),
    DATABASE_URL: 'postgres://x:y@localhost:5432/x',
    NODE_ENV: 'test',
  };
  delete process.env.LANGSMITH_PROJECT;
  delete process.env.LANGSMITH_TRACING;
  tracedStream.mockReset();
  resetEnvForTests();
});

afterEach(() => {
  process.env = { ...ENV_BACKUP };
  resetEnvForTests();
});

describe('llm LangSmith tracing', () => {
  it('uses LangSmith-wrapped AI SDK text/object/stream functions', () => {
    expect(generateText).not.toBe(ai.generateText);
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    expect(generateObject).not.toBe(ai.generateObject);
    expect(streamText).not.toBe(ai.streamText);
  });

  it('keeps disabled streams cancellable without entering the tracing wrapper', async () => {
    const controller = new AbortController();
    const onAbort = vi.fn();
    const model = new MockLanguageModelV3({
      doStream: async () => ({
        stream: new ReadableStream({
          start(stream) {
            stream.enqueue({ type: 'text-start', id: 'text' });
            stream.enqueue({ type: 'text-delta', id: 'text', delta: 'Partial' });
            setTimeout(() => controller.abort(), 0);
          },
        }),
      }),
    });

    await streamText({
      model,
      prompt: 'Synthetic prompt',
      abortSignal: controller.signal,
      onAbort,
    }).consumeStream();

    expect(tracedStream).not.toHaveBeenCalled();
    expect(onAbort).toHaveBeenCalledTimes(1);
    expect(onAbort).toHaveBeenCalledWith(expect.objectContaining({ steps: [] }));
  });

  it('keeps enabled streams on the tracing wrapper with their original options', () => {
    process.env.LANGSMITH_TRACING = 'true';
    process.env.LANGSMITH_API_KEY = 'lsv2_test_key';
    resetEnvForTests();
    const params = {
      model: new MockLanguageModelV3(),
      prompt: 'Synthetic prompt',
      providerOptions: withLangSmithProviderOptions(undefined, {
        name: 'llm.test',
        model: 'synthetic-model',
      }),
    };
    const result = { synthetic: true };
    tracedStream.mockReturnValue(result);

    expect(streamText(params)).toBe(result);
    expect(tracedStream).toHaveBeenCalledTimes(1);
    expect(tracedStream).toHaveBeenCalledWith(params);
  });

  it('adds disabled LangSmith provider options by default and preserves existing options', () => {
    const providerOptions = withLangSmithProviderOptions(
      { openai: { language: 'en' } },
      {
        name: 'llm.test',
        model: 'openai/test-model',
        metadata: {
          operation: 'test_call',
          input_chars: 12,
        },
      },
    );

    expect(providerOptions.openai).toEqual({ language: 'en' });
    expect(providerOptions.langsmith).toMatchObject({
      name: 'llm.test',
      project_name: 'timeline-test',
      tracingEnabled: false,
      metadata: {
        ls_provider: 'openrouter',
        ls_model_name: 'openai/test-model',
        operation: 'test_call',
        input_chars: 12,
      },
    });
  });

  it('enables LangSmith provider options when configured', () => {
    process.env = {
      ...process.env,
      NODE_ENV: 'test',
      LANGSMITH_TRACING: 'true',
      LANGSMITH_API_KEY: 'lsv2_test_key',
      LANGSMITH_PROJECT: 'timeline-production',
    };
    resetEnvForTests();

    const providerOptions = withLangSmithProviderOptions(undefined, {
      name: 'llm.test',
      model: 'anthropic/test-model',
    });

    expect(providerOptions.langsmith).toMatchObject({
      name: 'llm.test',
      project_name: 'timeline-production',
      tracingEnabled: true,
      metadata: {
        ls_provider: 'openrouter',
        ls_model_name: 'anthropic/test-model',
      },
    });
  });

  it('redacts AI SDK file and image inputs while preserving text prompts', () => {
    const inputs = sanitizeAiSdkInputs({
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Transcribe this exactly.' },
            {
              type: 'file',
              data: Buffer.from('%PDF-1.4'),
              mediaType: 'application/pdf',
              filename: 'contract.pdf',
            },
            {
              type: 'file',
              data: Buffer.from([0xff, 0xd8, 0xff]),
              mediaType: 'image/jpeg',
            },
          ],
        },
      ],
    });

    const message = (inputs.messages as { content: Record<string, unknown>[] }[])[0];
    expect(message?.content[0]).toEqual({ type: 'text', text: 'Transcribe this exactly.' });
    expect(message?.content[1]).toEqual({
      type: 'file',
      mediaType: 'application/pdf',
      filename: 'contract.pdf',
      data: { redacted: true, kind: 'buffer', bytes: 8 },
    });
    expect(message?.content[2]).toEqual({
      type: 'file',
      mediaType: 'image/jpeg',
      data: { redacted: true, kind: 'buffer', bytes: 3 },
    });
    expect(JSON.stringify(inputs)).not.toContain('%PDF-1.4');
  });

  it('installs binary redaction hooks in LangSmith provider options', () => {
    const providerOptions = withLangSmithProviderOptions(undefined, {
      name: 'llm.extractTextFromMedia',
      model: 'openai/vision-test',
      processInputs: sanitizeAiSdkInputs,
      processChildLLMRunInputs: sanitizeAiSdkInputs,
    });
    const langsmith = providerOptions.langsmith as unknown as {
      processInputs: typeof sanitizeAiSdkInputs;
      processChildLLMRunInputs: typeof sanitizeAiSdkInputs;
    };

    const input = {
      messages: [
        {
          role: 'user',
          content: [{ type: 'file', data: Buffer.from('secret'), mediaType: 'application/pdf' }],
        },
      ],
    };

    expect(langsmith.processInputs(input)).toEqual(langsmith.processChildLLMRunInputs(input));
    expect(JSON.stringify(langsmith.processInputs(input))).not.toContain('secret');
  });

  it('redacts transcription audio inputs while preserving useful options', () => {
    const input = sanitizeTranscribeInputs({
      model: {} as never,
      audio: Buffer.from('raw-audio-bytes'),
      providerOptions: { openai: { language: 'en' } },
    });

    expect(input).toEqual({
      audio: { redacted: true, kind: 'buffer', bytes: 15 },
      providerOptions: { openai: { language: 'en' } },
      maxRetries: undefined,
    });
    expect(JSON.stringify(input)).not.toContain('raw-audio-bytes');
  });
});

import * as ai from 'ai';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resetEnvForTests } from '#src/env.js';
import {
  generateObject,
  generateText,
  sanitizeAiSdkInputs,
  sanitizeTranscribeInputs,
  streamText,
  withLangSmithProviderOptions,
} from '#src/llm/tracing.js';

const ENV_BACKUP = { ...process.env };

beforeEach(() => {
  process.env = {
    ...ENV_BACKUP,
    AUTH_SECRET: 'a'.repeat(32),
    DATABASE_URL: 'postgres://x:y@localhost:5432/x',
  };
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
              type: 'image',
              image: Buffer.from([0xff, 0xd8, 0xff]),
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
      type: 'image',
      mediaType: 'image/jpeg',
      image: { redacted: true, kind: 'buffer', bytes: 3 },
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

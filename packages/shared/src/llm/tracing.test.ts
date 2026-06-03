import * as ai from 'ai';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resetEnvForTests } from '#src/env.js';
import {
  generateObject,
  generateText,
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
      NODE_ENV: 'production',
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
});

import { afterEach, describe, expect, it } from 'vitest';

import { getEnv, resetEnvForTests } from '#src/env.js';

const ENV_BACKUP = { ...process.env };

function setBaseEnv(overrides: Record<string, string | undefined> = {}): void {
  process.env = {
    ...ENV_BACKUP,
    AUTH_SECRET: 'a'.repeat(32),
    DATABASE_URL: 'postgres://x:y@localhost:5432/x',
    ...overrides,
  };
  resetEnvForTests();
}

afterEach(() => {
  process.env = { ...ENV_BACKUP };
  resetEnvForTests();
});

describe('getEnv', () => {
  it('does not require model selection env vars', () => {
    setBaseEnv({
      EMBEDDING_MODEL: undefined,
      EMBEDDING_DIMENSIONS: undefined,
      TRANSCRIPTION_MODEL: undefined,
      CHAT_MODEL_DEFAULT: undefined,
      EXTRACTION_MODEL: undefined,
      AGENT_MODEL: undefined,
      VISION_MODEL: undefined,
    });

    expect(getEnv().OPENROUTER_API_KEY).toBeUndefined();
  });

  it('ignores legacy model env vars because model config is code-owned', () => {
    setBaseEnv({
      EMBEDDING_MODEL: 'openai/text-embedding-3-large',
      EMBEDDING_DIMENSIONS: '3072',
      AGENT_MODEL: 'anthropic/not-used',
    });

    expect('EMBEDDING_MODEL' in getEnv()).toBe(false);
    expect('AGENT_MODEL' in getEnv()).toBe(false);
  });

  it('accepts NEXTAUTH aliases for Auth.js deployment variables', () => {
    setBaseEnv({
      AUTH_SECRET: undefined,
      AUTH_URL: undefined,
      NEXTAUTH_SECRET: 'b'.repeat(32),
      NEXTAUTH_URL: 'https://timeline.example.com',
    });

    expect(getEnv().AUTH_SECRET).toBe('b'.repeat(32));
    expect(getEnv().AUTH_URL).toBe('https://timeline.example.com');
  });
});

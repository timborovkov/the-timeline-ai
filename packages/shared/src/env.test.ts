import { afterEach, describe, expect, it } from 'vitest';

import { getEnv, resetEnvForTests } from './env.js';

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
  it('allows the default embedding model without explicit dimensions', () => {
    setBaseEnv({ EMBEDDING_MODEL: undefined, EMBEDDING_DIMENSIONS: undefined });

    expect(getEnv().EMBEDDING_DIMENSIONS).toBeUndefined();
  });

  it('requires explicit dimensions for non-default embedding models', () => {
    setBaseEnv({
      EMBEDDING_MODEL: 'openai/text-embedding-3-large',
      EMBEDDING_DIMENSIONS: undefined,
    });

    expect(() => getEnv()).toThrow(/EMBEDDING_DIMENSIONS is required/);
  });

  it('accepts non-default embedding models when dimensions are explicit', () => {
    setBaseEnv({
      EMBEDDING_MODEL: 'openai/text-embedding-3-large',
      EMBEDDING_DIMENSIONS: '3072',
    });

    expect(getEnv().EMBEDDING_DIMENSIONS).toBe(3072);
  });
});

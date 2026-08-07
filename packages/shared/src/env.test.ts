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

  it('keeps the legacy invite sender env var available for transactional email fallback', () => {
    setBaseEnv({
      INVITE_EMAIL_FROM: 'Timeline <invites@example.test>',
      TRANSACTIONAL_EMAIL_FROM: undefined,
    });

    expect(getEnv().INVITE_EMAIL_FROM).toBe('Timeline <invites@example.test>');
    expect(getEnv().TRANSACTIONAL_EMAIL_FROM).toBeUndefined();
  });

  it('defaults LangSmith tracing off with an environment-specific project', () => {
    setBaseEnv({ NODE_ENV: 'test' });

    expect(getEnv()).toMatchObject({
      LANGSMITH_TRACING: false,
      LANGSMITH_PROJECT: 'timeline-test',
      LANGSMITH_ENDPOINT: 'https://api.smith.langchain.com',
    });
  });

  it('keeps task category rollout controls disabled until explicitly enabled', () => {
    setBaseEnv({
      TASK_CATEGORY_CLASSIFICATION_ENABLED: undefined,
      TASK_CATEGORY_AUTO_ENQUEUE_ENABLED: undefined,
      TASK_CATEGORY_WORKER_ENABLED: undefined,
      TASK_CATEGORY_BACKFILL_ENABLED: undefined,
      TASK_CATEGORY_UI_ENABLED: undefined,
    });

    expect(getEnv()).toMatchObject({
      TASK_CATEGORY_CLASSIFICATION_ENABLED: false,
      TASK_CATEGORY_AUTO_ENQUEUE_ENABLED: false,
      TASK_CATEGORY_WORKER_ENABLED: false,
      TASK_CATEGORY_BACKFILL_ENABLED: false,
      TASK_CATEGORY_UI_ENABLED: false,
    });
  });

  it('keeps cross-source evidence disabled until an operator selects a rollout mode', () => {
    setBaseEnv({ CROSS_SOURCE_EVIDENCE_MODE: undefined });
    expect(getEnv().CROSS_SOURCE_EVIDENCE_MODE).toBe('off');

    setBaseEnv({ CROSS_SOURCE_EVIDENCE_MODE: 'shadow' });
    expect(getEnv().CROSS_SOURCE_EVIDENCE_MODE).toBe('shadow');

    setBaseEnv({ CROSS_SOURCE_EVIDENCE_MODE: 'enforced' });
    expect(getEnv().CROSS_SOURCE_EVIDENCE_MODE).toBe('enforced');
  });

  it('rejects unknown cross-source evidence rollout modes', () => {
    setBaseEnv({ CROSS_SOURCE_EVIDENCE_MODE: 'enabled' });
    expect(() => getEnv()).toThrow(/CROSS_SOURCE_EVIDENCE_MODE/);
  });

  it('requires a LangSmith API key when tracing is enabled', () => {
    setBaseEnv({
      LANGSMITH_TRACING: 'true',
      LANGSMITH_API_KEY: undefined,
    });

    expect(() => getEnv()).toThrow(/LANGSMITH_API_KEY/);
  });

  it('accepts LangSmith production config', () => {
    setBaseEnv({
      NODE_ENV: 'production',
      LANGSMITH_TRACING: 'true',
      LANGSMITH_TRACING_SAMPLING_RATE: '0.05',
      LANGSMITH_API_KEY: 'lsv2_test_key',
      LANGSMITH_PROJECT: 'timeline-production',
      LANGSMITH_ENDPOINT: 'https://eu.api.smith.langchain.com',
      LANGSMITH_WORKSPACE_ID: 'workspace-id',
    });

    expect(getEnv()).toMatchObject({
      LANGSMITH_TRACING: true,
      LANGSMITH_TRACING_SAMPLING_RATE: 0.05,
      LANGSMITH_API_KEY: 'lsv2_test_key',
      LANGSMITH_PROJECT: 'timeline-production',
      LANGSMITH_ENDPOINT: 'https://eu.api.smith.langchain.com',
      LANGSMITH_WORKSPACE_ID: 'workspace-id',
    });
  });

  it('treats a blank LangSmith endpoint as unset', () => {
    setBaseEnv({
      LANGSMITH_ENDPOINT: '',
    });

    expect(getEnv().LANGSMITH_ENDPOINT).toBe('https://api.smith.langchain.com');
  });

  it('treats a blank LangSmith project as unset', () => {
    setBaseEnv({
      NODE_ENV: 'production',
      LANGSMITH_PROJECT: '',
    });

    expect(getEnv().LANGSMITH_PROJECT).toBe('timeline-production');
  });

  it('rejects invalid LangSmith endpoint URLs', () => {
    setBaseEnv({
      LANGSMITH_ENDPOINT: 'not a url',
    });

    expect(() => getEnv()).toThrow(/LANGSMITH_ENDPOINT/);
  });

  it('rejects invalid LangSmith sampling rates', () => {
    setBaseEnv({
      LANGSMITH_TRACING_SAMPLING_RATE: '2',
    });

    expect(() => getEnv()).toThrow(/LANGSMITH_TRACING_SAMPLING_RATE/);
  });
});

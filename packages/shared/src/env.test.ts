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
      DOCUMENT_EXTRACT_ENABLED: 'false',
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
      DOCUMENT_EXTRACT_ENABLED: 'false',
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

  it('accepts 1/0 for boolean env flags including DOCUMENT_EXTRACT_ALLOW_INPROCESS', () => {
    setBaseEnv({
      DOCUMENT_EXTRACT_ALLOW_INPROCESS: '1',
      DOCUMENT_EXTRACT_ENABLED: '0',
      LANGSMITH_TRACING: 'false',
    });

    expect(getEnv()).toMatchObject({
      DOCUMENT_EXTRACT_ALLOW_INPROCESS: true,
      DOCUMENT_EXTRACT_ENABLED: false,
    });
  });

  it('allows omitting AUTH_SECRET in document-extract worker mode', () => {
    setBaseEnv({
      AUTH_SECRET: undefined,
      NEXTAUTH_SECRET: undefined,
      WORKER_MODE: 'document-extract',
      DAYTONA_API_KEY: 'dtn_test',
      OPENROUTER_API_KEY: 'sk-or-test',
      REDIS_URL: 'redis://localhost:6379',
    });

    expect(getEnv()).toMatchObject({
      WORKER_MODE: 'document-extract',
      AUTH_SECRET: undefined,
      DAYTONA_SNAPSHOT: 'timeline-document-extract',
      DOCUMENT_EXTRACT_SPARSE_TEXT_CHARS: 500,
      DOCUMENT_EXTRACT_MAX_VISION_PAGES: 20,
    });
  });

  it('still requires AUTH_SECRET for full worker mode', () => {
    setBaseEnv({
      AUTH_SECRET: undefined,
      NEXTAUTH_SECRET: undefined,
      WORKER_MODE: 'full',
    });

    expect(() => getEnv()).toThrow(/AUTH_SECRET/);
  });

  it('requires Daytona + OpenRouter in production document-extract mode', () => {
    setBaseEnv({
      AUTH_SECRET: undefined,
      NODE_ENV: 'production',
      WORKER_MODE: 'document-extract',
      DAYTONA_API_KEY: undefined,
      OPENROUTER_API_KEY: undefined,
      REDIS_URL: 'redis://localhost:6379',
      S3_ENDPOINT: 'http://localhost:9000',
      S3_REGION: 'us-east-1',
      S3_BUCKET_DOCUMENTS: 'timeline-documents',
      S3_ACCESS_KEY_ID: 'key',
      S3_SECRET_ACCESS_KEY: 'secret',
    });

    expect(() => getEnv()).toThrow(/DAYTONA_API_KEY/);
  });

  it('requires full S3 client settings in production document-extract mode', () => {
    setBaseEnv({
      AUTH_SECRET: undefined,
      NODE_ENV: 'production',
      WORKER_MODE: 'document-extract',
      DAYTONA_API_KEY: 'dtn_test',
      OPENROUTER_API_KEY: 'sk-or-test',
      REDIS_URL: 'redis://localhost:6379',
      S3_ENDPOINT: undefined,
      S3_REGION: undefined,
      S3_BUCKET_DOCUMENTS: undefined,
      S3_ACCESS_KEY_ID: undefined,
      S3_SECRET_ACCESS_KEY: undefined,
    });

    expect(() => getEnv()).toThrow(/S3_ENDPOINT/);
  });

  it('rejects credential-thick secrets on production document-extract mode', () => {
    const extractBase = {
      AUTH_SECRET: undefined,
      NODE_ENV: 'production',
      WORKER_MODE: 'document-extract',
      DAYTONA_API_KEY: 'dtn_test',
      OPENROUTER_API_KEY: 'sk-or-test',
      REDIS_URL: 'redis://localhost:6379',
      S3_ENDPOINT: 'http://localhost:9000',
      S3_REGION: 'us-east-1',
      S3_BUCKET_DOCUMENTS: 'timeline-documents',
      S3_ACCESS_KEY_ID: 'key',
      S3_SECRET_ACCESS_KEY: 'secret',
    } as const;

    setBaseEnv({ ...extractBase, SECRETS_ENCRYPTION_KEY: 'not-for-extract' });
    expect(() => getEnv()).toThrow(/SECRETS_ENCRYPTION_KEY must not be set/);

    setBaseEnv({ ...extractBase, CRON_SECRET: 'cron', SECRETS_ENCRYPTION_KEY: undefined });
    expect(() => getEnv()).toThrow(/CRON_SECRET must not be set/);

    setBaseEnv({
      ...extractBase,
      AUTH_GITHUB_SECRET: 'gh-secret',
      POSTMARK_SERVER_TOKEN: 'pm-token',
      CRON_SECRET: undefined,
    });
    expect(() => getEnv()).toThrow(/AUTH_GITHUB_SECRET must not be set/);
  });

  it('rejects DOCUMENT_EXTRACT_ALLOW_INPROCESS in production', () => {
    setBaseEnv({
      NODE_ENV: 'production',
      DOCUMENT_EXTRACT_ENABLED: 'false',
      DOCUMENT_EXTRACT_ALLOW_INPROCESS: 'true',
    });

    expect(() => getEnv()).toThrow(/DOCUMENT_EXTRACT_ALLOW_INPROCESS must be false/);
  });

  it('rejects DOCUMENT_EXTRACT_ENABLED on production full workers', () => {
    setBaseEnv({
      NODE_ENV: 'production',
      WORKER_MODE: 'full',
      DOCUMENT_EXTRACT_ENABLED: 'true',
    });

    expect(() => getEnv()).toThrow(/DOCUMENT_EXTRACT_ENABLED must be false on production full/);
  });

  it('accepts a minimal production document-extract env', () => {
    setBaseEnv({
      AUTH_SECRET: undefined,
      NEXTAUTH_SECRET: undefined,
      NODE_ENV: 'production',
      WORKER_MODE: 'document-extract',
      DAYTONA_API_KEY: 'dtn_test',
      OPENROUTER_API_KEY: 'sk-or-test',
      REDIS_URL: 'redis://localhost:6379',
      S3_ENDPOINT: 'http://localhost:9000',
      S3_REGION: 'us-east-1',
      S3_BUCKET_DOCUMENTS: 'timeline-documents',
      S3_ACCESS_KEY_ID: 'key',
      S3_SECRET_ACCESS_KEY: 'secret',
      SECRETS_ENCRYPTION_KEY: undefined,
      TELEGRAM_BOT_TOKEN: undefined,
      CRON_SECRET: undefined,
      AUTH_GITHUB_SECRET: undefined,
      POSTMARK_SERVER_TOKEN: undefined,
    });

    expect(getEnv()).toMatchObject({
      WORKER_MODE: 'document-extract',
      DOCUMENT_EXTRACT_ALLOW_INPROCESS: false,
      DAYTONA_SNAPSHOT: 'timeline-document-extract',
      S3_ENDPOINT: 'http://localhost:9000',
      S3_REGION: 'us-east-1',
    });
  });
});

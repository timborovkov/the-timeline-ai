import { afterEach, describe, expect, it } from 'vitest';

import { getEnv, isAllowedDocumentExtractProcessEnvKey, resetEnvForTests } from '#src/env.js';

const ENV_BACKUP = { ...process.env };

function setBaseEnv(overrides: Record<string, string | undefined> = {}): void {
  const next: Record<string, string | undefined> = {
    ...ENV_BACKUP,
    AUTH_SECRET: 'a'.repeat(32),
    DATABASE_URL: 'postgres://x:y@localhost:5432/x',
    ...overrides,
  };
  // Explicit undefined overrides must omit keys (spread keeps ENV_BACKUP values).
  const cleaned: Record<string, string> = {};
  for (const [key, value] of Object.entries(next)) {
    if (value !== undefined) cleaned[key] = value;
  }
  process.env = cleaned;
  resetEnvForTests();
}

/** Clean env for production extract allowlist tests (no copied .env secrets). */
function setExtractProductionEnv(overrides: Record<string, string | undefined> = {}): void {
  const base: Record<string, string | undefined> = {
    PATH: process.env.PATH ?? '/usr/bin',
    HOME: process.env.HOME ?? '/tmp',
    NODE_ENV: 'production',
    WORKER_MODE: 'document-extract',
    DATABASE_URL: 'postgres://x:y@localhost:5432/x',
    REDIS_URL: 'redis://localhost:6379',
    DAYTONA_API_KEY: 'dtn_test',
    OPENROUTER_API_KEY: 'sk-or-test',
    S3_ENDPOINT: 'http://localhost:9000',
    S3_REGION: 'us-east-1',
    S3_ACCESS_KEY_ID: 'key',
    S3_SECRET_ACCESS_KEY: 'secret',
    S3_BUCKET_DOCUMENTS: 'timeline-documents',
    ...overrides,
  };
  const cleaned: Record<string, string> = {};
  for (const [key, value] of Object.entries(base)) {
    if (value !== undefined) cleaned[key] = value;
  }
  process.env = cleaned;
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

  it('treats an empty optional Recall transcript webhook URL as unset', () => {
    setBaseEnv({ RECALL_TRANSCRIPT_WEBHOOK_URL: '' });

    expect(getEnv().RECALL_TRANSCRIPT_WEBHOOK_URL).toBeUndefined();
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
      DAYTONA_SNAPSHOT: undefined,
    });

    const env = getEnv();
    expect(env).toMatchObject({
      WORKER_MODE: 'document-extract',
      AUTH_SECRET: undefined,
      DAYTONA_SNAPSHOT_ENSURE: true,
      DOCUMENT_EXTRACT_SPARSE_TEXT_CHARS: 500,
      DOCUMENT_EXTRACT_MAX_VISION_PAGES: 20,
    });
    expect(env.DAYTONA_SNAPSHOT).toBeUndefined();
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
    setExtractProductionEnv({
      DAYTONA_API_KEY: undefined,
      OPENROUTER_API_KEY: undefined,
    });

    expect(() => getEnv()).toThrow(/DAYTONA_API_KEY/);
  });

  it('requires full S3 client settings in production document-extract mode', () => {
    setExtractProductionEnv({
      S3_ENDPOINT: undefined,
      S3_REGION: undefined,
      S3_BUCKET_DOCUMENTS: undefined,
      S3_ACCESS_KEY_ID: undefined,
      S3_SECRET_ACCESS_KEY: undefined,
    });

    expect(() => getEnv()).toThrow(/S3_ENDPOINT/);
  });

  it('rejects credential-thick secrets on production document-extract mode via process.env allowlist', () => {
    setExtractProductionEnv({ SECRETS_ENCRYPTION_KEY: 'not-for-extract' });
    expect(() => getEnv()).toThrow(/SECRETS_ENCRYPTION_KEY must not be set/);

    setExtractProductionEnv({ CRON_SECRET: 'cron' });
    expect(() => getEnv()).toThrow(/CRON_SECRET must not be set/);

    setExtractProductionEnv({ LANGSMITH_API_KEY: 'lsv2_secret' });
    expect(() => getEnv()).toThrow(/LANGSMITH_API_KEY must not be set/);

    // Unparsed / undocumented secrets still reject (not in Zod schema).
    setExtractProductionEnv({ SLACK_CANARY_BOT_TOKEN: 'xoxb-canary' });
    expect(() => getEnv()).toThrow(/SLACK_CANARY_BOT_TOKEN must not be set/);

    setExtractProductionEnv({ MCP_PREREGISTERED_ACME_CLIENT_SECRET: 'mcp-secret' });
    expect(() => getEnv()).toThrow(/MCP_PREREGISTERED_ACME_CLIENT_SECRET must not be set/);
  });

  it('rejects DOCUMENT_EXTRACT_ALLOW_INPROCESS in production', () => {
    setBaseEnv({
      NODE_ENV: 'production',
      DOCUMENT_EXTRACT_ALLOW_INPROCESS: 'true',
    });

    expect(() => getEnv()).toThrow(/DOCUMENT_EXTRACT_ALLOW_INPROCESS must be false/);
  });

  it('does not reject DOCUMENT_EXTRACT_ENABLED for production web (full-mode defaults)', () => {
    // Web calls getEnv() with WORKER_MODE defaulting to full. The full-worker
    // extract gate lives in apps/worker, not shared env parsing.
    setBaseEnv({
      NODE_ENV: 'production',
      WORKER_MODE: undefined,
      DOCUMENT_EXTRACT_ENABLED: undefined,
    });

    expect(getEnv()).toMatchObject({
      WORKER_MODE: 'full',
      DOCUMENT_EXTRACT_ENABLED: true,
    });
  });

  it('accepts a minimal production document-extract env', () => {
    setExtractProductionEnv({ DAYTONA_SNAPSHOT: undefined });

    const env = getEnv();
    expect(env).toMatchObject({
      WORKER_MODE: 'document-extract',
      DOCUMENT_EXTRACT_ALLOW_INPROCESS: false,
      DAYTONA_SNAPSHOT_ENSURE: true,
      S3_ENDPOINT: 'http://localhost:9000',
      S3_REGION: 'us-east-1',
    });
    expect(env.DAYTONA_SNAPSHOT).toBeUndefined();
  });

  it('accepts non-secret runtime variables injected by Railway Railpack', () => {
    setExtractProductionEnv({
      CI: 'true',
      MISE_DATA_DIR: '/mise/data',
      MISE_SHIMS_DIR: '/mise/shims',
      MISE_CACHE_DIR: '/mise/cache',
      MISE_CONFIG_DIR: '/mise/config',
      MISE_INSTALLS_DIR: '/mise/installs',
      RAILPACK_VERSION: '0.35.0',
      __MISE_SHIM: 'node',
      __MISE_DIFF: 'mise-diff',
    });

    expect(getEnv().WORKER_MODE).toBe('document-extract');
  });

  it('accepts an explicit DAYTONA_SNAPSHOT pin and disabling boot ensure', () => {
    setExtractProductionEnv({
      DAYTONA_SNAPSHOT: 'timeline-document-extract-deadbeefcafe',
      DAYTONA_SNAPSHOT_ENSURE: '0',
    });

    expect(getEnv()).toMatchObject({
      DAYTONA_SNAPSHOT: 'timeline-document-extract-deadbeefcafe',
      DAYTONA_SNAPSHOT_ENSURE: false,
    });
  });
});

describe('isAllowedDocumentExtractProcessEnvKey', () => {
  it('allows extract credentials and platform noise', () => {
    expect(isAllowedDocumentExtractProcessEnvKey('DAYTONA_API_KEY')).toBe(true);
    expect(isAllowedDocumentExtractProcessEnvKey('DAYTONA_SNAPSHOT_ENSURE')).toBe(true);
    expect(isAllowedDocumentExtractProcessEnvKey('S3_SECRET_ACCESS_KEY')).toBe(true);
    expect(isAllowedDocumentExtractProcessEnvKey('RAILWAY_ENVIRONMENT')).toBe(true);
    expect(isAllowedDocumentExtractProcessEnvKey('RAILPACK_VERSION')).toBe(true);
    expect(isAllowedDocumentExtractProcessEnvKey('MISE_DATA_DIR')).toBe(true);
    expect(isAllowedDocumentExtractProcessEnvKey('__MISE_SHIM')).toBe(true);
    expect(isAllowedDocumentExtractProcessEnvKey('CI')).toBe(true);
    expect(isAllowedDocumentExtractProcessEnvKey('PATH')).toBe(true);
  });

  it('rejects non-extract secrets including unparsed canary/MCP keys', () => {
    expect(isAllowedDocumentExtractProcessEnvKey('LANGSMITH_API_KEY')).toBe(false);
    expect(isAllowedDocumentExtractProcessEnvKey('SLACK_CANARY_BOT_TOKEN')).toBe(false);
    expect(isAllowedDocumentExtractProcessEnvKey('MCP_PREREGISTERED_X_CLIENT_SECRET')).toBe(false);
    expect(isAllowedDocumentExtractProcessEnvKey('AUTH_SECRET')).toBe(false);
  });
});

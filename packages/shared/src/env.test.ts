import { afterEach, describe, expect, it } from 'vitest';

import { getEnv, isAllowedDocumentExtractProcessEnvKey, resetEnvForTests } from '#src/env.js';
import { buildOpenRouterPrivacyAttestationToken } from '#src/llm/privacy-attestation.js';

const ENV_BACKUP = { ...process.env };
const TEST_OPENROUTER_API_KEY = 'sk-or-test';
const TEST_OPENROUTER_GUARDRAIL_ID = 'guardrail-test-production';

function testOpenRouterAttestation(
  apiKey = TEST_OPENROUTER_API_KEY,
  guardrailId = TEST_OPENROUTER_GUARDRAIL_ID,
): string {
  return buildOpenRouterPrivacyAttestationToken({ apiKey, guardrailId });
}

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
    OPENROUTER_API_KEY: TEST_OPENROUTER_API_KEY,
    OPENROUTER_GUARDRAIL_ID: TEST_OPENROUTER_GUARDRAIL_ID,
    OPENROUTER_PRIVACY_POLICY_ATTESTATION: testOpenRouterAttestation(),
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

    const env = getEnv();
    expect(env.OPENROUTER_API_KEY).toBeUndefined();
    expect(env.OPENROUTER_GUARDRAIL_ID).toBeUndefined();
    expect(env.OPENROUTER_PRIVACY_POLICY_ATTESTATION).toBeUndefined();
    expect(env.TIMELINE_DEPLOYMENT_MODE).toBe('hosted');
  });

  it('requires a guardrail id and generated model/privacy attestation in production', () => {
    setBaseEnv({
      NODE_ENV: 'production',
      OPENROUTER_API_KEY: TEST_OPENROUTER_API_KEY,
      OPENROUTER_GUARDRAIL_ID: undefined,
      OPENROUTER_PRIVACY_POLICY_ATTESTATION: undefined,
    });
    expect(() => getEnv()).toThrow(/OPENROUTER_GUARDRAIL_ID/);

    setBaseEnv({
      NODE_ENV: 'production',
      OPENROUTER_API_KEY: TEST_OPENROUTER_API_KEY,
      OPENROUTER_GUARDRAIL_ID: TEST_OPENROUTER_GUARDRAIL_ID,
      OPENROUTER_PRIVACY_POLICY_ATTESTATION: undefined,
    });
    expect(() => getEnv()).toThrow(/OPENROUTER_PRIVACY_POLICY_ATTESTATION/);

    setBaseEnv({
      NODE_ENV: 'production',
      OPENROUTER_API_KEY: TEST_OPENROUTER_API_KEY,
      OPENROUTER_GUARDRAIL_ID: TEST_OPENROUTER_GUARDRAIL_ID,
      OPENROUTER_PRIVACY_POLICY_ATTESTATION: '2026-08-21.1',
    });
    expect(() => getEnv()).toThrow(/must be regenerated/u);

    const attestation = testOpenRouterAttestation();
    setBaseEnv({
      NODE_ENV: 'production',
      OPENROUTER_API_KEY: TEST_OPENROUTER_API_KEY,
      OPENROUTER_GUARDRAIL_ID: TEST_OPENROUTER_GUARDRAIL_ID,
      OPENROUTER_PRIVACY_POLICY_ATTESTATION: attestation,
    });
    expect(getEnv().OPENROUTER_PRIVACY_POLICY_ATTESTATION).toBe(attestation);
  });

  it('invalidates the production attestation on key rotation or guardrail change', () => {
    const staleAttestation = testOpenRouterAttestation();
    setBaseEnv({
      NODE_ENV: 'production',
      OPENROUTER_API_KEY: `${TEST_OPENROUTER_API_KEY}-rotated`,
      OPENROUTER_GUARDRAIL_ID: TEST_OPENROUTER_GUARDRAIL_ID,
      OPENROUTER_PRIVACY_POLICY_ATTESTATION: staleAttestation,
    });
    expect(() => getEnv()).toThrow(/must be regenerated/u);

    setBaseEnv({
      NODE_ENV: 'production',
      OPENROUTER_API_KEY: TEST_OPENROUTER_API_KEY,
      OPENROUTER_GUARDRAIL_ID: `${TEST_OPENROUTER_GUARDRAIL_ID}-replacement`,
      OPENROUTER_PRIVACY_POLICY_ATTESTATION: staleAttestation,
    });
    expect(() => getEnv()).toThrow(/must be regenerated/u);
  });

  it('allows only the official OpenRouter API boundary in production', () => {
    setBaseEnv({
      NODE_ENV: 'production',
      OPENROUTER_API_KEY: TEST_OPENROUTER_API_KEY,
      OPENROUTER_GUARDRAIL_ID: TEST_OPENROUTER_GUARDRAIL_ID,
      OPENROUTER_PRIVACY_POLICY_ATTESTATION: testOpenRouterAttestation(),
      OPENROUTER_BASE_URL: 'https://proxy.example.test/api/v1',
    });
    expect(() => getEnv()).toThrow(/OPENROUTER_BASE_URL/);

    setBaseEnv({
      NODE_ENV: 'production',
      OPENROUTER_API_KEY: TEST_OPENROUTER_API_KEY,
      OPENROUTER_GUARDRAIL_ID: TEST_OPENROUTER_GUARDRAIL_ID,
      OPENROUTER_PRIVACY_POLICY_ATTESTATION: testOpenRouterAttestation(),
      OPENROUTER_BASE_URL: 'https://openrouter.ai/api/v1/',
    });
    expect(getEnv().OPENROUTER_BASE_URL).toBe('https://openrouter.ai/api/v1/');
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

  it('accepts canonical Recall webhook secrets and rejects malformed values', () => {
    const workspaceSecret = `whsec_${Buffer.alloc(24, 0x61).toString('base64')}`;
    const legacyStatusSecret = `whsec_${Buffer.alloc(24, 0x62).toString('base64')}`;
    setBaseEnv({
      RECALL_WORKSPACE_VERIFICATION_SECRET: workspaceSecret,
      RECALL_STATUS_WEBHOOK_SECRET: legacyStatusSecret,
    });
    expect(getEnv()).toMatchObject({
      RECALL_WORKSPACE_VERIFICATION_SECRET: workspaceSecret,
      RECALL_STATUS_WEBHOOK_SECRET: legacyStatusSecret,
    });

    for (const invalid of [
      'plain-text',
      'whsec_',
      'whsec_not/base64!',
      'whsec_YQ=',
      'whsec_YQ==',
      `whsec_${Buffer.alloc(23, 0x61).toString('base64')}`,
    ]) {
      setBaseEnv({ RECALL_WORKSPACE_VERIFICATION_SECRET: invalid });
      expect(() => getEnv()).toThrow(/RECALL_WORKSPACE_VERIFICATION_SECRET/);
    }
  });

  it('requires the Recall workspace verification secret with the production API key', () => {
    setBaseEnv({
      NODE_ENV: 'production',
      AUTH_URL: 'https://timeline.example.test',
      RECALL_API_KEY: 'recall-test',
      RECALL_WORKSPACE_VERIFICATION_SECRET: undefined,
      RECALL_STATUS_WEBHOOK_SECRET: `whsec_${Buffer.alloc(24, 0x61).toString('base64')}`,
    });
    expect(() => getEnv()).toThrow(/RECALL_WORKSPACE_VERIFICATION_SECRET is required/);

    const secret = `whsec_${Buffer.alloc(24, 0x61).toString('base64')}`;
    setBaseEnv({
      NODE_ENV: 'production',
      AUTH_URL: 'https://timeline.example.test',
      RECALL_API_KEY: 'recall-test',
      RECALL_WORKSPACE_VERIFICATION_SECRET: secret,
    });
    expect(getEnv().RECALL_WORKSPACE_VERIFICATION_SECRET).toBe(secret);
  });

  it('keeps server analytics credentials separate and validates the pseudonymization key', () => {
    setBaseEnv({
      POSTHOG_PROJECT_KEY: 'ph-server',
      POSTHOG_HOST: 'https://eu.i.posthog.com',
      ANALYTICS_PSEUDONYMIZATION_KEY: 'a'.repeat(32),
      NEXT_PUBLIC_POSTHOG_KEY: 'ph-browser',
    });
    expect(getEnv()).toMatchObject({
      POSTHOG_PROJECT_KEY: 'ph-server',
      POSTHOG_HOST: 'https://eu.i.posthog.com',
      ANALYTICS_PSEUDONYMIZATION_KEY: 'a'.repeat(32),
      NEXT_PUBLIC_POSTHOG_KEY: 'ph-browser',
    });

    setBaseEnv({ ANALYTICS_PSEUDONYMIZATION_KEY: 'too-short' });
    expect(() => getEnv()).toThrow(/ANALYTICS_PSEUDONYMIZATION_KEY/);

    setBaseEnv({
      POSTHOG_PROJECT_KEY: '',
      POSTHOG_HOST: '',
      ANALYTICS_PSEUDONYMIZATION_KEY: '',
    });
    expect(getEnv()).toMatchObject({ POSTHOG_HOST: 'https://eu.i.posthog.com' });
    expect(getEnv().POSTHOG_PROJECT_KEY).toBeUndefined();
    expect(getEnv().ANALYTICS_PSEUDONYMIZATION_KEY).toBeUndefined();

    setBaseEnv({ POSTHOG_HOST: 'https://us.i.posthog.com' });
    expect(() => getEnv()).toThrow(/reviewed EU PostHog ingestion origin/);
  });

  it('limits configured Recall media retention to one hour in Timeline-hosted production', () => {
    const secret = `whsec_${Buffer.alloc(24, 0x61).toString('base64')}`;
    setBaseEnv({
      NODE_ENV: 'production',
      AUTH_URL: 'https://timeline.example.test',
      TIMELINE_DEPLOYMENT_MODE: 'hosted',
      RECALL_API_KEY: 'recall-test',
      RECALL_WORKSPACE_VERIFICATION_SECRET: secret,
      RECALL_RETENTION: '24',
    });
    expect(() => getEnv()).toThrow(/RECALL_RETENTION must be unset or 1/);

    setBaseEnv({
      NODE_ENV: 'production',
      AUTH_URL: 'https://timeline.example.test',
      TIMELINE_DEPLOYMENT_MODE: 'hosted',
      RECALL_API_KEY: 'recall-test',
      RECALL_WORKSPACE_VERIFICATION_SECRET: secret,
      RECALL_RETENTION: '1',
    });
    expect(getEnv().RECALL_RETENTION).toBe('1');
  });

  it('allows only official Recall API regions and the app transcript ingress in hosted production', () => {
    const secret = `whsec_${Buffer.alloc(24, 0x61).toString('base64')}`;
    const base = {
      NODE_ENV: 'production',
      TIMELINE_DEPLOYMENT_MODE: 'hosted',
      AUTH_URL: 'https://timeline.example.test',
      RECALL_API_KEY: 'recall-test',
      RECALL_WORKSPACE_VERIFICATION_SECRET: secret,
    };

    for (const recallBaseUrl of [
      'http://us-west-2.recall.ai/api/v1',
      'https://proxy.example.test/api/v1',
      'https://us-west-2.recall.ai/not-api',
    ]) {
      setBaseEnv({ ...base, RECALL_BASE_URL: recallBaseUrl });
      expect(() => getEnv()).toThrow(/official Recall regional/u);
    }

    setBaseEnv({
      ...base,
      RECALL_BASE_URL: 'https://eu-central-1.recall.ai/api/v1/',
    });
    expect(getEnv().RECALL_BASE_URL).toBe('https://eu-central-1.recall.ai/api/v1/');

    for (const transcriptUrl of [
      'http://timeline.example.test/api/webhooks/recall/transcript',
      'https://ingress.example.test/api/webhooks/recall/transcript',
      'https://timeline.example.test/api/webhooks/recall/transcript?token=secret',
      'https://timeline.example.test/api/webhooks/recall/status',
    ]) {
      setBaseEnv({ ...base, RECALL_TRANSCRIPT_WEBHOOK_URL: transcriptUrl });
      expect(() => getEnv()).toThrow(/AUTH_URL HTTPS origin/u);
    }

    setBaseEnv({
      ...base,
      RECALL_TRANSCRIPT_WEBHOOK_URL: 'https://timeline.example.test/api/webhooks/recall/transcript',
    });
    expect(getEnv().RECALL_TRANSCRIPT_WEBHOOK_URL).toBe(
      'https://timeline.example.test/api/webhooks/recall/transcript',
    );
  });

  it('permits deliberate Recall retention in self-managed production', () => {
    const secret = `whsec_${Buffer.alloc(24, 0x61).toString('base64')}`;
    setBaseEnv({
      NODE_ENV: 'production',
      TIMELINE_DEPLOYMENT_MODE: 'self-managed',
      AUTH_URL: 'http://self-managed.internal',
      RECALL_API_KEY: 'recall-test',
      RECALL_WORKSPACE_VERIFICATION_SECRET: secret,
      RECALL_BASE_URL: 'http://recall-proxy.internal/api/v1',
      RECALL_TRANSCRIPT_WEBHOOK_URL:
        'http://webhook-ingress.internal/api/webhooks/recall/transcript',
      RECALL_RETENTION: '24',
    });

    expect(getEnv()).toMatchObject({
      TIMELINE_DEPLOYMENT_MODE: 'self-managed',
      RECALL_RETENTION: '24',
    });
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

  it('rejects LangSmith tracing in production', () => {
    setBaseEnv({
      NODE_ENV: 'production',
      LANGSMITH_TRACING: 'true',
      LANGSMITH_TRACING_SAMPLING_RATE: '0.05',
      LANGSMITH_API_KEY: 'lsv2_test_key',
      LANGSMITH_PROJECT: 'timeline-production',
      LANGSMITH_ENDPOINT: 'https://eu.api.smith.langchain.com',
      LANGSMITH_WORKSPACE_ID: 'workspace-id',
    });

    expect(() => getEnv()).toThrow(/LANGSMITH_TRACING must be false in production/);
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
      RAILPACK_VERSION: '0.36.1',
      RAILPACK_BUILT_AT: '1786542631',
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
    expect(isAllowedDocumentExtractProcessEnvKey('OPENROUTER_GUARDRAIL_ID')).toBe(true);
    expect(isAllowedDocumentExtractProcessEnvKey('OPENROUTER_PRIVACY_POLICY_ATTESTATION')).toBe(
      true,
    );
    expect(isAllowedDocumentExtractProcessEnvKey('TIMELINE_DEPLOYMENT_MODE')).toBe(true);
    expect(isAllowedDocumentExtractProcessEnvKey('RAILWAY_ENVIRONMENT')).toBe(true);
    expect(isAllowedDocumentExtractProcessEnvKey('RAILPACK_VERSION')).toBe(true);
    expect(isAllowedDocumentExtractProcessEnvKey('RAILPACK_BUILT_AT')).toBe(true);
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
    expect(isAllowedDocumentExtractProcessEnvKey('RAILPACK_FUTURE_SECRET')).toBe(false);
  });
});

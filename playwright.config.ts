import { defineConfig, devices } from '@playwright/test';

import { buildE2eEnv } from './scripts/e2e-env.js';

const e2eEnv = buildE2eEnv();
delete process.env.NO_COLOR;
Object.assign(process.env, e2eEnv);

const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const webServerCommand =
  process.env.E2E_WEB_SERVER_COMMAND ??
  'pnpm --filter @timeline/web exec next dev -H 127.0.0.1 -p 3000';

export default defineConfig({
  testDir: './e2e',
  testIgnore: process.env.E2E_PROD_SMOKE === '1' ? [] : ['**/prod-smoke.spec.ts'],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: {
    command: webServerCommand,
    url: baseURL,
    reuseExistingServer: true,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      AUTH_URL: baseURL,
      NEXTAUTH_URL: baseURL,
      AUTH_SECRET: e2eEnv.AUTH_SECRET,
      SECRETS_ENCRYPTION_KEY: e2eEnv.SECRETS_ENCRYPTION_KEY,
      DATABASE_URL: e2eEnv.DATABASE_URL,
      REDIS_URL: e2eEnv.REDIS_URL,
      S3_ENDPOINT: e2eEnv.S3_ENDPOINT,
      S3_PUBLIC_ENDPOINT: e2eEnv.S3_PUBLIC_ENDPOINT,
      S3_REGION: e2eEnv.S3_REGION,
      S3_ACCESS_KEY_ID: e2eEnv.S3_ACCESS_KEY_ID,
      S3_SECRET_ACCESS_KEY: e2eEnv.S3_SECRET_ACCESS_KEY,
      S3_FORCE_PATH_STYLE: e2eEnv.S3_FORCE_PATH_STYLE,
      S3_BUCKET_AUDIO: process.env.S3_BUCKET_AUDIO ?? 'timeline-audio',
      S3_BUCKET_DOCUMENTS: e2eEnv.S3_BUCKET_DOCUMENTS,
      E2E_DETERMINISTIC_CHAT: process.env.E2E_DETERMINISTIC_CHAT ?? '1',
      E2E_DETERMINISTIC_EMBEDDINGS: e2eEnv.E2E_DETERMINISTIC_EMBEDDINGS,
      E2E_DETERMINISTIC_GITHUB_OAUTH: process.env.E2E_DETERMINISTIC_GITHUB_OAUTH ?? '1',
      E2E_DETERMINISTIC_SLACK_API: e2eEnv.E2E_DETERMINISTIC_SLACK_API,
      OPENROUTER_API_KEY: e2eEnv.OPENROUTER_API_KEY,
      GITHUB_APP_CLIENT_ID: process.env.GITHUB_APP_CLIENT_ID ?? 'e2e-github-client-id',
      GITHUB_APP_CLIENT_SECRET: process.env.GITHUB_APP_CLIENT_SECRET ?? 'e2e-github-client-secret',
      SLACK_CLIENT_ID: process.env.SLACK_CLIENT_ID ?? 'e2e-slack-client-id',
      SLACK_CLIENT_SECRET: process.env.SLACK_CLIENT_SECRET ?? 'e2e-slack-client-secret',
      SLACK_SIGNING_SECRET: process.env.SLACK_SIGNING_SECRET ?? 'e2e-slack-signing-secret',
      QDRANT_URL: e2eEnv.QDRANT_URL,
      QDRANT_API_KEY: e2eEnv.QDRANT_API_KEY,
      INBOUND_EMAIL_DOMAIN: process.env.INBOUND_EMAIL_DOMAIN ?? 'e2e.localhost',
      POSTMARK_WEBHOOK_SECRET: process.env.POSTMARK_WEBHOOK_SECRET ?? 'e2e-postmark-secret',
      LOG_LEVEL: process.env.LOG_LEVEL ?? 'silent',
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});

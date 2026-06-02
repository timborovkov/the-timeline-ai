import { defineConfig, devices } from '@playwright/test';

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
      AUTH_SECRET: process.env.AUTH_SECRET ?? 'e2e-auth-secret-at-least-sixteen-characters',
      DATABASE_URL:
        process.env.DATABASE_URL ?? 'postgres://timeline:timeline_dev@localhost:5432/timeline',
      REDIS_URL: process.env.REDIS_URL ?? 'redis://localhost:6379',
      S3_ENDPOINT: process.env.S3_ENDPOINT ?? 'http://localhost:9000',
      S3_PUBLIC_ENDPOINT: process.env.S3_PUBLIC_ENDPOINT ?? 'http://localhost:9000',
      S3_REGION: process.env.S3_REGION ?? 'us-east-1',
      S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID ?? 'timeline',
      S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY ?? 'timeline_dev_secret',
      S3_FORCE_PATH_STYLE: process.env.S3_FORCE_PATH_STYLE ?? 'true',
      S3_BUCKET_DOCUMENTS: process.env.S3_BUCKET_DOCUMENTS ?? 'timeline-documents',
      INBOUND_EMAIL_DOMAIN: process.env.INBOUND_EMAIL_DOMAIN ?? 'e2e.localhost',
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

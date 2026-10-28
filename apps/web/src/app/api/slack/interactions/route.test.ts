import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { afterEach, beforeEach, describe, it } from 'bun:test';
const ENV_BACKUP = { ...process.env };

await vi.mock(
  import.meta.resolve('@/lib/db'),
  () => ({ db: {} }),
  () => import('@/lib/db'),
);
await vi.mock(
  import.meta.resolve('@/lib/sentry-report'),
  () => ({ reportCaughtError: vi.fn() }),
  () => import('@/lib/sentry-report'),
);
await vi.mock(
  import.meta.resolve('@timeline/shared/logger'),
  () => ({
    childLogger: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
  }),
  () => import('@timeline/shared/logger'),
);
await vi.mock(
  import.meta.resolve('@timeline/shared/email'),
  () => ({ clientIpFromHeaders: () => '203.0.113.10' }),
  () => import('@timeline/shared/email'),
);
await vi.mock(
  import.meta.resolve('@timeline/shared/rate-limit'),
  () => ({
    RATE_LIMITS: { slackWebhookIp: { capacity: 1, refillPerSecond: 1 } },
    rateLimitKey: (...parts: string[]) => parts.join(':'),
    checkRateLimit: () => Promise.resolve({ ok: true }),
  }),
  () => import('@timeline/shared/rate-limit'),
);
await vi.mock(
  import.meta.resolve('@timeline/shared/slack'),
  () => ({
    verifySlackSignature: vi.fn(),
    handleSlackInteraction: vi.fn(),
  }),
  () => import('@timeline/shared/slack'),
);

const { resetEnvForTests } = await import('@timeline/shared/env');

const { POST } = await import('./route.js');

beforeEach(() => {
  process.env.SLACK_SIGNING_SECRET = 'slack-signing-secret';
  resetEnvForTests();
});

afterEach(() => {
  process.env = { ...ENV_BACKUP };
  resetEnvForTests();
});

/** Slack interaction payloads must be bounded before signature verification. */
describe('POST /api/slack/interactions', () => {
  it('rejects an oversized interaction before signature verification', async () => {
    const response = await POST(
      new Request('http://test/api/slack/interactions', {
        method: 'POST',
        headers: { 'content-length': String(256 * 1024 + 1) },
        body: '{}',
      }),
    );
    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({ reason: 'payload_too_large' });
  });
});

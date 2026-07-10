import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetEnvForTests } from '@timeline/shared/env';

const ENV_BACKUP = { ...process.env };

vi.mock('@/lib/db', () => ({ db: {} }));
vi.mock('@/lib/sentry-report', () => ({ reportCaughtError: vi.fn() }));
vi.mock('@timeline/shared/logger', () => ({
  childLogger: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
}));
vi.mock('@timeline/shared/email', () => ({ clientIpFromHeaders: () => '203.0.113.10' }));
vi.mock('@timeline/shared/rate-limit', () => ({
  RATE_LIMITS: { slackWebhookIp: { capacity: 1, refillPerSecond: 1 } },
  rateLimitKey: (...parts: string[]) => parts.join(':'),
  checkRateLimit: () => Promise.resolve({ ok: true }),
}));
vi.mock('@timeline/shared/slack', () => ({
  verifySlackSignature: vi.fn(),
  handleSlackInteraction: vi.fn(),
}));

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

import { createHmac } from 'node:crypto';

import { resetEnvForTests } from '@timeline/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as SharedModuleNS from '@timeline/shared';

const ENV_BACKUP = { ...process.env };

const fakes = vi.hoisted(() => ({
  handleSlackEnvelope: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ db: {} }));
vi.mock('@/app/api/slack/_shared', () => ({ slackIngestDeps: () => ({}) }));

vi.mock('@timeline/shared', async () => {
  const actual = await vi.importActual<typeof SharedModuleNS>('@timeline/shared');
  return {
    ...actual,
    childLogger: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
    email: { ...actual.email, clientIpFromHeaders: () => null },
    rateLimit: {
      ...actual.rateLimit,
      checkRateLimit: vi.fn().mockResolvedValue({ ok: true }),
    },
    slack: {
      ...actual.slack,
      handleSlackEnvelope: fakes.handleSlackEnvelope,
    },
  };
});

const { POST } = await import('./route.js');

function slackRequest(payload: unknown, signature = true): Request {
  const body = JSON.stringify(payload);
  const ts = String(Math.floor(Date.now() / 1000));
  const digest = createHmac('sha256', 'slack-secret').update(`v0:${ts}:${body}`).digest('hex');
  return new Request('https://timeline.test/api/slack/events', {
    method: 'POST',
    headers: {
      'x-slack-request-timestamp': ts,
      'x-slack-signature': signature ? `v0=${digest}` : 'v0=bad',
    },
    body,
  });
}

beforeEach(() => {
  process.env.SLACK_SIGNING_SECRET = 'slack-secret';
  resetEnvForTests();
  fakes.handleSlackEnvelope.mockResolvedValue({ ok: true });
  vi.clearAllMocks();
});

afterEach(() => {
  process.env = { ...ENV_BACKUP };
  resetEnvForTests();
});

describe('POST /api/slack/events', () => {
  it('returns 503 when Slack events are disabled and 401 for bad signatures', async () => {
    delete process.env.SLACK_SIGNING_SECRET;
    resetEnvForTests();
    const disabled = await POST(slackRequest({ type: 'event_callback' }));
    expect(disabled.status).toBe(503);

    process.env.SLACK_SIGNING_SECRET = 'slack-secret';
    resetEnvForTests();
    const forbidden = await POST(slackRequest({ type: 'event_callback' }, false));
    expect(forbidden.status).toBe(401);
    expect(fakes.handleSlackEnvelope).not.toHaveBeenCalled();
  });

  it('responds to URL verification challenges through the Slack envelope handler', async () => {
    fakes.handleSlackEnvelope.mockResolvedValueOnce({ challenge: 'challenge-token' });

    const response = await POST(
      slackRequest({ type: 'url_verification', challenge: 'challenge-token' }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ challenge: 'challenge-token' });
    expect(fakes.handleSlackEnvelope).toHaveBeenCalledWith(
      { db: {} },
      expect.objectContaining({ type: 'url_verification' }),
    );
  });
});

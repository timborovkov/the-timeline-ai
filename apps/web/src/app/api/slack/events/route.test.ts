import { createHmac } from 'node:crypto';

import { resetEnvForTests } from '@timeline/shared/env';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as EmailModule from '@timeline/shared/email';
import type * as RateLimitModule from '@timeline/shared/rate-limit';
import type * as SlackModule from '@timeline/shared/slack';

const ENV_BACKUP = { ...process.env };

const fakes = vi.hoisted(() => ({
  handleSlackEnvelope: vi.fn(),
  slackIngestDeps: vi.fn(),
  extract: { enqueueExtract: vi.fn() },
  embed: { enqueueEmbed: vi.fn() },
  suggestions: { enqueueSuggestion: vi.fn() },
}));

vi.mock('@/lib/db', () => ({ db: {} }));
vi.mock('@/app/api/slack/_shared', () => ({ slackIngestDeps: fakes.slackIngestDeps }));

vi.mock('@timeline/shared/logger', () => ({
  childLogger: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
}));

vi.mock('@timeline/shared/email', async () => {
  const actual = await vi.importActual<typeof EmailModule>('@timeline/shared/email');
  return { ...actual, clientIpFromHeaders: () => null };
});

vi.mock('@timeline/shared/rate-limit', async () => {
  const actual = await vi.importActual<typeof RateLimitModule>('@timeline/shared/rate-limit');
  return {
    ...actual,
    checkRateLimit: vi.fn().mockResolvedValue({ ok: true }),
  };
});

vi.mock('@timeline/shared/slack', async () => {
  const actual = await vi.importActual<typeof SlackModule>('@timeline/shared/slack');
  return {
    ...actual,
    handleSlackEnvelope: fakes.handleSlackEnvelope,
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
  fakes.slackIngestDeps.mockReturnValue({});
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

  it('passes Redis-backed text queues to Slack dispatcher for event callbacks', async () => {
    process.env.REDIS_URL = 'redis://localhost:6379';
    resetEnvForTests();
    fakes.slackIngestDeps.mockReturnValue({
      extract: fakes.extract,
      embed: fakes.embed,
      suggestions: fakes.suggestions,
    });

    const response = await POST(
      slackRequest({
        type: 'event_callback',
        team_id: 'T_SLACK',
        event_id: 'EvText',
        event: { type: 'message', user: 'U_SLACK' },
      }),
    );

    expect(response.status).toBe(200);
    await vi.waitFor(() => {
      expect(fakes.handleSlackEnvelope).toHaveBeenCalledWith(
        {
          db: {},
          extract: fakes.extract,
          embed: fakes.embed,
          suggestions: fakes.suggestions,
        },
        expect.objectContaining({ event_id: 'EvText' }),
      );
    });
  });
});

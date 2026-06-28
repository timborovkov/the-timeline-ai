import { createHmac } from 'node:crypto';

import { resetEnvForTests } from '@timeline/shared/env';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as EmailModule from '@timeline/shared/email';
import type * as RateLimitModule from '@timeline/shared/rate-limit';
import type * as SlackModule from '@timeline/shared/slack';

const ENV_BACKUP = { ...process.env };

const fakes = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
  handleSlackSlashCommand: vi.fn(),
  reportCaughtError: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ db: {} }));
vi.mock('@/lib/sentry-report', () => ({
  reportCaughtError: fakes.reportCaughtError,
}));

vi.mock('@timeline/shared/logger', () => ({
  childLogger: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
}));

vi.mock('@timeline/shared/email', async () => {
  const actual = await vi.importActual<typeof EmailModule>('@timeline/shared/email');
  return { ...actual, clientIpFromHeaders: () => '203.0.113.10' };
});

vi.mock('@timeline/shared/rate-limit', async () => {
  const actual = await vi.importActual<typeof RateLimitModule>('@timeline/shared/rate-limit');
  return {
    ...actual,
    checkRateLimit: fakes.checkRateLimit,
  };
});

vi.mock('@timeline/shared/slack', async () => {
  const actual = await vi.importActual<typeof SlackModule>('@timeline/shared/slack');
  return {
    ...actual,
    handleSlackSlashCommand: fakes.handleSlackSlashCommand,
  };
});

const { POST } = await import('./route.js');

function slackCommandRequest(input: Record<string, string>, signature = true): Request {
  const body = new URLSearchParams(input).toString();
  const ts = String(Math.floor(Date.now() / 1000));
  const digest = createHmac('sha256', 'slack-secret').update(`v0:${ts}:${body}`).digest('hex');
  return new Request('https://timeline.test/api/slack/commands', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-slack-request-timestamp': ts,
      'x-slack-signature': signature ? `v0=${digest}` : 'v0=bad',
    },
    body,
  });
}

function commandInput(overrides: Partial<Record<string, string>> = {}) {
  return {
    command: '/timeline',
    text: 'join standup',
    user_id: 'U_SLACK',
    team_id: 'T_SLACK',
    channel_id: 'C_SLACK',
    response_url: 'https://hooks.slack.test/response',
    trigger_id: 'trigger-1',
    ...overrides,
  };
}

beforeEach(() => {
  process.env.SLACK_SIGNING_SECRET = 'slack-secret';
  resetEnvForTests();
  fakes.checkRateLimit.mockResolvedValue({ ok: true });
  fakes.handleSlackSlashCommand.mockResolvedValue(undefined);
  vi.clearAllMocks();
});

afterEach(() => {
  process.env = { ...ENV_BACKUP };
  resetEnvForTests();
});

describe('POST /api/slack/commands', () => {
  it('returns a Slack-visible disabled response when Slack commands are unconfigured', async () => {
    delete process.env.SLACK_SIGNING_SECRET;
    resetEnvForTests();

    const response = await POST(slackCommandRequest(commandInput()));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ text: 'Slack is not configured.' });
    expect(fakes.handleSlackSlashCommand).not.toHaveBeenCalled();
  });

  it('rejects badly signed Slack commands before dispatching', async () => {
    const response = await POST(slackCommandRequest(commandInput(), false));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ ok: false });
    expect(fakes.handleSlackSlashCommand).not.toHaveBeenCalled();
  });

  it('ignores unsupported slash commands after signature verification', async () => {
    const response = await POST(slackCommandRequest(commandInput({ command: '/other' })));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      response_type: 'ephemeral',
      text: 'Timeline only handles /ask and /timeline from Slack.',
    });
    expect(fakes.handleSlackSlashCommand).not.toHaveBeenCalled();
  });

  it('preserves Slack response_url and trigger_id when dispatching timeline commands', async () => {
    const response = await POST(slackCommandRequest(commandInput()));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      response_type: 'ephemeral',
      text: 'Working on it...',
    });
    await vi.waitFor(() => {
      expect(fakes.handleSlackSlashCommand).toHaveBeenCalled();
    });
    expect(fakes.handleSlackSlashCommand).toHaveBeenCalledWith(
      expect.objectContaining({ db: {} }),
      {
        command: '/timeline',
        text: 'join standup',
        user_id: 'U_SLACK',
        team_id: 'T_SLACK',
        channel_id: 'C_SLACK',
        response_url: 'https://hooks.slack.test/response',
        trigger_id: 'trigger-1',
      },
    );
  });

  it('does not dispatch commands when the per-user command limiter trips', async () => {
    fakes.checkRateLimit
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false, retryAfterMs: 10_000 });

    const response = await POST(slackCommandRequest(commandInput()));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      response_type: 'ephemeral',
      text: 'Timeline is rate-limiting Slack commands for a moment. Try again soon.',
    });
    expect(fakes.handleSlackSlashCommand).not.toHaveBeenCalled();
  });
});

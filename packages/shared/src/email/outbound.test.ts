import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { sendTeamInviteEmail } from '#src/email/outbound.js';

const OLD_ENV = process.env;

describe('sendTeamInviteEmail', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...OLD_ENV };
  });

  afterEach(() => {
    process.env = OLD_ENV;
    vi.restoreAllMocks();
  });

  it('returns a visible failure when outbound email is not configured', async () => {
    delete process.env.POSTMARK_SERVER_TOKEN;
    delete process.env.TRANSACTIONAL_EMAIL_FROM;
    delete process.env.INVITE_EMAIL_FROM;

    await expect(
      sendTeamInviteEmail({
        to: 'new@example.com',
        inviterName: 'Tim',
        teamName: 'Timeline',
        role: 'member',
        inviteUrl: 'https://app.test/accept-invite/token',
        expiresAt: new Date('2026-06-01T00:00:00Z'),
      }),
    ).resolves.toEqual({ ok: false, error: 'Outbound email is not configured' });
  });

  it('sends HTML and text bodies through Postmark', async () => {
    process.env.POSTMARK_SERVER_TOKEN = 'server-token';
    process.env.TRANSACTIONAL_EMAIL_FROM = 'Timeline <invites@example.com>';
    const fetchMock = vi.fn(() => Promise.resolve(new Response('{}', { status: 200 })));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      sendTeamInviteEmail({
        to: 'new@example.com',
        inviterName: 'Tim',
        teamName: 'Timeline',
        role: 'admin',
        inviteUrl: 'https://app.test/accept-invite/token',
        expiresAt: new Date('2026-06-01T00:00:00Z'),
      }),
    ).resolves.toEqual({ ok: true });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.postmarkapp.com/email');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ 'x-postmark-server-token': 'server-token' });
    expect(typeof init.body).toBe('string');
    const rawBody = typeof init.body === 'string' ? init.body : '';
    expect(rawBody).toEqual(expect.stringContaining('"TextBody"'));
    const body = JSON.parse(rawBody) as Record<string, string>;
    expect(body.HtmlBody).toContain('Join team');
    expect(body.TextBody).toContain('https://app.test/accept-invite/token');
  });
});

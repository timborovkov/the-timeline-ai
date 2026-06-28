import { resetEnvForTests } from '@timeline/shared/env';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as SlackModule from '@timeline/shared/slack';

const ENV_BACKUP = { ...process.env };

const fakes = vi.hoisted(() => ({
  auth: vi.fn(),
  resolveActiveTeam: vi.fn(),
  redirect: vi.fn(),
  requireMembership: vi.fn(),
  signSlackOAuthState: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ auth: fakes.auth }));
vi.mock('@/lib/active-team', () => ({ resolveActiveTeam: fakes.resolveActiveTeam }));
vi.mock('@/lib/db', () => ({ db: {} }));
vi.mock('next/navigation', () => ({ redirect: fakes.redirect }));
vi.mock('@timeline/shared/team-scope', () => ({
  withTeam: () => ({ requireMembership: fakes.requireMembership }),
}));
vi.mock('@timeline/shared/slack', async () => {
  const actual = await vi.importActual<typeof SlackModule>('@timeline/shared/slack');
  return {
    ...actual,
    signSlackOAuthState: fakes.signSlackOAuthState,
  };
});

const { GET } = await import('./route.js');

function redirectTarget(): string {
  const calls = fakes.redirect.mock.calls as [string][];
  return calls.at(-1)?.[0] ?? '';
}

beforeEach(() => {
  process.env.AUTH_SECRET = 'test-auth-secret-1234567890';
  process.env.AUTH_URL = 'https://timeline.test';
  process.env.DATABASE_URL = 'postgres://user:pass@localhost:5432/timeline';
  process.env.SLACK_CLIENT_ID = 'slack-client-id';
  resetEnvForTests();
  fakes.auth.mockResolvedValue({ user: { id: 'user-1' } });
  fakes.resolveActiveTeam.mockResolvedValue({ active: { teamId: 'team-1' } });
  fakes.requireMembership.mockResolvedValue('admin');
  fakes.signSlackOAuthState.mockReturnValue('signed-install-state');
  fakes.redirect.mockImplementation((target: string) => {
    throw new Error(`NEXT_REDIRECT:${target}`);
  });
  vi.clearAllMocks();
});

afterEach(() => {
  process.env = { ...ENV_BACKUP };
  resetEnvForTests();
});

describe('GET /api/slack/install/start', () => {
  it('requires an authenticated user and active team admin', async () => {
    fakes.auth.mockResolvedValueOnce(null);

    await expect(GET()).rejects.toThrow('NEXT_REDIRECT:/sign-in');

    fakes.auth.mockResolvedValueOnce({ user: { id: 'user-1' } });
    fakes.resolveActiveTeam.mockResolvedValueOnce({ active: { teamId: 'team-1' } });
    await expect(GET()).rejects.toThrow('NEXT_REDIRECT:https://slack.com/oauth');

    expect(fakes.requireMembership).toHaveBeenCalledWith('admin');
  });

  it('redirects to team Slack settings when Slack app credentials are missing', async () => {
    delete process.env.SLACK_CLIENT_ID;
    resetEnvForTests();

    await expect(GET()).rejects.toThrow('NEXT_REDIRECT:/app/team/slack?error=slack_unconfigured');
  });

  it('builds a Slack install OAuth URL with bot scopes, user identity, and signed state', async () => {
    await expect(GET()).rejects.toThrow('NEXT_REDIRECT:https://slack.com/oauth');

    const target = new URL(redirectTarget());
    expect(target.origin + target.pathname).toBe('https://slack.com/oauth/v2/authorize');
    expect(target.searchParams.get('client_id')).toBe('slack-client-id');
    expect(target.searchParams.get('user_scope')).toBe('identity.basic');
    expect(target.searchParams.get('scope')).toContain('commands');
    expect(target.searchParams.get('scope')).toContain('channels:history');
    expect(target.searchParams.get('redirect_uri')).toBe(
      'https://timeline.test/api/slack/install/callback',
    );
    expect(target.searchParams.get('state')).toBe('signed-install-state');
    expect(fakes.signSlackOAuthState).toHaveBeenCalledWith({
      kind: 'install',
      teamId: 'team-1',
      userId: 'user-1',
    });
  });
});

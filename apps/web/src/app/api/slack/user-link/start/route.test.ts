import { resetEnvForTests } from '@timeline/shared/env';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as SlackModule from '@timeline/shared/slack';

const ENV_BACKUP = { ...process.env };

const fakes = vi.hoisted(() => ({
  auth: vi.fn(),
  resolveActiveTeam: vi.fn(),
  redirect: vi.fn(),
  requireMembership: vi.fn(),
  hasSlackInstallForTeam: vi.fn(),
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
    hasSlackInstallForTeam: fakes.hasSlackInstallForTeam,
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
  fakes.requireMembership.mockResolvedValue('member');
  fakes.hasSlackInstallForTeam.mockResolvedValue(true);
  fakes.signSlackOAuthState.mockReturnValue('signed-user-link-state');
  fakes.redirect.mockImplementation((target: string) => {
    throw new Error(`NEXT_REDIRECT:${target}`);
  });
  vi.clearAllMocks();
});

afterEach(() => {
  process.env = { ...ENV_BACKUP };
  resetEnvForTests();
});

describe('GET /api/slack/user-link/start', () => {
  it('requires an authenticated team member and existing Slack workspace install', async () => {
    fakes.auth.mockResolvedValueOnce(null);

    await expect(GET()).rejects.toThrow('NEXT_REDIRECT:/sign-in');

    fakes.auth.mockResolvedValueOnce({ user: { id: 'user-1' } });
    fakes.resolveActiveTeam.mockResolvedValueOnce({ active: { teamId: 'team-1' } });
    fakes.hasSlackInstallForTeam.mockResolvedValueOnce(false);

    await expect(GET()).rejects.toThrow('NEXT_REDIRECT:/app/team/slack?error=slack_not_installed');
    expect(fakes.requireMembership).toHaveBeenCalledWith();
  });

  it('redirects to team Slack settings when Slack app credentials are missing', async () => {
    delete process.env.SLACK_CLIENT_ID;
    resetEnvForTests();

    await expect(GET()).rejects.toThrow('NEXT_REDIRECT:/app/team/slack?error=slack_unconfigured');
  });

  it('builds a Slack user-link OAuth URL with user identity only and signed state', async () => {
    await expect(GET()).rejects.toThrow('NEXT_REDIRECT:https://slack.com/oauth');

    const target = new URL(redirectTarget());
    expect(target.origin + target.pathname).toBe('https://slack.com/oauth/v2/authorize');
    expect(target.searchParams.get('client_id')).toBe('slack-client-id');
    expect(target.searchParams.get('user_scope')).toBe('identity.basic');
    expect(target.searchParams.has('scope')).toBe(false);
    expect(target.searchParams.get('redirect_uri')).toBe(
      'https://timeline.test/api/slack/user-link/callback',
    );
    expect(target.searchParams.get('state')).toBe('signed-user-link-state');
    expect(fakes.signSlackOAuthState).toHaveBeenCalledWith({
      kind: 'user_link',
      teamId: 'team-1',
      userId: 'user-1',
    });
  });
});

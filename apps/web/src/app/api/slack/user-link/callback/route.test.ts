import { resetEnvForTests } from '@timeline/shared/env';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as SlackModule from '@timeline/shared/slack';

const ENV_BACKUP = { ...process.env };

const fakes = vi.hoisted(() => ({
  auth: vi.fn(),
  redirect: vi.fn(),
  requireMembership: vi.fn(),
  auditRecord: vi.fn(),
  safeMarkOnboardingStep: vi.fn(),
  verifySlackOAuthState: vi.fn(),
  oauthV2Access: vi.fn(),
  linkSlackUserFromOAuth: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ auth: fakes.auth }));
vi.mock('@/lib/db', () => ({ db: {} }));
vi.mock('@/lib/onboarding', () => ({ safeMarkOnboardingStep: fakes.safeMarkOnboardingStep }));
vi.mock('next/navigation', () => ({ redirect: fakes.redirect }));
vi.mock('@timeline/shared/team-scope', () => ({
  withTeam: () => ({
    requireMembership: fakes.requireMembership,
    audit: { record: fakes.auditRecord },
  }),
}));
vi.mock('@timeline/shared/slack', async () => {
  const actual = await vi.importActual<typeof SlackModule>('@timeline/shared/slack');
  return {
    ...actual,
    SlackApi: class {
      oauthV2Access = fakes.oauthV2Access;
    },
    verifySlackOAuthState: fakes.verifySlackOAuthState,
    linkSlackUserFromOAuth: fakes.linkSlackUserFromOAuth,
  };
});

const { GET } = await import('./route.js');

interface UserLinkInput {
  db: unknown;
  oauth: { team?: { id?: string; name?: string } };
  userId: string;
  teamId: string;
}

function request(params: Record<string, string | undefined> = {}) {
  const url = new URL('https://timeline.test/api/slack/user-link/callback');
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, value);
  }
  return new Request(url);
}

beforeEach(() => {
  process.env.AUTH_SECRET = 'test-auth-secret-1234567890';
  process.env.AUTH_URL = 'https://timeline.test';
  process.env.DATABASE_URL = 'postgres://user:pass@localhost:5432/timeline';
  process.env.SLACK_CLIENT_ID = 'slack-client-id';
  process.env.SLACK_CLIENT_SECRET = 'slack-client-secret';
  resetEnvForTests();
  fakes.auth.mockResolvedValue({ user: { id: 'user-1' } });
  fakes.requireMembership.mockResolvedValue('member');
  fakes.verifySlackOAuthState.mockReturnValue({
    kind: 'user_link',
    teamId: 'team-1',
    userId: 'user-1',
    nonce: 'nonce',
    createdAt: Date.now(),
  });
  fakes.oauthV2Access.mockResolvedValue({
    ok: true,
    team: { id: 'T_SLACK', name: 'Acme' },
    authed_user: { id: 'U_SLACK', access_token: 'xoxp-token', scope: 'identity.basic' },
  });
  fakes.linkSlackUserFromOAuth.mockResolvedValue(undefined);
  fakes.safeMarkOnboardingStep.mockResolvedValue(true);
  fakes.redirect.mockImplementation((target: string) => {
    throw new Error(`NEXT_REDIRECT:${target}`);
  });
  vi.clearAllMocks();
});

afterEach(() => {
  process.env = { ...ENV_BACKUP };
  resetEnvForTests();
});

describe('GET /api/slack/user-link/callback', () => {
  it('rejects missing OAuth parameters and invalid user-link state', async () => {
    await expect(GET(request({ state: 'state-1' }))).rejects.toThrow(
      'NEXT_REDIRECT:/app/team/slack?error=missing_oauth',
    );

    fakes.verifySlackOAuthState.mockReturnValueOnce({
      kind: 'install',
      teamId: 'team-1',
      userId: 'user-1',
      nonce: 'nonce',
      createdAt: Date.now(),
    });

    await expect(GET(request({ code: 'code-1', state: 'bad-state' }))).rejects.toThrow(
      'NEXT_REDIRECT:/app/team/slack?error=invalid_state',
    );
  });

  it('exchanges the user-link code, stores the user link, audits, and marks onboarding', async () => {
    await expect(GET(request({ code: 'code-1', state: 'valid-state' }))).rejects.toThrow(
      'NEXT_REDIRECT:/app/team/slack?linked=1',
    );

    expect(fakes.requireMembership).toHaveBeenCalledWith();
    expect(fakes.oauthV2Access).toHaveBeenCalledWith({
      clientId: 'slack-client-id',
      clientSecret: 'slack-client-secret',
      code: 'code-1',
      redirectUri: 'https://timeline.test/api/slack/user-link/callback',
    });
    const [[userLinkInput]] = fakes.linkSlackUserFromOAuth.mock.calls as [[UserLinkInput]];
    expect(userLinkInput).toMatchObject({
      db: {},
      userId: 'user-1',
      teamId: 'team-1',
    });
    expect(userLinkInput.oauth.team).toEqual({ id: 'T_SLACK', name: 'Acme' });
    expect(fakes.auditRecord).toHaveBeenCalledWith({
      action: 'slack.connect',
      targetType: 'slack_user_link',
      metadata: { slack_team_id: 'T_SLACK', slack_user_id: 'U_SLACK' },
    });
    expect(fakes.safeMarkOnboardingStep).toHaveBeenCalledWith(
      expect.objectContaining({ audit: { record: fakes.auditRecord } }),
      'slack',
    );
  });
});

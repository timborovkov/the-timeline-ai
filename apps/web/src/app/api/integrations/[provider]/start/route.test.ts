import { beforeEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({
  auth: vi.fn(),
  resolveActiveTeam: vi.fn(),
  getProvider: vi.fn(),
  startOAuth: vi.fn(),
  loggerWarn: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ auth: fakes.auth }));
vi.mock('@/lib/active-team', () => ({ resolveActiveTeam: fakes.resolveActiveTeam }));
vi.mock('@/lib/sentry-report', () => ({ reportCaughtError: vi.fn() }));
vi.mock('@timeline/shared/env', () => ({
  getEnv: () => ({ AUTH_SECRET: 'test-auth-secret-at-least-sixteen-characters' }),
}));
vi.mock('@timeline/shared/integrations', () => ({ getProvider: fakes.getProvider }));
vi.mock('@timeline/shared/logger', () => ({
  childLogger: () => ({ warn: fakes.loggerWarn, error: vi.fn(), info: vi.fn() }),
}));

const { POST } = await import('./route.js');

const USER_ID = '22222222-2222-4222-8222-222222222222';
const TEAM_ID = '11111111-1111-4111-8111-111111111111';
const PUBLIC_ORIGIN = 'https://thetimeline.cc';

interface StartOAuthInput {
  teamId: string;
  userId: string;
  redirectUri: string;
  state: string;
}

function request(): Request {
  return new Request('https://0.0.0.0:8080/api/integrations/github/start', {
    method: 'POST',
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.AUTH_URL = PUBLIC_ORIGIN;
  delete process.env.NEXTAUTH_URL;
  delete process.env.VERCEL_URL;
  fakes.auth.mockResolvedValue({ user: { id: USER_ID } });
  fakes.resolveActiveTeam.mockResolvedValue({
    active: { teamId: TEAM_ID, role: 'admin' },
  });
  fakes.getProvider.mockReturnValue({ startOAuth: fakes.startOAuth });
  fakes.startOAuth.mockResolvedValue({
    authorizeUrl: 'https://github.com/login/oauth/authorize?state=signed-state',
  });
});

describe('POST /api/integrations/[provider]/start', () => {
  it('uses AUTH_URL for provider redirect_uri instead of the incoming request origin', async () => {
    const response = await POST(request(), { params: Promise.resolve({ provider: 'github' }) });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      url: 'https://github.com/login/oauth/authorize?state=signed-state',
    });
    expect(fakes.startOAuth).toHaveBeenCalledTimes(1);
    const [[input]] = fakes.startOAuth.mock.calls as unknown as [[StartOAuthInput]];
    expect(input).toMatchObject({
      teamId: TEAM_ID,
      userId: USER_ID,
      redirectUri: `${PUBLIC_ORIGIN}/api/integrations/github/callback`,
    });
    expect(input.state).toEqual(expect.any(String));
  });
});

import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { beforeEach, describe, it } from 'bun:test';
const fakes = vi.hoisted(() => ({
  auth: vi.fn(),
  resolveActiveTeam: vi.fn(),
  getProvider: vi.fn(),
  startOAuth: vi.fn(),
  loggerWarn: vi.fn(),
}));

await vi.mock(
  import.meta.resolve('@/lib/auth'),
  () => ({ auth: fakes.auth }),
  () => import('@/lib/auth'),
);
await vi.mock(
  import.meta.resolve('@/lib/active-team'),
  () => ({ resolveActiveTeam: fakes.resolveActiveTeam }),
  () => import('@/lib/active-team'),
);
await vi.mock(
  import.meta.resolve('@/lib/sentry-report'),
  () => ({ reportCaughtError: vi.fn() }),
  () => import('@/lib/sentry-report'),
);
await vi.mock(
  import.meta.resolve('@timeline/shared/env'),
  () => ({
    getEnv: () => ({ AUTH_SECRET: 'test-auth-secret-at-least-sixteen-characters' }),
    requireAuthSecret: () => 'test-auth-secret-at-least-sixteen-characters',
  }),
  () => import('@timeline/shared/env'),
);
await vi.mock(
  import.meta.resolve('@timeline/shared/integrations'),
  () => ({ getProvider: fakes.getProvider }),
  () => import('@timeline/shared/integrations'),
);
await vi.mock(
  import.meta.resolve('@timeline/shared/logger'),
  () => ({
    childLogger: () => ({ warn: fakes.loggerWarn, error: vi.fn(), info: vi.fn() }),
  }),
  () => import('@timeline/shared/logger'),
);

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

  it('allows priority native providers through the generic OAuth start route', async () => {
    const response = await POST(request(), { params: Promise.resolve({ provider: 'monday' }) });

    expect(response.status).toBe(200);
    const [[input]] = fakes.startOAuth.mock.calls as unknown as [[StartOAuthInput]];
    expect(input.redirectUri).toBe(`${PUBLIC_ORIGIN}/api/integrations/monday/callback`);
  });
});

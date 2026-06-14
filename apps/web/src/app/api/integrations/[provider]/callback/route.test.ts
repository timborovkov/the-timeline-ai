import { createHmac } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const AUTH_SECRET = 'test-auth-secret-at-least-sixteen-characters';

const fakes = vi.hoisted(() => ({
  auth: vi.fn(),
  getProvider: vi.fn(),
  handleOAuthCallback: vi.fn(),
  requireMembership: vi.fn(),
  upsertProviderConnection: vi.fn(),
  recordAudit: vi.fn(),
  trackProductEventBestEffort: vi.fn(),
  loggerWarn: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ auth: fakes.auth }));
vi.mock('@/lib/db', () => ({ db: {} }));
vi.mock('@/lib/analytics', () => ({
  trackProductEventBestEffort: fakes.trackProductEventBestEffort,
}));
vi.mock('@/lib/sentry-report', () => ({ reportCaughtError: vi.fn() }));
vi.mock('@timeline/shared/env', () => ({ getEnv: () => ({ AUTH_SECRET }) }));
vi.mock('@timeline/shared/integrations', () => ({ getProvider: fakes.getProvider }));
vi.mock('@timeline/shared/logger', () => ({
  childLogger: () => ({ warn: fakes.loggerWarn, error: vi.fn(), info: vi.fn() }),
}));
vi.mock('@timeline/shared/team-scope', () => ({
  withTeam: () => ({
    requireMembership: fakes.requireMembership,
    integrations: {
      upsertProviderConnection: fakes.upsertProviderConnection,
      recordAudit: fakes.recordAudit,
    },
  }),
}));

const { GET } = await import('./route.js');

const USER_ID = '22222222-2222-4222-8222-222222222222';
const TEAM_ID = '11111111-1111-4111-8111-111111111111';
const CONNECTION_ID = '55555555-5555-4555-8555-555555555555';
const PUBLIC_ORIGIN = 'https://thetimeline.cc';

function signState(): string {
  const payload = {
    teamId: TEAM_ID,
    userId: USER_ID,
    provider: 'github',
    nonce: 'nonce',
    iat: Date.now(),
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', AUTH_SECRET).update(payloadB64).digest('base64url');
  return `${payloadB64}.${sig}`;
}

function request(search: string): Request {
  return new Request(`https://0.0.0.0:8080/api/integrations/github/callback${search}`, {
    method: 'GET',
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.AUTH_URL = PUBLIC_ORIGIN;
  delete process.env.NEXTAUTH_URL;
  delete process.env.VERCEL_URL;
  fakes.auth.mockResolvedValue({ user: { id: USER_ID } });
  fakes.requireMembership.mockResolvedValue('member');
  fakes.upsertProviderConnection.mockResolvedValue({ id: CONNECTION_ID });
  fakes.getProvider.mockReturnValue({ handleOAuthCallback: fakes.handleOAuthCallback });
  fakes.handleOAuthCallback.mockResolvedValue({
    displayName: 'timeline-ai',
    externalAccountId: 'owner/repo',
    scopes: ['repo'],
    tokens: { accessToken: 'encrypted' },
  });
});

describe('GET /api/integrations/[provider]/callback', () => {
  it('uses AUTH_URL for token-exchange redirect_uri and final redirects', async () => {
    const response = await GET(
      request(`?code=auth-code&state=${encodeURIComponent(signState())}`),
      {
        params: Promise.resolve({ provider: 'github' }),
      },
    );

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(
      `${PUBLIC_ORIGIN}/app/me/connections?connected=github&providerConnectionId=${CONNECTION_ID}`,
    );
    expect(fakes.handleOAuthCallback).toHaveBeenCalledWith({
      code: 'auth-code',
      redirectUri: `${PUBLIC_ORIGIN}/api/integrations/github/callback`,
    });
    expect(fakes.upsertProviderConnection).toHaveBeenCalledWith({
      provider: 'github',
      displayName: 'timeline-ai',
      externalAccountId: 'owner/repo',
      scopes: ['repo'],
      tokens: { accessToken: 'encrypted' },
    });
  });

  it('redirects provider errors to the canonical app origin', async () => {
    const response = await GET(request('?error=access_denied'), {
      params: Promise.resolve({ provider: 'github' }),
    });

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(
      `${PUBLIC_ORIGIN}/app/team/integrations?error=access_denied`,
    );
  });
});

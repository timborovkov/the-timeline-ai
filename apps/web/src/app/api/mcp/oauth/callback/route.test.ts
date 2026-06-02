import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Route-handler tests for completing inbound MCP OAuth. The route owns
 * state/session matching, ownership gates, token persistence options, and
 * final redirects back to the integrations UI.
 */

const fakes = vi.hoisted(() => ({
  auth: vi.fn(),
  getServer: vi.fn(),
  requireMembership: vi.fn(),
  loadOauthClientInfo: vi.fn(),
  persistOauthTokens: vi.fn(),
  updateServer: vi.fn(),
  verifyOAuthState: vi.fn(),
  discoverOAuth: vi.fn(),
  exchangeCode: vi.fn(),
  loggerWarn: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ auth: fakes.auth }));
vi.mock('@/lib/db', () => ({ db: {} }));
vi.mock('@timeline/shared/logger', () => ({
  childLogger: () => ({ warn: fakes.loggerWarn, error: vi.fn(), info: vi.fn() }),
}));
vi.mock('@timeline/shared/team-scope', () => ({
  withTeam: () => ({
    requireMembership: fakes.requireMembership,
    mcp: {
      getServer: fakes.getServer,
      loadOauthClientInfo: fakes.loadOauthClientInfo,
      persistOauthTokens: fakes.persistOauthTokens,
      updateServer: fakes.updateServer,
    },
  }),
}));
vi.mock('@timeline/shared/mcp', () => ({
  verifyOAuthState: fakes.verifyOAuthState,
  discoverOAuth: fakes.discoverOAuth,
  exchangeCode: fakes.exchangeCode,
}));

const { GET } = await import('./route.js');

const USER_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_USER_ID = '33333333-3333-4333-8333-333333333333';
const TEAM_ID = '11111111-1111-4111-8111-111111111111';
const SERVER_ID = '44444444-4444-4444-8444-444444444444';
const DISCOVERY = {
  authorization_endpoint: 'https://auth.example/authorize',
  token_endpoint: 'https://auth.example/token',
};

function request(search: string): Request {
  return new Request(`https://timeline.test/api/mcp/oauth/callback${search}`, {
    method: 'GET',
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  fakes.auth.mockResolvedValue({ user: { id: USER_ID } });
  fakes.verifyOAuthState.mockReturnValue({
    teamId: TEAM_ID,
    mcpServerId: SERVER_ID,
    userId: USER_ID,
  });
  fakes.getServer.mockResolvedValue({
    id: SERVER_ID,
    url: 'https://mcp.example/sse',
    userId: null,
  });
  fakes.requireMembership.mockResolvedValue('admin');
  fakes.loadOauthClientInfo.mockResolvedValue({
    clientInfo: { client_id: 'client', client_secret: 'secret', __discovery: DISCOVERY },
    codeVerifier: 'verifier',
    hasExistingTokens: false,
  });
  fakes.exchangeCode.mockResolvedValue({
    access_token: 'access',
    refresh_token: 'refresh',
    token_type: 'Bearer',
    scope: 'read',
    expires_at: '2026-07-01T00:00:00.000Z',
  });
  fakes.discoverOAuth.mockResolvedValue(DISCOVERY);
});

describe('GET /api/mcp/oauth/callback', () => {
  it('redirects unauthenticated users and OAuth provider errors safely', async () => {
    fakes.auth.mockResolvedValueOnce(null);
    const signIn = await GET(request('?code=c&state=s'));
    expect(signIn.status).toBe(307);
    expect(signIn.headers.get('location')).toBe('https://timeline.test/sign-in');

    const providerError = await GET(request('?error=access_denied'));
    expect(providerError.status).toBe(307);
    expect(providerError.headers.get('location')).toBe(
      'https://timeline.test/app/team/integrations?error=access_denied',
    );
  });

  it('rejects missing query params and mismatched state before scoped work', async () => {
    const missing = await GET(request('?code=c'));
    expect(missing.status).toBe(400);
    await expect(missing.text()).resolves.toBe('missing_code_or_state');

    fakes.verifyOAuthState.mockReturnValueOnce({ userId: OTHER_USER_ID });
    const badState = await GET(request('?code=c&state=s'));
    expect(badState.status).toBe(400);
    await expect(badState.text()).resolves.toBe('bad_state');
    expect(fakes.getServer).not.toHaveBeenCalled();
  });

  it('guards missing servers, team-shared admin access, and personal ownership', async () => {
    fakes.getServer.mockResolvedValueOnce(null);
    const missing = await GET(request('?code=c&state=s'));
    expect(missing.status).toBe(404);
    await expect(missing.text()).resolves.toBe('not_found');

    fakes.requireMembership.mockRejectedValueOnce(new Error('member'));
    const forbiddenTeam = await GET(request('?code=c&state=s'));
    expect(forbiddenTeam.status).toBe(403);
    await expect(forbiddenTeam.text()).resolves.toBe('forbidden');

    fakes.getServer.mockResolvedValueOnce({
      id: SERVER_ID,
      url: 'https://mcp.example',
      userId: OTHER_USER_ID,
    });
    const forbiddenPersonal = await GET(request('?code=c&state=s'));
    expect(forbiddenPersonal.status).toBe(403);
    await expect(forbiddenPersonal.text()).resolves.toBe('forbidden');
  });

  it('requires pending PKCE/client state before exchanging the code', async () => {
    fakes.loadOauthClientInfo.mockResolvedValueOnce({
      clientInfo: null,
      codeVerifier: 'verifier',
      hasExistingTokens: false,
    });

    const response = await GET(request('?code=c&state=s'));

    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toBe('missing_pending_state');
    expect(fakes.exchangeCode).not.toHaveBeenCalled();
  });

  it('exchanges with pinned discovery, persists encrypted token intent, enables first connects, and redirects success', async () => {
    const response = await GET(request('?code=auth-code&state=signed-state'));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(
      `https://timeline.test/app/team/integrations?connected=${SERVER_ID}`,
    );
    expect(fakes.discoverOAuth).not.toHaveBeenCalled();
    expect(fakes.exchangeCode).toHaveBeenCalledWith({
      discovery: DISCOVERY,
      code: 'auth-code',
      redirectUri: 'https://timeline.test/api/mcp/oauth/callback',
      clientId: 'client',
      clientSecret: 'secret',
      codeVerifier: 'verifier',
    });
    const persistCall = fakes.persistOauthTokens.mock.calls[0] as [
      string,
      unknown,
      Date,
      { clientInfo: { client_id?: string; __discovery?: unknown }; codeVerifier: string | null },
    ];
    expect(persistCall[0]).toBe(SERVER_ID);
    expect(persistCall[1]).toEqual({
      accessToken: 'access',
      refreshToken: 'refresh',
      tokenType: 'Bearer',
      scope: 'read',
      expiresAt: '2026-07-01T00:00:00.000Z',
    });
    expect(persistCall[2]).toEqual(new Date('2026-07-01T00:00:00.000Z'));
    expect(persistCall[3].clientInfo).toMatchObject({
      client_id: 'client',
      __discovery: DISCOVERY,
    });
    expect(persistCall[3].codeVerifier).toBeNull();
    expect(fakes.updateServer).toHaveBeenCalledWith(SERVER_ID, { enabled: true });
  });

  it('falls back to fresh discovery for legacy pending rows and does not re-enable existing tokens', async () => {
    fakes.loadOauthClientInfo.mockResolvedValueOnce({
      clientInfo: { client_id: 'client' },
      codeVerifier: 'verifier',
      hasExistingTokens: true,
    });

    const response = await GET(request('?code=c&state=s'));

    expect(response.status).toBe(307);
    expect(fakes.discoverOAuth).toHaveBeenCalledWith('https://mcp.example/sse');
    expect(fakes.updateServer).not.toHaveBeenCalled();
    const persistCall = fakes.persistOauthTokens.mock.calls[0] as [
      string,
      unknown,
      Date,
      { clientInfo: { __discovery?: unknown } },
    ];
    expect(persistCall[0]).toBe(SERVER_ID);
    expect(persistCall[2]).toBeInstanceOf(Date);
    expect(persistCall[3].clientInfo.__discovery).toBe(DISCOVERY);
  });

  it('redirects callback dependency failures with a bounded error and logs context', async () => {
    fakes.exchangeCode.mockRejectedValueOnce(new Error('token_down'));

    const response = await GET(request('?code=c&state=s'));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(
      'https://timeline.test/app/team/integrations?error=token_down',
    );
    expect(fakes.loggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({ mcpServerId: SERVER_ID }),
      'mcp oauth callback failed',
    );
  });
});

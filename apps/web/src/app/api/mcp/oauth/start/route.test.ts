import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Route-handler tests for starting inbound MCP OAuth. Shared MCP helpers own
 * OAuth protocol details; this route owns auth/team gates, server ownership
 * gates, pending-state persistence, and authorize URL response shaping.
 */

const fakes = vi.hoisted(() => ({
  auth: vi.fn(),
  resolveActiveTeam: vi.fn(),
  getServer: vi.fn(),
  requireMembership: vi.fn(),
  persistOauthPending: vi.fn(),
  discoverOAuth: vi.fn(),
  findPreregisteredClient: vi.fn(),
  registerClient: vi.fn(),
  generatePkcePair: vi.fn(),
  signOAuthState: vi.fn(),
  buildAuthorizeUrl: vi.fn(),
  loggerWarn: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ auth: fakes.auth }));
vi.mock('@/lib/active-team', () => ({ resolveActiveTeam: fakes.resolveActiveTeam }));
vi.mock('@/lib/db', () => ({ db: {} }));
vi.mock('@timeline/shared/logger', () => ({
  childLogger: () => ({ warn: fakes.loggerWarn, error: vi.fn(), info: vi.fn() }),
}));
vi.mock('@timeline/shared/team-scope', () => ({
  withTeam: () => ({
    requireMembership: fakes.requireMembership,
    mcp: {
      getServer: fakes.getServer,
      persistOauthPending: fakes.persistOauthPending,
    },
  }),
}));
vi.mock('@timeline/shared/mcp', () => ({
  discoverOAuth: fakes.discoverOAuth,
  findPreregisteredClient: fakes.findPreregisteredClient,
  registerClient: fakes.registerClient,
  generatePkcePair: fakes.generatePkcePair,
  signOAuthState: fakes.signOAuthState,
  buildAuthorizeUrl: fakes.buildAuthorizeUrl,
}));

const { POST } = await import('./route.js');

const USER_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_USER_ID = '33333333-3333-4333-8333-333333333333';
const TEAM_ID = '11111111-1111-4111-8111-111111111111';
const SERVER_ID = '44444444-4444-4444-8444-444444444444';
const DISCOVERY = {
  authorization_endpoint: 'https://auth.example/authorize',
  token_endpoint: 'https://auth.example/token',
  registration_endpoint: 'https://auth.example/register',
};

function request(body: unknown): Request {
  return new Request('https://timeline.test/api/mcp/oauth/start', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  fakes.auth.mockResolvedValue({ user: { id: USER_ID } });
  fakes.resolveActiveTeam.mockResolvedValue({ active: { teamId: TEAM_ID } });
  fakes.getServer.mockResolvedValue({
    id: SERVER_ID,
    name: 'Notion',
    url: 'https://mcp.example/sse',
    authType: 'oauth',
    userId: null,
  });
  fakes.requireMembership.mockResolvedValue('admin');
  fakes.discoverOAuth.mockResolvedValue(DISCOVERY);
  fakes.findPreregisteredClient.mockReturnValue(null);
  fakes.registerClient.mockResolvedValue({
    client_id: 'dynamic-client',
    client_secret: 'dyn-secret',
  });
  fakes.generatePkcePair.mockReturnValue({
    codeVerifier: 'verifier',
    codeChallenge: 'challenge',
  });
  fakes.signOAuthState.mockReturnValue('signed-state');
  fakes.buildAuthorizeUrl.mockReturnValue('https://auth.example/authorize?state=signed-state');
});

describe('POST /api/mcp/oauth/start', () => {
  it('guards auth, active team, and request schema before MCP work', async () => {
    fakes.auth.mockResolvedValueOnce(null);
    const unauthenticated = await POST(request({ mcpServerId: SERVER_ID }));
    expect(unauthenticated.status).toBe(401);
    await expect(unauthenticated.json()).resolves.toEqual({ error: 'unauthorized' });

    fakes.resolveActiveTeam.mockResolvedValueOnce({ active: null });
    const noTeam = await POST(request({ mcpServerId: SERVER_ID }));
    expect(noTeam.status).toBe(400);
    await expect(noTeam.json()).resolves.toEqual({ error: 'no_team' });

    const badBody = await POST(request({ mcpServerId: 'not-a-uuid' }));
    expect(badBody.status).toBe(400);
    const badBodyPayload = (await badBody.json()) as { error: string };
    expect(badBodyPayload.error).toBe('bad_request');
  });

  it('rejects missing, non-OAuth, and forbidden team-shared servers', async () => {
    fakes.getServer.mockResolvedValueOnce(null);
    const missing = await POST(request({ mcpServerId: SERVER_ID }));
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toEqual({ error: 'not_found' });

    fakes.getServer.mockResolvedValueOnce({ authType: 'bearer', userId: null });
    const wrongType = await POST(request({ mcpServerId: SERVER_ID }));
    expect(wrongType.status).toBe(400);
    await expect(wrongType.json()).resolves.toEqual({ error: 'not_oauth_server' });

    fakes.requireMembership.mockRejectedValueOnce(new Error('member'));
    const forbidden = await POST(request({ mcpServerId: SERVER_ID }));
    expect(forbidden.status).toBe(403);
    await expect(forbidden.json()).resolves.toEqual({ error: 'forbidden' });
  });

  it('allows only the owner to start OAuth for personal MCP servers', async () => {
    fakes.getServer.mockResolvedValueOnce({ authType: 'oauth', userId: OTHER_USER_ID });

    const response = await POST(request({ mcpServerId: SERVER_ID }));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'forbidden' });
    expect(fakes.discoverOAuth).not.toHaveBeenCalled();
  });

  it('uses preregistered clients, persists pinned discovery and PKCE, and returns the authorize URL', async () => {
    fakes.findPreregisteredClient.mockReturnValue({
      clientId: 'pre-client',
      clientSecret: 'pre-secret',
    });

    const response = await POST(request({ mcpServerId: SERVER_ID, scopes: ['read', 'write'] }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      url: 'https://auth.example/authorize?state=signed-state',
    });
    expect(fakes.persistOauthPending).toHaveBeenCalledWith(
      SERVER_ID,
      'verifier',
      expect.objectContaining({
        client_id: 'pre-client',
        client_secret: 'pre-secret',
        preregistered: true,
        __discovery: DISCOVERY,
      }),
    );
    expect(fakes.signOAuthState).toHaveBeenCalledWith({
      teamId: TEAM_ID,
      mcpServerId: SERVER_ID,
      userId: USER_ID,
    });
    expect(fakes.buildAuthorizeUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        discovery: DISCOVERY,
        clientId: 'pre-client',
        redirectUri: 'https://timeline.test/api/mcp/oauth/callback',
        state: 'signed-state',
        codeChallenge: 'challenge',
        scopes: ['read', 'write'],
      }),
    );
  });

  it('uses dynamic registration or returns a bounded error when registration is unavailable', async () => {
    const dynamic = await POST(request({ mcpServerId: SERVER_ID }));
    expect(dynamic.status).toBe(200);
    expect(fakes.registerClient).toHaveBeenCalledWith(
      'https://auth.example/register',
      'https://timeline.test/api/mcp/oauth/callback',
      'The Timeline — Notion',
    );

    fakes.discoverOAuth.mockResolvedValueOnce({
      authorization_endpoint: 'https://auth.example/authorize',
      token_endpoint: 'https://auth.example/token',
    });
    const noRegistration = await POST(request({ mcpServerId: SERVER_ID }));
    expect(noRegistration.status).toBe(400);
    const noRegistrationPayload = (await noRegistration.json()) as { error: string };
    expect(noRegistrationPayload.error).toBe('no_dynamic_registration');
  });

  it('maps OAuth start dependency failures to 500 and logs context', async () => {
    fakes.discoverOAuth.mockRejectedValueOnce(new Error('discovery_down'));

    const response = await POST(request({ mcpServerId: SERVER_ID }));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'discovery_down' });
    expect(fakes.loggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({ mcpServerId: SERVER_ID }),
      'mcp oauth start failed',
    );
  });
});

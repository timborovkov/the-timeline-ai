import { beforeEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({
  register: vi.fn(),
  exchange: vi.fn(),
  rotate: vi.fn(),
  revoke: vi.fn(),
  checkRateLimit: vi.fn(),
}));

vi.mock('@timeline/shared/mcp-server', () => {
  class McpOAuthError extends Error {
    constructor(
      readonly code: string,
      message: string,
    ) {
      super(message);
    }
  }
  return {
    McpOAuthError,
    MCP_OAUTH_SCOPES: ['read', 'agent:ask'],
    registerMcpOAuthClient: fakes.register,
    exchangeMcpAuthorizationCode: fakes.exchange,
    rotateMcpRefreshToken: fakes.rotate,
    revokeMcpOAuthToken: fakes.revoke,
  };
});
vi.mock('@timeline/shared/rate-limit', () => ({
  checkRateLimit: fakes.checkRateLimit,
  rateLimitKey: (...parts: string[]) => parts.join(':'),
}));
vi.mock('@timeline/shared/email', () => ({ clientIpFromHeaders: () => '203.0.113.10' }));
vi.mock('@/lib/db', () => ({ db: { name: 'db' } }));

const { McpOAuthError } = await import('@timeline/shared/mcp-server');
const { POST: register } = await import('@/app/oauth/register/route');
const { POST: token } = await import('@/app/oauth/token/route');
const { POST: revoke } = await import('@/app/oauth/revoke/route');

const tokenResult = {
  access_token: 'tlo_access',
  token_type: 'Bearer',
  expires_in: 3600,
  refresh_token: 'tlr_refresh',
  scope: 'read',
  resource: 'https://timeline.example/api/mcp/server',
};

function formRequest(path: string, body: URLSearchParams, headers?: HeadersInit): Request {
  const requestHeaders = new Headers(headers);
  requestHeaders.set('content-type', 'application/x-www-form-urlencoded');
  return new Request(`https://timeline.example${path}`, {
    method: 'POST',
    headers: requestHeaders,
    body,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('AUTH_URL', 'https://timeline.example');
  fakes.checkRateLimit.mockResolvedValue({ ok: true, remaining: 10 });
  fakes.register.mockResolvedValue({
    client_id: 'tlc_client',
    client_id_issued_at: 1_786_000_000,
    client_name: 'Claude',
    redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
  });
  fakes.exchange.mockResolvedValue(tokenResult);
  fakes.rotate.mockResolvedValue(tokenResult);
  fakes.revoke.mockResolvedValue(undefined);
});

describe('Timeline OAuth protocol routes', () => {
  it('registers a constrained public client and never caches the returned client ID', async () => {
    const metadata = {
      client_name: 'Claude',
      redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
      token_endpoint_auth_method: 'none',
    };
    const response = await register(
      new Request('https://timeline.example/oauth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(metadata),
      }),
    );

    expect(response.status).toBe(201);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(fakes.checkRateLimit).toHaveBeenCalledWith({
      key: 'mcp:oauth:register:203.0.113.10',
      capacity: 10,
      refillPerSec: 10 / 3_600,
      failureMode: 'closed',
    });
    expect(fakes.register).toHaveBeenCalledWith(expect.anything(), metadata);
    await expect(response.json()).resolves.toMatchObject({ client_id: 'tlc_client' });
  });

  it('fails closed with Retry-After when the OAuth security bucket is unavailable or exhausted', async () => {
    fakes.checkRateLimit.mockResolvedValueOnce({
      ok: false,
      remaining: 0,
      retryAfterMs: 2_500,
    });

    const response = await register(
      new Request('https://timeline.example/oauth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          client_name: 'Claude',
          redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
        }),
      }),
    );

    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('3');
    await expect(response.json()).resolves.toMatchObject({ error: 'temporarily_unavailable' });
    expect(fakes.register).not.toHaveBeenCalled();
  });

  it('exchanges an authorization code only with PKCE, exact redirect, client, and resource inputs', async () => {
    const response = await token(
      formRequest(
        '/oauth/token',
        new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: 'tlc_client',
          code: 'tlc_code_value',
          redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
          code_verifier: 'v'.repeat(43),
          resource: 'https://timeline.example/api/mcp/server',
        }),
      ),
    );

    expect(response.status).toBe(200);
    expect(fakes.exchange).toHaveBeenCalledWith(expect.anything(), {
      code: 'tlc_code_value',
      clientId: 'tlc_client',
      redirectUri: 'https://claude.ai/api/mcp/auth_callback',
      codeVerifier: 'v'.repeat(43),
      resource: 'https://timeline.example/api/mcp/server',
      expectedResource: 'https://timeline.example/api/mcp/server',
    });
    await expect(response.json()).resolves.toEqual(tokenResult);
  });

  it('rotates refresh tokens and rejects client authentication methods that were not advertised', async () => {
    const refreshResponse = await token(
      formRequest(
        '/oauth/token',
        new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: 'tlc_client',
          refresh_token: 'tlr_old',
          resource: 'https://timeline.example/api/mcp/server',
          scope: 'read',
        }),
      ),
    );
    expect(refreshResponse.status).toBe(200);
    expect(fakes.rotate).toHaveBeenCalledWith(expect.anything(), {
      refreshToken: 'tlr_old',
      clientId: 'tlc_client',
      resource: 'https://timeline.example/api/mcp/server',
      expectedResource: 'https://timeline.example/api/mcp/server',
      scope: 'read',
    });

    const authenticatedResponse = await token(
      formRequest('/oauth/token', new URLSearchParams({ grant_type: 'refresh_token' }), {
        authorization: 'Basic dGVzdDp0ZXN0',
      }),
    );
    expect(authenticatedResponse.status).toBe(401);
    await expect(authenticatedResponse.json()).resolves.toMatchObject({ error: 'invalid_client' });
  });

  it('returns protocol errors without leaking internals or accepting ambiguous parameters', async () => {
    const duplicate = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: 'tlc_client',
      code: 'code',
      redirect_uri: 'https://claude.ai/callback',
      code_verifier: 'v'.repeat(43),
      resource: 'https://timeline.example/api/mcp/server',
    });
    duplicate.append('resource', 'https://attacker.example/mcp');
    const duplicateResponse = await token(formRequest('/oauth/token', duplicate));
    expect(duplicateResponse.status).toBe(400);
    await expect(duplicateResponse.json()).resolves.toMatchObject({ error: 'invalid_request' });
    expect(fakes.exchange).not.toHaveBeenCalled();

    const duplicateScope = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: 'tlc_client',
      refresh_token: 'tlr_current',
      resource: 'https://timeline.example/api/mcp/server',
      scope: 'read',
    });
    duplicateScope.append('scope', 'read agent:ask');
    const duplicateScopeResponse = await token(formRequest('/oauth/token', duplicateScope));
    expect(duplicateScopeResponse.status).toBe(400);
    await expect(duplicateScopeResponse.json()).resolves.toMatchObject({
      error: 'invalid_request',
    });
    expect(fakes.rotate).not.toHaveBeenCalled();

    fakes.rotate.mockRejectedValueOnce(new McpOAuthError('invalid_grant', 'Expired token'));
    const expired = await token(
      formRequest(
        '/oauth/token',
        new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: 'tlc_client',
          refresh_token: 'tlr_expired',
          resource: 'https://timeline.example/api/mcp/server',
        }),
      ),
    );
    await expect(expired.json()).resolves.toEqual({
      error: 'invalid_grant',
      error_description: 'Expired token',
    });
  });

  it('revokes by token possession and returns success for an unknown token', async () => {
    const response = await revoke(
      formRequest('/oauth/revoke', new URLSearchParams({ token: 'tlr_unknown' })),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(fakes.revoke).toHaveBeenCalledWith(expect.anything(), 'tlr_unknown');
    await expect(response.json()).resolves.toEqual({});
  });
});

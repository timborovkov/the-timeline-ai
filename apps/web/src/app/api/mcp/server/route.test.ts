import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as RateLimitModule from '@timeline/shared/rate-limit';

const RESOURCE_URL = 'https://timeline.test/api/mcp/server';
const METADATA_URL = 'https://timeline.test/.well-known/oauth-protected-resource/api/mcp/server';
const MCP_BODY_LIMIT_BYTES = 256 * 1024;
const PRINCIPAL = {
  authType: 'oauth' as const,
  teamId: '11111111-1111-1111-1111-111111111111',
  userId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  keyId: 'oauth-token-id',
  clientId: 'oauth-client-id',
  scopes: ['read'],
  expiresAt: 1_800_000_000,
};
const AUTH_INFO = {
  token: 'mcp-token',
  clientId: PRINCIPAL.clientId,
  scopes: PRINCIPAL.scopes,
  expiresAt: PRINCIPAL.expiresAt,
  resource: new URL(RESOURCE_URL),
  extra: { principal: PRINCIPAL, agentDelegationDepth: 0 },
};

const fakes = vi.hoisted(() => {
  const httpFetch = vi.fn();
  return {
    clientIpFromHeaders: vi.fn(),
    checkRateLimit: vi.fn(),
    validateTimelineMcpRequestHeaders: vi.fn(),
    isValidatedCurrentTimelineAgentCall: vi.fn(),
    resolveMcpBearer: vi.fn(),
    buildTimelineMcpAuthInfo: vi.fn(),
    timelineMcpResourceMetadataUrl: vi.fn(),
    httpFetch,
    createTimelineMcpHttpHandler: vi.fn(() => ({ fetch: httpFetch })),
  };
});

vi.mock('@/lib/db', () => ({ db: { kind: 'db' } }));
vi.mock('@/lib/site-url', () => ({
  appUrl: (path: string) => new URL(path, 'https://timeline.test'),
}));
vi.mock('@/lib/request-ip', () => ({ clientIpFromHeaders: fakes.clientIpFromHeaders }));
vi.mock('@timeline/shared/rate-limit', async () => {
  const actual = await vi.importActual<typeof RateLimitModule>('@timeline/shared/rate-limit');
  return { ...actual, checkRateLimit: fakes.checkRateLimit };
});
vi.mock('@timeline/shared/mcp-server', () => ({
  validateTimelineMcpRequestHeaders: fakes.validateTimelineMcpRequestHeaders,
  isValidatedCurrentTimelineAgentCall: fakes.isValidatedCurrentTimelineAgentCall,
  resolveMcpBearer: fakes.resolveMcpBearer,
  buildTimelineMcpAuthInfo: fakes.buildTimelineMcpAuthInfo,
  timelineMcpResourceMetadataUrl: fakes.timelineMcpResourceMetadataUrl,
  createTimelineMcpHttpHandler: fakes.createTimelineMcpHttpHandler,
}));

fakes.timelineMcpResourceMetadataUrl.mockReturnValue(METADATA_URL);

const { DELETE, GET, OPTIONS, POST } = await import('./route.js');

function request(
  method: 'DELETE' | 'GET' | 'OPTIONS' | 'POST',
  body?: string,
  headers: Record<string, string> = {},
): Request {
  return new Request(RESOURCE_URL, {
    method,
    headers: {
      host: 'timeline.test',
      origin: 'https://chatgpt.com',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...headers,
    },
    ...(body === undefined ? {} : { body }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  fakes.clientIpFromHeaders.mockReturnValue('203.0.113.10');
  fakes.checkRateLimit.mockResolvedValue({ ok: true, remaining: 9, retryAfterMs: 0 });
  fakes.validateTimelineMcpRequestHeaders.mockReturnValue(undefined);
  fakes.isValidatedCurrentTimelineAgentCall.mockResolvedValue(false);
  fakes.resolveMcpBearer.mockResolvedValue(PRINCIPAL);
  fakes.buildTimelineMcpAuthInfo.mockReturnValue(AUTH_INFO);
  fakes.httpFetch.mockResolvedValue(Response.json({ jsonrpc: '2.0', id: 1, result: { ok: true } }));
});

describe('/api/mcp/server', () => {
  it('returns a validated, origin-specific CORS preflight', () => {
    const response = OPTIONS(request('OPTIONS'));

    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('https://chatgpt.com');
    expect(response.headers.get('access-control-allow-methods')).toBe('GET, POST, DELETE, OPTIONS');
    expect(response.headers.get('access-control-allow-headers')).toContain('authorization');
    expect(response.headers.get('access-control-allow-headers')).toContain('mcp-protocol-version');
    expect(response.headers.get('access-control-expose-headers')).toContain('mcp-session-id');
    expect(response.headers.get('vary')).toContain('Origin');
  });

  it('rejects invalid Host or Origin before auth and dispatch', async () => {
    fakes.validateTimelineMcpRequestHeaders.mockReturnValueOnce(
      Response.json({ error: 'invalid_host' }, { status: 403 }),
    );

    const response = await POST(
      request('POST', JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }), {
        authorization: 'Bearer mcp-token',
      }),
    );

    expect(response.status).toBe(403);
    expect(fakes.resolveMcpBearer).not.toHaveBeenCalled();
    expect(fakes.httpFetch).not.toHaveBeenCalled();
  });

  it('rate limits by client IP before token resolution and includes Retry-After', async () => {
    fakes.checkRateLimit.mockResolvedValue({ ok: false, retryAfterMs: 1_001 });

    const response = await POST(
      request('POST', JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })),
    );

    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('2');
    expect(response.headers.get('access-control-allow-origin')).toBe('https://chatgpt.com');
    await expect(response.json()).resolves.toEqual({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32029, message: 'rate_limited' },
    });
    expect(fakes.resolveMcpBearer).not.toHaveBeenCalled();
  });

  it('rejects a declared oversized POST body with a CORS-preserving JSON-RPC 413', async () => {
    const response = await POST(
      request('POST', '{}', {
        authorization: 'Bearer mcp-token',
        'content-length': String(MCP_BODY_LIMIT_BYTES + 1),
      }),
    );

    expect(response.status).toBe(413);
    expect(response.headers.get('access-control-allow-origin')).toBe('https://chatgpt.com');
    await expect(response.json()).resolves.toEqual({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32_013, message: 'payload_too_large' },
    });
    expect(fakes.resolveMcpBearer).not.toHaveBeenCalled();
    expect(fakes.httpFetch).not.toHaveBeenCalled();
  });

  it('rejects a streamed oversized POST body before authentication or SDK parsing', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(200 * 1024));
        controller.enqueue(new Uint8Array(100 * 1024));
        controller.close();
      },
    });
    const incoming = new Request(RESOURCE_URL, {
      method: 'POST',
      headers: {
        authorization: 'Bearer mcp-token',
        'content-type': 'application/json',
        host: 'timeline.test',
        origin: 'https://chatgpt.com',
      },
      body: stream,
      duplex: 'half',
    } as RequestInit & { duplex: 'half' });

    const response = await POST(incoming);

    expect(response.status).toBe(413);
    expect(response.headers.get('access-control-allow-origin')).toBe('https://chatgpt.com');
    expect(fakes.resolveMcpBearer).not.toHaveBeenCalled();
    expect(fakes.httpFetch).not.toHaveBeenCalled();
  });

  it('returns a discoverable 401 challenge for missing and invalid tokens', async () => {
    const missing = await POST(
      request('POST', JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })),
    );
    expect(missing.status).toBe(401);
    expect(missing.headers.get('www-authenticate')).not.toContain('error=');
    expect(missing.headers.get('www-authenticate')).toContain('scope="read"');
    expect(missing.headers.get('www-authenticate')).toContain(
      `resource_metadata="${METADATA_URL}"`,
    );
    expect(missing.headers.get('cache-control')).toBe('no-store');
    await expect(missing.json()).resolves.toEqual({ error: 'unauthorized' });

    fakes.resolveMcpBearer.mockResolvedValueOnce(null);
    const invalid = await POST(
      request('POST', JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }), {
        authorization: 'Bearer bad-token',
      }),
    );
    expect(invalid.status).toBe(401);
    expect(invalid.headers.get('www-authenticate')).toContain('error="invalid_token"');
    expect(invalid.headers.get('www-authenticate')).toContain('scope="read"');
    await expect(invalid.json()).resolves.toMatchObject({ error: 'invalid_token' });
  });

  it('returns a current MCP 403 scope challenge before an OAuth ask_agent call', async () => {
    fakes.isValidatedCurrentTimelineAgentCall.mockResolvedValueOnce(true);
    const response = await POST(
      request(
        'POST',
        JSON.stringify({
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: {
            name: 'timeline.ask_agent',
            arguments: { question: 'What changed?' },
            _meta: {
              'io.modelcontextprotocol/protocolVersion': '2026-07-28',
              'io.modelcontextprotocol/clientCapabilities': {},
            },
          },
        }),
        {
          authorization: 'Bearer mcp-token',
          'mcp-method': 'tools/call',
          'mcp-name': 'timeline.ask_agent',
          'mcp-protocol-version': '2026-07-28',
        },
      ),
    );

    expect(response.status).toBe(403);
    expect(response.headers.get('www-authenticate')).toContain('error="insufficient_scope"');
    expect(response.headers.get('www-authenticate')).toContain('scope="read agent:ask"');
    expect(response.headers.get('www-authenticate')).toContain(
      `resource_metadata="${METADATA_URL}"`,
    );
    expect(response.headers.get('access-control-allow-origin')).toBe('https://chatgpt.com');
    expect(fakes.isValidatedCurrentTimelineAgentCall).toHaveBeenCalledOnce();
    expect(fakes.httpFetch).not.toHaveBeenCalled();
  });

  it('lets the SDK reject a current request whose standard headers disagree with its body', async () => {
    fakes.httpFetch.mockResolvedValue(
      Response.json(
        {
          jsonrpc: '2.0',
          id: 31,
          error: { code: -32_020, message: 'HeaderMismatch' },
        },
        { status: 400 },
      ),
    );

    const response = await POST(
      request(
        'POST',
        JSON.stringify({
          jsonrpc: '2.0',
          id: 31,
          method: 'tools/call',
          params: {
            name: 'timeline.list_events',
            arguments: {},
            _meta: {
              'io.modelcontextprotocol/protocolVersion': '2026-07-28',
              'io.modelcontextprotocol/clientCapabilities': {},
            },
          },
        }),
        {
          authorization: 'Bearer mcp-token',
          'mcp-method': 'tools/call',
          'mcp-name': 'timeline.ask_agent',
          'mcp-protocol-version': '2026-07-28',
        },
      ),
    );

    expect(response.status).toBe(400);
    expect(fakes.isValidatedCurrentTimelineAgentCall).toHaveBeenCalledOnce();
    expect(fakes.httpFetch).toHaveBeenCalledOnce();
  });

  it('leaves legacy ask_agent scope challenges to the in-band compatibility path', async () => {
    const response = await POST(
      request(
        'POST',
        JSON.stringify({
          jsonrpc: '2.0',
          id: 4,
          method: 'tools/call',
          params: { name: 'timeline.ask_agent', arguments: { question: 'What changed?' } },
        }),
        {
          authorization: 'Bearer mcp-token',
          'mcp-method': 'tools/call',
          'mcp-name': 'timeline.ask_agent',
          'mcp-protocol-version': '2025-11-25',
        },
      ),
    );

    expect(response.status).toBe(200);
    expect(fakes.httpFetch).toHaveBeenCalledOnce();
  });

  it('builds SDK AuthInfo and delegates the original request body unchanged', async () => {
    const body = JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'tools/list' });
    fakes.httpFetch.mockImplementationOnce(async (incoming: Request) => {
      await expect(incoming.clone().text()).resolves.toBe(body);
      await expect(incoming.clone().json()).resolves.toEqual(JSON.parse(body));
      return Response.json({ jsonrpc: '2.0', id: 7, result: { tools: [] } });
    });

    const response = await POST(
      request('POST', body, {
        authorization: 'Bearer mcp-token',
        'x-timeline-agent-depth': '1',
      }),
    );

    expect(fakes.resolveMcpBearer).toHaveBeenCalledWith({ kind: 'db' }, 'mcp-token', RESOURCE_URL);
    expect(fakes.buildTimelineMcpAuthInfo).toHaveBeenCalledWith({
      token: 'mcp-token',
      principal: PRINCIPAL,
      resourceUrl: RESOURCE_URL,
      agentDelegationDepth: 1,
    });
    expect(fakes.httpFetch).toHaveBeenCalledWith(expect.any(Request), {
      authInfo: AUTH_INFO,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe('https://chatgpt.com');
    await expect(response.json()).resolves.toMatchObject({ id: 7, result: { tools: [] } });
  });

  it('preserves SDK notification, GET, and DELETE transport statuses', async () => {
    fakes.httpFetch
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
      .mockResolvedValueOnce(
        new Response('GET not allowed', { status: 405, headers: { allow: 'POST' } }),
      )
      .mockResolvedValueOnce(
        new Response('DELETE not allowed', { status: 405, headers: { allow: 'POST' } }),
      );

    const notification = await POST(
      request('POST', JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }), {
        authorization: 'Bearer mcp-token',
      }),
    );
    const get = await GET(request('GET', undefined, { authorization: 'Bearer mcp-token' }));
    const del = await DELETE(request('DELETE', undefined, { authorization: 'Bearer mcp-token' }));

    expect(notification.status).toBe(202);
    expect(get.status).toBe(405);
    expect(del.status).toBe(405);
    expect(get.headers.get('allow')).toBe('POST');
    expect(fakes.httpFetch).toHaveBeenCalledTimes(3);
  });

  it.each([400, 406, 415])('preserves SDK protocol/media failure status %s', async (status) => {
    fakes.httpFetch.mockResolvedValueOnce(
      Response.json({ jsonrpc: '2.0', id: null, error: { code: -32600 } }, { status }),
    );

    const response = await POST(request('POST', '{', { authorization: 'Bearer mcp-token' }));

    expect(response.status).toBe(status);
    expect(response.headers.get('access-control-allow-origin')).toBe('https://chatgpt.com');
  });
});

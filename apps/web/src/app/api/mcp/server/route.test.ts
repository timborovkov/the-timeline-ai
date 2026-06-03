import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as EmailModule from '@timeline/shared/email';
import type * as RateLimitModule from '@timeline/shared/rate-limit';

/**
 * Route-handler tests for Timeline-as-MCP-server. The shared MCP server
 * handler owns JSON-RPC semantics; this route owns CORS, rate limiting,
 * bearer extraction, parse errors, and response status mapping.
 */

const fakes = vi.hoisted(() => ({
  clientIpFromHeaders: vi.fn(),
  checkRateLimit: vi.fn(),
  handleMcpRequest: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ db: { kind: 'db' } }));
vi.mock('@timeline/shared/email', async () => {
  const actual = await vi.importActual<typeof EmailModule>('@timeline/shared/email');
  return { ...actual, clientIpFromHeaders: fakes.clientIpFromHeaders };
});
vi.mock('@timeline/shared/rate-limit', async () => {
  const actual = await vi.importActual<typeof RateLimitModule>('@timeline/shared/rate-limit');
  return { ...actual, checkRateLimit: fakes.checkRateLimit };
});
vi.mock('@timeline/shared/mcp-server', () => ({
  handleMcpRequest: fakes.handleMcpRequest,
}));

const { GET, OPTIONS, POST } = await import('./route.js');

function request(body: string, headers: Record<string, string> = {}): Request {
  return new Request('https://timeline.test/api/mcp/server', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  fakes.clientIpFromHeaders.mockReturnValue('203.0.113.10');
  fakes.checkRateLimit.mockResolvedValue({ ok: true, remaining: 9, retryAfterMs: 0 });
  fakes.handleMcpRequest.mockResolvedValue({
    jsonrpc: '2.0',
    id: 1,
    result: { ok: true },
  });
});

describe('/api/mcp/server', () => {
  it('returns CORS preflight and capability metadata', async () => {
    const preflight = OPTIONS();
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe('*');
    expect(preflight.headers.get('access-control-allow-headers')).toContain('authorization');

    const response = GET();
    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    await expect(response.json()).resolves.toMatchObject({
      name: 'the-timeline',
      protocolVersion: '2024-11-05',
    });
  });

  it('rate limits by client IP and returns a JSON-RPC error with CORS headers', async () => {
    fakes.checkRateLimit.mockResolvedValue({ ok: false, retryAfterMs: 1000 });

    const response = await POST(
      request(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })),
    );

    expect(response.status).toBe(429);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    await expect(response.json()).resolves.toEqual({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32029, message: 'rate_limited' },
    });
    expect(fakes.handleMcpRequest).not.toHaveBeenCalled();
  });

  it('maps invalid JSON and invalid request shapes before calling the shared handler', async () => {
    const badJson = await POST(request('{'));
    expect(badJson.status).toBe(400);
    await expect(badJson.json()).resolves.toEqual({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32700, message: 'parse_error' },
    });

    const badShape = await POST(request(JSON.stringify({ jsonrpc: '2.0', id: 1 })));
    expect(badShape.status).toBe(400);
    await expect(badShape.json()).resolves.toEqual({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32600, message: 'invalid_request' },
    });
    expect(fakes.handleMcpRequest).not.toHaveBeenCalled();
  });

  it('extracts bearer auth, forwards JSON-RPC requests, and serializes handler responses', async () => {
    const body = { jsonrpc: '2.0', id: 7, method: 'tools/list' };

    const response = await POST(
      request(JSON.stringify(body), { authorization: 'Bearer tla_test_key' }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(fakes.handleMcpRequest).toHaveBeenCalledWith(
      { db: { kind: 'db' }, bearer: 'tla_test_key' },
      body,
    );
    await expect(response.json()).resolves.toEqual({
      jsonrpc: '2.0',
      id: 1,
      result: { ok: true },
    });
  });

  it('returns 204 with CORS for JSON-RPC notifications', async () => {
    fakes.handleMcpRequest.mockResolvedValue(null);

    const response = await POST(request(JSON.stringify({ method: 'notifications/initialized' })));

    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
  });
});

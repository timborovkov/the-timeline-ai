import { email, mcpServer, rateLimit } from '@timeline/shared';
import { NextResponse } from 'next/server';

import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// CORS — MCP clients may run in a browser context (web-based agents,
// claude.ai integrations) where the fetch crosses origins. Bearer auth
// is in the Authorization header so a wildcard `*` origin is safe
// (credentials are NOT cookie-based; opaque keys must be explicitly
// supplied). We do NOT set Access-Control-Allow-Credentials so cookies
// can't be used to authenticate the cross-origin call.
const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-max-age': '3600',
} as const;

export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

function withCors(res: Response): Response {
  for (const [k, v] of Object.entries(CORS_HEADERS)) {
    res.headers.set(k, v);
  }
  return res;
}

/**
 * Timeline-as-MCP-server JSON-RPC endpoint. External agents (Claude
 * Desktop, Cursor, Vernix, etc.) point at this URL and authorise via a
 * bearer key minted under /app/team/mcp-share.
 *
 * Path lives at `/api/mcp/server` rather than `/api/mcp` to avoid
 * colliding with the inbound MCP client routes under `/api/mcp/oauth/*`.
 */
export async function POST(req: Request): Promise<Response> {
  // Per-IP rate gate. MCP clients can be chatty (initialize + tools/list
  // + many tools/call). 600/min per IP is generous for legitimate use
  // and tight enough to stop a runaway key from burning DB capacity.
  const clientIp = email.clientIpFromHeaders(req.headers);
  if (clientIp) {
    const rl = await rateLimit.checkRateLimit({
      key: rateLimit.rateLimitKey('mcp_server', 'ip', clientIp),
      capacity: 600,
      refillPerSec: 600 / 60,
    });
    if (!rl.ok) {
      return withCors(
        NextResponse.json(
          { jsonrpc: '2.0', id: null, error: { code: -32029, message: 'rate_limited' } },
          { status: 429 },
        ),
      );
    }
  }
  const authHeader = req.headers.get('authorization') ?? '';
  const bearer = authHeader.toLowerCase().startsWith('bearer ')
    ? authHeader.slice('bearer '.length).trim()
    : null;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return withCors(
      NextResponse.json(
        { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse_error' } },
        { status: 400 },
      ),
    );
  }
  if (!body || typeof body !== 'object' || !('method' in body)) {
    return withCors(
      NextResponse.json(
        { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'invalid_request' } },
        { status: 400 },
      ),
    );
  }
  const response = await mcpServer.handleMcpRequest({ db, bearer }, body);
  if (!response) {
    // Notification: no response expected.
    return withCors(new Response(null, { status: 204 }));
  }
  return withCors(NextResponse.json(response));
}

export function GET(): Response {
  // GET on the same URL returns a tiny capability blurb so a curious
  // browser visitor sees something other than 405. MCP clients don't
  // use GET; the streamable-HTTP transport spec allows it for SSE
  // notifications which we don't emit today.
  return withCors(
    NextResponse.json({
      name: 'the-timeline',
      version: '0.1.0',
      description:
        'Timeline-as-MCP-server. POST JSON-RPC 2.0 requests with `Authorization: Bearer <key>`. Mint keys at /app/team/mcp-share.',
      protocolVersion: '2024-11-05',
    }),
  );
}

import * as mcpServer from '@timeline/shared/mcp-server';
import * as rateLimit from '@timeline/shared/rate-limit';

import { db } from '@/lib/db';
import { readCappedTextBody, REQUEST_BODY_LIMITS } from '@/lib/request-body';
import { clientIpFromHeaders } from '@/lib/request-ip';
import { appUrl } from '@/lib/site-url';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MCP_RESOURCE_URL = appUrl('/api/mcp/server').toString();
const MCP_RESOURCE_METADATA_URL = mcpServer.timelineMcpResourceMetadataUrl(MCP_RESOURCE_URL);
const canonicalHostname = new URL(MCP_RESOURCE_URL).hostname;
const localHostnames = ['localhost', '127.0.0.1', '[::1]'];
const allowedHosts = [
  canonicalHostname,
  ...(process.env.NODE_ENV === 'production' ? [] : localHostnames),
];
const allowedOrigins = [
  canonicalHostname,
  'chatgpt.com',
  'chat.openai.com',
  'claude.ai',
  ...(process.env.NODE_ENV === 'production' ? [] : localHostnames),
];

const CORS_ALLOW_HEADERS = [
  'authorization',
  'content-type',
  'last-event-id',
  'mcp-method',
  'mcp-name',
  'mcp-protocol-version',
  'mcp-session-id',
  'x-timeline-agent-depth',
].join(', ');
const CORS_EXPOSE_HEADERS = ['mcp-protocol-version', 'mcp-session-id', 'www-authenticate'].join(
  ', ',
);

const httpHandler = mcpServer.createTimelineMcpHttpHandler({ db });

function withCors(request: Request, response: Response): Response {
  const headers = new Headers(response.headers);
  const origin = request.headers.get('origin');
  if (origin) {
    headers.set('access-control-allow-origin', origin);
    const vary = headers.get('vary');
    const values =
      vary
        ?.toLowerCase()
        .split(',')
        .map((value) => value.trim()) ?? [];
    if (!values.includes('origin')) headers.set('vary', vary ? `${vary}, Origin` : 'Origin');
  }
  headers.set('access-control-allow-methods', 'GET, POST, DELETE, OPTIONS');
  headers.set('access-control-allow-headers', CORS_ALLOW_HEADERS);
  headers.set('access-control-expose-headers', CORS_EXPOSE_HEADERS);
  headers.set('access-control-max-age', '3600');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function validateRequestHeaders(request: Request): Response | undefined {
  return mcpServer.validateTimelineMcpRequestHeaders(request, {
    allowedHosts,
    allowedOrigins,
  });
}

function bearerToken(request: Request): string | null {
  const header = request.headers.get('authorization')?.trim();
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1]?.trim() ?? null;
}

function missingBearer(): Response {
  return Response.json(
    { error: 'unauthorized' },
    {
      status: 401,
      headers: {
        'cache-control': 'no-store',
        'www-authenticate': `Bearer scope="read", resource_metadata="${MCP_RESOURCE_METADATA_URL}"`,
      },
    },
  );
}

function invalidBearer(description: string): Response {
  return Response.json(
    { error: 'invalid_token', error_description: description },
    {
      status: 401,
      headers: {
        'cache-control': 'no-store',
        'www-authenticate': `Bearer error="invalid_token", error_description="${description}", scope="read", resource_metadata="${MCP_RESOURCE_METADATA_URL}"`,
      },
    },
  );
}

async function insufficientAgentScope(
  request: Request,
  principal: mcpServer.McpAuthPrincipal,
): Promise<Response | null> {
  if (
    principal.authType !== 'oauth' ||
    principal.scopes.includes('agent:ask') ||
    !(await mcpServer.isValidatedCurrentTimelineAgentCall(request))
  ) {
    return null;
  }
  const description = 'Grant the agent:ask scope to use timeline.ask_agent';
  return Response.json(
    { error: 'insufficient_scope', error_description: description },
    {
      status: 403,
      headers: {
        'cache-control': 'no-store',
        'www-authenticate': `Bearer error="insufficient_scope", error_description="${description}", scope="read agent:ask", resource_metadata="${MCP_RESOURCE_METADATA_URL}"`,
      },
    },
  );
}

function delegationDepth(request: Request): number {
  const requested = Number(request.headers.get('x-timeline-agent-depth') ?? '0');
  return Number.isInteger(requested) && requested >= 0 ? requested : 0;
}

async function cappedPostRequest(request: Request): Promise<Request | Response> {
  const body = await readCappedTextBody(request, REQUEST_BODY_LIMITS.mcpServer);
  if (body.tooLarge) {
    return Response.json(
      {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32_013, message: 'payload_too_large' },
      },
      { status: 413, headers: { 'cache-control': 'no-store' } },
    );
  }
  return new Request(request.url, {
    method: request.method,
    headers: request.headers,
    body: body.text,
    signal: request.signal,
  });
}

async function dispatch(request: Request): Promise<Response> {
  const rejected = validateRequestHeaders(request);
  if (rejected) return rejected;

  const clientIp = clientIpFromHeaders(request.headers);
  if (clientIp) {
    const limit = await rateLimit.checkRateLimit({
      key: rateLimit.rateLimitKey('mcp_server', 'ip', clientIp),
      ...rateLimit.RATE_LIMITS.mcpServer,
    });
    if (!limit.ok) {
      return withCors(
        request,
        Response.json(
          { jsonrpc: '2.0', id: null, error: { code: -32029, message: 'rate_limited' } },
          {
            status: 429,
            headers: {
              'retry-after': String(Math.max(1, Math.ceil(limit.retryAfterMs / 1_000))),
            },
          },
        ),
      );
    }
  }

  if (request.method === 'POST') {
    const capped = await cappedPostRequest(request);
    if (capped instanceof Response) return withCors(request, capped);
    request = capped;
  }

  const token = bearerToken(request);
  if (!token) return withCors(request, missingBearer());
  const principal = await mcpServer.resolveMcpBearer(db, token, MCP_RESOURCE_URL);
  if (!principal) {
    return withCors(request, invalidBearer('Invalid, expired, or revoked bearer token'));
  }
  const scopeChallenge = await insufficientAgentScope(request, principal);
  if (scopeChallenge) return withCors(request, scopeChallenge);

  const authInfo = mcpServer.buildTimelineMcpAuthInfo({
    token,
    principal,
    resourceUrl: MCP_RESOURCE_URL,
    agentDelegationDepth: delegationDepth(request),
  });
  return withCors(request, await httpHandler.fetch(request, { authInfo }));
}

export function OPTIONS(request: Request): Response {
  const rejected = validateRequestHeaders(request);
  if (rejected) return rejected;
  return withCors(request, new Response(null, { status: 204 }));
}

export const POST = dispatch;
export const GET = dispatch;
export const DELETE = dispatch;

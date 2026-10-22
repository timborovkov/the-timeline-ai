import { McpOAuthError, MCP_OAUTH_SCOPES } from '@timeline/shared/mcp-server';
import * as rateLimit from '@timeline/shared/rate-limit';

import { clientIpFromHeaders } from '@/lib/request-ip';
import { getSiteUrl } from '@/lib/site-url';

export const MCP_OAUTH_BODY_LIMIT_BYTES = 16 * 1024;

function mcpOAuthIssuer(): string {
  return getSiteUrl();
}

export function mcpOAuthResource(): string {
  return `${mcpOAuthIssuer()}/api/mcp/server`;
}

export function mcpProtectedResourceMetadata() {
  const issuer = mcpOAuthIssuer();
  return {
    resource: mcpOAuthResource(),
    authorization_servers: [issuer],
    scopes_supported: [...MCP_OAUTH_SCOPES],
    bearer_methods_supported: ['header'],
    resource_name: 'Timeline MCP',
    resource_documentation: `${issuer}/help`,
    resource_policy_uri: `${issuer}/privacy`,
    resource_tos_uri: `${issuer}/terms`,
  };
}

export function mcpAuthorizationServerMetadata() {
  const issuer = mcpOAuthIssuer();
  return {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    registration_endpoint: `${issuer}/oauth/register`,
    revocation_endpoint: `${issuer}/oauth/revoke`,
    scopes_supported: [...MCP_OAUTH_SCOPES],
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['none'],
    revocation_endpoint_auth_methods_supported: ['none'],
    code_challenge_methods_supported: ['S256'],
    authorization_response_iss_parameter_supported: true,
    client_id_metadata_document_supported: true,
    service_documentation: `${issuer}/help`,
    op_policy_uri: `${issuer}/privacy`,
    op_tos_uri: `${issuer}/terms`,
  };
}

export function oauthMetadataResponse(body: unknown): Response {
  return Response.json(body, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=300, stale-while-revalidate=3600',
    },
  });
}

export function oauthJsonResponse(
  body: unknown,
  status = 200,
  additionalHeaders?: HeadersInit,
): Response {
  return Response.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      Pragma: 'no-cache',
      ...Object.fromEntries(new Headers(additionalHeaders)),
    },
  });
}

export function oauthErrorResponse(error: unknown, fallback = 'OAuth request failed'): Response {
  if (error instanceof McpOAuthError) {
    return oauthJsonResponse({ error: error.code, error_description: error.message }, 400);
  }
  return oauthJsonResponse({ error: 'server_error', error_description: fallback }, 500);
}

export function requireFormContentType(request: Request): Response | null {
  const contentType = request.headers.get('content-type')?.toLowerCase() ?? '';
  if (contentType.split(';', 1)[0]?.trim() === 'application/x-www-form-urlencoded') return null;
  return oauthJsonResponse(
    {
      error: 'invalid_request',
      error_description: 'Content-Type must be application/x-www-form-urlencoded',
    },
    400,
  );
}

export function requireJsonContentType(request: Request): Response | null {
  const contentType = request.headers.get('content-type')?.toLowerCase() ?? '';
  if (contentType.split(';', 1)[0]?.trim() === 'application/json') return null;
  return oauthJsonResponse(
    {
      error: 'invalid_client_metadata',
      error_description: 'Content-Type must be application/json',
    },
    400,
  );
}

export function singleFormValue(params: URLSearchParams, name: string): string | null {
  const values = params.getAll(name);
  return values.length === 1 ? (values[0] ?? null) : null;
}

export async function mcpOAuthRateLimitResponse(
  request: Request,
  endpoint: 'register' | 'token' | 'revoke',
): Promise<Response | null> {
  const ip = clientIpFromHeaders(request.headers) ?? 'unknown';
  const limits =
    endpoint === 'register'
      ? { capacity: 10, refillPerSec: 10 / 3_600 }
      : { capacity: 60, refillPerSec: 60 / 60 };
  const result = await rateLimit.checkRateLimit({
    key: rateLimit.rateLimitKey('mcp', 'oauth', endpoint, ip),
    ...limits,
    failureMode: 'closed',
  });
  if (result.ok) return null;
  return oauthJsonResponse(
    {
      error: 'temporarily_unavailable',
      error_description: 'Too many OAuth requests. Try again shortly.',
    },
    429,
    { 'Retry-After': String(Math.max(1, Math.ceil(result.retryAfterMs / 1_000))) },
  );
}

export function oauthAuthorizationRedirect(
  redirectUri: string,
  params: Record<string, string>,
): string {
  const destination = new URL(redirectUri);
  for (const [name, value] of Object.entries(params)) destination.searchParams.set(name, value);
  destination.searchParams.set('iss', mcpOAuthIssuer());
  return destination.toString();
}

const authorizationErrorDescriptions = {
  access_denied: 'The authorization request was denied.',
  invalid_request: 'The authorization request is invalid.',
  invalid_scope: 'The requested scope is invalid or unsupported.',
  invalid_target: 'The requested resource is invalid or unsupported.',
  server_error: 'Timeline could not complete the authorization request.',
  unsupported_response_type: 'The requested response type is not supported.',
} as const;

type AuthorizationErrorCode = keyof typeof authorizationErrorDescriptions;

function safeAuthorizationError(error: McpOAuthError): {
  code: AuthorizationErrorCode;
  description: string;
} {
  const code = Object.hasOwn(authorizationErrorDescriptions, error.code)
    ? (error.code as AuthorizationErrorCode)
    : 'server_error';
  return { code, description: authorizationErrorDescriptions[code] };
}

/**
 * Build an OAuth authorization-error callback only when the shared validator
 * has already attached an exact registered redirect URI. Error descriptions
 * are deliberately code-owned so database, membership, and validation details
 * never cross the client boundary.
 */
export function oauthAuthorizationErrorRedirect(error: unknown): string | null {
  if (!(error instanceof McpOAuthError) || !error.trustedAuthorizationRedirect) return null;
  const safe = safeAuthorizationError(error);
  const params: Record<string, string> = {
    error: safe.code,
    error_description: safe.description,
  };
  if (error.trustedAuthorizationRedirect.state !== undefined) {
    params.state = error.trustedAuthorizationRedirect.state;
  }
  return oauthAuthorizationRedirect(error.trustedAuthorizationRedirect.redirectUri, params);
}

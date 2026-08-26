import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const MCP_OAUTH_SCOPES = ['read', 'agent:ask'] as const;
export const MCP_OAUTH_DEFAULT_SCOPE = 'read';
export const MCP_TEAM_ACTOR_USER_ID = '00000000-0000-0000-0000-000000000000';

export const AUTHORIZATION_CODE_TTL_MS = 10 * 60 * 1_000;
export const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1_000;
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
export const REVOKED_GRANT_RETENTION_MS = REFRESH_TOKEN_TTL_MS + 24 * 60 * 60 * 1_000;
export const AUTHORIZATION_CODE_PREFIX = 'tlc_code_';
export const ACCESS_TOKEN_PREFIX = 'tlo_';
export const REFRESH_TOKEN_PREFIX = 'tlr_';

const PKCE_VERIFIER_RE = /^[A-Za-z0-9._~-]{43,128}$/;
const PKCE_S256_CHALLENGE_RE = /^[A-Za-z0-9_-]{43}$/;

export type McpOAuthScope = (typeof MCP_OAUTH_SCOPES)[number];
export type McpOAuthErrorCode =
  | 'access_denied'
  | 'invalid_client'
  | 'invalid_client_metadata'
  | 'invalid_grant'
  | 'invalid_redirect_uri'
  | 'invalid_request'
  | 'invalid_scope'
  | 'invalid_target'
  | 'server_error'
  | 'unsupported_grant_type'
  | 'unsupported_response_type';

export interface McpOAuthTrustedAuthorizationRedirect {
  redirectUri: string;
  state?: string;
}

export class McpOAuthError extends Error {
  constructor(
    readonly code: McpOAuthErrorCode,
    message: string,
    readonly trustedAuthorizationRedirect?: McpOAuthTrustedAuthorizationRedirect,
  ) {
    super(message);
    this.name = 'McpOAuthError';
  }
}

export function withMcpOAuthTrustedAuthorizationRedirect(
  error: unknown,
  trustedAuthorizationRedirect: McpOAuthTrustedAuthorizationRedirect,
): McpOAuthError {
  return error instanceof McpOAuthError
    ? new McpOAuthError(error.code, error.message, trustedAuthorizationRedirect)
    : new McpOAuthError(
        'server_error',
        'Timeline could not complete the authorization request',
        trustedAuthorizationRedirect,
      );
}

export interface McpAuthPrincipal {
  authType: 'api_key' | 'oauth';
  teamId: string;
  userId: string;
  keyId: string;
  clientId: string;
  scopes: string[];
  expiresAt?: number;
}

export interface RegisteredOAuthClient {
  clientId: string;
  clientName: string;
  redirectUris: string[];
  clientUri: string | null;
  logoUri: string | null;
}

export interface ValidatedAuthorizationRequest {
  client: RegisteredOAuthClient;
  redirectUri: string;
  scopes: McpOAuthScope[];
  state: string;
  codeChallenge: string;
  resource: string;
}

export interface OAuthTokenResponse {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token: string;
  scope: string;
  resource: string;
}

type McpOAuthTeamRole = 'owner' | 'admin' | 'member';

export interface ActiveMcpOAuthMembership {
  role: McpOAuthTeamRole;
  authorizationEpoch: string;
}

export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

export function mintSecret(
  prefix: string,
  bytes = 32,
): { plaintext: string; hash: string; short: string } {
  const plaintext = `${prefix}${randomBytes(bytes).toString('base64url')}`;
  return {
    plaintext,
    hash: hashSecret(plaintext),
    short: plaintext.slice(0, prefix.length + 8),
  };
}

function normalizedUrl(raw: string, kind: 'redirect' | 'resource' | 'metadata'): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new McpOAuthError(
      kind === 'redirect' ? 'invalid_redirect_uri' : 'invalid_request',
      `Invalid ${kind} URL`,
    );
  }
  if (url.username || url.password || url.hash) {
    throw new McpOAuthError(
      kind === 'redirect' ? 'invalid_redirect_uri' : 'invalid_request',
      `${kind} URL must not contain credentials or a fragment`,
    );
  }
  return url;
}

export function normalizeRedirectUri(raw: string): string {
  const url = normalizedUrl(raw, 'redirect');
  const loopback =
    url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new McpOAuthError(
      'invalid_redirect_uri',
      'Redirect URIs must use HTTPS, except loopback HTTP callbacks',
    );
  }
  return url.toString();
}

export function normalizeOptionalMetadataUri(raw: string | undefined): string | null {
  if (!raw) return null;
  const url = normalizedUrl(raw, 'metadata');
  const loopback =
    url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new McpOAuthError('invalid_client_metadata', 'Client metadata URLs must use HTTPS');
  }
  return url.toString();
}

export function normalizeMetadataUrl(raw: string): URL {
  return normalizedUrl(raw, 'metadata');
}

export function normalizeMcpResource(raw: string, expectedResource: string): string {
  const resource = normalizedUrl(raw, 'resource');
  const expected = normalizedUrl(expectedResource, 'resource');
  if (resource.toString() !== expected.toString()) {
    throw new McpOAuthError('invalid_target', 'The requested MCP resource is not supported');
  }
  return resource.toString();
}

export function parseMcpOAuthScopes(raw: string | null | undefined): McpOAuthScope[] {
  const values = raw?.trim() ? raw.trim().split(/\s+/) : [MCP_OAUTH_DEFAULT_SCOPE];
  const unique = [...new Set(values)];
  if (
    unique.length === 0 ||
    unique.some((scope) => !MCP_OAUTH_SCOPES.includes(scope as McpOAuthScope)) ||
    (unique.includes('agent:ask') && !unique.includes('read'))
  ) {
    throw new McpOAuthError(
      'invalid_scope',
      'One or more requested scopes are not supported or are missing a required scope',
    );
  }
  return unique as McpOAuthScope[];
}

export function isValidPkceS256Challenge(value: string): boolean {
  return PKCE_S256_CHALLENGE_RE.test(value);
}

export function membershipAuthorizesScopes(
  membership: ActiveMcpOAuthMembership | null,
  scopes: readonly string[],
  expectedAuthorizationEpoch?: string,
): boolean {
  if (!membership) return false;
  if (expectedAuthorizationEpoch && membership.authorizationEpoch !== expectedAuthorizationEpoch) {
    return false;
  }
  return (
    !scopes.includes('agent:ask') || membership.role === 'owner' || membership.role === 'admin'
  );
}

export function sameScopes(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((scope) => right.includes(scope));
}

export function pkceMatches(verifier: string, challenge: string): boolean {
  if (!PKCE_VERIFIER_RE.test(verifier)) return false;
  const actual = Buffer.from(createHash('sha256').update(verifier).digest('base64url'));
  const expected = Buffer.from(challenge);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function tokenResponse(input: {
  access: string;
  refresh: string;
  scopes: string[];
  resource: string;
}): OAuthTokenResponse {
  return {
    access_token: input.access,
    token_type: 'Bearer',
    expires_in: Math.floor(ACCESS_TOKEN_TTL_MS / 1_000),
    refresh_token: input.refresh,
    scope: input.scopes.join(' '),
    resource: input.resource,
  };
}

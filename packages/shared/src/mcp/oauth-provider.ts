import { createHash, randomBytes } from 'node:crypto';

import { validateMcpUrl } from './auth.js';

// Phase 11 — MCP OAuth client (per the MCP authorization spec).
//
// Implements just the bits we actually need: discovery, optional dynamic
// client registration, the PKCE authorize redirect, and the code-exchange.
// Token refresh is done at request time inside the client manager.
//
// Reference: https://modelcontextprotocol.io/specification/2024-11-05/basic/authorization

export interface OAuthDiscovery {
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  scopes_supported?: string[];
  code_challenge_methods_supported?: string[];
}

export interface OAuthClientInfo {
  client_id: string;
  client_secret?: string;
  client_id_issued_at?: number;
  client_secret_expires_at?: number;
}

export interface PreregisteredClient {
  clientId: string;
  clientSecret?: string;
  /**
   * Match by the resource server's origin (https://api.linear.app). When
   * the MCP server URL begins with this origin, we use the pre-registered
   * client info instead of dynamic registration.
   */
  origin: string;
}

export interface OAuthTokenSet {
  access_token: string;
  refresh_token?: string;
  token_type?: string;
  scope?: string;
  expires_in?: number;
  expires_at?: number;
}

const PREREGISTERED: PreregisteredClient[] = [];

/**
 * Read pre-registered MCP OAuth clients from env. Format:
 *   MCP_PREREGISTERED_<NAME>_ORIGIN=https://...
 *   MCP_PREREGISTERED_<NAME>_CLIENT_ID=...
 *   MCP_PREREGISTERED_<NAME>_CLIENT_SECRET=... (optional for public clients)
 *
 * Called lazily so adding a server doesn't require restart.
 */
export function listPreregisteredClients(): PreregisteredClient[] {
  if (PREREGISTERED.length > 0) return PREREGISTERED;
  const seen = new Set<string>();
  for (const key of Object.keys(process.env)) {
    const m = /^MCP_PREREGISTERED_([A-Z0-9_]+)_ORIGIN$/.exec(key);
    if (!m) continue;
    const name = m[1];
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const origin = process.env[`MCP_PREREGISTERED_${name}_ORIGIN`];
    const clientId = process.env[`MCP_PREREGISTERED_${name}_CLIENT_ID`];
    const clientSecret = process.env[`MCP_PREREGISTERED_${name}_CLIENT_SECRET`];
    if (!origin || !clientId) continue;
    const entry: PreregisteredClient = { origin, clientId };
    if (clientSecret) entry.clientSecret = clientSecret;
    PREREGISTERED.push(entry);
  }
  return PREREGISTERED;
}

export function findPreregisteredClient(serverUrl: string): PreregisteredClient | null {
  let parsed: URL;
  try {
    parsed = new URL(serverUrl);
  } catch {
    return null;
  }
  const origin = parsed.origin;
  for (const c of listPreregisteredClients()) {
    if (origin === c.origin || serverUrl.startsWith(c.origin)) return c;
  }
  return null;
}

/**
 * Resolve the OAuth authorization server endpoints for a given MCP server
 * URL. Tries the standard well-known paths described in the MCP authorization
 * spec, with the resource server's own origin as the discovery base.
 */
export async function discoverOAuth(serverUrl: string): Promise<OAuthDiscovery> {
  const parsed = new URL(serverUrl);
  const candidates = [
    `${parsed.origin}/.well-known/oauth-authorization-server`,
    // RFC 9728 — Protected Resource Metadata. Many MCP servers point at a
    // separate auth server; we resolve the auth server URL here and re-fetch
    // the AS metadata.
    `${parsed.origin}/.well-known/oauth-protected-resource`,
  ];
  let lastErr: unknown;
  // redirect: 'manual' across every outbound fetch in this file — a 3xx
  // could point at a link-local / private target that the original
  // validateMcpUrl check passed but the redirect destination wouldn't.
  for (const url of candidates) {
    try {
      const res = await fetch(url, {
        headers: { accept: 'application/json' },
        redirect: 'manual',
      });
      if (!res.ok) continue;
      const body = (await res.json()) as Record<string, unknown>;
      // Protected-resource metadata points at the authorization server.
      if (
        typeof body.authorization_servers === 'object' &&
        Array.isArray(body.authorization_servers)
      ) {
        const asUrl = body.authorization_servers[0] as string | undefined;
        if (asUrl) {
          // SSRF guard: the AS URL came from the resource server's
          // metadata response — an attacker-controlled MCP server could
          // point this at AWS IMDS (169.254.169.254), private IPs, or
          // localhost. Apply the same validator we use on user-supplied
          // mcp_servers.url.
          const ssrfErr = validateMcpUrl(asUrl);
          if (ssrfErr) {
            throw new Error(`OAuth discovery rejected authorization_server URL: ${ssrfErr}`);
          }
          const asRes = await fetch(`${asUrl}/.well-known/oauth-authorization-server`, {
            headers: { accept: 'application/json' },
            redirect: 'manual',
          });
          if (asRes.ok) return (await asRes.json()) as OAuthDiscovery;
        }
      }
      if (typeof body.authorization_endpoint === 'string') {
        return body as unknown as OAuthDiscovery;
      }
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(
    `OAuth discovery failed for ${serverUrl}${lastErr instanceof Error ? `: ${lastErr.message}` : ''}`,
  );
}

/**
 * Dynamic client registration per RFC 7591. Returns the issued client info,
 * which the caller persists encrypted in `mcp_oauth_tokens.client_info_*`.
 */
export async function registerClient(
  registrationEndpoint: string,
  redirectUri: string,
  clientName: string,
): Promise<OAuthClientInfo> {
  // Same SSRF posture as buildAuthorizeUrl / exchangeCode / refreshToken —
  // a malicious MCP server could advertise a private-IP registration_endpoint
  // and force this backend to POST to internal infra.
  const ssrfErr = validateMcpUrl(registrationEndpoint);
  if (ssrfErr) throw new Error(`OAuth registration_endpoint rejected: ${ssrfErr}`);
  const res = await fetch(registrationEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      client_name: clientName,
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      application_type: 'web',
    }),
    redirect: 'manual',
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`MCP DCR ${String(res.status)}: ${text.slice(0, 200)}`);
  }
  return JSON.parse(text) as OAuthClientInfo;
}

export function generatePkcePair(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = randomBytes(32).toString('base64url');
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
  return { codeVerifier, codeChallenge };
}

export interface BuildAuthorizeUrlInput {
  discovery: OAuthDiscovery;
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  scopes?: string[];
}

export function buildAuthorizeUrl(input: BuildAuthorizeUrlInput): string {
  const ssrfErr = validateMcpUrl(input.discovery.authorization_endpoint);
  if (ssrfErr) {
    throw new Error(`OAuth authorization_endpoint rejected: ${ssrfErr}`);
  }
  const url = new URL(input.discovery.authorization_endpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', input.clientId);
  url.searchParams.set('redirect_uri', input.redirectUri);
  url.searchParams.set('state', input.state);
  url.searchParams.set('code_challenge', input.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  if (input.scopes && input.scopes.length > 0) {
    url.searchParams.set('scope', input.scopes.join(' '));
  }
  return url.toString();
}

export interface ExchangeCodeInput {
  discovery: OAuthDiscovery;
  code: string;
  redirectUri: string;
  clientId: string;
  clientSecret?: string;
  codeVerifier: string;
}

export async function exchangeCode(input: ExchangeCodeInput): Promise<OAuthTokenSet> {
  const ssrfErr = validateMcpUrl(input.discovery.token_endpoint);
  if (ssrfErr) throw new Error(`OAuth token_endpoint rejected: ${ssrfErr}`);
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: input.code,
    redirect_uri: input.redirectUri,
    client_id: input.clientId,
    code_verifier: input.codeVerifier,
  });
  if (input.clientSecret) body.set('client_secret', input.clientSecret);
  const res = await fetch(input.discovery.token_endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
    },
    body: body.toString(),
    redirect: 'manual',
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`MCP token exchange ${String(res.status)}: ${text.slice(0, 200)}`);
  }
  const parsed = JSON.parse(text) as OAuthTokenSet;
  if (!parsed.access_token) throw new Error('MCP token exchange returned no access_token');
  if (parsed.expires_in && !parsed.expires_at) {
    parsed.expires_at = Date.now() + parsed.expires_in * 1000;
  }
  return parsed;
}

export interface RefreshTokenInput {
  discovery: OAuthDiscovery;
  refreshToken: string;
  clientId: string;
  clientSecret?: string;
}

export async function refreshToken(input: RefreshTokenInput): Promise<OAuthTokenSet> {
  const ssrfErr = validateMcpUrl(input.discovery.token_endpoint);
  if (ssrfErr) throw new Error(`OAuth token_endpoint rejected: ${ssrfErr}`);
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: input.refreshToken,
    client_id: input.clientId,
  });
  if (input.clientSecret) body.set('client_secret', input.clientSecret);
  const res = await fetch(input.discovery.token_endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
    },
    body: body.toString(),
    redirect: 'manual',
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`MCP token refresh ${String(res.status)}: ${text.slice(0, 200)}`);
  }
  const parsed = JSON.parse(text) as OAuthTokenSet;
  if (!parsed.access_token) throw new Error('MCP token refresh returned no access_token');
  if (parsed.expires_in && !parsed.expires_at) {
    parsed.expires_at = Date.now() + parsed.expires_in * 1000;
  }
  return parsed;
}

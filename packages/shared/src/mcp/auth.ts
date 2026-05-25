import { decryptJson } from '../crypto/secrets.js';

import type { mcpServers as mcpServersTable } from '@timeline/db';

export type McpServerRow = typeof mcpServersTable.$inferSelect;

// Phase 11 — Build the auth headers and URL for an MCP server based on
// its row in `mcp_servers`. Mirrors Vernix's `auth.ts` but team-scoped
// and reads from the AES-256-GCM ciphertext columns.

export interface BearerAuth {
  token: string;
}
export interface HeaderAuth {
  name: string;
  value: string;
}
export interface BasicAuth {
  username: string;
  password: string;
}
export interface UrlKeyAuth {
  paramName: string;
  value: string;
}

export type McpAuthConfig =
  | BearerAuth
  | HeaderAuth
  | BasicAuth
  | UrlKeyAuth
  | Record<string, never>;

function decryptAuthConfig(server: McpServerRow): McpAuthConfig | null {
  if (!server.authConfigCiphertext || !server.authConfigIv || !server.authConfigTag) {
    return null;
  }
  return decryptJson({
    ciphertext: server.authConfigCiphertext,
    iv: server.authConfigIv,
    tag: server.authConfigTag,
  }) as McpAuthConfig;
}

export interface BuiltAuth {
  headers: Record<string, string>;
  url: string;
}

export function buildAuth(server: McpServerRow, oauthAccessToken?: string | null): BuiltAuth {
  const headers: Record<string, string> = {};
  let url = server.url;
  switch (server.authType) {
    case 'bearer': {
      const cfg = decryptAuthConfig(server) as BearerAuth | null;
      if (cfg?.token) headers.authorization = `Bearer ${cfg.token}`;
      break;
    }
    case 'header': {
      const cfg = decryptAuthConfig(server) as HeaderAuth | null;
      if (cfg?.name && cfg.value) headers[cfg.name] = cfg.value;
      break;
    }
    case 'basic': {
      const cfg = decryptAuthConfig(server) as BasicAuth | null;
      if (cfg?.username) {
        const enc = Buffer.from(`${cfg.username}:${cfg.password}`).toString('base64');
        headers.authorization = `Basic ${enc}`;
      }
      break;
    }
    case 'url_key': {
      const cfg = decryptAuthConfig(server) as UrlKeyAuth | null;
      if (cfg?.paramName && cfg.value) {
        const parsed = new URL(url);
        parsed.searchParams.set(cfg.paramName, cfg.value);
        url = parsed.toString();
      }
      break;
    }
    case 'oauth': {
      if (oauthAccessToken) headers.authorization = `Bearer ${oauthAccessToken}`;
      break;
    }
    case 'none':
    default:
      break;
  }
  return { headers, url };
}

/**
 * SSRF guard. Reject URLs that target private IP ranges or loopback,
 * unless `NODE_ENV !== 'production'` (dev can hit localhost). Returns
 * null on OK, error string when rejected.
 */
export function validateMcpUrl(rawUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return 'Invalid URL';
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return 'URL must use http or https';
  }
  const host = parsed.hostname.toLowerCase();
  if (process.env.NODE_ENV === 'production') {
    if (parsed.protocol === 'http:') return 'http:// not allowed in production (use https)';
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') {
      return 'Loopback hosts not allowed';
    }
    if (host.endsWith('.local') || host.endsWith('.internal')) {
      return 'Internal hosts not allowed';
    }
    // Block obvious private ranges. Full IP-range checking is left to the
    // upstream firewall; this catches the easy cases.
    if (
      host.startsWith('10.') ||
      host.startsWith('192.168.') ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
    ) {
      return 'Private IP ranges not allowed';
    }
    // RFC 3927 link-local (169.254.0.0/16) — same range as AWS / GCP /
    // Azure metadata (169.254.169.254). Without this block, a team
    // admin could register the cloud metadata endpoint as an MCP URL
    // and later OAuth/RPC fetches would credential-leak through it.
    if (host.startsWith('169.254.')) {
      return 'Link-local addresses not allowed';
    }
    // IPv6 link-local (fe80::/10) and unique-local (fc00::/7). URL host
    // strips outer brackets so we match on the leading bytes.
    if (host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd')) {
      return 'IPv6 link-local / unique-local addresses not allowed';
    }
  }
  return null;
}

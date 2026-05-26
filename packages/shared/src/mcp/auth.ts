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
/**
 * Normalize any numeric IPv4-ish hostname (dotted quad, decimal, octal,
 * hex, or 1-/2-/3-part shorthand) to canonical `a.b.c.d` form. Returns
 * `null` for hostnames that aren't a numeric IPv4 representation
 * (regular DNS names, IPv6, malformed input).
 *
 * Why: a hostname like `2852039166` is the decimal encoding of
 * 169.254.169.254 (AWS/GCP/Azure metadata). Node's `fetch` resolves it
 * via the OS resolver which accepts all five forms — so a string-prefix
 * check on the raw hostname misses it. We re-emit the canonical
 * dotted-quad and run every check below against THAT.
 */
function normalizeNumericIpv4(host: string): string | null {
  // Reject anything with non-IPv4-ish characters first.
  if (!/^[0-9a-fx.]+$/i.test(host)) return null;
  const parts = host.split('.');
  if (parts.length > 4 || parts.length < 1) return null;
  const nums: number[] = [];
  for (const p of parts) {
    if (p === '') return null;
    let n: number;
    if (/^0x[0-9a-f]+$/i.test(p)) n = Number.parseInt(p.slice(2), 16);
    else if (/^0[0-7]+$/.test(p)) n = Number.parseInt(p, 8);
    else if (/^[0-9]+$/.test(p)) n = Number.parseInt(p, 10);
    else return null;
    if (!Number.isFinite(n) || n < 0) return null;
    nums.push(n);
  }
  // Per inet_aton: 1 part = 32-bit int; 2 parts = a.bbb (24-bit); 3 parts
  // = a.b.cc (16-bit); 4 parts = a.b.c.d.
  const [a, b, c, d] = nums;
  let packed: number;
  if (a === undefined) return null;
  if (nums.length === 1) {
    if (a > 0xffffffff) return null;
    packed = a;
  } else if (nums.length === 2) {
    if (b === undefined || a > 0xff || b > 0xffffff) return null;
    packed = (a << 24) | b;
  } else if (nums.length === 3) {
    if (b === undefined || c === undefined || a > 0xff || b > 0xff || c > 0xffff) return null;
    packed = (a << 24) | (b << 16) | c;
  } else {
    if (b === undefined || c === undefined || d === undefined) return null;
    if (a > 0xff || b > 0xff || c > 0xff || d > 0xff) return null;
    packed = ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
  }
  return [
    (packed >>> 24) & 0xff,
    (packed >>> 16) & 0xff,
    (packed >>> 8) & 0xff,
    packed & 0xff,
  ].join('.');
}

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
  const rawHost = parsed.hostname.toLowerCase();
  // If the host parses as a numeric IPv4 (any form: decimal, octal, hex,
  // shorthand), re-emit it as a dotted-quad so the range checks below
  // catch encoded metadata addresses like 2852039166 (= 169.254.169.254).
  const host = normalizeNumericIpv4(rawHost) ?? rawHost;
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

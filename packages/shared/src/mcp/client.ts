import { type Db, mcpOauthTokens, mcpServers } from '@timeline/db';
import { and, eq } from 'drizzle-orm';

import { decryptJson, encryptJson } from '../crypto/secrets.js';
import { childLogger } from '../logger.js';

import { buildAuth } from './auth.js';
import { discoverOAuth, refreshToken as oauthRefreshToken } from './oauth-provider.js';
import { namespaceToolName } from './tool-namespace.js';

import type { McpServerRow } from './auth.js';

// Phase 11 — Minimal MCP-over-HTTP client. The full
// @modelcontextprotocol/sdk supports stdio, SSE, and WebSocket transports;
// custom MCP servers connected by users are almost always HTTPS endpoints
// speaking JSON-RPC 2.0 with either request/response or streamable HTTP
// (per the 2024-11 MCP spec). This client handles the streamable-HTTP
// shape: every request is a POST whose response is either a JSON body
// (request/response) or an SSE stream (notifications). We use the JSON
// body shape exclusively for `tools/list` and `tools/call`, which the
// spec guarantees works for every compliant server.
//
// The team-scoped `McpClientManager` caches a discovered tool list per
// team for 5 minutes, mirroring Vernix's behavior.

const log = childLogger('mcp:client');

/**
 * Thrown when an OAuth-backed MCP server's tokens have expired and the
 * refresh attempt failed (revoked, server rotated client, etc). The chat
 * UI catches this and renders an inline "Reconnect <server>" CTA so the
 * user can re-authorize without leaving the conversation.
 */
export class McpNeedsReauthError extends Error {
  readonly code = 'needs_reauth' as const;
  constructor(
    readonly serverId: string,
    readonly serverName: string,
  ) {
    super(`MCP server ${serverName} needs reconnection`);
    this.name = 'McpNeedsReauthError';
  }
}

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface DiscoveredTool extends McpTool {
  serverId: string;
  serverName: string;
  /** `mcp__<serverIdCompact>__<toolName>`. */
  namespacedName: string;
}

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

async function rpc(
  url: string,
  headers: Record<string, string>,
  method: string,
  params: unknown,
): Promise<unknown> {
  const id = Date.now() + Math.floor(Math.random() * 1000);
  const body: JsonRpcRequest = { jsonrpc: '2.0', id, method, params };
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`MCP ${method} ${String(res.status)}: ${text.slice(0, 200)}`);
  }
  // The streamable-HTTP transport may return SSE; for simple JSON the
  // response is a single JSON document. Detect by content-type.
  const ct = res.headers.get('content-type') ?? '';
  if (ct.includes('application/json')) {
    const parsed = JSON.parse(text) as JsonRpcResponse;
    if (parsed.error)
      throw new Error(`MCP ${method} error ${String(parsed.error.code)}: ${parsed.error.message}`);
    return parsed.result;
  }
  // SSE fallback: parse the last `data:` chunk as JSON.
  const lines = text.split('\n');
  let lastData: string | undefined;
  for (const line of lines) {
    if (line.startsWith('data:')) lastData = line.slice('data:'.length).trim();
  }
  if (!lastData) throw new Error(`MCP ${method}: SSE response had no data frame`);
  const parsed = JSON.parse(lastData) as JsonRpcResponse;
  if (parsed.error)
    throw new Error(`MCP ${method} error ${String(parsed.error.code)}: ${parsed.error.message}`);
  return parsed.result;
}

interface StoredOauthTokens {
  accessToken?: string;
  refreshToken?: string;
  tokenType?: string;
  scope?: string;
  expiresAt?: number;
}

// 60-second skew — refresh slightly ahead of expiry so concurrent in-flight
// tool calls don't hit a 401 race on the resource server side.
const REFRESH_SKEW_MS = 60 * 1000;

// Per-(team, server) pending refresh map so two concurrent tool calls don't
// race two refresh roundtrips and stomp each other's tokens.
const pendingRefresh = new Map<string, Promise<string | null>>();

async function loadOauthAccessToken(
  db: Db,
  teamId: string,
  serverId: string,
  serverUrl: string,
): Promise<string | null> {
  const rows = await db
    .select()
    .from(mcpOauthTokens)
    .where(and(eq(mcpOauthTokens.teamId, teamId), eq(mcpOauthTokens.mcpServerId, serverId)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  let tokens: StoredOauthTokens;
  try {
    tokens = decryptJson({
      ciphertext: row.tokenCiphertext,
      iv: row.tokenIv,
      tag: row.tokenTag,
    }) as StoredOauthTokens;
  } catch (err) {
    log.warn({ err, serverId }, 'failed to decrypt MCP oauth tokens');
    return null;
  }
  const expiresAt =
    typeof tokens.expiresAt === 'number'
      ? tokens.expiresAt
      : row.expiresAt
        ? row.expiresAt.getTime()
        : undefined;
  // Fast path: still valid, no refresh needed.
  if (!expiresAt || Date.now() < expiresAt - REFRESH_SKEW_MS) {
    return tokens.accessToken ?? null;
  }
  // Expired (or near-expiry) and we have a refresh token + persisted client
  // info — try a refresh. Without a refresh token we can only return the
  // stale access token and let the resource server 401 us into a
  // needs_reauth surface.
  const refreshTokenStr = tokens.refreshToken;
  const clientCiphertext = row.clientInfoCiphertext;
  const clientIv = row.clientInfoIv;
  const clientTag = row.clientInfoTag;
  if (!refreshTokenStr || !clientCiphertext || !clientIv || !clientTag) {
    return tokens.accessToken ?? null;
  }
  const lockKey = `${teamId}:${serverId}`;
  const inflight = pendingRefresh.get(lockKey);
  if (inflight) return inflight;
  const p = (async (): Promise<string | null> => {
    try {
      const clientInfo = decryptJson({
        ciphertext: clientCiphertext,
        iv: clientIv,
        tag: clientTag,
      }) as { client_id?: string; client_secret?: string };
      if (!clientInfo.client_id) return tokens.accessToken ?? null;
      const discovery = await discoverOAuth(serverUrl);
      const refreshed = await oauthRefreshToken({
        discovery,
        refreshToken: refreshTokenStr,
        clientId: clientInfo.client_id,
        ...(clientInfo.client_secret ? { clientSecret: clientInfo.client_secret } : {}),
      });
      const nextExpiresAtMs =
        typeof refreshed.expires_at === 'number'
          ? refreshed.expires_at
          : refreshed.expires_in
            ? Date.now() + refreshed.expires_in * 1000
            : undefined;
      // Some servers rotate the refresh token; otherwise reuse the old one.
      const nextRefresh = refreshed.refresh_token ?? tokens.refreshToken;
      const nextScope = refreshed.scope ?? tokens.scope;
      const nextTokens: StoredOauthTokens = {
        accessToken: refreshed.access_token,
        tokenType: refreshed.token_type ?? tokens.tokenType ?? 'Bearer',
        ...(nextRefresh ? { refreshToken: nextRefresh } : {}),
        ...(nextScope ? { scope: nextScope } : {}),
        ...(nextExpiresAtMs ? { expiresAt: nextExpiresAtMs } : {}),
      };
      const enc = encryptJson(nextTokens);
      await db
        .update(mcpOauthTokens)
        .set({
          tokenCiphertext: enc.ciphertext,
          tokenIv: enc.iv,
          tokenTag: enc.tag,
          expiresAt: nextExpiresAtMs ? new Date(nextExpiresAtMs) : null,
          updatedAt: new Date(),
        })
        .where(and(eq(mcpOauthTokens.teamId, teamId), eq(mcpOauthTokens.mcpServerId, serverId)));
      await db
        .update(mcpServers)
        .set({ lastError: null, updatedAt: new Date() })
        .where(eq(mcpServers.id, serverId));
      return refreshed.access_token;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn({ err, serverId }, 'MCP oauth refresh failed');
      await db
        .update(mcpServers)
        .set({ lastError: `oauth_refresh_failed: ${msg.slice(0, 200)}`, updatedAt: new Date() })
        .where(eq(mcpServers.id, serverId));
      return null;
    } finally {
      pendingRefresh.delete(lockKey);
    }
  })();
  pendingRefresh.set(lockKey, p);
  return p;
}

export interface CachedTeamTools {
  tools: DiscoveredTool[];
  toolMap: Map<string, { serverId: string; toolName: string }>;
  fetchedAt: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000;

export class McpClientManager {
  private static instance: McpClientManager | undefined;
  private cache = new Map<string, CachedTeamTools>();
  private pending = new Map<string, Promise<CachedTeamTools>>();

  static getInstance(): McpClientManager {
    this.instance ??= new McpClientManager();
    return this.instance;
  }

  invalidate(teamId: string): void {
    this.cache.delete(teamId);
  }

  async connectForTeam(db: Db, teamId: string): Promise<CachedTeamTools> {
    const cached = this.cache.get(teamId);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached;
    const pending = this.pending.get(teamId);
    if (pending) return pending;
    const p = this.refresh(db, teamId).finally(() => {
      this.pending.delete(teamId);
    });
    this.pending.set(teamId, p);
    return p;
  }

  private async refresh(db: Db, teamId: string): Promise<CachedTeamTools> {
    const servers = await db
      .select()
      .from(mcpServers)
      .where(and(eq(mcpServers.teamId, teamId), eq(mcpServers.enabled, true)));
    const allTools: DiscoveredTool[] = [];
    const toolMap = new Map<string, { serverId: string; toolName: string }>();
    for (const server of servers) {
      try {
        const tools = await this.discoverTools(db, server);
        for (const t of tools) {
          const namespaced = namespaceToolName(server.id, t.name);
          const discovered: DiscoveredTool = {
            ...t,
            serverId: server.id,
            serverName: server.name,
            namespacedName: namespaced,
          };
          allTools.push(discovered);
          toolMap.set(namespaced, { serverId: server.id, toolName: t.name });
        }
        // Update the cached_tools column for the UI.
        await db
          .update(mcpServers)
          .set({
            cachedTools: tools.map((t) => ({ name: t.name, description: t.description ?? '' })),
            toolsCachedAt: new Date(),
            lastConnectedAt: new Date(),
            lastError: null,
            updatedAt: new Date(),
          })
          .where(eq(mcpServers.id, server.id));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.warn({ err, serverId: server.id }, 'MCP discovery failed');
        await db
          .update(mcpServers)
          .set({ lastError: msg, updatedAt: new Date() })
          .where(eq(mcpServers.id, server.id));
      }
    }
    const entry: CachedTeamTools = { tools: allTools, toolMap, fetchedAt: Date.now() };
    this.cache.set(teamId, entry);
    return entry;
  }

  async discoverTools(db: Db, server: McpServerRow): Promise<McpTool[]> {
    const oauth =
      server.authType === 'oauth'
        ? await loadOauthAccessToken(db, server.teamId, server.id, server.url)
        : null;
    const { headers, url } = buildAuth(server, oauth);
    const disabled = new Set(
      Array.isArray(server.disabledTools) ? (server.disabledTools as string[]) : [],
    );
    // Initialize handshake — required by spec but many servers tolerate
    // a missing initialize and answer tools/list directly. Try-and-fall-back.
    try {
      await rpc(url, headers, 'initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'timeline', version: '0.1.0' },
      });
    } catch (err) {
      log.debug({ err }, 'initialize failed (non-fatal)');
    }
    const result = (await rpc(url, headers, 'tools/list', {})) as { tools?: McpTool[] };
    return (result.tools ?? []).filter((t) => !disabled.has(t.name));
  }

  async callTool(
    db: Db,
    teamId: string,
    namespacedName: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const cached = await this.connectForTeam(db, teamId);
    const mapping = cached.toolMap.get(namespacedName);
    if (!mapping) throw new Error(`MCP tool not found: ${namespacedName}`);
    const rows = await db
      .select()
      .from(mcpServers)
      .where(and(eq(mcpServers.id, mapping.serverId), eq(mcpServers.teamId, teamId)))
      .limit(1);
    const server = rows[0];
    if (!server) throw new Error('MCP server not found');
    const oauth =
      server.authType === 'oauth'
        ? await loadOauthAccessToken(db, teamId, server.id, server.url)
        : null;
    if (server.authType === 'oauth' && !oauth) {
      // Refresh failed (token revoked, server rotated client, etc). Surface
      // a typed error the chat UI can recognize and render an inline
      // "Reconnect <server>" CTA instead of a generic failure toast.
      throw new McpNeedsReauthError(server.id, server.name);
    }
    const { headers, url } = buildAuth(server, oauth);
    return rpc(url, headers, 'tools/call', { name: mapping.toolName, arguments: args });
  }
}

export function getMcpManager(): McpClientManager {
  return McpClientManager.getInstance();
}

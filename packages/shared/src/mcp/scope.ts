import { type Db, auditLog, mcpOauthTokens, mcpServers } from '@timeline/db';
import { and, desc, eq, isNull, or } from 'drizzle-orm';

import { decryptJson, encryptJson } from '#src/crypto/secrets.js';
import { validateMcpUrl, type McpAuthConfig } from '#src/mcp/auth.js';
import { getMcpManager } from '#src/mcp/client.js';

// Phase 11 — Team-scoped CRUD for custom MCP servers. Mirrors the rest
// of the codebase's `withTeam` style: every method first checks
// membership via the injected `ensureMember` and never accepts a foreign
// team_id.

export interface AddMcpServerInput {
  name: string;
  url: string;
  authType: 'none' | 'bearer' | 'header' | 'basic' | 'oauth' | 'url_key';
  authConfig?: McpAuthConfig | null;
  /**
   * Phase 11 overlay: `'team'` puts the server in the team catalog (admin
   * only). `'personal'` keys it to the calling user — visible only to
   * them, and they don't need to be an admin to add it. Defaults to
   * `'team'` to preserve pre-overlay callers' behavior.
   */
  ownership?: 'team' | 'personal';
}

export function createMcpScope(deps: {
  db: Db;
  teamId: string;
  userId: string;
  ensureMember: (minRole?: 'member' | 'admin' | 'owner') => Promise<unknown>;
}) {
  const { db, teamId, userId, ensureMember } = deps;

  // Visibility predicate: team-shared rows are visible to every member;
  // personal rows are visible only to their owner. Used everywhere we
  // surface a server's existence to the caller (list, get, callTool).
  const visibilityClause = or(isNull(mcpServers.userId), eq(mcpServers.userId, userId));

  async function listServers() {
    await ensureMember();
    return db
      .select()
      .from(mcpServers)
      .where(and(eq(mcpServers.teamId, teamId), visibilityClause))
      .orderBy(desc(mcpServers.createdAt));
  }

  async function listTeamServers() {
    await ensureMember();
    return db
      .select()
      .from(mcpServers)
      .where(and(eq(mcpServers.teamId, teamId), isNull(mcpServers.userId)))
      .orderBy(desc(mcpServers.createdAt));
  }

  async function listPersonalServers() {
    await ensureMember();
    return db
      .select()
      .from(mcpServers)
      .where(and(eq(mcpServers.teamId, teamId), eq(mcpServers.userId, userId)))
      .orderBy(desc(mcpServers.createdAt));
  }

  async function getServer(id: string) {
    await ensureMember();
    const rows = await db
      .select()
      .from(mcpServers)
      .where(and(eq(mcpServers.id, id), eq(mcpServers.teamId, teamId), visibilityClause))
      .limit(1);
    return rows[0] ?? null;
  }

  async function addServer(input: AddMcpServerInput) {
    const ownership = input.ownership ?? 'team';
    if (ownership === 'team') {
      // Team catalog is admin-only. Personal entries belong to the caller
      // so any member can add them.
      await ensureMember('admin');
    } else {
      await ensureMember();
    }
    const urlErr = validateMcpUrl(input.url);
    if (urlErr) throw new Error(urlErr);
    let enc: ReturnType<typeof encryptJson> | undefined;
    if (input.authConfig && input.authType !== 'none' && input.authType !== 'oauth') {
      enc = encryptJson(input.authConfig);
    }
    // OAuth servers start disabled — the callback flips them on once tokens land.
    const enabled = input.authType !== 'oauth';
    const row = await db.transaction(async (tx) => {
      const rows = await tx
        .insert(mcpServers)
        .values({
          teamId,
          userId: ownership === 'personal' ? userId : null,
          addedByUserId: userId,
          name: input.name,
          url: input.url,
          authType: input.authType,
          authConfigCiphertext: enc?.ciphertext ?? null,
          authConfigIv: enc?.iv ?? null,
          authConfigTag: enc?.tag ?? null,
          enabled,
        })
        .returning();
      const created = rows[0];
      if (!created) throw new Error('Failed to add MCP server');
      await tx.insert(auditLog).values({
        teamId,
        actorUserId: userId,
        action: 'mcp.connect',
        targetType: 'mcp_server',
        targetId: created.id,
        targetVisibility: created.userId ? 'private' : 'team',
        targetOwnerUserId: created.userId,
        metadata: { auth_type: created.authType, ownership },
      });
      return created;
    });
    getMcpManager().invalidate(`${teamId}:${userId}`);
    getMcpManager().invalidate(teamId);
    return row;
  }

  async function updateServer(
    id: string,
    patch: {
      name?: string;
      enabled?: boolean;
      disabledTools?: string[];
      authConfig?: McpAuthConfig | null;
    },
  ) {
    const existing = await getServer(id);
    if (!existing) throw new Error('MCP server not found');
    // Personal rows: only the owner can update. Team rows: admin only.
    if (existing.userId) {
      if (existing.userId !== userId) throw new Error('forbidden');
      await ensureMember();
    } else {
      await ensureMember('admin');
    }
    const updates: Partial<typeof mcpServers.$inferInsert> & { updatedAt: Date } = {
      updatedAt: new Date(),
    };
    if (patch.name !== undefined) updates.name = patch.name;
    if (patch.enabled !== undefined) updates.enabled = patch.enabled;
    if (patch.disabledTools !== undefined) updates.disabledTools = patch.disabledTools;
    if (patch.authConfig !== undefined) {
      if (patch.authConfig === null) {
        updates.authConfigCiphertext = null;
        updates.authConfigIv = null;
        updates.authConfigTag = null;
      } else {
        const enc = encryptJson(patch.authConfig);
        updates.authConfigCiphertext = enc.ciphertext;
        updates.authConfigIv = enc.iv;
        updates.authConfigTag = enc.tag;
      }
    }
    await db.transaction(async (tx) => {
      const rows = await tx
        .update(mcpServers)
        .set(updates)
        .where(and(eq(mcpServers.id, id), eq(mcpServers.teamId, teamId)))
        .returning({ id: mcpServers.id });
      if (!rows[0]) throw new Error('MCP server not found');
      await tx.insert(auditLog).values({
        teamId,
        actorUserId: userId,
        action: 'mcp.settings_change',
        targetType: 'mcp_server',
        targetId: id,
        targetVisibility: existing.userId ? 'private' : 'team',
        targetOwnerUserId: existing.userId,
        metadata: {
          fields: Object.keys(patch).filter((key) => key !== 'authConfig'),
          auth_config_changed: patch.authConfig !== undefined,
        },
      });
    });
    getMcpManager().invalidate(teamId);
    getMcpManager().invalidate(`${teamId}:${userId}`);
  }

  async function deleteServer(id: string) {
    const existing = await getServer(id);
    if (!existing) throw new Error('MCP server not found');
    if (existing.userId) {
      if (existing.userId !== userId) throw new Error('forbidden');
      await ensureMember();
    } else {
      await ensureMember('admin');
    }
    await db.transaction(async (tx) => {
      await tx.delete(mcpServers).where(and(eq(mcpServers.id, id), eq(mcpServers.teamId, teamId)));
      await tx.insert(auditLog).values({
        teamId,
        actorUserId: userId,
        action: 'mcp.disconnect',
        targetType: 'mcp_server',
        targetId: id,
        targetVisibility: existing.userId ? 'private' : 'team',
        targetOwnerUserId: existing.userId,
        metadata: {
          auth_type: existing.authType,
          ownership: existing.userId ? 'personal' : 'team',
        },
      });
    });
    getMcpManager().invalidate(teamId);
    getMcpManager().invalidate(`${teamId}:${userId}`);
  }

  async function persistOauthTokens(
    mcpServerId: string,
    tokens: Record<string, unknown>,
    expiresAt: Date | null,
    opts: { clientInfo?: Record<string, unknown>; codeVerifier?: string | null } = {},
  ) {
    const server = await getServer(mcpServerId);
    if (!server) throw new Error('MCP server not found');
    // Personal server (user_id set): only the owner persists tokens. Team
    // server (user_id null): admin required. Matches updateServer /
    // deleteServer / persistOauthPending so the OAuth flow doesn't
    // fight itself for non-admin owners of personal MCPs.
    if (server.userId) {
      if (server.userId !== userId) throw new Error('forbidden');
      await ensureMember();
    } else {
      await ensureMember('admin');
    }
    const enc = encryptJson(tokens);
    const clientEnc = opts.clientInfo ? encryptJson(opts.clientInfo) : undefined;
    await db.transaction(async (tx) => {
      await tx
        .insert(mcpOauthTokens)
        .values({
          teamId,
          mcpServerId,
          tokenCiphertext: enc.ciphertext,
          tokenIv: enc.iv,
          tokenTag: enc.tag,
          expiresAt,
          clientInfoCiphertext: clientEnc?.ciphertext ?? null,
          clientInfoIv: clientEnc?.iv ?? null,
          clientInfoTag: clientEnc?.tag ?? null,
          codeVerifier: opts.codeVerifier ?? null,
        })
        .onConflictDoUpdate({
          target: [mcpOauthTokens.teamId, mcpOauthTokens.mcpServerId],
          set: {
            tokenCiphertext: enc.ciphertext,
            tokenIv: enc.iv,
            tokenTag: enc.tag,
            expiresAt,
            ...(clientEnc
              ? {
                  clientInfoCiphertext: clientEnc.ciphertext,
                  clientInfoIv: clientEnc.iv,
                  clientInfoTag: clientEnc.tag,
                }
              : {}),
            ...(opts.codeVerifier !== undefined ? { codeVerifier: opts.codeVerifier } : {}),
            updatedAt: new Date(),
          },
        });
      await tx.insert(auditLog).values({
        teamId,
        actorUserId: userId,
        action: 'mcp.connect',
        targetType: 'mcp_server',
        targetId: mcpServerId,
        targetVisibility: server.userId ? 'private' : 'team',
        targetOwnerUserId: server.userId,
        metadata: { auth_type: server.authType, oauth: true },
      });
    });
    // Personal servers are cached under `teamId:userId`; team-shared
    // servers under just `teamId`. Invalidate both so a personal-MCP
    // owner doesn't see empty tools until the 5-min TTL expires.
    getMcpManager().invalidate(teamId);
    getMcpManager().invalidate(`${teamId}:${userId}`);
  }

  async function persistOauthPending(
    mcpServerId: string,
    codeVerifier: string,
    clientInfo: Record<string, unknown>,
  ) {
    const server = await getServer(mcpServerId);
    if (!server) throw new Error('MCP server not found');
    if (server.userId) {
      if (server.userId !== userId) throw new Error('forbidden');
      await ensureMember();
    } else {
      await ensureMember('admin');
    }
    const clientEnc = encryptJson(clientInfo);
    const placeholder = encryptJson({});
    await db
      .insert(mcpOauthTokens)
      .values({
        teamId,
        mcpServerId,
        tokenCiphertext: placeholder.ciphertext,
        tokenIv: placeholder.iv,
        tokenTag: placeholder.tag,
        clientInfoCiphertext: clientEnc.ciphertext,
        clientInfoIv: clientEnc.iv,
        clientInfoTag: clientEnc.tag,
        codeVerifier,
      })
      .onConflictDoUpdate({
        target: [mcpOauthTokens.teamId, mcpOauthTokens.mcpServerId],
        set: {
          clientInfoCiphertext: clientEnc.ciphertext,
          clientInfoIv: clientEnc.iv,
          clientInfoTag: clientEnc.tag,
          codeVerifier,
          updatedAt: new Date(),
        },
      });
  }

  async function loadOauthClientInfo(mcpServerId: string): Promise<{
    clientInfo: Record<string, unknown> | null;
    codeVerifier: string | null;
    /**
     * True once a real token blob has been persisted — i.e. callback
     * has run at least once for this server. `persistOauthPending`
     * leaves `expires_at` null; `persistOauthTokens` sets it. The
     * callback uses this to decide whether to flip `enabled: true`
     * (first connect) or leave the current admin-managed flag alone
     * (re-auth after an admin disabled).
     */
    hasExistingTokens: boolean;
  }> {
    // Mirror the gate used by persistOauthPending / persistOauthTokens:
    // personal servers are owner-only, team-shared servers are admin-only.
    // Without this, any team member could read another server's pending
    // OAuth state — including dynamically-registered client_secret and
    // PKCE code_verifier — by passing its UUID.
    const server = await getServer(mcpServerId);
    if (!server) return { clientInfo: null, codeVerifier: null, hasExistingTokens: false };
    if (server.userId) {
      if (server.userId !== userId) throw new Error('forbidden');
      await ensureMember();
    } else {
      await ensureMember('admin');
    }
    const rows = await db
      .select()
      .from(mcpOauthTokens)
      .where(and(eq(mcpOauthTokens.teamId, teamId), eq(mcpOauthTokens.mcpServerId, mcpServerId)))
      .limit(1);
    const row = rows[0];
    if (!row) return { clientInfo: null, codeVerifier: null, hasExistingTokens: false };
    // Distinguish first-connect from re-auth by peeking at the token
    // blob itself: `persistOauthPending` stores `encryptJson({})` as a
    // placeholder; `persistOauthTokens` replaces it with a blob that
    // includes `accessToken`. Using the column-level `expiresAt`
    // wouldn't work — many MCP servers (Notion, Slack, …) issue
    // non-expiring access tokens, so a successful connect leaves
    // `expiresAt` null and a later re-auth would be misclassified as
    // first connect (and silently re-enable an admin-disabled server).
    let hasExistingTokens = false;
    try {
      const tokenBlob = decryptJson({
        ciphertext: row.tokenCiphertext,
        iv: row.tokenIv,
        tag: row.tokenTag,
      }) as { accessToken?: unknown; access_token?: unknown };
      hasExistingTokens =
        typeof tokenBlob.accessToken === 'string' || typeof tokenBlob.access_token === 'string';
    } catch {
      // Corrupt blob → treat as first-connect to avoid blocking the
      // user with no recovery path. Re-enabling a disabled server in
      // this corner case is acceptable; the row is broken either way.
      hasExistingTokens = false;
    }
    let clientInfo: Record<string, unknown> | null = null;
    if (row.clientInfoCiphertext && row.clientInfoIv && row.clientInfoTag) {
      clientInfo = decryptJson({
        ciphertext: row.clientInfoCiphertext,
        iv: row.clientInfoIv,
        tag: row.clientInfoTag,
      }) as Record<string, unknown>;
    }
    return { clientInfo, codeVerifier: row.codeVerifier, hasExistingTokens };
  }

  async function discoverTools() {
    await ensureMember();
    return getMcpManager().connectForTeam(db, teamId, userId);
  }

  async function callTool(namespacedName: string, args: Record<string, unknown>) {
    await ensureMember();
    return getMcpManager().callTool(db, teamId, namespacedName, args, userId);
  }

  return {
    listServers,
    listTeamServers,
    listPersonalServers,
    getServer,
    addServer,
    updateServer,
    deleteServer,
    persistOauthTokens,
    persistOauthPending,
    loadOauthClientInfo,
    discoverTools,
    callTool,
  };
}

export type McpScope = ReturnType<typeof createMcpScope>;

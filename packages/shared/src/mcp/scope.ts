import { type Db, mcpOauthTokens, mcpServers } from '@timeline/db';
import { and, desc, eq, isNull, or } from 'drizzle-orm';

import { decryptJson, encryptJson } from '../crypto/secrets.js';

import { validateMcpUrl, type McpAuthConfig } from './auth.js';
import { getMcpManager } from './client.js';

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
    const rows = await db
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
    getMcpManager().invalidate(`${teamId}:${userId}`);
    getMcpManager().invalidate(teamId);
    const row = rows[0];
    if (!row) throw new Error('Failed to add MCP server');
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
    await db
      .update(mcpServers)
      .set(updates)
      .where(and(eq(mcpServers.id, id), eq(mcpServers.teamId, teamId)));
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
    await db.delete(mcpServers).where(and(eq(mcpServers.id, id), eq(mcpServers.teamId, teamId)));
    getMcpManager().invalidate(teamId);
    getMcpManager().invalidate(`${teamId}:${userId}`);
  }

  async function persistOauthTokens(
    mcpServerId: string,
    tokens: Record<string, unknown>,
    expiresAt: Date | null,
    opts: { clientInfo?: Record<string, unknown>; codeVerifier?: string | null } = {},
  ) {
    await ensureMember('admin');
    const server = await getServer(mcpServerId);
    if (!server) throw new Error('MCP server not found');
    const enc = encryptJson(tokens);
    const clientEnc = opts.clientInfo ? encryptJson(opts.clientInfo) : undefined;
    await db
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
    getMcpManager().invalidate(teamId);
  }

  async function persistOauthPending(
    mcpServerId: string,
    codeVerifier: string,
    clientInfo: Record<string, unknown>,
  ) {
    await ensureMember('admin');
    const server = await getServer(mcpServerId);
    if (!server) throw new Error('MCP server not found');
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

  async function loadOauthClientInfo(
    mcpServerId: string,
  ): Promise<{ clientInfo: Record<string, unknown> | null; codeVerifier: string | null }> {
    await ensureMember();
    const rows = await db
      .select()
      .from(mcpOauthTokens)
      .where(and(eq(mcpOauthTokens.teamId, teamId), eq(mcpOauthTokens.mcpServerId, mcpServerId)))
      .limit(1);
    const row = rows[0];
    if (!row) return { clientInfo: null, codeVerifier: null };
    let clientInfo: Record<string, unknown> | null = null;
    if (row.clientInfoCiphertext && row.clientInfoIv && row.clientInfoTag) {
      clientInfo = decryptJson({
        ciphertext: row.clientInfoCiphertext,
        iv: row.clientInfoIv,
        tag: row.clientInfoTag,
      }) as Record<string, unknown>;
    }
    return { clientInfo, codeVerifier: row.codeVerifier };
  }

  async function getOauthTokens(mcpServerId: string) {
    await ensureMember();
    const rows = await db
      .select()
      .from(mcpOauthTokens)
      .where(and(eq(mcpOauthTokens.teamId, teamId), eq(mcpOauthTokens.mcpServerId, mcpServerId)))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return decryptJson({
      ciphertext: row.tokenCiphertext,
      iv: row.tokenIv,
      tag: row.tokenTag,
    });
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
    getOauthTokens,
    discoverTools,
    callTool,
  };
}

export type McpScope = ReturnType<typeof createMcpScope>;

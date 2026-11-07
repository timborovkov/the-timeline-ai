import { auditLog, type Db, mcpOutboundKeys } from '@timeline/db';
import { and, desc, eq, isNull } from 'drizzle-orm';

import { mintKey } from '#src/mcp-server/keys.js';
import { mcpStaticKeyScopes } from '#src/mcp-server/oauth-core.js';

export interface McpOutboundKeyRow {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
}

export interface CreatedMcpOutboundKey extends McpOutboundKeyRow {
  plaintext: string;
}

interface McpOutboundScopeDeps {
  db: Db;
  teamId: string;
  userId: string;
  ensureMember: (minRole?: 'member' | 'admin' | 'owner') => Promise<unknown>;
}

function asScopes(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((scope): scope is string => typeof scope === 'string')
    : ['read'];
}

export function createMcpOutboundScope({ db, teamId, userId, ensureMember }: McpOutboundScopeDeps) {
  async function listKeys(): Promise<McpOutboundKeyRow[]> {
    await ensureMember('admin');
    const rows = await db
      .select()
      .from(mcpOutboundKeys)
      .where(and(eq(mcpOutboundKeys.teamId, teamId), isNull(mcpOutboundKeys.revokedAt)))
      .orderBy(desc(mcpOutboundKeys.createdAt));
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      prefix: row.keyPrefix,
      scopes: asScopes(row.scopes),
      lastUsedAt: row.lastUsedAt,
      expiresAt: row.expiresAt,
      createdAt: row.createdAt,
    }));
  }

  async function createKey(input: {
    name: string;
    allowCapture?: boolean;
    allowAgent?: boolean;
  }): Promise<CreatedMcpOutboundKey> {
    await ensureMember('admin');
    const minted = mintKey();
    const created = await db.transaction(async (tx) => {
      const rows = await tx
        .insert(mcpOutboundKeys)
        .values({
          teamId,
          createdByUserId: userId,
          name: input.name,
          keyHash: minted.hash,
          keyPrefix: minted.prefix,
          scopes: mcpStaticKeyScopes({
            allowCapture: input.allowCapture ?? true,
            allowAgent: input.allowAgent ?? false,
          }),
        })
        .returning();
      const row = rows[0];
      if (!row) throw new Error('create_failed');
      await tx.insert(auditLog).values({
        teamId,
        actorUserId: userId,
        action: 'mcp.connect',
        targetType: 'mcp_outbound_key',
        targetId: row.id,
        targetVisibility: 'team',
        metadata: {
          surface: 'timeline_as_mcp_server',
          scope_count: asScopes(row.scopes).length,
        },
      });
      return row;
    });
    return {
      id: created.id,
      name: created.name,
      prefix: created.keyPrefix,
      scopes: asScopes(created.scopes),
      lastUsedAt: created.lastUsedAt,
      expiresAt: created.expiresAt,
      createdAt: created.createdAt,
      plaintext: minted.plaintext,
    };
  }

  async function revokeKey(id: string): Promise<{ found: boolean; revokedNow: boolean }> {
    await ensureMember('admin');
    const revoked = await db.transaction(async (tx) => {
      const existingRows = await tx
        .select({ id: mcpOutboundKeys.id, revokedAt: mcpOutboundKeys.revokedAt })
        .from(mcpOutboundKeys)
        .where(and(eq(mcpOutboundKeys.id, id), eq(mcpOutboundKeys.teamId, teamId)))
        .limit(1)
        .for('update');
      const existing = existingRows[0];
      if (!existing) return null;
      if (existing.revokedAt) return { revokedNow: false };

      const rows = await tx
        .update(mcpOutboundKeys)
        .set({ revokedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(mcpOutboundKeys.id, id), eq(mcpOutboundKeys.teamId, teamId)))
        .returning({ id: mcpOutboundKeys.id });
      const row = rows[0];
      if (!row) return null;
      await tx.insert(auditLog).values({
        teamId,
        actorUserId: userId,
        action: 'mcp.disconnect',
        targetType: 'mcp_outbound_key',
        targetId: row.id,
        targetVisibility: 'team',
        metadata: { surface: 'timeline_as_mcp_server' },
      });
      return { revokedNow: true };
    });
    if (!revoked) return { found: false, revokedNow: false };
    return { found: true, revokedNow: revoked.revokedNow };
  }

  return { listKeys, createKey, revokeKey };
}

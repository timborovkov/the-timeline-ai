import {
  auditLog,
  type Db,
  mcpOutboundOAuthClients,
  mcpOutboundOAuthCodes,
  mcpOutboundOAuthGrants,
  mcpOutboundOAuthTokens,
  teamMembers,
} from '@timeline/db';
import { and, desc, eq, inArray, isNull, lte, notExists } from 'drizzle-orm';

import {
  ACCESS_TOKEN_PREFIX,
  ACCESS_TOKEN_TTL_MS,
  type ActiveMcpOAuthMembership,
  AUTHORIZATION_CODE_PREFIX,
  AUTHORIZATION_CODE_TTL_MS,
  McpOAuthError,
  type McpAuthPrincipal,
  type McpOAuthScope,
  MCP_TEAM_ACTOR_USER_ID,
  membershipAuthorizesScopes,
  mintSecret,
  pkceMatches,
  REFRESH_TOKEN_PREFIX,
  REFRESH_TOKEN_TTL_MS,
  REVOKED_GRANT_RETENTION_MS,
  sameScopes,
  tokenResponse,
  type ValidatedAuthorizationRequest,
  type OAuthTokenResponse,
} from '#src/mcp-server/oauth-core.js';

interface McpOAuthScopeDeps {
  db: Db;
  teamId: string;
  userId: string;
}

export interface DiscoveredAuthorizationCode {
  codeHash: string;
  grantId: string;
  clientId: string;
  redirectUri: string;
  codeVerifier: string;
  resource: string;
}

export interface DiscoveredRefreshToken {
  refreshTokenHash: string;
  grantId: string;
  clientId: string;
  resource: string;
  requestedScopes?: McpOAuthScope[];
}

export interface DiscoveredAccessToken {
  accessTokenHash: string;
  grantId: string;
  expectedResource: string;
}

export interface McpOAuthPruneResult {
  authorizationCodesDeleted: number;
  tokensDeleted: number;
  grantsDeleted: number;
}

/**
 * Team-known outbound OAuth operations. The caller can supply credentials only
 * after the pre-principal adapter has resolved them to this exact team/user.
 */
export function createMcpOAuthScope({ db, teamId, userId }: McpOAuthScopeDeps) {
  async function activeMembership(queryDb: Db = db): Promise<ActiveMcpOAuthMembership | null> {
    const rows = await queryDb
      .select({
        role: teamMembers.role,
        authorizationEpoch: teamMembers.authorizationEpoch,
      })
      .from(teamMembers)
      .where(
        and(
          eq(teamMembers.teamId, teamId),
          eq(teamMembers.userId, userId),
          isNull(teamMembers.removedAt),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async function revokeGrantFamily(
    tx: Db,
    grant: typeof mcpOutboundOAuthGrants.$inferSelect,
    action: 'mcp.oauth_membership_revoked' | 'mcp.oauth_refresh_reuse',
  ): Promise<void> {
    const now = new Date();
    await tx
      .update(mcpOutboundOAuthGrants)
      .set({ revokedAt: now, updatedAt: now })
      .where(
        and(
          eq(mcpOutboundOAuthGrants.id, grant.id),
          eq(mcpOutboundOAuthGrants.teamId, teamId),
          eq(mcpOutboundOAuthGrants.userId, userId),
        ),
      );
    await tx
      .update(mcpOutboundOAuthTokens)
      .set({ revokedAt: now })
      .where(eq(mcpOutboundOAuthTokens.grantId, grant.id));
    await tx.insert(auditLog).values({
      teamId,
      actorUserId: null,
      action,
      targetType: 'mcp_oauth_grant',
      targetId: grant.id,
      metadata: { client_id: grant.clientId },
    });
  }

  /**
   * Remove OAuth records only after their protocol security windows close.
   * This path is reserved for Timeline's zero-UUID system actor; every delete
   * is still constrained through a grant owned by this exact team scope.
   */
  async function pruneExpiredCredentials(): Promise<McpOAuthPruneResult> {
    if (userId !== MCP_TEAM_ACTOR_USER_ID) {
      throw new Error('MCP OAuth credential pruning requires the system actor');
    }

    const now = new Date();
    const teamGrantIds = db
      .select({ id: mcpOutboundOAuthGrants.id })
      .from(mcpOutboundOAuthGrants)
      .where(eq(mcpOutboundOAuthGrants.teamId, teamId));

    // Each delete commits independently. This avoids holding child-row locks
    // while later acquiring grant locks, preserving the grant -> token lock
    // order used by refresh rotation.
    const deletedCodes = await db
      .delete(mcpOutboundOAuthCodes)
      .where(
        and(
          lte(mcpOutboundOAuthCodes.expiresAt, now),
          inArray(mcpOutboundOAuthCodes.grantId, teamGrantIds),
        ),
      )
      .returning({ id: mcpOutboundOAuthCodes.id });
    const deletedTokens = await db
      .delete(mcpOutboundOAuthTokens)
      .where(
        and(
          lte(mcpOutboundOAuthTokens.refreshExpiresAt, now),
          inArray(mcpOutboundOAuthTokens.grantId, teamGrantIds),
        ),
      )
      .returning({ id: mcpOutboundOAuthTokens.id });
    const revokedBefore = new Date(now.getTime() - REVOKED_GRANT_RETENTION_MS);
    const deletedGrants = await db
      .delete(mcpOutboundOAuthGrants)
      .where(
        and(
          eq(mcpOutboundOAuthGrants.teamId, teamId),
          lte(mcpOutboundOAuthGrants.revokedAt, revokedBefore),
          // Never let ON DELETE CASCADE shorten a code or refresh-token
          // security window, even if inconsistent future-dated data exists.
          notExists(
            db
              .select({ id: mcpOutboundOAuthCodes.id })
              .from(mcpOutboundOAuthCodes)
              .where(eq(mcpOutboundOAuthCodes.grantId, mcpOutboundOAuthGrants.id)),
          ),
          notExists(
            db
              .select({ id: mcpOutboundOAuthTokens.id })
              .from(mcpOutboundOAuthTokens)
              .where(eq(mcpOutboundOAuthTokens.grantId, mcpOutboundOAuthGrants.id)),
          ),
        ),
      )
      .returning({ id: mcpOutboundOAuthGrants.id });

    return {
      authorizationCodesDeleted: deletedCodes.length,
      tokensDeleted: deletedTokens.length,
      grantsDeleted: deletedGrants.length,
    };
  }

  async function createAuthorizationCode(request: ValidatedAuthorizationRequest): Promise<string> {
    const code = mintSecret(AUTHORIZATION_CODE_PREFIX);
    await db.transaction(async (rawTx) => {
      const tx = rawTx as unknown as Db;
      const membership = await activeMembership(tx);
      if (!membership || !membershipAuthorizesScopes(membership, request.scopes)) {
        throw new McpOAuthError(
          'access_denied',
          request.scopes.includes('agent:ask')
            ? 'Only a team owner or admin can authorize Timeline agent access'
            : 'You are not an active member of this team',
        );
      }
      const now = new Date();
      const existingRows = await tx
        .select()
        .from(mcpOutboundOAuthGrants)
        .where(
          and(
            eq(mcpOutboundOAuthGrants.clientId, request.client.clientId),
            eq(mcpOutboundOAuthGrants.userId, userId),
            eq(mcpOutboundOAuthGrants.teamId, teamId),
          ),
        )
        .limit(1)
        .for('update');
      const existing = existingRows[0];
      let grantId: string;
      if (existing) {
        const resetsCredentialFamily =
          !sameScopes(existing.scopes, request.scopes) ||
          existing.resource !== request.resource ||
          existing.membershipAuthorizationEpoch !== membership.authorizationEpoch ||
          existing.revokedAt !== null;
        await tx
          .update(mcpOutboundOAuthGrants)
          .set({
            membershipAuthorizationEpoch: membership.authorizationEpoch,
            scopes: request.scopes,
            resource: request.resource,
            revokedAt: null,
            updatedAt: now,
          })
          .where(
            and(
              eq(mcpOutboundOAuthGrants.id, existing.id),
              eq(mcpOutboundOAuthGrants.teamId, teamId),
              eq(mcpOutboundOAuthGrants.userId, userId),
            ),
          );
        if (resetsCredentialFamily) {
          await tx
            .delete(mcpOutboundOAuthTokens)
            .where(eq(mcpOutboundOAuthTokens.grantId, existing.id));
        }
        grantId = existing.id;
      } else {
        const inserted = await tx
          .insert(mcpOutboundOAuthGrants)
          .values({
            clientId: request.client.clientId,
            userId,
            teamId,
            membershipAuthorizationEpoch: membership.authorizationEpoch,
            scopes: request.scopes,
            resource: request.resource,
            createdAt: now,
            updatedAt: now,
          })
          .returning({ id: mcpOutboundOAuthGrants.id });
        const id = inserted[0]?.id;
        if (!id) throw new Error('mcp_oauth_grant_insert_failed');
        grantId = id;
      }
      await tx
        .update(mcpOutboundOAuthCodes)
        .set({ consumedAt: now })
        .where(
          and(eq(mcpOutboundOAuthCodes.grantId, grantId), isNull(mcpOutboundOAuthCodes.consumedAt)),
        );
      await tx.insert(mcpOutboundOAuthCodes).values({
        grantId,
        clientId: request.client.clientId,
        codeHash: code.hash,
        redirectUri: request.redirectUri,
        codeChallenge: request.codeChallenge,
        scopes: request.scopes,
        resource: request.resource,
        expiresAt: new Date(now.getTime() + AUTHORIZATION_CODE_TTL_MS),
        createdAt: now,
      });
      await tx.insert(auditLog).values({
        teamId,
        actorUserId: userId,
        action: 'mcp.oauth_connect',
        targetType: 'mcp_oauth_grant',
        targetId: grantId,
        metadata: {
          client_id: request.client.clientId,
          client_name: request.client.clientName,
          scopes: request.scopes,
          resource: request.resource,
        },
      });
    });
    return code.plaintext;
  }

  async function exchangeAuthorizationCode(
    input: DiscoveredAuthorizationCode,
  ): Promise<OAuthTokenResponse> {
    const result = await db.transaction(async (rawTx) => {
      const tx = rawTx as unknown as Db;
      const grantRows = await tx
        .select()
        .from(mcpOutboundOAuthGrants)
        .where(
          and(
            eq(mcpOutboundOAuthGrants.id, input.grantId),
            eq(mcpOutboundOAuthGrants.teamId, teamId),
            eq(mcpOutboundOAuthGrants.userId, userId),
          ),
        )
        .limit(1)
        .for('update');
      const grant = grantRows[0];
      const codeRows = await tx
        .select()
        .from(mcpOutboundOAuthCodes)
        .where(
          and(
            eq(mcpOutboundOAuthCodes.codeHash, input.codeHash),
            eq(mcpOutboundOAuthCodes.grantId, input.grantId),
          ),
        )
        .limit(1)
        .for('update');
      const row = codeRows[0];
      if (
        !row ||
        row.consumedAt ||
        row.expiresAt.getTime() <= Date.now() ||
        row.clientId !== input.clientId ||
        row.redirectUri !== input.redirectUri ||
        row.resource !== input.resource ||
        !pkceMatches(input.codeVerifier, row.codeChallenge)
      ) {
        throw new McpOAuthError(
          'invalid_grant',
          'Invalid, expired, or consumed authorization code',
        );
      }
      if (
        !grant ||
        grant.revokedAt ||
        grant.clientId !== input.clientId ||
        grant.resource !== row.resource ||
        !sameScopes(grant.scopes, row.scopes)
      ) {
        throw new McpOAuthError('invalid_grant', 'The authorization grant is no longer active');
      }
      if (
        !membershipAuthorizesScopes(
          await activeMembership(tx),
          grant.scopes,
          grant.membershipAuthorizationEpoch,
        )
      ) {
        throw new McpOAuthError('invalid_grant', 'The authorizing user is no longer authorized');
      }
      const now = new Date();
      const access = mintSecret(ACCESS_TOKEN_PREFIX);
      const refresh = mintSecret(REFRESH_TOKEN_PREFIX);
      await tx
        .update(mcpOutboundOAuthCodes)
        .set({ consumedAt: now })
        .where(
          and(eq(mcpOutboundOAuthCodes.id, row.id), eq(mcpOutboundOAuthCodes.grantId, grant.id)),
        );
      await tx.insert(mcpOutboundOAuthTokens).values({
        grantId: grant.id,
        accessTokenHash: access.hash,
        accessTokenPrefix: access.short,
        accessExpiresAt: new Date(now.getTime() + ACCESS_TOKEN_TTL_MS),
        refreshTokenHash: refresh.hash,
        refreshTokenPrefix: refresh.short,
        refreshExpiresAt: new Date(now.getTime() + REFRESH_TOKEN_TTL_MS),
        createdAt: now,
      });
      return { access: access.plaintext, refresh: refresh.plaintext, grant };
    });
    return tokenResponse({
      access: result.access,
      refresh: result.refresh,
      scopes: result.grant.scopes,
      resource: result.grant.resource,
    });
  }

  async function rotateRefreshToken(input: DiscoveredRefreshToken): Promise<OAuthTokenResponse> {
    const result = await db.transaction(async (rawTx) => {
      const tx = rawTx as unknown as Db;
      const grantRows = await tx
        .select()
        .from(mcpOutboundOAuthGrants)
        .where(
          and(
            eq(mcpOutboundOAuthGrants.id, input.grantId),
            eq(mcpOutboundOAuthGrants.teamId, teamId),
            eq(mcpOutboundOAuthGrants.userId, userId),
          ),
        )
        .limit(1)
        .for('update');
      const grant = grantRows[0];
      const tokenRows = await tx
        .select()
        .from(mcpOutboundOAuthTokens)
        .where(
          and(
            eq(mcpOutboundOAuthTokens.refreshTokenHash, input.refreshTokenHash),
            eq(mcpOutboundOAuthTokens.grantId, input.grantId),
          ),
        )
        .limit(1)
        .for('update');
      const token = tokenRows[0];
      if (!token) return { kind: 'invalid' as const };
      if (token.rotatedAt) {
        if (grant) await revokeGrantFamily(tx, grant, 'mcp.oauth_refresh_reuse');
        return { kind: 'reuse' as const };
      }
      if (
        !grant ||
        grant.revokedAt ||
        token.revokedAt ||
        token.refreshExpiresAt.getTime() <= Date.now() ||
        grant.clientId !== input.clientId ||
        grant.resource !== input.resource
      ) {
        return { kind: 'invalid' as const };
      }
      const scopes = input.requestedScopes ?? grant.scopes;
      if (scopes.some((scope) => !grant.scopes.includes(scope))) {
        throw new McpOAuthError('invalid_scope', 'Refresh scope cannot exceed the original grant');
      }
      const membership = await activeMembership(tx);
      if (!membershipAuthorizesScopes(membership, scopes, grant.membershipAuthorizationEpoch)) {
        await revokeGrantFamily(tx, grant, 'mcp.oauth_membership_revoked');
        return { kind: 'invalid' as const };
      }
      const now = new Date();
      const access = mintSecret(ACCESS_TOKEN_PREFIX);
      const refresh = mintSecret(REFRESH_TOKEN_PREFIX);
      const narrowsGrant = !sameScopes(scopes, grant.scopes);
      if (narrowsGrant) {
        await tx
          .update(mcpOutboundOAuthGrants)
          .set({ scopes, updatedAt: now })
          .where(
            and(
              eq(mcpOutboundOAuthGrants.id, grant.id),
              eq(mcpOutboundOAuthGrants.teamId, teamId),
              eq(mcpOutboundOAuthGrants.userId, userId),
            ),
          );
        await tx
          .update(mcpOutboundOAuthTokens)
          .set({ revokedAt: now })
          .where(eq(mcpOutboundOAuthTokens.grantId, grant.id));
        await tx
          .update(mcpOutboundOAuthTokens)
          .set({ rotatedAt: now })
          .where(
            and(
              eq(mcpOutboundOAuthTokens.id, token.id),
              eq(mcpOutboundOAuthTokens.grantId, grant.id),
            ),
          );
      } else {
        await tx
          .update(mcpOutboundOAuthTokens)
          .set({ rotatedAt: now, revokedAt: now })
          .where(
            and(
              eq(mcpOutboundOAuthTokens.id, token.id),
              eq(mcpOutboundOAuthTokens.grantId, grant.id),
            ),
          );
      }
      await tx.insert(mcpOutboundOAuthTokens).values({
        grantId: grant.id,
        accessTokenHash: access.hash,
        accessTokenPrefix: access.short,
        accessExpiresAt: new Date(now.getTime() + ACCESS_TOKEN_TTL_MS),
        refreshTokenHash: refresh.hash,
        refreshTokenPrefix: refresh.short,
        refreshExpiresAt: new Date(now.getTime() + REFRESH_TOKEN_TTL_MS),
        createdAt: now,
      });
      return {
        kind: 'ok' as const,
        access: access.plaintext,
        refresh: refresh.plaintext,
        scopes,
        resource: grant.resource,
      };
    });
    if (result.kind !== 'ok') {
      throw new McpOAuthError(
        'invalid_grant',
        result.kind === 'reuse'
          ? 'Refresh-token reuse detected; the authorization grant was revoked'
          : 'Invalid or expired refresh token',
      );
    }
    return tokenResponse({
      access: result.access,
      refresh: result.refresh,
      scopes: result.scopes,
      resource: result.resource,
    });
  }

  async function revokeGrant(grantId: string): Promise<boolean> {
    if (!(await activeMembership())) throw new Error('Not a member of this team');
    const now = new Date();
    return db.transaction(async (rawTx) => {
      const tx = rawTx as unknown as Db;
      const updated = await tx
        .update(mcpOutboundOAuthGrants)
        .set({ revokedAt: now, updatedAt: now })
        .where(
          and(
            eq(mcpOutboundOAuthGrants.id, grantId),
            eq(mcpOutboundOAuthGrants.userId, userId),
            eq(mcpOutboundOAuthGrants.teamId, teamId),
            isNull(mcpOutboundOAuthGrants.revokedAt),
          ),
        )
        .returning({ id: mcpOutboundOAuthGrants.id });
      if (updated.length === 0) return false;
      await tx
        .update(mcpOutboundOAuthTokens)
        .set({ revokedAt: now })
        .where(eq(mcpOutboundOAuthTokens.grantId, grantId));
      await tx.insert(auditLog).values({
        teamId,
        actorUserId: userId,
        action: 'mcp.oauth_disconnect',
        targetType: 'mcp_oauth_grant',
        targetId: grantId,
        metadata: { source: 'timeline_connections' },
      });
      return true;
    });
  }

  async function listGrants() {
    if (!(await activeMembership())) throw new Error('Not a member of this team');
    return db
      .select({
        id: mcpOutboundOAuthGrants.id,
        clientId: mcpOutboundOAuthGrants.clientId,
        clientName: mcpOutboundOAuthClients.clientName,
        scopes: mcpOutboundOAuthGrants.scopes,
        createdAt: mcpOutboundOAuthGrants.createdAt,
        lastUsedAt: mcpOutboundOAuthGrants.lastUsedAt,
      })
      .from(mcpOutboundOAuthGrants)
      .innerJoin(
        mcpOutboundOAuthClients,
        eq(mcpOutboundOAuthClients.clientId, mcpOutboundOAuthGrants.clientId),
      )
      .where(
        and(
          eq(mcpOutboundOAuthGrants.userId, userId),
          eq(mcpOutboundOAuthGrants.teamId, teamId),
          isNull(mcpOutboundOAuthGrants.revokedAt),
        ),
      )
      .orderBy(desc(mcpOutboundOAuthGrants.updatedAt));
  }

  async function authorizeCurrentGrant(input: {
    grantId: string;
    expectedScopes: readonly string[];
    expectedResource?: string;
  }): Promise<boolean> {
    const rows = await db
      .select({
        scopes: mcpOutboundOAuthGrants.scopes,
        resource: mcpOutboundOAuthGrants.resource,
        membershipAuthorizationEpoch: mcpOutboundOAuthGrants.membershipAuthorizationEpoch,
        role: teamMembers.role,
        authorizationEpoch: teamMembers.authorizationEpoch,
      })
      .from(mcpOutboundOAuthGrants)
      .innerJoin(
        teamMembers,
        and(
          eq(teamMembers.teamId, mcpOutboundOAuthGrants.teamId),
          eq(teamMembers.userId, mcpOutboundOAuthGrants.userId),
          isNull(teamMembers.removedAt),
        ),
      )
      .where(
        and(
          eq(mcpOutboundOAuthGrants.id, input.grantId),
          eq(mcpOutboundOAuthGrants.teamId, teamId),
          eq(mcpOutboundOAuthGrants.userId, userId),
          isNull(mcpOutboundOAuthGrants.revokedAt),
        ),
      )
      .limit(1);
    const row = rows[0];
    return Boolean(
      row &&
      sameScopes(row.scopes, input.expectedScopes) &&
      (!input.expectedResource || row.resource === input.expectedResource) &&
      membershipAuthorizesScopes(
        { role: row.role, authorizationEpoch: row.authorizationEpoch },
        row.scopes,
        row.membershipAuthorizationEpoch,
      ),
    );
  }

  async function resolveAccessToken(
    input: DiscoveredAccessToken,
  ): Promise<McpAuthPrincipal | null> {
    const rows = await db
      .select({
        tokenId: mcpOutboundOAuthTokens.id,
        accessExpiresAt: mcpOutboundOAuthTokens.accessExpiresAt,
        tokenRevokedAt: mcpOutboundOAuthTokens.revokedAt,
        grantId: mcpOutboundOAuthGrants.id,
        clientId: mcpOutboundOAuthGrants.clientId,
        scopes: mcpOutboundOAuthGrants.scopes,
        resource: mcpOutboundOAuthGrants.resource,
        membershipAuthorizationEpoch: mcpOutboundOAuthGrants.membershipAuthorizationEpoch,
        grantRevokedAt: mcpOutboundOAuthGrants.revokedAt,
        role: teamMembers.role,
        authorizationEpoch: teamMembers.authorizationEpoch,
      })
      .from(mcpOutboundOAuthTokens)
      .innerJoin(
        mcpOutboundOAuthGrants,
        eq(mcpOutboundOAuthGrants.id, mcpOutboundOAuthTokens.grantId),
      )
      .innerJoin(
        teamMembers,
        and(
          eq(teamMembers.teamId, mcpOutboundOAuthGrants.teamId),
          eq(teamMembers.userId, mcpOutboundOAuthGrants.userId),
          isNull(teamMembers.removedAt),
        ),
      )
      .where(
        and(
          eq(mcpOutboundOAuthTokens.accessTokenHash, input.accessTokenHash),
          eq(mcpOutboundOAuthTokens.grantId, input.grantId),
          eq(mcpOutboundOAuthGrants.teamId, teamId),
          eq(mcpOutboundOAuthGrants.userId, userId),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (
      !row ||
      row.tokenRevokedAt ||
      row.grantRevokedAt ||
      row.accessExpiresAt.getTime() <= Date.now() ||
      row.resource !== input.expectedResource ||
      !membershipAuthorizesScopes(
        { role: row.role, authorizationEpoch: row.authorizationEpoch },
        row.scopes,
        row.membershipAuthorizationEpoch,
      )
    ) {
      return null;
    }
    const now = new Date();
    void Promise.all([
      db
        .update(mcpOutboundOAuthTokens)
        .set({ lastUsedAt: now })
        .where(
          and(
            eq(mcpOutboundOAuthTokens.id, row.tokenId),
            eq(mcpOutboundOAuthTokens.grantId, row.grantId),
          ),
        ),
      db
        .update(mcpOutboundOAuthGrants)
        .set({ lastUsedAt: now, updatedAt: now })
        .where(
          and(
            eq(mcpOutboundOAuthGrants.id, row.grantId),
            eq(mcpOutboundOAuthGrants.teamId, teamId),
            eq(mcpOutboundOAuthGrants.userId, userId),
          ),
        ),
    ]).catch(() => undefined);
    return {
      authType: 'oauth',
      teamId,
      userId,
      keyId: row.grantId,
      clientId: row.clientId,
      scopes: row.scopes,
      expiresAt: Math.floor(row.accessExpiresAt.getTime() / 1_000),
    };
  }

  return {
    pruneExpiredCredentials,
    createAuthorizationCode,
    exchangeAuthorizationCode,
    rotateRefreshToken,
    revokeGrant,
    listGrants,
    authorizeCurrentGrant,
    resolveAccessToken,
  };
}

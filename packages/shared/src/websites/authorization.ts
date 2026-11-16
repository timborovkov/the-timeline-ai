import { type Db, mcpOutboundKeys, mcpOutboundOAuthGrants, teamMembers } from '@timeline/db';
import { and, eq, isNull } from 'drizzle-orm';

import { principalIsActive } from '#src/platform-admin/runtime.js';

import type { McpAuthPrincipal } from '#src/mcp-server/oauth-core.js';

export async function authorizeWebsitePrincipal(
  db: Db,
  principal: McpAuthPrincipal,
  required: 'read' | 'websites:scan' | 'websites:manage',
): Promise<void> {
  if (!principal.scopes.includes('read') || !principal.scopes.includes(required))
    throw new Error('Missing website permission');
  if (principal.authType === 'api_key') {
    const [key] = await db
      .select()
      .from(mcpOutboundKeys)
      .where(
        and(
          eq(mcpOutboundKeys.teamId, principal.teamId),
          eq(mcpOutboundKeys.id, principal.keyId),
          isNull(mcpOutboundKeys.revokedAt),
        ),
      );
    if (
      !key ||
      (key.expiresAt && key.expiresAt.getTime() <= Date.now()) ||
      !Array.isArray(key.scopes) ||
      !key.scopes.includes(required)
    )
      throw new Error('Website credential revoked or expired');
    if (!(await principalIsActive(db, principal.teamId, key.createdByUserId ?? undefined)))
      throw new Error('Website credential issuer suspended');
    if (required === 'websites:manage') {
      const [member] = key.createdByUserId
        ? await db
            .select()
            .from(teamMembers)
            .where(
              and(
                eq(teamMembers.teamId, principal.teamId),
                eq(teamMembers.userId, key.createdByUserId),
                isNull(teamMembers.removedAt),
              ),
            )
        : [];
      if (!member || member.role === 'member') throw new Error('Requires admin authority');
    }
  } else {
    const [grant] = await db
      .select()
      .from(mcpOutboundOAuthGrants)
      .where(
        and(
          eq(mcpOutboundOAuthGrants.teamId, principal.teamId),
          eq(mcpOutboundOAuthGrants.userId, principal.userId),
          eq(mcpOutboundOAuthGrants.id, principal.keyId),
          isNull(mcpOutboundOAuthGrants.revokedAt),
        ),
      );
    const [member] = await db
      .select()
      .from(teamMembers)
      .where(
        and(
          eq(teamMembers.teamId, principal.teamId),
          eq(teamMembers.userId, principal.userId),
          isNull(teamMembers.removedAt),
        ),
      );
    if (!grant || !member) throw new Error('Website grant no longer authorized');
    if (
      grant.membershipAuthorizationEpoch !== member.authorizationEpoch ||
      !grant.scopes.includes(required) ||
      (required === 'websites:manage' && member.role === 'member')
    )
      throw new Error('Website grant no longer authorized');
  }
}

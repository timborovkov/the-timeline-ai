import { teamMembers, teams } from '@timeline/db';
import { buildInboundEmail, randomSlugSuffix, slugify } from '@timeline/shared/slug';
import { and, eq, isNull } from 'drizzle-orm';

import { db } from './db';

/**
 * Idempotently create a solo team for a user who has no memberships. No-op
 * when the user is already on at least one team. Used by:
 *
 *   - The NextAuth `createUser` event for fresh OAuth signups.
 *   - The `acceptInviteAction` failure path, when an OAuth user arrived via
 *     `/sign-up?invite=<token>`, `createUser` skipped solo-team creation, and
 *     invite acceptance then failed (expired, revoked, email mismatch).
 *
 * Same name / slug / inboundEmail convention as `createTeamAction` so a
 * fallback team is indistinguishable from a deliberate one.
 */
export async function ensureSoloTeam(
  userId: string,
  hint: { name?: string | null; email?: string | null } = {},
): Promise<void> {
  const existing = await db
    .select({ teamId: teamMembers.teamId })
    .from(teamMembers)
    .where(and(eq(teamMembers.userId, userId), isNull(teamMembers.removedAt)))
    .limit(1);
  if (existing.length > 0) return;

  const label = hint.name ?? hint.email?.split('@')[0] ?? 'team';
  const slug = `${slugify(`${label}-team`) || 'team'}-${randomSlugSuffix()}`;
  const inboundEmail = buildInboundEmail(slug, process.env.INBOUND_EMAIL_DOMAIN);
  await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(teams)
      .values({ name: `${label}'s Team`, slug, inboundEmail })
      .returning({ id: teams.id });
    const teamId = inserted[0]?.id;
    if (!teamId) throw new Error('Failed to create default team');
    await tx.insert(teamMembers).values({ teamId, userId, role: 'owner' });
  });
}

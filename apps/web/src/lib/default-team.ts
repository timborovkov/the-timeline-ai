import { teamMembers } from '@timeline/db';
import { initializeOwnedWorkspace } from '@timeline/shared/agent-provisioning';
import { applyOwnedTeamFreeGrant } from '@timeline/shared/billing';
import { buildInboundEmail, randomSlugSuffix, slugify } from '@timeline/shared/slug';
import { and, eq, isNull } from 'drizzle-orm';

import { db } from '@/lib/db';

/** Prefill display name for the Welcome step before a solo workspace exists. */
export function defaultSoloTeamName(label: string): string {
  return `${label}'s team`;
}

/**
 * Idempotently create a solo team for a user who has no memberships. No-op
 * when the user is already on at least one team.
 *
 * Prefer the Welcome / `createTeamAction` paths so the owner chooses the name
 * (slug + inbound email minted then). Kept for recovery scripts and tests —
 * product signup must not invent a default-named owned team.
 */
export async function ensureSoloTeam(
  userId: string,
  hint: { name?: string | null; email?: string | null } = {},
): Promise<string | null> {
  const existing = await db
    .select({ teamId: teamMembers.teamId })
    .from(teamMembers)
    .where(and(eq(teamMembers.userId, userId), isNull(teamMembers.removedAt)))
    .limit(1);
  if (existing.length > 0) return null;

  const label = hint.name ?? hint.email?.split('@')[0] ?? 'team';
  const slug = `${slugify(`${label}-team`) || 'team'}-${randomSlugSuffix()}`;
  const inboundEmail = buildInboundEmail(slug, process.env.INBOUND_EMAIL_DOMAIN);
  const teamId = await db.transaction(async (tx) => {
    const team = await initializeOwnedWorkspace(tx, {
      ownerId: userId,
      name: defaultSoloTeamName(label),
      slug,
      inboundEmail,
    });
    const id = team?.id;
    if (!id) throw new Error('Failed to create default team');
    await applyOwnedTeamFreeGrant({ db: tx, teamId: id, userId });
    return id;
  });
  return teamId;
}

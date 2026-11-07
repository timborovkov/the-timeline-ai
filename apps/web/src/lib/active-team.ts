import { teamBillingAccounts, teamMembers, teams } from '@timeline/db';
import {
  operatorContext,
  assertActivePrincipal,
  isInactiveWorkspaceSecurityState,
} from '@timeline/shared/platform-admin/runtime';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { cookies } from 'next/headers';

import { ACTIVE_TEAM_COOKIE, parseActiveTeamCookie } from '@/lib/active-team-cookie';
import { db } from '@/lib/db';

export {
  ACTIVE_TEAM_COOKIE,
  activeTeamCookieOptions,
  parseActiveTeamCookie,
  serializeActiveTeamCookie,
} from '@/lib/active-team-cookie';

export interface TeamMembership {
  teamId: string;
  teamName: string;
  teamSlug: string;
  role: 'owner' | 'admin' | 'member';
}

async function listMemberships(userId: string): Promise<TeamMembership[]> {
  const [context, rows] = await Promise.all([
    operatorContext(),
    db
      .select({
        teamId: teams.id,
        teamName: teams.name,
        teamSlug: teams.slug,
        role: teamMembers.role,
        createdAt: teamMembers.createdAt,
        securityState: teamBillingAccounts.securityState,
      })
      .from(teamMembers)
      .innerJoin(teams, eq(teams.id, teamMembers.teamId))
      .leftJoin(teamBillingAccounts, eq(teamBillingAccounts.teamId, teams.id))
      .where(and(eq(teamMembers.userId, userId), isNull(teamMembers.removedAt)))
      .orderBy(asc(teamMembers.createdAt)),
  ]);
  return rows
    .filter((r) => {
      // Read-only impersonation may inspect a suspended workspace. Normal
      // members never see it in the selector or as an active-team candidate.
      if (context?.readOnly && context.effectiveUserId === userId && context.teamId === r.teamId)
        return true;
      return !isInactiveWorkspaceSecurityState(r.securityState);
    })
    .map((r) => ({
      teamId: r.teamId,
      teamName: r.teamName,
      teamSlug: r.teamSlug,
      role: r.role,
    }));
}

/**
 * Resolve the active team for a user. Priority:
 *   1. tl_active_team cookie, if it points to a team the user is a member of.
 *   2. Oldest membership.
 *   3. null (caller redirects to onboarding).
 */
export async function resolveActiveTeam(
  userId: string,
): Promise<{ active: TeamMembership | null; memberships: TeamMembership[] }> {
  const [context, listed] = await Promise.all([operatorContext(), listMemberships(userId)]);
  const memberships = listed.filter(
    (m) => !context || (context.effectiveUserId === userId && m.teamId === context.teamId),
  );
  if (memberships.length === 0) return { active: null, memberships };
  const cookieStore = await cookies();
  const cookieTeamId = parseActiveTeamCookie(cookieStore.get(ACTIVE_TEAM_COOKIE)?.value)?.teamId;
  const fromCookie = cookieTeamId ? memberships.find((m) => m.teamId === cookieTeamId) : undefined;
  return { active: fromCookie ?? memberships[0] ?? null, memberships };
}

export async function verifyMembership(userId: string, teamId: string): Promise<boolean> {
  const context = await operatorContext();
  if (context && (context.teamId !== teamId || context.effectiveUserId !== userId)) return false;
  if (!context?.readOnly) await assertActivePrincipal(db, teamId, userId);
  const rows = await db
    .select({ teamId: teamMembers.teamId })
    .from(teamMembers)
    .where(
      and(
        eq(teamMembers.userId, userId),
        eq(teamMembers.teamId, teamId),
        isNull(teamMembers.removedAt),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

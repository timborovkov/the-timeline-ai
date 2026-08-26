import { teamMembers, teams } from '@timeline/db';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { cookies } from 'next/headers';

import { db } from '@/lib/db';

export const ACTIVE_TEAM_COOKIE = 'tl_active_team';
const ACTIVE_TEAM_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

/**
 * Keep the active workspace preference no longer than the default Auth.js
 * session and never allow production traffic to send it over plain HTTP.
 *
 * The cookie must remain available to `/api` and Server Action requests because
 * those routes resolve the active team independently of the `/app` layout.
 */
export function activeTeamCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: ACTIVE_TEAM_COOKIE_MAX_AGE_SECONDS,
  };
}

export interface TeamMembership {
  teamId: string;
  teamName: string;
  teamSlug: string;
  role: 'owner' | 'admin' | 'member';
}

async function listMemberships(userId: string): Promise<TeamMembership[]> {
  const rows = await db
    .select({
      teamId: teams.id,
      teamName: teams.name,
      teamSlug: teams.slug,
      role: teamMembers.role,
      createdAt: teamMembers.createdAt,
    })
    .from(teamMembers)
    .innerJoin(teams, eq(teams.id, teamMembers.teamId))
    .where(and(eq(teamMembers.userId, userId), isNull(teamMembers.removedAt)))
    .orderBy(asc(teamMembers.createdAt));
  return rows.map((r) => ({
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
  const memberships = await listMemberships(userId);
  if (memberships.length === 0) return { active: null, memberships };
  const cookieStore = await cookies();
  const cookieTeamId = cookieStore.get(ACTIVE_TEAM_COOKIE)?.value;
  const fromCookie = cookieTeamId ? memberships.find((m) => m.teamId === cookieTeamId) : undefined;
  return { active: fromCookie ?? memberships[0] ?? null, memberships };
}

export async function verifyMembership(userId: string, teamId: string): Promise<boolean> {
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

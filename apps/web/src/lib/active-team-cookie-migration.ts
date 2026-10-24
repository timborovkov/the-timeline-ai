import type { NextResponse } from 'next/server';
import type { NextAuthRequest } from 'next-auth';

import { verifyMembership } from '@/lib/active-team';
import {
  ACTIVE_TEAM_COOKIE,
  activeTeamCookieOptions,
  expireActiveTeamCookie,
  parseActiveTeamCookie,
  serializeActiveTeamCookie,
} from '@/lib/active-team-cookie';

/**
 * Replace the legacy raw-UUID cookie only after Auth.js has supplied a user and
 * the existing membership boundary confirms that team still belongs to them.
 * New writers use a v2 marker, so subsequent requests do not repeat the query
 * or slide the expiry window. Membership remains the authorization boundary.
 */
export async function migrateLegacyActiveTeamCookie(
  request: NextAuthRequest,
  response: NextResponse,
): Promise<void> {
  const cookieValue = request.cookies.get(ACTIVE_TEAM_COOKIE)?.value;
  if (!cookieValue) return;
  const parsed = parseActiveTeamCookie(cookieValue);
  if (parsed && !parsed.needsMigration) return;

  const userId = request.auth?.user.id;
  if (!parsed || !userId) {
    expireActiveTeamCookie(response);
    return;
  }

  try {
    if (!(await verifyMembership(userId, parsed.teamId))) {
      expireActiveTeamCookie(response);
      return;
    }
    response.cookies.set(
      ACTIVE_TEAM_COOKIE,
      serializeActiveTeamCookie(parsed.teamId),
      activeTeamCookieOptions(),
    );
  } catch {
    // Cookie hardening is best effort and must never block authentication or navigation.
  }
}

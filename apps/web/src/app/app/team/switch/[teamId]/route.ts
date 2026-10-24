import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import {
  ACTIVE_TEAM_COOKIE,
  activeTeamCookieOptions,
  serializeActiveTeamCookie,
  verifyMembership,
} from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { getSiteUrl } from '@/lib/site-url';

function appRedirect(path: '/app' | '/sign-in'): NextResponse {
  return NextResponse.redirect(new URL(path, getSiteUrl()));
}

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ teamId: string }> },
): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return appRedirect('/sign-in');
  }
  const { teamId } = await params;
  const ok = await verifyMembership(session.user.id, teamId);
  if (!ok) {
    return appRedirect('/app');
  }

  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_TEAM_COOKIE, serializeActiveTeamCookie(teamId), activeTeamCookieOptions());
  return appRedirect('/app');
}

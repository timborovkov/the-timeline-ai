import { PlatformAccessError } from '@timeline/shared/platform-admin';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import {
  ACTIVE_TEAM_COOKIE,
  activeTeamCookieOptions,
  serializeActiveTeamCookie,
  verifyMembership,
} from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { getSiteUrl } from '@/lib/site-url';
import { updateDestinationPath } from '@/lib/update-links';

function appRedirect(path: '/app' | '/sign-in'): NextResponse {
  return NextResponse.redirect(new URL(path, getSiteUrl()));
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ teamId: string }> },
): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return appRedirect('/sign-in');
  }
  const { teamId } = await params;
  let ok: boolean;
  try {
    ok = await verifyMembership(session.user.id, teamId);
  } catch (error) {
    // Suspended/terminated workspaces throw instead of returning false. Stay on
    // the current team and let /app (or the request gate) handle the UI.
    if (error instanceof PlatformAccessError) return appRedirect('/app');
    throw error;
  }
  if (!ok) {
    return appRedirect('/app');
  }

  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_TEAM_COOKIE, serializeActiveTeamCookie(teamId), activeTeamCookieOptions());
  const query = new URL(request.url).searchParams;
  const destination = updateDestinationPath(query.get('update') ?? undefined);
  if (destination) return NextResponse.redirect(new URL(destination, getSiteUrl()), 303);
  const digest = z.uuid().safeParse(query.get('digest'));
  if (!digest.success) return appRedirect('/app');
  const target = new URL('/app/digests', getSiteUrl());
  target.searchParams.set('digest', digest.data);
  return NextResponse.redirect(target, 303);
}

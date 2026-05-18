import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { ACTIVE_TEAM_COOKIE, verifyMembership } from '@/lib/active-team';
import { auth } from '@/lib/auth';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ teamId: string }> },
): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.redirect(new URL('/sign-in', req.url));
  }
  const { teamId } = await params;
  const ok = await verifyMembership(session.user.id, teamId);
  if (!ok) {
    return NextResponse.redirect(new URL('/app/timeline', req.url));
  }

  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_TEAM_COOKIE, teamId, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  });
  return NextResponse.redirect(new URL('/app/timeline', req.url));
}

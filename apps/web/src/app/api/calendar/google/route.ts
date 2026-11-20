import { createHash, randomBytes } from 'node:crypto';

import { exchangeGoogleCalendarCode, googleCalendarAuthorizeUrl } from '@timeline/shared/calendar';
import { withTeam } from '@timeline/shared/team-scope';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { appUrl } from '@/lib/site-url';

const COOKIE = 'timeline-google-calendar-oauth';
const ROUTE = '/api/calendar/google';
const transactionSchema = z.object({
  state: z.string(),
  verifier: z.string(),
  userId: z.uuid(),
  teamId: z.uuid(),
  expiresAt: z.number(),
});

function calendarResult(status: string) {
  const response = NextResponse.redirect(appUrl(`/app/calendar?google=${status}`), 303);
  response.cookies.set(COOKIE, '', { path: ROUTE, maxAge: 0 });
  return response;
}

export async function POST(req: NextRequest) {
  const origin = req.headers.get('origin');
  if (origin && origin !== appUrl('/').origin) return new Response(null, { status: 403 });
  const session = await auth();
  if (!session?.user) return NextResponse.redirect(appUrl('/sign-in'), 303);
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) return calendarResult('error');
  try {
    await withTeam(db, active.teamId, session.user.id).requireMembership();
    const state = randomBytes(32).toString('base64url');
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const callback = appUrl(ROUTE);
    const response = NextResponse.redirect(
      googleCalendarAuthorizeUrl(callback.href, state, challenge),
      303,
    );
    response.cookies.set(
      COOKIE,
      JSON.stringify({
        state,
        verifier,
        teamId: active.teamId,
        userId: session.user.id,
        expiresAt: Date.now() + 10 * 60_000,
      }),
      {
        httpOnly: true,
        secure: callback.protocol === 'https:',
        sameSite: 'lax',
        path: ROUTE,
        maxAge: 10 * 60,
      },
    );
    return response;
  } catch {
    return calendarResult('error');
  }
}

export async function GET(req: NextRequest) {
  const session = await auth();
  const code = req.nextUrl.searchParams.get('code');
  const state = req.nextUrl.searchParams.get('state');
  const cookie = req.cookies.get(COOKIE)?.value;
  if (!session?.user || !code || !state || !cookie) return calendarResult('error');
  try {
    const transaction = transactionSchema.parse(JSON.parse(cookie) as unknown);
    if (
      transaction.expiresAt <= Date.now() ||
      transaction.state !== state ||
      transaction.userId !== session.user.id
    )
      return calendarResult('error');
    const { active } = await resolveActiveTeam(session.user.id);
    if (active?.teamId !== transaction.teamId) return calendarResult('error');
    const scope = withTeam(db, transaction.teamId, session.user.id);
    await scope.requireMembership();
    const token = await exchangeGoogleCalendarCode(code, appUrl(ROUTE).href, transaction.verifier);
    await scope.calendar.google.connect(token);
    return calendarResult('connected');
  } catch {
    return calendarResult('error');
  }
}

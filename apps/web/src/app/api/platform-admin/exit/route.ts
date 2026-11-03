import {
  IMPERSONATION_COOKIE,
  endImpersonation,
  requirePlatformActor,
  PlatformAccessError,
} from '@timeline/shared/platform-admin';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { realAuth } from '@/lib/auth';
import { db } from '@/lib/db';

export async function POST(request: Request) {
  if (request.headers.get('origin') !== new URL(request.url).origin)
    return new Response('Forbidden', { status: 403 });
  const session = await realAuth();
  const jar = await cookies();
  const token = jar.get(IMPERSONATION_COOKIE)?.value;
  if (session?.user && token) await endImpersonation(db, session.user.id, token);
  jar.delete(IMPERSONATION_COOKIE);
  let destination = session?.user ? '/app' : '/sign-in';
  if (session?.user) {
    try {
      await requirePlatformActor(db, { userId: session.user.id, email: session.user.email ?? '' });
      destination = '/app/admin';
    } catch (error) {
      if (!(error instanceof PlatformAccessError)) throw error;
    }
  }
  return NextResponse.redirect(new URL(destination, request.url), 303);
}

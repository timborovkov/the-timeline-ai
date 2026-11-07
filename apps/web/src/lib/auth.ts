import { getDb, users } from '@timeline/db';
import {
  IMPERSONATION_COOKIE,
  PlatformAccessError,
  resolveImpersonation,
} from '@timeline/shared/platform-admin';
import { registerOperatorContextResolver } from '@timeline/shared/platform-admin/runtime';
import { eq } from 'drizzle-orm';
import { cookies, headers } from 'next/headers';
import { cache } from 'react';

import { auth as baseAuth } from '@/lib/auth-base';
import { db } from '@/lib/db';
export { handlers, signIn, updateSession, hasGitHubAuth } from '@/lib/auth-base';

export const realAuth = baseAuth;
export const getRequestIdentity = cache(async () => {
  initializeOperatorRequestContext();
  const session = await baseAuth();
  if (!session?.user) return { session: null, impersonation: null };
  const [user] = await db
    .select({ suspendedAt: users.suspendedAt })
    .from(users)
    .where(eq(users.id, session.user.id));
  if (!user || user.suspendedAt) return { session: null, impersonation: null };
  const path = (await headers()).get('x-timeline-path') ?? '';
  if (path.startsWith('/app/admin') || path.startsWith('/api/platform-admin'))
    return { session, impersonation: null };
  const token = (await cookies()).get(IMPERSONATION_COOKIE)?.value;
  if (!token) return { session, impersonation: null };
  try {
    const impersonation = await resolveImpersonation(
      // Expiry revocation is authentication bookkeeping. The effective-user
      // write guard itself resolves this identity, so it must not wrap this store.
      getDb(),
      { userId: session.user.id, email: session.user.email ?? '' },
      token,
    );
    return { session, impersonation };
  } catch (error) {
    if (error instanceof PlatformAccessError) return { session: null, impersonation: null };
    throw error;
  }
});

/** Existing consumers receive the effective identity; privileged operations use realAuth. */
export async function auth() {
  initializeOperatorRequestContext();
  const { session, impersonation } = await getRequestIdentity();
  if (!session || !impersonation) return session;
  const requestHeaders = await headers();
  const path = requestHeaders.get('x-timeline-path') ?? '';
  if (path.startsWith('/app/admin') || path.startsWith('/api/platform-admin')) return session;
  return {
    ...session,
    user: {
      ...session.user,
      id: impersonation.user.id,
      name: impersonation.user.name,
      email: impersonation.user.email,
    },
  };
}

function initializeOperatorRequestContext(): void {
  registerOperatorContextResolver(async () => {
    const { session, impersonation } = await getRequestIdentity();
    if (!session || !impersonation) return null;
    const path = (await headers()).get('x-timeline-path') ?? '';
    if (path.startsWith('/app/admin') || path.startsWith('/api/platform-admin')) return null;
    return {
      actorUserId: session.user.id,
      actorEmail: session.user.email ?? '',
      effectiveUserId: impersonation.user.id,
      teamId: impersonation.session.teamId,
      sessionId: impersonation.session.id,
      readOnly: impersonation.readOnly,
    };
  });
}

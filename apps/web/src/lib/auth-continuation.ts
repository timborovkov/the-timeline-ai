import { createHash, randomBytes } from 'node:crypto';

import { authContinuations, users, type Db } from '@timeline/db';
import { and, desc, eq, gt, lt } from 'drizzle-orm';

import { safeSameOriginPath } from '@/lib/safe-redirect';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');

export async function createAuthContinuation(
  db: Db,
  userId: string,
  callback?: string,
): Promise<string | undefined> {
  // Account-menu resends have no callback; retain the latest live account-bound intent.
  const [pending] = callback
    ? []
    : await db
        .select({ destination: authContinuations.destination })
        .from(authContinuations)
        .where(
          and(eq(authContinuations.userId, userId), gt(authContinuations.expiresAt, new Date())),
        )
        .orderBy(desc(authContinuations.expiresAt))
        .limit(1);
  const destination = safeSameOriginPath(callback ?? pending?.destination, '', {
    blockedPaths: ['/sign-in', '/sign-up'],
  });
  // Only OAuth authorization needs a durable continuation. Pricing retains its fixed intent.
  if (new URL(destination || '/', 'https://local.invalid').pathname !== '/oauth/authorize')
    return undefined;
  const token = randomBytes(32).toString('base64url');
  const now = new Date();
  await db
    .delete(authContinuations)
    .where(and(eq(authContinuations.userId, userId), lt(authContinuations.expiresAt, now)));
  await db.insert(authContinuations).values({
    tokenHash: digest(token),
    userId,
    destination,
    expiresAt: new Date(now.getTime() + 86400000),
  });
  return token;
}

export async function resolveAuthContinuation(
  db: Db,
  token: string,
  email: string,
): Promise<string | null> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const [row] = await db
    .select({ destination: authContinuations.destination })
    .from(authContinuations)
    .innerJoin(users, eq(users.id, authContinuations.userId))
    .where(
      and(
        eq(authContinuations.tokenHash, digest(token)),
        eq(users.email, email.toLowerCase()),
        gt(authContinuations.expiresAt, new Date()),
      ),
    )
    .limit(1);
  return row
    ? safeSameOriginPath(row.destination, '/app', { blockedPaths: ['/sign-in', '/sign-up'] })
    : null;
}

import { createHash, randomBytes } from 'node:crypto';

import { authContinuations, users, type Db } from '@timeline/db';
import { and, desc, eq, gt, sql } from 'drizzle-orm';

import { safeSameOriginPath } from '@/lib/safe-redirect';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');

function authorizationDestination(value: string | null | undefined): string | null {
  const destination = safeSameOriginPath(value ?? undefined, '', {
    blockedPaths: ['/sign-in', '/sign-up'],
  });
  return new URL(destination || '/', 'https://local.invalid').pathname === '/oauth/authorize'
    ? destination
    : null;
}

export async function createAuthContinuation(
  db: Db,
  userId: string,
  callback?: string,
): Promise<string | undefined> {
  const requested = authorizationDestination(callback);
  return db.transaction(async (tx) => {
    // Account-menu resends pass the current page, not the original authorize URL.
    // Keep the latest live account-bound OAuth destination in that case.
    const [pending] = requested
      ? []
      : await tx
          .select({ destination: authContinuations.destination })
          .from(authContinuations)
          .where(
            and(eq(authContinuations.userId, userId), gt(authContinuations.expiresAt, new Date())),
          )
          .orderBy(desc(authContinuations.expiresAt))
          .limit(1);
    const destination = requested ?? authorizationDestination(pending?.destination);
    if (!destination) return undefined;
    const token = randomBytes(32).toString('base64url');
    const now = new Date();
    await tx.delete(authContinuations).where(eq(authContinuations.userId, userId));
    await tx.insert(authContinuations).values({
      tokenHash: digest(token),
      userId,
      destination,
      expiresAt: new Date(now.getTime() + 86400000),
    });
    return token;
  });
}

export async function resolveAuthContinuation(
  db: Db,
  token: string,
  email: string,
): Promise<string | null> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const tokenHash = digest(token);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ destination: authContinuations.destination })
      .from(authContinuations)
      .innerJoin(users, eq(users.id, authContinuations.userId))
      .where(
        and(
          eq(authContinuations.tokenHash, tokenHash),
          sql`lower(${users.email}) = ${email.toLowerCase()}`,
          gt(authContinuations.expiresAt, new Date()),
        ),
      )
      .limit(1)
      .for('update');
    if (!row) return null;
    await tx.delete(authContinuations).where(eq(authContinuations.tokenHash, tokenHash));
    return authorizationDestination(row.destination);
  });
}

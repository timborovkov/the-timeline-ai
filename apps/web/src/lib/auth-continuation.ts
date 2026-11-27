import { createHash, randomBytes } from 'node:crypto';

import { authContinuations, users, type Db } from '@timeline/db';
import { and, desc, eq, gt, sql } from 'drizzle-orm';
import { decode, encode } from 'next-auth/jwt';

import { isGuestInvitePath } from '@/lib/auth-redirect';
import { authConfig } from '@/lib/auth.config';
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

const guestPrefix = 'guest:';
const guestSalt = 'guest-invitation-email-continuation';

async function encodeDestination(destination: string, userId: string): Promise<string> {
  if (!isGuestInvitePath(destination)) return destination;
  const secret = authConfig.secret;
  if (!secret) throw new Error('AUTH_SECRET is required');
  // The guest invitation itself is a credential. Keep the existing
  // continuation opaque without adding a copy of that credential to the DB.
  return (
    guestPrefix +
    (await encode({
      token: { sub: userId, destination },
      secret,
      salt: guestSalt,
      maxAge: 86400,
    }))
  );
}

async function decodeDestination(
  stored: string | undefined,
  userId: string,
): Promise<string | null> {
  if (!stored?.startsWith(guestPrefix)) return authorizationDestination(stored);
  const secret = authConfig.secret;
  if (!secret) return null;
  try {
    const token = await decode({
      token: stored.slice(guestPrefix.length),
      secret,
      salt: guestSalt,
    });
    return token?.sub === userId &&
      typeof token.destination === 'string' &&
      isGuestInvitePath(token.destination)
      ? token.destination
      : null;
  } catch {
    return null;
  }
}

export async function createAuthContinuation(
  db: Db,
  userId: string,
  callback?: string,
): Promise<string | undefined> {
  const safe = safeSameOriginPath(callback, '', { blockedPaths: ['/sign-in', '/sign-up'] });
  const requested = isGuestInvitePath(safe) ? safe : authorizationDestination(safe);
  return db.transaction(async (tx) => {
    // Account-menu resends pass the current page, not the original authorize URL.
    // Keep the latest live account-bound destination in that case.
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
    const destination = requested ?? (await decodeDestination(pending?.destination, userId));
    if (!destination) return undefined;
    const token = randomBytes(32).toString('base64url');
    const now = new Date();
    await tx.delete(authContinuations).where(eq(authContinuations.userId, userId));
    await tx.insert(authContinuations).values({
      tokenHash: digest(token),
      userId,
      destination: await encodeDestination(destination, userId),
      expiresAt: new Date(now.getTime() + 86400000),
    });
    return token;
  });
}

/**
 * Ensure a parked `/oauth/authorize` destination exists for Welcome resume
 * without rotating an opaque token already emailed for verification.
 */
export async function parkAuthContinuation(
  db: Db,
  userId: string,
  callback: string,
): Promise<void> {
  const destination = authorizationDestination(callback);
  if (!destination) return;
  await db.transaction(async (tx) => {
    const [pending] = await tx
      .select({
        tokenHash: authContinuations.tokenHash,
        destination: authContinuations.destination,
      })
      .from(authContinuations)
      .where(and(eq(authContinuations.userId, userId), gt(authContinuations.expiresAt, new Date())))
      .orderBy(desc(authContinuations.expiresAt))
      .limit(1)
      .for('update');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 86400000);
    if (pending) {
      // Keep the emailed opaque token; refresh destination/expiry in place.
      await tx
        .update(authContinuations)
        .set({ destination, expiresAt })
        .where(eq(authContinuations.tokenHash, pending.tokenHash));
      return;
    }
    await tx.insert(authContinuations).values({
      tokenHash: digest(randomBytes(32).toString('base64url')),
      userId,
      destination,
      expiresAt,
    });
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
      .select({ destination: authContinuations.destination, userId: authContinuations.userId })
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
    return decodeDestination(row.destination, row.userId);
  });
}

/**
 * Read the latest parked `/oauth/authorize` destination for a signed-in user
 * without redeeming it — Welcome resumes consent, while email verification may
 * still redeem the same opaque token later.
 */
export async function peekAuthContinuationForUser(db: Db, userId: string): Promise<string | null> {
  const [row] = await db
    .select({ destination: authContinuations.destination })
    .from(authContinuations)
    .where(and(eq(authContinuations.userId, userId), gt(authContinuations.expiresAt, new Date())))
    .orderBy(desc(authContinuations.expiresAt))
    .limit(1);
  return authorizationDestination(row?.destination) ?? null;
}

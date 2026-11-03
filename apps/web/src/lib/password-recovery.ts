import { createHash, randomBytes } from 'node:crypto';

import { type Db, passwordResetTokens, users } from '@timeline/db';
import { sendMessage } from '@timeline/shared/messaging';
import { hashPassword } from '@timeline/shared/passwords';
import { and, eq, isNotNull, sql } from 'drizzle-orm';

import { reportHandledEvent } from '@/lib/sentry-report';
import { getSiteUrl } from '@/lib/site-url';

const TOKEN_TTL_MS = 30 * 60 * 1000;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function digest(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

// These global identity lookups intentionally precede team authorization.
export async function requestPasswordRecovery(db: Db, email: string): Promise<void> {
  const issued = await db.transaction(async (tx) => {
    const [user] = await tx
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(and(eq(users.email, email.toLowerCase()), isNotNull(users.passwordHash)))
      .for('update');
    if (!user) return null;
    const token = randomBytes(32).toString('base64url');
    const tokenHash = digest(token);
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + TOKEN_TTL_MS);
    await tx.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, user.id));
    await tx
      .insert(passwordResetTokens)
      .values({ userId: user.id, tokenHash, createdAt, expiresAt });
    return { user, token, tokenHash, expiresAt };
  });
  if (!issued) return;
  const result = await sendMessage(
    'password_reset',
    {
      to: issued.user.email,
      resetUrl: `${getSiteUrl()}/reset-password?token=${encodeURIComponent(issued.token)}`,
      expiresAt: issued.expiresAt,
    },
    { db, userId: issued.user.id, teamId: null, dedupeKey: `password_reset:${issued.tokenHash}` },
  );
  if (!result.ok) {
    reportHandledEvent({
      message: 'password_reset_delivery_failed',
      surface: 'server_action',
      operation: 'request_password_reset',
    });
  }
}

export async function passwordResetTokenStatus(
  db: Db,
  token: string,
): Promise<'valid' | 'invalid' | 'expired'> {
  if (!TOKEN_PATTERN.test(token)) return 'invalid';
  const [row] = await db
    .select({ expiresAt: passwordResetTokens.expiresAt })
    .from(passwordResetTokens)
    .where(eq(passwordResetTokens.tokenHash, digest(token)))
    .limit(1);
  if (!row) return 'invalid';
  return row.expiresAt.getTime() <= Date.now() ? 'expired' : 'valid';
}

export async function resetRecoveredPassword(
  db: Db,
  token: string,
  password: string,
): Promise<'reset' | 'invalid' | 'expired'> {
  if (!TOKEN_PATTERN.test(token) || password.length < 8 || password.length > 200) return 'invalid';
  const tokenHash = digest(token);
  const [candidate] = await db
    .select({ userId: passwordResetTokens.userId })
    .from(passwordResetTokens)
    .where(eq(passwordResetTokens.tokenHash, tokenHash))
    .limit(1);
  if (!candidate) return 'invalid';
  return db.transaction(async (tx) => {
    // Use the same user lock as issuance, then re-read the token after acquiring it.
    const [user] = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, candidate.userId), isNotNull(users.passwordHash)))
      .for('update');
    if (!user) return 'invalid';
    const [row] = await tx
      .select()
      .from(passwordResetTokens)
      .where(
        and(eq(passwordResetTokens.userId, user.id), eq(passwordResetTokens.tokenHash, tokenHash)),
      )
      .limit(1);
    if (!row) return 'invalid';
    if (row.expiresAt.getTime() <= Date.now()) return 'expired';
    const passwordHash = await hashPassword(password);
    // Do not allow a token that expired during password hashing to be redeemed.
    if (row.expiresAt.getTime() <= Date.now()) return 'expired';
    await tx
      .update(users)
      .set({
        passwordHash,
        sessionVersion: sql`${users.sessionVersion} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id));
    await tx.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, user.id));
    return 'reset';
  });
}

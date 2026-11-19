import { createHash, randomBytes } from 'node:crypto';

import { type Db, users, verificationTokens } from '@timeline/db';
import {
  claimOwnedTeamFreeGrantsForVerifiedUser,
  synchronizePolarBillingUser,
  createPolarBillingProvider,
} from '@timeline/shared/billing';
import { sendMessage } from '@timeline/shared/messaging';
import { and, eq, gt, isNull, lt, sql } from 'drizzle-orm';

import { trackProductEventBestEffort } from '@/lib/analytics';
import { createAuthContinuation } from '@/lib/auth-continuation';
import { selectedPlanFromCallback } from '@/lib/auth-redirect';
import { getSiteUrl } from '@/lib/site-url';

const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;

function tokenDigest(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function sendEmailVerification(input: {
  db: Db;
  userId: string;
  email: string;
  teamId?: string | null;
  callbackUrl?: string | undefined;
  now?: Date;
}): Promise<{ ok: boolean; error?: string }> {
  const now = input.now ?? new Date();
  const expiresAt = new Date(now.getTime() + EMAIL_VERIFICATION_TTL_MS);
  const rawToken = randomBytes(32).toString('base64url');
  const token = tokenDigest(rawToken);
  const email = input.email.toLowerCase();

  await input.db
    .delete(verificationTokens)
    .where(and(eq(verificationTokens.identifier, email), lt(verificationTokens.expires, now)));

  await input.db.insert(verificationTokens).values({
    identifier: email,
    token,
    expires: expiresAt,
  });

  const plan = selectedPlanFromCallback(input.callbackUrl);
  const continuation = await createAuthContinuation(input.db, input.userId, input.callbackUrl);
  const verificationUrl = `${getSiteUrl()}/verify-email/${encodeURIComponent(
    rawToken,
  )}?email=${encodeURIComponent(email)}${plan ? `&plan=${plan}` : ''}${continuation ? `&continuation=${continuation}` : ''}`;

  const result = await sendMessage(
    'email_verification',
    { to: email, verificationUrl, expiresAt },
    {
      db: input.db,
      teamId: input.teamId ?? null,
      userId: input.userId,
      dedupeKey: `email_verification:${input.userId}:${token}`,
    },
  );
  return result.ok ? { ok: true } : { ok: false, error: result.error };
}

export async function retryOwnedTeamFreeGrantsAfterSignIn(input: {
  db: Db;
  userId: string;
  emailVerified: Date | string | null | undefined;
}): Promise<void> {
  if (!input.emailVerified) return;
  await claimOwnedTeamFreeGrantsForVerifiedUser({ db: input.db, userId: input.userId });
}

async function runPostEmailVerificationSideEffects(input: {
  db: Db;
  userId: string;
}): Promise<void> {
  try {
    await claimOwnedTeamFreeGrantsForVerifiedUser({ db: input.db, userId: input.userId });
  } catch {
    // Email is already verified; grant claim retries on the next signed-in load.
  }
  try {
    await synchronizePolarBillingUser({
      db: input.db,
      userId: input.userId,
      provider: createPolarBillingProvider(),
    });
  } catch {
    // Billing access retries verification + member sync before any new portal session.
  }
  trackProductEventBestEffort({ kind: 'user', userId: input.userId }, 'email_verified', {});
}

export async function markEmailVerifiedFromTrustedOAuth(input: {
  db: Db;
  userId: string;
  now?: Date;
}): Promise<boolean> {
  const now = input.now ?? new Date();
  const updated = await input.db
    .update(users)
    .set({ emailVerified: now, updatedAt: now })
    .where(and(eq(users.id, input.userId), isNull(users.emailVerified)))
    .returning({ id: users.id });
  if (!updated[0]?.id) return false;
  await runPostEmailVerificationSideEffects({ db: input.db, userId: input.userId });
  return true;
}

interface EmailVerificationToken {
  db: Db;
  email: string;
  token: string;
  now?: Date;
}

function verificationTokenMatch(email: string, token: string) {
  return and(
    eq(verificationTokens.identifier, email.toLowerCase()),
    eq(verificationTokens.token, tokenDigest(token)),
  );
}

export async function inspectEmailVerificationToken(
  input: EmailVerificationToken,
): Promise<'confirm' | 'expired' | 'invalid'> {
  const now = input.now ?? new Date();
  const [row] = await input.db
    .select({ expires: verificationTokens.expires })
    .from(verificationTokens)
    .where(verificationTokenMatch(input.email, input.token))
    .limit(1);
  return row ? (row.expires > now ? 'confirm' : 'expired') : 'invalid';
}

export async function verifyEmailToken(
  input: EmailVerificationToken,
): Promise<'verified' | 'expired' | 'invalid'> {
  const now = input.now ?? new Date();
  const email = input.email.toLowerCase();
  const match = verificationTokenMatch(email, input.token);
  const userEmail = sql`lower(${users.email}) = ${email}`;
  const confirmation = await input.db.transaction(async (tx) => {
    const [claimed] = await tx
      .delete(verificationTokens)
      .where(and(match, gt(verificationTokens.expires, now)))
      .returning({ token: verificationTokens.token });
    if (!claimed) {
      const [remaining] = await tx
        .select({ expires: verificationTokens.expires })
        .from(verificationTokens)
        .where(match)
        .limit(1);
      return { status: remaining ? 'expired' : 'invalid' } as const;
    }

    const accounts = await tx
      .select({ id: users.id, verifiedAt: users.emailVerified })
      .from(users)
      .where(userEmail)
      .limit(2)
      .for('update');
    const [account] = accounts;
    if (!account || accounts.length !== 1) return { status: 'invalid' } as const;
    if (account.verifiedAt) return { status: 'verified' } as const;

    await tx
      .update(users)
      .set({ emailVerified: now, updatedAt: now })
      .where(eq(users.id, account.id));
    return { status: 'verified', newlyVerifiedUserId: account.id } as const;
  });
  if (confirmation.newlyVerifiedUserId) {
    await runPostEmailVerificationSideEffects({
      db: input.db,
      userId: confirmation.newlyVerifiedUserId,
    });
  }
  return confirmation.status;
}

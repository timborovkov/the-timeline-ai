import { createHash, randomBytes } from 'node:crypto';

import { type Db, users, verificationTokens } from '@timeline/db';
import { claimOwnedTeamFreeGrantsForVerifiedUser } from '@timeline/shared/billing';
import { sendMessage } from '@timeline/shared/messaging';
import { and, eq, lt, sql } from 'drizzle-orm';

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

  const verificationUrl = `${getSiteUrl()}/verify-email/${encodeURIComponent(
    rawToken,
  )}?email=${encodeURIComponent(email)}`;

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

export async function verifyEmailToken(input: {
  db: Db;
  email: string;
  token: string;
  now?: Date;
}): Promise<'verified' | 'expired' | 'invalid'> {
  const now = input.now ?? new Date();
  const email = input.email.toLowerCase();
  const digest = tokenDigest(input.token);
  const rows = await input.db
    .select()
    .from(verificationTokens)
    .where(and(eq(verificationTokens.identifier, email), eq(verificationTokens.token, digest)))
    .limit(1);
  const row = rows[0];
  if (!row) return 'invalid';
  if (row.expires < now) {
    await input.db
      .delete(verificationTokens)
      .where(and(eq(verificationTokens.identifier, email), eq(verificationTokens.token, digest)));
    return 'expired';
  }

  const updated = await input.db.transaction(async (tx) => {
    const updatedUsers = await tx
      .update(users)
      .set({ emailVerified: now, updatedAt: now })
      .where(sql`lower(${users.email}) = ${email}`)
      .returning({ id: users.id });
    await tx
      .delete(verificationTokens)
      .where(and(eq(verificationTokens.identifier, email), eq(verificationTokens.token, digest)));
    return updatedUsers;
  });
  const userId = updated[0]?.id;
  if (!userId) return 'invalid';
  try {
    await claimOwnedTeamFreeGrantsForVerifiedUser({ db: input.db, userId });
  } catch {
    // Email is already verified; grant claim retries on the next signed-in load.
  }
  return 'verified';
}

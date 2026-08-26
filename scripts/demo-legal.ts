import type { Db } from '@timeline/db';
import { legalAcceptances, users } from '@timeline/db';
import { PRIVACY_VERSION, TERMS_VERSION } from '@timeline/shared/legal-versions';
import { and, eq, inArray } from 'drizzle-orm';

type SeedTx = Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * Seed one immutable acceptance for the current legal bundle, then make each
 * user's fast snapshot match the preserved event. A rerun never rewrites an
 * existing acceptance timestamp.
 */
export async function seedCurrentLegalAcceptances(
  tx: SeedTx,
  userIds: readonly string[],
  acceptedAt: Date,
): Promise<void> {
  const uniqueUserIds = [...new Set(userIds)];
  if (uniqueUserIds.length === 0) return;

  await tx
    .insert(legalAcceptances)
    .values(
      uniqueUserIds.map((userId) => ({
        userId,
        termsVersion: TERMS_VERSION,
        privacyVersion: PRIVACY_VERSION,
        acceptedAt,
        source: 'credentials_signup' as const,
      })),
    )
    .onConflictDoNothing({
      target: [
        legalAcceptances.userId,
        legalAcceptances.termsVersion,
        legalAcceptances.privacyVersion,
      ],
    });

  const acceptances = await tx
    .select({ userId: legalAcceptances.userId, acceptedAt: legalAcceptances.acceptedAt })
    .from(legalAcceptances)
    .where(
      and(
        inArray(legalAcceptances.userId, uniqueUserIds),
        eq(legalAcceptances.termsVersion, TERMS_VERSION),
        eq(legalAcceptances.privacyVersion, PRIVACY_VERSION),
      ),
    );

  if (acceptances.length !== uniqueUserIds.length) {
    throw new Error('Failed to seed current legal acceptance evidence for every demo user');
  }

  for (const acceptance of acceptances) {
    const updated = await tx
      .update(users)
      .set({
        legalTermsVersion: TERMS_VERSION,
        legalPrivacyVersion: PRIVACY_VERSION,
        legalAcceptedAt: acceptance.acceptedAt,
        updatedAt: acceptance.acceptedAt,
      })
      .where(eq(users.id, acceptance.userId))
      .returning({ id: users.id });
    if (!updated[0]) throw new Error(`Demo legal acceptance user ${acceptance.userId} is missing`);
  }
}

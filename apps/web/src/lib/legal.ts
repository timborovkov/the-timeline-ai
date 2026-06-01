import { users } from '@timeline/db';
import { eq } from 'drizzle-orm';

import { db } from '@/lib/db';
import { PRIVACY_VERSION, TERMS_VERSION } from '@/lib/legal-versions';

export function hasCurrentLegalAcceptance(user: {
  legalTermsVersion: string | null;
  legalPrivacyVersion: string | null;
  legalAcceptedAt: Date | null;
}): boolean {
  return (
    user.legalTermsVersion === TERMS_VERSION &&
    user.legalPrivacyVersion === PRIVACY_VERSION &&
    Boolean(user.legalAcceptedAt)
  );
}

export async function getUserLegalAcceptance(userId: string) {
  const rows = await db
    .select({
      legalTermsVersion: users.legalTermsVersion,
      legalPrivacyVersion: users.legalPrivacyVersion,
      legalAcceptedAt: users.legalAcceptedAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return rows[0] ?? null;
}

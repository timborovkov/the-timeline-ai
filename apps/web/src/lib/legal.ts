import { isIP } from 'node:net';

import { type Db, legalAcceptances, type LegalAcceptanceSource, users } from '@timeline/db';
import { and, eq } from 'drizzle-orm';

import { db } from '@/lib/db';
import { PRIVACY_VERSION, TERMS_VERSION } from '@/lib/legal-versions';
import { clientIpFromHeaders } from '@/lib/request-ip';

export type LegalAcceptanceTransaction = Parameters<Parameters<Db['transaction']>[0]>[0];

const MAX_USER_AGENT_LENGTH = 512;

export interface LegalAcceptanceRequestMetadata {
  ipAddress: string | null;
  userAgent: string | null;
}

export interface RecordCurrentLegalAcceptanceInput extends LegalAcceptanceRequestMetadata {
  userId: string;
  source: Exclude<LegalAcceptanceSource, 'legacy_snapshot'>;
  acceptedAt?: Date;
}

export interface RecordedLegalAcceptance {
  id: string;
  termsVersion: string;
  privacyVersion: string;
  acceptedAt: Date;
  recordedAt: Date;
}

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

export function legalAcceptanceRequestMetadata(headers: Headers): LegalAcceptanceRequestMetadata {
  const observedIp = clientIpFromHeaders(headers);
  const rawUserAgent = headers.get('user-agent')?.trim() ?? '';
  return {
    // Proxy headers are evidentiary request context, not proof of identity. Keep
    // only a syntactically valid address and never make acceptance depend on it.
    ipAddress: observedIp && isIP(observedIp) !== 0 ? observedIp : null,
    userAgent: rawUserAgent ? rawUserAgent.slice(0, MAX_USER_AGENT_LENGTH) : null,
  };
}

/**
 * Record one immutable event for the current document-version pair and update
 * the users-table snapshot in the caller's transaction. Replays preserve the
 * first event (including its timestamp and request metadata) while repairing
 * the current-state snapshot if necessary.
 */
export async function recordCurrentLegalAcceptance(
  tx: LegalAcceptanceTransaction,
  input: RecordCurrentLegalAcceptanceInput,
): Promise<RecordedLegalAcceptance> {
  const attemptedAt = input.acceptedAt ?? new Date();
  const inserted = await tx
    .insert(legalAcceptances)
    .values({
      userId: input.userId,
      termsVersion: TERMS_VERSION,
      privacyVersion: PRIVACY_VERSION,
      acceptedAt: attemptedAt,
      source: input.source,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    })
    .onConflictDoNothing({
      target: [
        legalAcceptances.userId,
        legalAcceptances.termsVersion,
        legalAcceptances.privacyVersion,
      ],
    })
    .returning({
      id: legalAcceptances.id,
      termsVersion: legalAcceptances.termsVersion,
      privacyVersion: legalAcceptances.privacyVersion,
      acceptedAt: legalAcceptances.acceptedAt,
      recordedAt: legalAcceptances.recordedAt,
    });

  const acceptance =
    inserted[0] ??
    (
      await tx
        .select({
          id: legalAcceptances.id,
          termsVersion: legalAcceptances.termsVersion,
          privacyVersion: legalAcceptances.privacyVersion,
          acceptedAt: legalAcceptances.acceptedAt,
          recordedAt: legalAcceptances.recordedAt,
        })
        .from(legalAcceptances)
        .where(
          and(
            eq(legalAcceptances.userId, input.userId),
            eq(legalAcceptances.termsVersion, TERMS_VERSION),
            eq(legalAcceptances.privacyVersion, PRIVACY_VERSION),
          ),
        )
        .limit(1)
    )[0];
  if (!acceptance) throw new Error('Failed to record legal acceptance');

  const updated = await tx
    .update(users)
    .set({
      legalTermsVersion: acceptance.termsVersion,
      legalPrivacyVersion: acceptance.privacyVersion,
      legalAcceptedAt: acceptance.acceptedAt,
      updatedAt: attemptedAt,
    })
    .where(eq(users.id, input.userId))
    .returning({ id: users.id });
  if (!updated[0]) throw new Error('Legal acceptance user no longer exists');

  return acceptance;
}

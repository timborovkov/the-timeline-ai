'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { auth, updateSession } from '@/lib/auth';
import { db } from '@/lib/db';
import { legalAcceptanceRequestMetadata, recordCurrentLegalAcceptance } from '@/lib/legal';
import { PRIVACY_VERSION, TERMS_VERSION } from '@/lib/legal-versions';
import { safeSameOriginPath } from '@/lib/safe-redirect';
import { runSentryServerAction } from '@/lib/sentry-action';

const acceptLegalSchema = z.object({
  accepted: z.literal('on'),
  returnTo: z.string().max(2048).optional(),
  termsVersion: z.literal(TERMS_VERSION),
  privacyVersion: z.literal(PRIVACY_VERSION),
});

const LEGAL_VERSION_CHANGED_ERROR =
  'The Terms of Use or Privacy Policy changed. Reload this page and review the current versions before accepting.';

export interface AcceptLegalState {
  error?: string;
}

export async function acceptLegalAction(
  _prev: AcceptLegalState,
  formData: FormData,
): Promise<AcceptLegalState> {
  return runSentryServerAction('accept_legal', async () => {
    const session = await auth();
    if (!session?.user) redirect('/sign-in?callbackUrl=/legal/accept');

    const submittedTermsVersion = formData.get('termsVersion');
    const submittedPrivacyVersion = formData.get('privacyVersion');
    if (submittedTermsVersion !== TERMS_VERSION || submittedPrivacyVersion !== PRIVACY_VERSION) {
      return { error: LEGAL_VERSION_CHANGED_ERROR };
    }

    const parsed = acceptLegalSchema.safeParse({
      accepted: formData.get('accepted'),
      returnTo: formData.get('returnTo') ?? undefined,
      termsVersion: submittedTermsVersion,
      privacyVersion: submittedPrivacyVersion,
    });
    if (!parsed.success) {
      return { error: 'You must agree before continuing.' };
    }

    const requestMetadata = legalAcceptanceRequestMetadata(await headers());
    await db.transaction((tx) =>
      recordCurrentLegalAcceptance(tx, {
        userId: session.user.id,
        source: 'legal_gate',
        ...requestMetadata,
      }),
    );

    // Trigger Auth.js' server-side update path. The JWT callback deliberately
    // ignores client/session fields and re-reads the committed DB snapshot.
    await updateSession({});

    redirect(
      safeSameOriginPath(parsed.data.returnTo, '/app', {
        blockedPaths: ['/legal/accept', '/sign-in', '/sign-up'],
      }),
    );
  });
}

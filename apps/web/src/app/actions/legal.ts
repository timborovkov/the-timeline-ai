'use server';

import { users } from '@timeline/db';
import { eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { PRIVACY_VERSION, TERMS_VERSION } from '@/lib/legal-versions';
import { safeSameOriginPath } from '@/lib/safe-redirect';
import { runSentryServerAction } from '@/lib/sentry-action';

const acceptLegalSchema = z.object({
  accepted: z.literal('on'),
  returnTo: z.string().max(2048).optional(),
});

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

    const parsed = acceptLegalSchema.safeParse({
      accepted: formData.get('accepted'),
      returnTo: formData.get('returnTo') ?? undefined,
    });
    if (!parsed.success) {
      return { error: 'You must agree before continuing.' };
    }

    await db
      .update(users)
      .set({
        legalTermsVersion: TERMS_VERSION,
        legalPrivacyVersion: PRIVACY_VERSION,
        legalAcceptedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(users.id, session.user.id));

    redirect(
      safeSameOriginPath(parsed.data.returnTo, '/app', {
        blockedPaths: ['/legal/accept', '/sign-in', '/sign-up'],
      }),
    );
  });
}

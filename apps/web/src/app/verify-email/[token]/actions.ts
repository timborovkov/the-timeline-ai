'use server';

import { z } from 'zod';

import type { VerificationState } from '@/app/verify-email/[token]/confirmation';
import { resolveAuthContinuation } from '@/lib/auth-continuation';
import { selectedPlanCallback } from '@/lib/auth-redirect';
import { db } from '@/lib/db';
import { verifyEmailToken } from '@/lib/email-verification';
import { runSentryServerAction } from '@/lib/sentry-action';

const linkSchema = z.object({
  email: z.email().max(254),
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  continuation: z
    .string()
    .regex(/^[A-Za-z0-9_-]{43}$/)
    .optional()
    .catch(undefined),
  plan: z.string().max(32).optional().catch(undefined),
});

export async function confirmEmailVerification(
  link: unknown,
  _previousState: VerificationState | null,
): Promise<VerificationState> {
  return runSentryServerAction('confirm_email_verification', async () => {
    const parsed = linkSchema.safeParse(link);
    if (!parsed.success) return { status: 'invalid' };
    const { email, token, continuation, plan } = parsed.data;
    const status = await verifyEmailToken({ db, email, token });
    if (status !== 'verified') return { status };

    const destination = continuation
      ? await resolveAuthContinuation(db, continuation, email)
      : null;
    const callback = destination ?? selectedPlanCallback(plan);
    return {
      status,
      continuationExpired: Boolean(continuation && !destination),
      next: destination ? 'agent' : callback ? 'billing' : 'dashboard',
      href: callback ? `/sign-in?callbackUrl=${encodeURIComponent(callback)}` : '/app',
    };
  });
}

import type { Metadata } from 'next';

import { confirmEmailVerification } from '@/app/verify-email/[token]/actions';
import { EmailVerificationConfirmation } from '@/app/verify-email/[token]/confirmation';
import { db } from '@/lib/db';
import { inspectEmailVerificationToken } from '@/lib/email-verification';

export const metadata: Metadata = {
  title: 'Verify email',
  robots: { index: false, follow: false },
};

export default async function VerifyEmailPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ email?: string; plan?: string; continuation?: string }>;
}) {
  const [{ token }, query] = await Promise.all([params, searchParams]);
  const email = typeof query.email === 'string' ? query.email : '';
  const initialStatus =
    email && email.length <= 254 && /^[A-Za-z0-9_-]{43}$/.test(token)
      ? await inspectEmailVerificationToken({ db, email, token })
      : 'invalid';

  return (
    <EmailVerificationConfirmation
      initialStatus={initialStatus}
      confirmAction={confirmEmailVerification.bind(null, {
        email,
        token,
        continuation: query.continuation,
        plan: query.plan,
      })}
    />
  );
}

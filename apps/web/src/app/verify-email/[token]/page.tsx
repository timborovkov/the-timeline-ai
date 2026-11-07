import Link from 'next/link';

import type { Metadata } from 'next';

import { AuthShell } from '@/components/auth-shell';
import { Button } from '@/components/ui/button';
import { resolveAuthContinuation } from '@/lib/auth-continuation';
import { selectedPlanCallback } from '@/lib/auth-redirect';
import { db } from '@/lib/db';
import { verifyEmailToken } from '@/lib/email-verification';

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
  const result = email ? await verifyEmailToken({ db, email, token }) : 'invalid';
  const continuation =
    result === 'verified' && query.continuation
      ? await resolveAuthContinuation(db, query.continuation, email)
      : null;
  const expiredContinuation = result === 'verified' && Boolean(query.continuation) && !continuation;
  const callback = continuation ?? selectedPlanCallback(query.plan);
  const copy = verificationCopy(result, continuation, expiredContinuation, callback);

  return (
    <AuthShell title={copy.title} subtitle={copy.body}>
      <Button asChild className="w-fit">
        <Link href={copy.href}>{copy.action}</Link>
      </Button>
    </AuthShell>
  );
}

function verificationCopy(
  result: string,
  continuation: string | null,
  expiredContinuation: boolean,
  callback: string | undefined | null,
) {
  return result === 'verified'
    ? {
        title: 'Email verified',
        body: expiredContinuation
          ? 'Email verified. Your agent connection request expired. Restart authorization from your agent to connect it.'
          : 'Thanks. This email address is now confirmed for your Timeline account.',
        action: continuation
          ? 'Continue connecting your agent'
          : callback
            ? 'Continue to billing'
            : 'Open dashboard',
        href: callback ? `/sign-in?callbackUrl=${encodeURIComponent(callback)}` : '/app',
      }
    : result === 'expired'
      ? {
          title: 'Verification link expired',
          body: 'Open your account menu in The Timeline and send yourself a fresh verification email.',
          action: 'Open dashboard',
          href: '/app',
        }
      : {
          title: 'Verification link invalid',
          body: 'This link cannot be used. Open your account menu in The Timeline and resend verification.',
          action: 'Open dashboard',
          href: '/app',
        };
}

import Link from 'next/link';

import type { Metadata } from 'next';

import { AuthShell } from '@/components/auth-shell';
import { ResetPasswordForm } from '@/components/password-recovery-form';
import { db } from '@/lib/db';
import { passwordResetTokenStatus } from '@/lib/password-recovery';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Reset password',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const { token } = await searchParams;
  const rawToken = typeof token === 'string' ? token : '';
  let status: 'valid' | 'invalid' | 'expired' | 'unavailable';
  try {
    status = await passwordResetTokenStatus(db, rawToken);
  } catch {
    status = 'unavailable';
  }
  return (
    <AuthShell
      title="Reset your password"
      subtitle="Choose a new password for your account."
      secondaryPrefix="Back to"
      secondaryHref="/sign-in"
      secondaryLabel="Sign in"
    >
      {status === 'valid' ? (
        <ResetPasswordForm token={rawToken} />
      ) : (
        <div className="space-y-4">
          <p role="alert" className="text-sm text-destructive">
            {status === 'unavailable'
              ? 'Recovery is temporarily unavailable. Please refresh and try again.'
              : status === 'expired'
                ? 'This reset link has expired.'
                : 'This reset link is invalid or has already been used.'}
          </p>
          <Link href="/forgot-password" className="text-sm text-primary hover:underline">
            Request a new reset link
          </Link>
        </div>
      )}
    </AuthShell>
  );
}

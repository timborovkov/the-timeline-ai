import Link from 'next/link';

import type { Metadata } from 'next';

import { Button } from '@/components/ui/button';
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
  searchParams: Promise<{ email?: string }>;
}) {
  const [{ token }, query] = await Promise.all([params, searchParams]);
  const email = typeof query.email === 'string' ? query.email : '';
  const result = email
    ? await verifyEmailToken({ db, email, token }).catch(() => 'invalid' as const)
    : 'invalid';
  const copy =
    result === 'verified'
      ? {
          title: 'Email verified',
          body: 'Thanks. This email address is now confirmed for your Timeline account.',
          action: 'Open dashboard',
          href: '/app',
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

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-16">
      <div className="mb-6 font-mono text-xs uppercase tracking-[0.14em] text-signal">
        The Timeline
      </div>
      <h1 className="text-2xl font-semibold">{copy.title}</h1>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">{copy.body}</p>
      <Button asChild className="mt-6 w-fit">
        <Link href={copy.href}>{copy.action}</Link>
      </Button>
    </main>
  );
}

'use client';

import Link from 'next/link';
import { useActionState } from 'react';

import { AuthShell } from '@/components/auth-shell';
import { Button } from '@/components/ui/button';

export type VerificationState =
  | { status: 'confirm' | 'expired' | 'invalid' }
  | {
      status: 'verified';
      continuationExpired: boolean;
      next: 'agent' | 'billing' | 'dashboard' | 'guest';
      href: string;
    };

const invalidLinkCopy = {
  expired: {
    title: 'Verification link expired',
    body: 'Open your account menu in The Timeline and send yourself a fresh verification email.',
  },
  invalid: {
    title: 'Verification link invalid',
    body: 'This link cannot be used. Open your account menu in The Timeline and resend verification.',
  },
};

export function EmailVerificationConfirmation({
  initialStatus,
  confirmAction,
}: {
  initialStatus: 'confirm' | 'expired' | 'invalid';
  confirmAction: (previousState: VerificationState | null) => Promise<VerificationState>;
}) {
  const [result, submit, pending] = useActionState(confirmAction, null);
  const verification: VerificationState = result ?? { status: initialStatus };
  if (verification.status === 'confirm') {
    return (
      <AuthShell
        title="Confirm your email"
        subtitle="Confirm this email address for your Timeline account."
      >
        <form action={submit}>
          <Button type="submit" disabled={pending}>
            {pending ? 'Confirming email…' : 'Confirm email'}
          </Button>
        </form>
      </AuthShell>
    );
  }

  if (verification.status === 'verified') {
    const action = {
      agent: 'Continue connecting your agent',
      billing: 'Continue to billing',
      dashboard: 'Open dashboard',
      guest: 'Return to guest invitation',
    }[verification.next];
    return (
      <AuthShell
        title="Email verified"
        subtitle={
          verification.continuationExpired
            ? 'Your previous request expired. Reopen the original invitation or restart the request.'
            : 'This email address is now confirmed for your Timeline account.'
        }
      >
        <Button asChild className="w-fit">
          <Link href={verification.href}>{action}</Link>
        </Button>
      </AuthShell>
    );
  }

  const copy = invalidLinkCopy[verification.status];
  return (
    <AuthShell title={copy.title} subtitle={copy.body}>
      <Button asChild className="w-fit">
        <Link href="/app">Open dashboard</Link>
      </Button>
    </AuthShell>
  );
}

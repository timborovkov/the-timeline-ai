'use client';

import Link from 'next/link';

import { AuthShell } from '@/components/auth-shell';
import { ErrorState } from '@/components/error-state';
import { Button } from '@/components/ui/button';

export default function VerifyEmailError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <AuthShell
      title="Email verification"
      subtitle="Confirm the email address for your Timeline account."
    >
      <ErrorState
        title="Unable to verify email"
        description="Email verification could not be confirmed. If you just opened this link, it may already have succeeded. Check your connection, then try again."
        error={error}
        reset={reset}
      />
      <Button asChild variant="outline" className="mt-4 w-fit">
        <Link href="/app">Open dashboard</Link>
      </Button>
    </AuthShell>
  );
}

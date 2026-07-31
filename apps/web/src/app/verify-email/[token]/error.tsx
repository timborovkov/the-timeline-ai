'use client';

import { AuthShell } from '@/components/auth-shell';
import { ErrorState } from '@/components/error-state';

export default function VerifyEmailError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <AuthShell title="Email verification unavailable">
      <ErrorState
        title="Unable to verify email"
        description="Check your connection, then try again."
        error={error}
        reset={reset}
      />
    </AuthShell>
  );
}

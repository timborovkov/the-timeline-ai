'use client';

import { AuthShell } from '@/components/auth-shell';
import { ErrorState } from '@/components/error-state';

export default function SignUpError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <AuthShell title="Create your account" subtitle="Name your team next, then connect one source.">
      <ErrorState
        title="Unable to load account creation"
        description="No account was created by this failed load. Check your connection, then try again."
        error={error}
        reset={reset}
      />
    </AuthShell>
  );
}

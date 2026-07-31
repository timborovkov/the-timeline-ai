'use client';

import { AuthShell } from '@/components/auth-shell';
import { ErrorState } from '@/components/error-state';

export default function SignInError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to your team’s timeline."
      secondaryPrefix="No account yet?"
      secondaryHref="/sign-up"
      secondaryLabel="Create one"
    >
      <ErrorState
        title="Unable to load sign in"
        description="Your account and existing session were not changed. Check your connection, then try again."
        error={error}
        reset={reset}
      />
    </AuthShell>
  );
}

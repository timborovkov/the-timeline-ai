'use client';

import { AuthShell } from '@/components/auth-shell';
import { ErrorState } from '@/components/error-state';

export default function AcceptInviteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <AuthShell title="Invite unavailable">
      <ErrorState
        title="Unable to load invitation"
        description="Check your connection, then try again."
        error={error}
        reset={reset}
      />
    </AuthShell>
  );
}

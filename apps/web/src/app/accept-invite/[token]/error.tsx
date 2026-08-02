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
    <AuthShell title="Accept invitation" subtitle="Review the invitation before joining the team.">
      <ErrorState
        title="Unable to load invitation"
        description="This failed load did not accept your invitation or change your team access. Check your connection, then try again."
        error={error}
        reset={reset}
      />
    </AuthShell>
  );
}

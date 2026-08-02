'use client';

import { AuthShell } from '@/components/auth-shell';
import { ErrorState } from '@/components/error-state';

export default function LegalAcceptanceError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <AuthShell
      maxWidth="lg"
      title="Review The Timeline terms"
      subtitle="Before entering the signed-in product, accept the current Terms of Use and acknowledge the Privacy Policy."
    >
      <ErrorState
        title="Unable to load legal acceptance"
        description="This failed load did not change your legal acceptance. If you just submitted it, that acceptance may already have succeeded. Check your connection, then try again."
        error={error}
        reset={reset}
      />
    </AuthShell>
  );
}

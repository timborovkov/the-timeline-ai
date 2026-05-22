'use client';

import { ErrorState } from '@/components/error-state';

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ErrorState
      title="Something went wrong"
      description="An unexpected error occurred. Reload to try again."
      error={error}
      reset={reset}
    />
  );
}

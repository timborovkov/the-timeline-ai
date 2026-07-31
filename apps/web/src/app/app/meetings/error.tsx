'use client';

import { ErrorState } from '@/components/error-state';
import { PageHeader } from '@/components/page-header';

export default function MeetingsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="space-y-6">
      <PageHeader title="Meetings" />
      <ErrorState
        title="Unable to load meetings"
        description="Your saved links and captured transcripts are unchanged. Check your connection and try again."
        error={error}
        reset={reset}
      />
    </div>
  );
}

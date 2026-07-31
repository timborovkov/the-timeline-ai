'use client';

import { ErrorState } from '@/components/error-state';
import { HistoryBackLink } from '@/components/history-back-link';
import { PageHeader } from '@/components/page-header';
export default function MeetingError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="space-y-6">
      <HistoryBackLink fallbackHref="/app/meetings" label="Meetings" />
      <PageHeader title="Meeting" />
      <ErrorState
        title="Unable to load meeting"
        description="Meeting details could not be loaded. Your captured transcript and saved meeting data are unchanged. Check your connection, then try again."
        error={error}
        reset={reset}
      />
    </div>
  );
}

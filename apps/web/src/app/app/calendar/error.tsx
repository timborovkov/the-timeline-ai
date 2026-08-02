'use client';

import { ErrorState } from '@/components/error-state';
import { PageHeader } from '@/components/page-header';
import { WorkSubnav } from '@/components/work-subnav';

export default function CalendarError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="space-y-6">
      <PageHeader title="Calendar" subtitle="Track deadlines, meetings, and follow-ups." />
      <WorkSubnav current="/app/calendar" />
      <ErrorState
        title="Unable to load calendar"
        description="Your calendar events and saved schedule changes have not changed. Try again."
        error={error}
        reset={reset}
      />
    </div>
  );
}

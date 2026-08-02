'use client';

import { ErrorState } from '@/components/error-state';
import { PageHeader } from '@/components/page-header';

export default function ChatError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="space-y-8">
      <PageHeader title="Ask" subtitle="Ask questions across your timeline context." />
      <ErrorState
        title="Unable to load Ask"
        description="Your saved conversations and captured history have not changed. Check your connection, then try again."
        error={error}
        reset={reset}
      />
    </div>
  );
}

'use client';

import { ErrorState } from '@/components/error-state';
import { PageHeader } from '@/components/page-header';

export default function DocumentsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="space-y-6">
      <PageHeader title="Documents" subtitle="Browse files, folders, and captured knowledge." />
      <ErrorState
        title="Unable to load documents"
        description="Documents could not be loaded. Your files, folders, and captured knowledge are unchanged. Check your connection, then try again."
        error={error}
        reset={reset}
      />
    </div>
  );
}

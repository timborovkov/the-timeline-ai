'use client';

import { Breadcrumb } from '@/components/breadcrumb';
import { ErrorState } from '@/components/error-state';
import { PageHeader } from '@/components/page-header';

export default function CapturedDocumentsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="space-y-6">
      <Breadcrumb
        items={[{ label: 'Documents', href: '/app/documents' }, { label: 'Captured files' }]}
      />
      <PageHeader title="Captured files" />
      <ErrorState
        title="Unable to load captured files"
        description="Captured files could not be loaded. Your captured files have not changed. Check your connection, then try again."
        error={error}
        reset={reset}
      />
    </div>
  );
}

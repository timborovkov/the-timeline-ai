'use client';

import { Breadcrumb } from '@/components/breadcrumb';
import { ErrorState } from '@/components/error-state';
import { PageHeader } from '@/components/page-header';

export default function DocumentError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="space-y-6">
      <Breadcrumb items={[{ label: 'Documents', href: '/app/documents' }, { label: 'Document' }]} />
      <PageHeader title="Document" />
      <ErrorState
        title="Unable to load document"
        description="Document details could not be loaded. Your saved document data is unchanged. Check your connection, then try again."
        error={error}
        reset={reset}
      />
    </div>
  );
}

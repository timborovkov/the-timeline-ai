'use client';

import { Breadcrumb } from '@/components/breadcrumb';
import { ErrorState } from '@/components/error-state';
import { PageHeader } from '@/components/page-header';

export default function ReconciliationError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="space-y-10">
      <Breadcrumb items={[{ label: 'Team', href: '/app/team' }, { label: 'Reconciliation' }]} />
      <PageHeader
        title="Reconciliation"
        subtitle="Review evidence coverage and proposed workspace updates for this team."
      />
      <ErrorState
        title="Unable to load reconciliation"
        description="No evidence, reconciliation outputs, or workspace records have changed. Check your connection, then try again."
        error={error}
        reset={reset}
      />
    </div>
  );
}

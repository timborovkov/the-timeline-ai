'use client';

import { Breadcrumb } from '@/components/breadcrumb';
import { ErrorState } from '@/components/error-state';
import { PageHeader } from '@/components/page-header';

export default function ClusterError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="space-y-8">
      <Breadcrumb
        items={[
          { label: 'Team', href: '/app/team' },
          { label: 'Reconciliation', href: '/app/team/reconciliation' },
          { label: 'Cluster' },
        ]}
      />
      <PageHeader
        title="Reconciliation cluster"
        subtitle="Inspect the evidence and proposed updates connected to this workspace item."
      />
      <ErrorState
        title="Unable to load reconciliation cluster"
        description="No evidence, reconciliation outputs, or workspace records have changed. Check your connection, then try again."
        error={error}
        reset={reset}
      />
    </div>
  );
}

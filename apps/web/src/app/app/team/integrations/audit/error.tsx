'use client';

import { Breadcrumb } from '@/components/breadcrumb';
import { ErrorState } from '@/components/error-state';
import { PageHeader } from '@/components/page-header';

export default function IntegrationAuditError({
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
          { label: 'Integrations', href: '/app/team/integrations' },
          { label: 'Audit log' },
        ]}
      />
      <PageHeader
        title="Integration audit"
        subtitle="Review integration activity and sync history."
      />
      <ErrorState
        title="Unable to load integration audit"
        description="Your team’s integration activity and audit history have not changed. Check your connection, then try again."
        error={error}
        reset={reset}
      />
    </div>
  );
}

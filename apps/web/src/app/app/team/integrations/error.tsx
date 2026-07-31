'use client';

import { Breadcrumb } from '@/components/breadcrumb';
import { ErrorState } from '@/components/error-state';
import { PageHeader } from '@/components/page-header';

export default function IntegrationsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="space-y-8">
      <Breadcrumb items={[{ label: 'Team', href: '/app/team' }, { label: 'Integrations' }]} />
      <PageHeader
        title="Team integrations"
        subtitle="Manage provider sync, source access, and integration recovery for this team."
      />
      <ErrorState
        title="Unable to load team integrations"
        description="Your team’s existing provider connections, shared sources, and sync settings have not changed. Check your connection, then try again."
        error={error}
        reset={reset}
      />
    </div>
  );
}

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
      <Breadcrumb
        items={[{ label: 'Connections', href: '/app/sources' }, { label: 'Integrations' }]}
      />
      <PageHeader
        title="Team integrations"
        subtitle="Team integration settings now live on Connections."
      />
      <ErrorState
        title="Unable to open team integrations"
        description="This failed redirect did not change your provider connections, shared sources, or sync settings. Check your connection, then try again."
        error={error}
        reset={reset}
      />
    </div>
  );
}

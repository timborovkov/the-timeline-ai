'use client';

import { Breadcrumb } from '@/components/breadcrumb';
import { ErrorState } from '@/components/error-state';
import { PageHeader } from '@/components/page-header';

export default function ConnectAgentError({
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
          { label: 'Connections', href: '/app/connections' },
          { label: 'Connect your agent' },
        ]}
      />
      <PageHeader
        title="Connect your agent"
        subtitle="OAuth first. Answers appear once work is captured; remember works now."
      />
      <ErrorState
        title="Unable to load Connect your agent"
        description="This failed load did not change OAuth grants, keys, or webhooks. Check your connection, then try again."
        error={error}
        reset={reset}
      />
    </div>
  );
}

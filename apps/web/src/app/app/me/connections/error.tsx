'use client';

import { Breadcrumb } from '@/components/breadcrumb';
import { ErrorState } from '@/components/error-state';
import { PageHeader } from '@/components/page-header';

export default function PersonalConnectionsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="space-y-8">
      <Breadcrumb
        items={[{ label: 'Connections', href: '/app/sources' }, { label: 'Provider accounts' }]}
      />
      <PageHeader
        title="Provider accounts"
        subtitle="Manage personal OAuth accounts and share allowed sources to the active team."
      />
      <ErrorState
        title="Unable to load provider accounts"
        description="Your existing provider accounts and shared sources have not changed. Try again."
        error={error}
        reset={reset}
      />
    </div>
  );
}

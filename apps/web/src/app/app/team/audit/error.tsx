'use client';

import { Breadcrumb } from '@/components/breadcrumb';
import { ErrorState } from '@/components/error-state';
import { IndexStrip } from '@/components/index-strip';

export default function AuditError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="space-y-8">
      <Breadcrumb items={[{ label: 'Team', href: '/app/team' }, { label: 'Trust audit' }]} />
      <IndexStrip segments={[{ value: 'TRUST AUDIT' }]} srLabel="Trust audit" />
      <ErrorState
        title="Unable to load trust audit"
        description="Your team’s audit history has not changed. Check your connection, then try again."
        error={error}
        reset={reset}
      />
    </div>
  );
}

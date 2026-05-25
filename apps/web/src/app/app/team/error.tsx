'use client';

import { ErrorState } from '@/components/error-state';
import { IndexStrip } from '@/components/index-strip';

export default function TeamError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <IndexStrip
        srLabel="Team · error"
        segments={[
          { value: 'TEAM' },
          { label: 'status', value: 'ERROR', danger: true },
        ]}
      />
      <ErrorState
        title="Couldn't load team settings"
        description="The team settings failed to load. This is usually transient."
        error={error}
        reset={reset}
      />
    </div>
  );
}

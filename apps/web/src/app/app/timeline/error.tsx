'use client';

import { ErrorState } from '@/components/error-state';
import { IndexStrip } from '@/components/index-strip';

export default function TimelineError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="space-y-8">
      <IndexStrip
        srLabel="Timeline · error"
        segments={[{ value: 'TIMELINE' }, { label: 'status', value: 'ERROR', danger: true }]}
      />
      <ErrorState
        title="Couldn't load the timeline"
        description="The feed failed to load. This is usually transient."
        error={error}
        reset={reset}
      />
    </div>
  );
}

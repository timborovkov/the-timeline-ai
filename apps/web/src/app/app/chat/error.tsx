'use client';

import { ErrorState } from '@/components/error-state';
import { IndexStrip } from '@/components/index-strip';

export default function ChatError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <IndexStrip
        srLabel="Chat · error"
        segments={[
          { value: 'CHAT' },
          { label: 'status', value: 'ERROR', danger: true },
        ]}
      />
      <ErrorState
        title="Couldn't open chat"
        description="The chat surface failed to load. This is usually transient."
        error={error}
        reset={reset}
      />
    </div>
  );
}

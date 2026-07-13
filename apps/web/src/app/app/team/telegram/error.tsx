'use client';

import { ErrorState } from '@/components/error-state';
import { IndexStrip } from '@/components/index-strip';

export default function TelegramError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="space-y-8">
      <IndexStrip
        srLabel="Team / Telegram · error"
        segments={[{ value: 'TEAM / TELEGRAM' }, { label: 'status', value: 'ERROR', danger: true }]}
      />
      <ErrorState
        title="Couldn't load Telegram links"
        description="The Telegram integration page failed to load. This is usually transient."
        error={error}
        reset={reset}
      />
    </div>
  );
}

'use client';

import { ErrorState } from '@/components/error-state';
import { HistoryBackLink } from '@/components/history-back-link';
import { PageHeader } from '@/components/page-header';

export default function TelegramError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="space-y-6">
      <HistoryBackLink fallbackHref="/app/team" label="Team settings" />
      <PageHeader
        title="Telegram"
        subtitle="Route chat and voice notes into the same capture pipeline."
      />
      <ErrorState
        title="Unable to load Telegram settings"
        description="Your Telegram links, group bindings, and captured messages have not changed. Check your connection, then try again."
        error={error}
        reset={reset}
      />
    </div>
  );
}

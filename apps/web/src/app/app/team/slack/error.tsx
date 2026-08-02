'use client';

import { ErrorState } from '@/components/error-state';
import { HistoryBackLink } from '@/components/history-back-link';
import { PageHeader } from '@/components/page-header';

export default function ErrorPage({
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
        title="Slack"
        subtitle="Capture DMs, channel messages, slash-command answers, and linked sender context."
      />
      <ErrorState
        title="Unable to load Slack settings"
        description="Your Slack workspace connection, channel bindings, and captured messages have not changed. Check your connection, then try again."
        error={error}
        reset={reset}
      />
    </div>
  );
}

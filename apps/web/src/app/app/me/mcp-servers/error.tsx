'use client';

import { ErrorState } from '@/components/error-state';
import { PageHeader } from '@/components/page-header';

export default function PersonalMcpServersError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="max-w-3xl space-y-8">
      <PageHeader
        title="Personal MCP servers"
        subtitle="Custom external tools that only you can use in chats you start."
      />
      <ErrorState
        title="Unable to open personal MCP servers"
        description="Your personal server settings have not changed. Check your connection and try again."
        error={error}
        reset={reset}
      />
    </div>
  );
}

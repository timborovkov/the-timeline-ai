'use client';

import { ErrorState } from '@/components/error-state';
import { PageHeader } from '@/components/page-header';

export default function McpServersError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto w-full max-w-2xl space-y-8">
      <PageHeader
        title="Team MCP servers"
        subtitle="Team MCP server settings are managed in Integrations."
      />
      <ErrorState
        title="Unable to open team MCP servers"
        description="MCP server settings are managed in Integrations. Your settings have not changed. Try again."
        error={error}
        reset={reset}
      />
    </div>
  );
}

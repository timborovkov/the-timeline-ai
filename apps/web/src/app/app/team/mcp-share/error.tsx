'use client';

import { Breadcrumb } from '@/components/breadcrumb';
import { ErrorState } from '@/components/error-state';
import { PageHeader } from '@/components/page-header';

export default function McpShareError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="space-y-8">
      <Breadcrumb
        items={[
          { label: 'Team', href: '/app/team' },
          { label: 'Integrations', href: '/app/team/integrations' },
          { label: 'Timeline as MCP' },
        ]}
      />
      <PageHeader
        title="Timeline as MCP server"
        subtitle="Expose team-level workspace retrieval to external agents via a bearer-keyed MCP endpoint."
      />
      <ErrorState
        title="Unable to load Timeline as MCP server"
        description="This failed load did not change your MCP settings. If you just created or revoked a key, that change may already have succeeded. Check your connection, then try again."
        error={error}
        reset={reset}
      />
    </div>
  );
}

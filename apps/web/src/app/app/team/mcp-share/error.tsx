'use client';

import { Breadcrumb } from '@/components/breadcrumb';
import { ErrorState } from '@/components/error-state';
import { PageHeader } from '@/components/page-header';
import { CONNECT_AGENT_HREF } from '@/lib/connect-agent-content';

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
          { label: 'Connections', href: CONNECT_AGENT_HREF },
          { label: 'Timeline as MCP' },
        ]}
      />
      <PageHeader
        title="Timeline as MCP server"
        subtitle="Timeline MCP settings now live on Connect your agent."
      />
      <ErrorState
        title="Unable to open Timeline as MCP server"
        description="This failed redirect did not change your MCP settings. Check your connection, then try again."
        error={error}
        reset={reset}
      />
    </div>
  );
}

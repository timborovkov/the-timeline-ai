'use client';

import { useSearchParams } from 'next/navigation';

import { Breadcrumb } from '@/components/breadcrumb';
import { ErrorState } from '@/components/error-state';
import { PageHeader } from '@/components/page-header';

export default function McpServersError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const searchParams = useSearchParams();
  const suffix = searchParams.toString();
  const integrationsHref = `/app/team/integrations${suffix ? `?${suffix}` : ''}`;

  return (
    <div className="space-y-8">
      <Breadcrumb
        items={[
          { label: 'Team', href: '/app/team' },
          { label: 'Integrations', href: integrationsHref },
          { label: 'Team MCP servers' },
        ]}
      />
      <PageHeader
        title="Team MCP servers"
        subtitle="Team MCP server settings are managed in Integrations."
      />
      <ErrorState
        title="Unable to open team MCP servers"
        description="This failed redirect did not change your team MCP server settings. Check your connection, then try again."
        error={error}
        reset={reset}
      />
    </div>
  );
}

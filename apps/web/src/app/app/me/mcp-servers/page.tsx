import { withTeam } from '@timeline/shared/team-scope';
import { redirect } from 'next/navigation';

import type { Metadata } from 'next';

import { Breadcrumb } from '@/components/breadcrumb';
import { McpServersUi } from '@/components/integrations/mcp-servers';
import { PageHeader } from '@/components/page-header';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

export const metadata: Metadata = {
  title: 'My MCP servers',
  description: 'Manage personal MCP server connections.',
};

export const dynamic = 'force-dynamic';

/**
 * Personal MCP overlay. Servers visible only to the owner, layered on
 * top of the team-shared catalog at /app/team/integrations.
 */
export default async function PersonalMcpServersPage() {
  const session = await auth();
  if (!session?.user) redirect('/sign-in');
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) redirect('/sign-in');
  const scope = withTeam(db, active.teamId, session.user.id);
  const servers = await scope.mcp.listPersonalServers();
  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <Breadcrumb
        items={[
          { label: 'Team', href: '/app/team' },
          { label: 'Integrations', href: '/app/team/integrations' },
          { label: 'Personal MCP' },
        ]}
      />
      <PageHeader
        title="Personal MCP servers"
        subtitle="Custom external tools visible only to you, layered on the team catalog."
        srLabel={`Personal MCP servers · ${String(servers.length)} connected`}
        metadata={[
          { label: 'team', value: active.teamName, signal: true },
          { label: 'mine', value: servers.length },
        ]}
      />
      <p className="text-sm text-fg-muted">
        Visible only to you. Tools contribute to chats you start; teammates don&apos;t see them.
      </p>
      <McpServersUi
        ownership="personal"
        servers={servers.map((s) => ({
          id: s.id,
          name: s.name,
          url: s.url,
          authType: s.authType,
          enabled: s.enabled,
          cachedTools: Array.isArray(s.cachedTools)
            ? (s.cachedTools as { name: string; description?: string }[])
            : [],
          disabledTools: Array.isArray(s.disabledTools) ? (s.disabledTools as string[]) : [],
          toolsCachedAt: s.toolsCachedAt ? s.toolsCachedAt.toISOString() : null,
          lastError: s.lastError,
        }))}
      />
    </div>
  );
}

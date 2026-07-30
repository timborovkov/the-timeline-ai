import { withTeam } from '@timeline/shared/team-scope';
import { redirect } from 'next/navigation';

import type { Metadata } from 'next';

import { Breadcrumb } from '@/components/breadcrumb';
import { McpServersUi } from '@/components/integrations/mcp-servers';
import { PageHeader } from '@/components/page-header';
import { SectionHeading } from '@/components/section-heading';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

export const metadata: Metadata = {
  title: 'My MCP servers',
  description: 'Manage MCP server connections that are visible only to you.',
};

export const dynamic = 'force-dynamic';

/**
 * Personal MCP overlay. Servers visible only to the owner, layered on
 * top of the team-shared catalog linked from /app/sources.
 */
export default async function PersonalMcpServersPage() {
  const session = await auth();
  if (!session?.user) redirect('/sign-in');
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) redirect('/sign-in');
  const scope = withTeam(db, active.teamId, session.user.id);
  const servers = await scope.mcp.listPersonalServers();
  return (
    <div className="space-y-8">
      <Breadcrumb
        items={[{ label: 'Connections', href: '/app/sources' }, { label: 'Personal MCP servers' }]}
      />
      <PageHeader
        title="Personal MCP servers"
        subtitle="Custom external tools that only you can use in chats you start."
        srLabel={`Personal MCP servers · ${String(servers.length)} configured`}
        metadata={[
          { label: 'team', value: active.teamName, signal: true },
          { label: 'mine', value: servers.length },
        ]}
      />
      <section className="max-w-3xl space-y-3" aria-labelledby="your-personal-mcp-servers">
        <SectionHeading id="your-personal-mcp-servers">Your personal servers</SectionHeading>
        <p className="text-sm text-fg-muted">
          Only you can see or use these servers. Team-shared MCP servers stay managed in
          Connections.
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
      </section>
    </div>
  );
}

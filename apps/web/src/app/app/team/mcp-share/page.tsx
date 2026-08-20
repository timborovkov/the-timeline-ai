import { mcpOutboundKeys } from '@timeline/db';
import { withTeam } from '@timeline/shared/team-scope';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { redirect } from 'next/navigation';

import type { Metadata } from 'next';

import { Breadcrumb } from '@/components/breadcrumb';
import { McpShareUi } from '@/components/integrations/mcp-share';
import { PageHeader } from '@/components/page-header';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { appUrl } from '@/lib/site-url';

export const metadata: Metadata = {
  title: 'MCP share',
  description: 'Share team-visible timeline context through MCP.',
};

export const dynamic = 'force-dynamic';

/**
 * Timeline-as-MCP-server settings. Admins mint bearer keys that grant
 * outside agents (Claude Desktop, Cursor, etc.) scoped access to the
 * team's events / entities / documents and, when explicitly enabled, the
 * team-level Timeline agent via /api/mcp/server. The
 * MCP endpoint URL is shown here so the agent operator can paste both
 * the URL and the key into their client.
 */
export default async function McpSharePage() {
  const session = await auth();
  if (!session?.user) redirect('/sign-in');
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) redirect('/sign-in');
  const scope = withTeam(db, active.teamId, session.user.id);
  let canManageMcpShare = true;
  try {
    await scope.requireMembership('admin');
  } catch {
    canManageMcpShare = false;
  }
  if (!canManageMcpShare) redirect('/app/team/integrations');
  const rows = await db
    .select()
    .from(mcpOutboundKeys)
    .where(and(eq(mcpOutboundKeys.teamId, active.teamId), isNull(mcpOutboundKeys.revokedAt)))
    .orderBy(desc(mcpOutboundKeys.createdAt));

  const keys = rows.map((r) => ({
    id: r.id,
    name: r.name,
    prefix: r.keyPrefix,
    scopes: Array.isArray(r.scopes) ? (r.scopes as string[]) : ['read'],
    lastUsedAt: r.lastUsedAt ? r.lastUsedAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
  }));

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
        subtitle="Expose team-level workspace retrieval and optional Timeline agent access through a bearer-keyed MCP endpoint."
        srLabel={`Timeline as MCP server · ${String(keys.length)} active keys`}
        metadata={[
          { label: 'team', value: active.teamName, signal: true },
          { label: 'keys', value: keys.length },
        ]}
      />
      <McpShareUi keys={keys} mcpUrl={appUrl('/api/mcp/server').toString()} />
    </div>
  );
}

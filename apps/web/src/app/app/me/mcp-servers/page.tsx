import { withTeam } from '@timeline/shared';
import { redirect } from 'next/navigation';

import { IndexStrip } from '@/components/index-strip';
import { McpServersUi } from '@/components/integrations/mcp-servers';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * Per-user MCP overlay. Personal servers layer on top of the team catalog —
 * visible only to their owner, contributed to the agent's tool list only
 * for chats this user initiates. Mirrors Vernix's user-scoped MCP pattern.
 */
export default async function PersonalMcpServersPage() {
  const session = await auth();
  if (!session?.user) redirect('/sign-in');
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) redirect('/sign-in');
  const scope = withTeam(db, active.teamId, session.user.id);
  const servers = await scope.mcp.listPersonalServers();
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <IndexStrip
        srLabel={`Personal MCP servers · ${String(servers.length)} connected`}
        segments={[
          { value: 'PERSONAL MCP' },
          { label: 'team', value: active.teamName, signal: true },
          { label: 'mine', value: servers.length },
        ]}
      />
      <p className="text-sm text-fg-muted">
        Personal MCP servers are visible only to you and contribute their tools to chats you start.
        Use them for tools tied to your own accounts (e.g. personal Linear, scratch Postgres, your
        own MCP servers in development).
      </p>
      <a
        href="/app/team/mcp-servers"
        className="text-sm text-signal underline-offset-4 hover:underline"
      >
        ← Back to team MCP catalog
      </a>
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

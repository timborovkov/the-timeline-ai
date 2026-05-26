import { withTeam } from '@timeline/shared';
import { redirect } from 'next/navigation';

import { IndexStrip } from '@/components/index-strip';
import { McpServersUi } from '@/components/integrations/mcp-servers';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * Personal MCP overlay. Servers visible only to the owner, layered on
 * top of the team-shared catalog at /app/team/integrations. Same
 * `McpServersUi` component as the team page so add / disable / test-call
 * UX is identical.
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
      <a
        href="/app/team/integrations"
        className="text-sm text-signal underline-offset-4 hover:underline"
      >
        ← Back to integrations
      </a>
      <p className="text-sm text-fg-muted">
        MCP servers visible only to you. Tools from these contribute to chats you start; teammates
        don&apos;t see them. Use this for tools tied to your own accounts (personal Linear, a
        scratch Postgres MCP, an MCP server you&apos;re developing locally).
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

import { mcpOutboundKeys } from '@timeline/db';
import { withTeam } from '@timeline/shared';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { redirect } from 'next/navigation';

import { IndexStrip } from '@/components/index-strip';
import { McpShareUi } from '@/components/integrations/mcp-share';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * Timeline-as-MCP-server settings. Admins mint bearer keys that grant
 * outside agents (Claude Desktop, Cursor, etc.) read-only access
 * to the team's events / entities / documents via /api/mcp/server. The
 * MCP endpoint URL is shown here so the agent operator can paste both
 * the URL and the key into their client.
 */
export default async function McpSharePage() {
  const session = await auth();
  if (!session?.user) redirect('/sign-in');
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) redirect('/sign-in');
  const scope = withTeam(db, active.teamId, session.user.id);
  try {
    await scope.requireMembership('admin');
  } catch {
    redirect('/app/team/integrations');
  }
  const rows = await db
    .select()
    .from(mcpOutboundKeys)
    .where(and(eq(mcpOutboundKeys.teamId, active.teamId), isNull(mcpOutboundKeys.revokedAt)))
    .orderBy(desc(mcpOutboundKeys.createdAt));

  const keys = rows.map((r) => ({
    id: r.id,
    name: r.name,
    prefix: r.keyPrefix,
    lastUsedAt: r.lastUsedAt ? r.lastUsedAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
  }));

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <IndexStrip
        srLabel={`Timeline as MCP server · ${String(keys.length)} active keys`}
        segments={[
          { value: 'TIMELINE AS MCP' },
          { label: 'team', value: active.teamName, signal: true },
          { label: 'keys', value: keys.length },
        ]}
      />
      <a
        href="/app/team/integrations"
        className="text-sm text-signal underline-offset-4 hover:underline"
      >
        ← Back to integrations
      </a>
      <McpShareUi keys={keys} />
    </div>
  );
}

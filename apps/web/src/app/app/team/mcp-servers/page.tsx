import { integrations as integrationsLib, withTeam } from '@timeline/shared';
import { redirect } from 'next/navigation';

import { IndexStrip } from '@/components/index-strip';
import { McpCatalog } from '@/components/integrations/mcp-catalog';
import { McpServersUi } from '@/components/integrations/mcp-servers';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default async function McpServersPage() {
  const session = await auth();
  if (!session?.user) redirect('/sign-in');
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) redirect('/sign-in');
  const scope = withTeam(db, active.teamId, session.user.id);
  // Team catalog only — personal MCPs live at /app/me/mcp-servers so the
  // shared team view doesn't surface another user's private servers.
  const servers = await scope.mcp.listTeamServers();
  const catalog = integrationsLib.listCatalog().filter((c) => c.kind === 'mcp' && c.mcpUrl);
  // Hide entries the team already connected (match by URL).
  const connectedUrls = new Set(servers.map((s) => s.url));
  const catalogAvailable = catalog.filter((c) => !connectedUrls.has(c.mcpUrl ?? ''));
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <IndexStrip
        srLabel={`MCP servers · ${String(servers.length)} connected · ${String(catalogAvailable.length)} in catalog`}
        segments={[
          { value: 'MCP SERVERS' },
          { label: 'team', value: active.teamName, signal: true },
          { label: 'connected', value: servers.length },
          { label: 'catalog', value: catalogAvailable.length },
        ]}
      />
      <a
        href="/app/team/integrations"
        className="text-sm text-signal underline-offset-4 hover:underline"
      >
        ← Back to integrations
      </a>

      {catalogAvailable.length > 0 ? (
        <section className="space-y-3">
          <h2 className="font-mono text-xs uppercase tracking-[0.14em] text-fg-muted">
            One-click connect
          </h2>
          <McpCatalog
            entries={catalogAvailable.map((c) => ({
              id: c.id,
              label: c.label,
              description: c.description,
              logo: c.logo,
              category: c.category,
              authType: c.mcpAuthType ?? 'none',
              authHint: c.mcpAuthHint ?? null,
              status: c.status,
            }))}
          />
        </section>
      ) : null}

      <section className="space-y-3">
        <h2 className="font-mono text-xs uppercase tracking-[0.14em] text-fg-muted">
          Connected & custom servers
        </h2>
        <McpServersUi
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

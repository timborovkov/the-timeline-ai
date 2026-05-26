import { integrations as integrationsLib, withTeam } from '@timeline/shared';
import { redirect } from 'next/navigation';

import { IndexStrip } from '@/components/index-strip';
import { IntegrationsCatalog } from '@/components/integrations/catalog';
import { ConnectedIntegrations } from '@/components/integrations/connected';
import { McpCatalog } from '@/components/integrations/mcp-catalog';
import { McpServersUi } from '@/components/integrations/mcp-servers';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * Single integrations page. Native connectors (Drive/Linear/GitHub),
 * MCP catalog (Notion/Slack/Atlassian/Figma/Sentry/Stripe), connected
 * list, and an "Add custom MCP server" affordance, all on one screen.
 * Separate /app/team/mcp-servers route was killed in favor of this.
 */
export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string; integrationId?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect('/sign-in');
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) redirect('/sign-in');

  const params = await searchParams;
  const scope = withTeam(db, active.teamId, session.user.id);
  const [connected, mcpServers] = await Promise.all([
    scope.integrations.listIntegrations(),
    scope.mcp.listTeamServers(),
  ]);
  const nativeCatalog = integrationsLib.listAvailableProviders();
  const mcpCatalog = integrationsLib.listCatalog().filter((c) => c.kind === 'mcp' && c.mcpUrl);
  // Hide MCP entries already connected (match by URL).
  const connectedUrls = new Set(mcpServers.map((s) => s.url));
  const mcpCatalogAvailable = mcpCatalog.filter((c) => !connectedUrls.has(c.mcpUrl ?? ''));

  const totalConnected = connected.length + mcpServers.length;
  const totalCatalog = nativeCatalog.length + mcpCatalogAvailable.length;

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <IndexStrip
        srLabel={`Integrations · ${String(totalConnected)} connected · ${String(totalCatalog)} in catalog`}
        segments={[
          { value: 'INTEGRATIONS' },
          { label: 'team', value: active.teamName, signal: true },
          { label: 'connected', value: totalConnected },
          { label: 'catalog', value: totalCatalog },
        ]}
      />

      {params.connected ? (
        <div className="rounded-md border border-signal/40 bg-signal/10 px-3 py-2 text-sm text-signal">
          Connected to <span className="font-mono">{params.connected}</span>.
        </div>
      ) : null}
      {params.error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          Connection failed: <span className="font-mono">{params.error}</span>
        </div>
      ) : null}

      {/* Connected section: native + MCP servers, side by side. Empty
          state lets the page lead with the catalog when nothing is
          connected yet. */}
      {totalConnected > 0 ? (
        <section className="space-y-3">
          <h2 className="font-mono text-xs uppercase tracking-[0.14em] text-fg-muted">Connected</h2>
          {connected.length > 0 ? (
            <ConnectedIntegrations
              connected={connected.map((c) => ({
                id: c.id,
                provider: c.provider,
                displayName: c.displayName,
                enabled: c.enabled,
                lastSyncedAt: c.lastSyncedAt ? c.lastSyncedAt.toISOString() : null,
                lastError: c.lastError,
              }))}
            />
          ) : null}
          {mcpServers.length > 0 ? (
            <McpServersUi
              servers={mcpServers.map((s) => ({
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
          ) : null}
        </section>
      ) : null}

      {/* Native integrations (only shown when env vars are configured). */}
      {nativeCatalog.length > 0 ? (
        <section className="space-y-3">
          <h2 className="font-mono text-xs uppercase tracking-[0.14em] text-fg-muted">
            Drive, Linear, GitHub
          </h2>
          <IntegrationsCatalog catalog={nativeCatalog} />
        </section>
      ) : null}

      {/* MCP catalog — one-click connect to curated MCP servers. */}
      {mcpCatalogAvailable.length > 0 ? (
        <section className="space-y-3">
          <h2 className="font-mono text-xs uppercase tracking-[0.14em] text-fg-muted">
            MCP servers
          </h2>
          <McpCatalog
            entries={mcpCatalogAvailable.map((c) => ({
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

      {/* Empty-state when nothing is configured at all. */}
      {nativeCatalog.length === 0 && mcpCatalogAvailable.length === 0 && totalConnected === 0 ? (
        <div className="rounded-sm border border-dashed border-border bg-surface p-6 text-sm text-fg-muted">
          <p className="mb-1 font-medium text-fg">No integrations available yet.</p>
          <p>
            Set the OAuth client + webhook secret env vars on this deployment to enable Google
            Drive, Linear, or GitHub. See{' '}
            <a className="text-signal underline" href="/docs/setup/integrations.html">
              the integrations setup doc
            </a>
            . Or add an arbitrary MCP-compatible server from the link below.
          </p>
        </div>
      ) : null}

      <p className="flex flex-wrap items-center gap-x-5 gap-y-2 pt-2 text-xs text-fg-dim">
        <a className="hover:text-fg" href="/app/me/mcp-servers">
          Personal MCP servers →
        </a>
        <a className="hover:text-fg" href="/app/team/mcp-share">
          Expose this Timeline as an MCP server →
        </a>
        <a className="hover:text-fg" href="/app/team/integrations/audit">
          Audit log →
        </a>
      </p>
    </div>
  );
}

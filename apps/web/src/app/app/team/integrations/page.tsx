import { users } from '@timeline/db';
import * as integrationsLib from '@timeline/shared/integrations';
import { withTeam } from '@timeline/shared/team-scope';
import { inArray } from 'drizzle-orm';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import type { Metadata } from 'next';

import { ActionChip } from '@/components/action-chip';
import { Breadcrumb } from '@/components/breadcrumb';
import { IndexStrip } from '@/components/index-strip';
import { IntegrationsCatalog } from '@/components/integrations/catalog';
import { ConnectedIntegrations } from '@/components/integrations/connected';
import { McpCatalog } from '@/components/integrations/mcp-catalog';
import { AddCustomMcpServerLauncher, McpServersUi } from '@/components/integrations/mcp-servers';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

export const metadata: Metadata = {
  title: 'Integrations',
  description: 'Connect and manage third-party integrations.',
};

export const dynamic = 'force-dynamic';

/**
 * Single integrations page. Sits under /app/team. The layout is:
 *   1. Breadcrumb  (Team / Integrations)
 *   2. IndexStrip header
 *   3. Top action bar: secondary nav chips + "+ Add custom MCP server"
 *   4. Connected list (native + MCP) when anything is connected
 *   5. Native catalog (Drive/Linear/GitHub) when env-configured
 *   6. MCP catalog (Notion, Slack, Atlassian, Figma, Sentry, Stripe…)
 *
 * Secondary actions (Expose-as-MCP, Personal MCP, Audit log) live in the
 * action bar — pinned at the top so they don't sink below the fold as
 * the catalog grows.
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
  const [role, connected, mcpServers, members] = await Promise.all([
    scope.requireMembership(),
    scope.integrations.listIntegrations(),
    scope.mcp.listTeamServers(),
    scope.timeline.listMembers(),
  ]);
  const isAdmin = role === 'owner' || role === 'admin';
  const memberIds = members.map((m) => m.userId);
  const memberUsers =
    memberIds.length > 0
      ? await db
          .select({ id: users.id, name: users.name, email: users.email })
          .from(users)
          .where(inArray(users.id, memberIds))
      : [];
  const memberUserMap = new Map(memberUsers.map((u) => [u.id, u] as const));
  const nativeCatalog = integrationsLib.listAvailableProviders();
  const mcpCatalog = integrationsLib.listCatalog().filter((c) => c.kind === 'mcp' && c.mcpUrl);
  const connectedUrls = new Set(mcpServers.map((s) => s.url));
  const mcpCatalogAvailable = mcpCatalog.filter((c) => !connectedUrls.has(c.mcpUrl ?? ''));

  const totalConnected = connected.length + mcpServers.length;
  const totalCatalog = nativeCatalog.length + mcpCatalogAvailable.length;
  const hasAnything = totalConnected > 0 || totalCatalog > 0;

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <Breadcrumb items={[{ label: 'Team', href: '/app/team' }, { label: 'Integrations' }]} />

      <IndexStrip
        srLabel={`Integrations · ${String(totalConnected)} connected · ${String(totalCatalog)} in catalog`}
        segments={[
          { value: 'INTEGRATIONS' },
          { label: 'team', value: active.teamName, signal: true },
          { label: 'connected', value: totalConnected },
          { label: 'catalog', value: totalCatalog },
        ]}
      />

      {/* Action bar. Stays above the fold; the three secondary links
          previously buried under the catalog footer are chips here, and
          the most-requested affordance ("+ Add custom MCP server") sits
          on the right. */}
      <div className="flex flex-wrap items-center gap-2 border-y border-border py-2">
        <ActionChip href="/app/team/mcp-share" label="Expose as MCP →" />
        <ActionChip href="/app/me/mcp-servers" label="Personal MCP →" />
        <ActionChip href="/app/team/integrations/audit" label="Audit log →" />
        {isAdmin ? <ActionChip href="/app/team/jobs" label="Job recovery →" /> : null}
        <span className="ml-auto" />
        <AddCustomMcpServerLauncher ownership="team" />
      </div>

      {params.connected ? (
        <div className="rounded-sm border border-signal/40 bg-signal/10 px-3 py-2 text-sm text-signal">
          Connected to <span className="font-mono">{params.connected}</span>.
        </div>
      ) : null}
      {params.error ? (
        <div className="rounded-sm border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          Connection failed: <span className="font-mono">{params.error}</span>
        </div>
      ) : null}

      {totalConnected > 0 ? (
        <section className="space-y-3">
          <SectionHeader>Connected</SectionHeader>
          {connected.length > 0 ? (
            <ConnectedIntegrations
              connected={connected.map((c) => ({
                id: c.id,
                provider: c.provider,
                displayName: c.displayName,
                enabled: c.enabled,
                lastSyncedAt: c.lastSyncedAt ? c.lastSyncedAt.toISOString() : null,
                lastError: c.lastError,
                visibilityDefault: c.visibilityDefault,
                visibilityDefaultUserIds: c.visibilityDefaultUserIds,
              }))}
              members={members.map((m) => {
                const u = memberUserMap.get(m.userId);
                return { id: m.userId, label: u?.name ?? u?.email ?? m.userId };
              })}
            />
          ) : null}
          {mcpServers.length > 0 ? (
            <McpServersUi
              hideAddButton
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

      {nativeCatalog.length > 0 ? (
        <section className="space-y-3">
          <SectionHeader>Drive · Linear · GitHub</SectionHeader>
          <IntegrationsCatalog catalog={nativeCatalog} />
        </section>
      ) : null}

      {mcpCatalogAvailable.length > 0 ? (
        <section className="space-y-3">
          <SectionHeader>MCP servers</SectionHeader>
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

      {!hasAnything ? (
        <div className="rounded-sm border border-dashed border-border bg-surface p-6 text-sm text-fg-muted">
          <p className="mb-1 font-medium text-fg">No integrations configured.</p>
          <p>
            Add the provider credentials in env to enable Drive, Linear, or GitHub; see{' '}
            <Link className="text-signal underline" href="/docs/setup/integrations.html">
              setup
            </Link>
            . Or add any MCP-compatible server above.
          </p>
        </div>
      ) : null}
    </div>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="font-mono text-xs uppercase tracking-[0.14em] text-fg-muted">{children}</h2>
  );
}

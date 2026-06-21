import { users } from '@timeline/db';
import * as integrationsLib from '@timeline/shared/integrations';
import { withTeam } from '@timeline/shared/team-scope';
import { inArray } from 'drizzle-orm';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import type { Metadata } from 'next';

import { ActionChip } from '@/components/action-chip';
import { Breadcrumb } from '@/components/breadcrumb';
import { IntegrationsCatalog } from '@/components/integrations/catalog';
import { ConnectedIntegrations } from '@/components/integrations/connected';
import { McpCatalog } from '@/components/integrations/mcp-catalog';
import { AddCustomMcpServerLauncher, McpServersUi } from '@/components/integrations/mcp-servers';
import { TeamSourcesUi } from '@/components/integrations/provider-connections';
import { PageHeader } from '@/components/page-header';
import { SectionHeading } from '@/components/section-heading';
import { Button } from '@/components/ui/button';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { connectionErrorMessage } from '@/lib/ux-errors';

export const metadata: Metadata = {
  title: 'Integrations',
  description: 'Connect and manage third-party integrations.',
};

export const dynamic = 'force-dynamic';

/**
 * Single integrations page. Sits under /app/team. The layout is:
 *   1. Breadcrumb  (Team / Integrations)
 *   2. PageHeader (title + metadata strip)
 *   3. Top action bar: secondary nav chips + "+ Add custom MCP server"
 *   4. Connected list (native + MCP) when anything is connected
 *   5. Native catalog (GitHub/Linear/Drive) when env-configured
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
  const [role, connected, mcpServers, members, resourceShares, attention] = await Promise.all([
    scope.requireMembership(),
    scope.integrations.listIntegrations(),
    scope.mcp.listTeamServers(),
    scope.timeline.listMembers(),
    scope.integrations.listTeamResourceShares(),
    scope.integrations.listConnectionAttention(),
  ]);
  const isAdmin = role === 'owner' || role === 'admin';
  const ownerIds = resourceShares.map((row) => row.connection.ownerUserId);
  const userIds = [...new Set([...members.map((m) => m.userId), ...ownerIds])];
  const memberUsers =
    userIds.length > 0
      ? await db
          .select({ id: users.id, name: users.name, email: users.email })
          .from(users)
          .where(inArray(users.id, userIds))
      : [];
  const memberUserMap = new Map(memberUsers.map((u) => [u.id, u] as const));
  const nativeCatalog = integrationsLib.listAvailableProviders();
  const mcpCatalog = integrationsLib.listCatalog().filter((c) => c.kind === 'mcp' && c.mcpUrl);
  const connectedUrls = new Set(mcpServers.map((s) => s.url));
  const mcpCatalogAvailable = mcpCatalog.filter((c) => !connectedUrls.has(c.mcpUrl ?? ''));

  const totalConnected = connected.length + mcpServers.length;
  const totalCatalog = nativeCatalog.length + mcpCatalogAvailable.length;
  const totalSharedSources = resourceShares.length;
  const hasAnything = totalConnected > 0 || totalCatalog > 0 || totalSharedSources > 0;
  const selectionLists = await Promise.all(
    connected.map(async (integration) => scope.integrations.listSelections(integration.id)),
  );
  const activeShareIds = selectionLists
    .flat()
    .map((selection) => selection.resourceShareId)
    .filter((id): id is string => Boolean(id));

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <Breadcrumb items={[{ label: 'Team', href: '/app/team' }, { label: 'Integrations' }]} />

      <PageHeader
        title="Integrations"
        subtitle="Connect and manage third-party integrations."
        srLabel={`Integrations · ${String(totalConnected)} connected · ${String(totalCatalog)} in catalog`}
        metadata={[
          { label: 'team', value: active.teamName, signal: true },
          { label: 'connected', value: totalConnected },
          { label: 'catalog', value: totalCatalog },
        ]}
      />

      {/* Primary action: add a custom MCP server. The jargon-y secondary
          links (Expose-as-MCP, Personal connections, Personal MCP, Audit
          log, Job recovery) collapse into a single Advanced disclosure so
          they don't compete with the connect flow. */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <details className="group">
          <summary className="inline-flex cursor-pointer items-center gap-1 text-sm text-fg-muted transition-colors hover:text-fg">
            Advanced
            <span className="font-mono text-[10px] text-fg-dim group-open:hidden">+</span>
            <span className="hidden font-mono text-[10px] text-fg-dim group-open:inline">-</span>
          </summary>
          <div className="mt-2 flex flex-wrap items-center gap-2 border-y border-border py-2">
            <ActionChip href="/app/team/integrations/audit" label="Audit log →" />
            {isAdmin ? <ActionChip href="/app/team/jobs" label="Job recovery →" /> : null}
            <ActionChip href="/app/me/connections" label="Personal connections →" />
            <ActionChip href="/app/me/mcp-servers" label="Personal MCP →" />
          </div>
        </details>
        <div className="flex flex-wrap items-center gap-2">
          {isAdmin ? (
            <Button asChild variant="outline" size="sm">
              <Link href="/app/team/mcp-share">Manage Timeline MCP endpoint</Link>
            </Button>
          ) : null}
          <AddCustomMcpServerLauncher ownership="team" />
        </div>
      </div>

      {params.connected ? (
        <div className="rounded-sm border border-signal/40 bg-signal/10 px-3 py-2 text-sm text-signal">
          MCP server connected successfully. It should now appear in the list above.
        </div>
      ) : null}
      {params.error ? (
        <div className="rounded-sm border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          <p>{connectionErrorMessage(params.error)}</p>
          <details className="mt-1">
            <summary className="cursor-pointer text-xs text-fg-dim">Error details</summary>
            <code className="mt-1 block text-xs">{params.error}</code>
          </details>
        </div>
      ) : null}

      {attention.length > 0 ? (
        <div className="rounded-sm border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {String(attention.length)} integration item{attention.length === 1 ? '' : 's'} need
          attention. Use the affected provider below to reconnect credentials, replace the
          connection, or narrow shared sources.
        </div>
      ) : null}

      {isAdmin ? (
        <section className="space-y-3 border-y border-border py-5">
          <SectionHeading>Expose Timeline as an MCP server</SectionHeading>
          <p className="max-w-2xl text-sm text-fg-muted">
            Let external agents read this team&apos;s timeline events through a bearer-keyed MCP
            endpoint. This is outbound access: external tools reading from Timeline, not Timeline
            reading from them.
          </p>
          <Button asChild variant="outline" size="sm">
            <Link href="/app/team/mcp-share">Manage MCP endpoint</Link>
          </Button>
        </section>
      ) : null}

      {totalConnected > 0 || totalSharedSources > 0 ? (
        <section className="space-y-3">
          <SectionHeading>Connected</SectionHeading>
          <TeamSourcesUi
            rows={resourceShares.map((row) => ({
              share: {
                id: row.share.id,
                providerConnectionId: row.share.providerConnectionId,
                resourceKind: row.share.resourceKind,
                externalId: row.share.externalId,
                externalLabel: row.share.externalLabel,
                revokedAt: row.share.revokedAt ? row.share.revokedAt.toISOString() : null,
              },
              connection: {
                id: row.connection.id,
                provider: row.connection.provider,
                displayName: row.connection.displayName,
                ownerUserId: row.connection.ownerUserId,
                ownerLabel:
                  memberUserMap.get(row.connection.ownerUserId)?.name ??
                  memberUserMap.get(row.connection.ownerUserId)?.email ??
                  row.connection.ownerUserId,
                lastError: row.connection.lastError,
                lastConnectedAt: row.connection.lastConnectedAt.toISOString(),
              },
            }))}
            activeShareIds={activeShareIds}
            isAdmin={isAdmin}
          />
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
          <SectionHeading>Native integrations</SectionHeading>
          <p className="text-sm text-fg-muted">
            GitHub, Linear, and Google Drive sync directly into Timeline as first-party providers.
          </p>
          <IntegrationsCatalog catalog={nativeCatalog} />
        </section>
      ) : null}

      {mcpCatalogAvailable.length > 0 ? (
        <section className="space-y-3">
          <SectionHeading>MCP servers</SectionHeading>
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
          <p className="mb-1 font-medium text-fg">No sources connected yet.</p>
          <p>
            Connect Google Drive, Linear, or GitHub to sync work into the timeline, or add any
            MCP-compatible server above.
          </p>
          {isAdmin ? (
            <p className="mt-2">
              <Link className="text-signal underline" href="/docs/setup/integrations.html">
                Read the setup guide
              </Link>
            </p>
          ) : (
            <p className="mt-2">Ask a team admin to enable a source to get started.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

import { integrations as integrationsLib, withTeam } from '@timeline/shared';
import { redirect } from 'next/navigation';

import { IndexStrip } from '@/components/index-strip';
import { IntegrationsCatalog } from '@/components/integrations/catalog';
import { ConnectedIntegrations } from '@/components/integrations/connected';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

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
  const [connected, catalog] = await Promise.all([
    scope.integrations.listIntegrations(),
    Promise.resolve(integrationsLib.listAvailableProviders()),
  ]);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <IndexStrip
        srLabel={`Integrations · ${String(connected.length)} connected`}
        segments={[
          { value: 'INTEGRATIONS' },
          { label: 'team', value: active.teamName, signal: true },
          { label: 'connected', value: connected.length },
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

      <section className="space-y-3">
        <h2 className="font-mono text-xs uppercase tracking-[0.14em] text-fg-muted">Connected</h2>
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
      </section>

      <section className="space-y-3">
        <h2 className="font-mono text-xs uppercase tracking-[0.14em] text-fg-muted">Catalog</h2>
        <IntegrationsCatalog catalog={catalog} />
      </section>

      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-2 text-xs text-fg-dim">
        <a className="hover:text-fg" href="/app/team/mcp-servers">
          Custom MCP server →
        </a>
        <a className="hover:text-fg" href="/app/me/mcp-servers">
          Personal MCP servers →
        </a>
        <a className="hover:text-fg" href="/app/team/mcp-share">
          Expose as MCP server →
        </a>
        <a className="hover:text-fg" href="/app/team/integrations/audit">
          Audit log →
        </a>
      </p>
    </div>
  );
}

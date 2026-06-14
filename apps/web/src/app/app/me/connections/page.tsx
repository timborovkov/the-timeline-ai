import * as integrationsLib from '@timeline/shared/integrations';
import { withTeam } from '@timeline/shared/team-scope';
import { redirect } from 'next/navigation';

import type { Metadata } from 'next';

import { ActionChip } from '@/components/action-chip';
import { Breadcrumb } from '@/components/breadcrumb';
import { IndexStrip } from '@/components/index-strip';
import { IntegrationsCatalog } from '@/components/integrations/catalog';
import { PersonalConnectionsUi } from '@/components/integrations/provider-connections';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

export const metadata: Metadata = {
  title: 'Personal connections',
  description: 'Manage provider accounts you have granted to Timeline.',
};

export const dynamic = 'force-dynamic';

export default async function PersonalConnectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string }>;
}) {
  const session = await auth();
  if (!session?.user.id) redirect('/sign-in');
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) redirect('/sign-in');
  const params = await searchParams;
  const scope = withTeam(db, active.teamId, session.user.id);
  await scope.requireMembership();
  const [connections, nativeCatalog] = await Promise.all([
    scope.integrations.listOwnedProviderConnections(),
    Promise.resolve(integrationsLib.listAvailableProviders()),
  ]);

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <Breadcrumb
        items={[
          { label: 'Team', href: '/app/team' },
          { label: 'Integrations', href: '/app/team/integrations' },
          { label: 'Personal connections' },
        ]}
      />

      <IndexStrip
        srLabel={`Personal connections · ${String(connections.length)} connected`}
        segments={[
          { value: 'CONNECTIONS' },
          { label: 'team', value: active.teamName, signal: true },
          { label: 'owned', value: connections.length },
        ]}
      />

      <div className="flex flex-wrap items-center gap-2 border-y border-border py-2">
        <ActionChip href="/app/team/integrations" label="Team integrations ->" />
        <ActionChip href="/app/me/mcp-servers" label="Personal MCP ->" />
      </div>

      {params.connected ? (
        <div className="rounded-sm border border-signal/40 bg-signal/10 px-3 py-2 text-sm text-signal">
          Connected {params.connected}. Choose the sources this team may use.
        </div>
      ) : null}
      {params.error ? (
        <div className="rounded-sm border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          Connection failed: <span className="font-mono">{params.error}</span>
        </div>
      ) : null}

      <section className="space-y-3">
        <SectionHeader>Your provider connections</SectionHeader>
        <PersonalConnectionsUi
          connections={connections.map((connection) => ({
            id: connection.id,
            provider: connection.provider,
            displayName: connection.displayName,
            lastError: connection.lastError,
            lastConnectedAt: connection.lastConnectedAt.toISOString(),
          }))}
        />
      </section>

      <section className="space-y-3">
        <SectionHeader>Connect another account</SectionHeader>
        <IntegrationsCatalog catalog={nativeCatalog} />
      </section>
    </div>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="font-mono text-xs uppercase tracking-[0.14em] text-fg-muted">{children}</h2>
  );
}

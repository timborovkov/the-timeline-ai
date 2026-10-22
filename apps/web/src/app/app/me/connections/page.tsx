import * as integrationsLib from '@timeline/shared/integrations';
import { withTeam } from '@timeline/shared/team-scope';
import { redirect } from 'next/navigation';

import type { Metadata } from 'next';

import { ActionChip } from '@/components/action-chip';
import { Breadcrumb } from '@/components/breadcrumb';
import { IntegrationsCatalog } from '@/components/integrations/catalog';
import { PersonalConnectionsUi } from '@/components/integrations/provider-connections';
import { McpOAuthGrants } from '@/components/mcp-oauth-grants';
import { PageHeader } from '@/components/page-header';
import { RedirectActionToast } from '@/components/redirect-action-toast';
import { SectionHeading } from '@/components/section-heading';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { providerLabel } from '@/lib/resource-labels';

export const metadata: Metadata = {
  title: 'Provider accounts',
  description: 'Manage personal provider accounts and AI apps connected through Timeline.',
};

export const dynamic = 'force-dynamic';

export default async function PersonalConnectionsPage({
  searchParams,
}: {
  searchParams: Promise<{
    connected?: string;
    error?: string;
    mcpError?: string;
    mcpRevoked?: string;
  }>;
}) {
  const session = await auth();
  if (!session?.user.id) redirect('/sign-in');
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) redirect('/sign-in');
  const params = await searchParams;
  const scope = withTeam(db, active.teamId, session.user.id);
  await scope.requireMembership();
  const [connections, nativeCatalog, mcpOAuthGrants] = await Promise.all([
    scope.integrations.listOwnedProviderConnections(),
    Promise.resolve(integrationsLib.listAvailableProviders()),
    scope.mcpOAuth.listGrants(),
  ]);

  return (
    <div className="space-y-4">
      <Breadcrumb
        items={[{ label: 'Connections', href: '/app/sources' }, { label: 'Provider accounts' }]}
      />

      <PageHeader
        variant="collection"
        title="Provider accounts"
        subtitle="Manage personal provider accounts, shared sources, and AI app access."
        srLabel={`Provider accounts · ${String(connections.length)} connected · ${String(mcpOAuthGrants.length)} authorized apps`}
        metadata={[
          { label: 'Team', value: active.teamName },
          { label: 'Accounts', value: connections.length, mono: true },
          { label: 'AI apps', value: mcpOAuthGrants.length, mono: true },
        ]}
      />

      <div className="flex flex-wrap items-center gap-x-1 gap-y-1 border-y border-border py-1.5">
        <ActionChip href="/app/sources" label="View connections" />
        <ActionChip href="/app/me/mcp-servers" label="Manage personal MCP" />
      </div>

      <RedirectActionToast
        id="connections:oauth"
        error={
          params.error
            ? 'Unable to connect this account. Try again or choose a different account.'
            : null
        }
        success={
          params.connected
            ? `Connected ${providerLabel(params.connected)}. Choose which sources this team may use.`
            : null
        }
      />

      <RedirectActionToast
        id="connections:mcp-oauth"
        error={params.mcpError ? 'Unable to revoke this app’s access. Try again.' : null}
        success={params.mcpRevoked ? 'Revoked the app’s access to this team.' : null}
      />

      <section className="space-y-3">
        <SectionHeading>Your provider accounts</SectionHeading>
        <PersonalConnectionsUi
          connections={connections.map((connection) => ({
            id: connection.id,
            provider: connection.provider,
            displayName: connection.displayName,
            lastError: connection.lastError,
            lastConnectedAt: connection.lastConnectedAt.toISOString(),
          }))}
          connectProviderHref="#connect-provider"
        />
      </section>

      <section className="space-y-3">
        <div className="space-y-1">
          <SectionHeading>AI app access</SectionHeading>
          <p className="text-sm text-fg-muted">
            These apps can use Timeline through MCP with your permissions in {active.teamName}.
          </p>
        </div>
        <McpOAuthGrants grants={mcpOAuthGrants} teamId={active.teamId} />
      </section>

      <section id="connect-provider" className="space-y-3">
        <SectionHeading>Connect another provider account</SectionHeading>
        <p className="text-sm text-fg-muted">
          If the provider reuses the wrong account, switch accounts on the provider OAuth page or
          sign out of the provider before approving.
        </p>
        <IntegrationsCatalog catalog={nativeCatalog} />
      </section>
    </div>
  );
}

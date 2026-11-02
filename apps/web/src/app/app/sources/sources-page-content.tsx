import { teams } from '@timeline/db';
import { withTeam } from '@timeline/shared/team-scope';
import { eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';

import type { Metadata } from 'next';

import { AdvancedConnections } from '@/app/app/sources/advanced-connections';
import {
  buildDirectoryProviders,
  connectionHeaderMetadata,
  initialOpenProviderId,
  partitionMcpCatalog,
  partitionMcpServers,
  type InboundEmailSettings,
} from '@/app/app/sources/connection-directory';
import { ConnectionsDirectory } from '@/app/app/sources/connections-directory';
import {
  loadIntegrationsPageModel,
  type IntegrationsPageModel,
} from '@/app/app/team/integrations/integrations-page-model';
import { PageHeader } from '@/components/page-header';
import { RedirectActionToast } from '@/components/redirect-action-toast';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import {
  displayInboundEmail,
  getSourcesStatusSummary,
  shouldWarnPlaceholderInboundEmail,
  type SourcesStatusSummary,
} from '@/lib/hub-status';
import { connectionErrorMessage } from '@/lib/ux-errors';

export const metadata: Metadata = {
  title: 'Connections',
  description: 'Provider accounts and team sync.',
};

interface SourcesPageParams {
  connected?: string;
  error?: string;
  integrationId?: string;
}

async function loadInboundEmailSettings(
  teamId: string,
  teamSlug: string,
): Promise<InboundEmailSettings> {
  const row = (
    await db
      .select({
        inboundEmail: teams.inboundEmail,
        enabled: teams.inboundSenderWhitelistEnabled,
        senders: teams.inboundSenderWhitelist,
      })
      .from(teams)
      .where(eq(teams.id, teamId))
      .limit(1)
  )[0] ?? { inboundEmail: null, enabled: true, senders: [] };
  const inboundEmail = displayInboundEmail({
    slug: teamSlug,
    inboundEmail: row.inboundEmail,
  });
  return {
    inboundEmail,
    enabled: row.enabled,
    senders: row.senders,
    placeholderInbound: shouldWarnPlaceholderInboundEmail(row.inboundEmail, inboundEmail),
  };
}

function ConnectionHealthNotices({ model }: { model: IntegrationsPageModel }) {
  return (
    <>
      {model.blockingAttentionCount > 0 ? (
        <div role="alert" className="text-sm text-danger">
          {String(model.blockingAttentionCount)} integration item
          {model.blockingAttentionCount === 1 ? '' : 's'} need attention. Open the affected provider
          to reconnect, replace the connection, or retry failed sync.
        </div>
      ) : null}
      {model.webhookDegradedCount > 0 ? (
        <output className="block text-sm text-fg-muted">
          {String(model.webhookDegradedCount)} webhook subscription
          {model.webhookDegradedCount === 1 ? '' : 's'} degraded. Reconciliation remains active
          while provider webhook delivery is repaired.
        </output>
      ) : null}
    </>
  );
}

export default async function SourcesPage({
  searchParams,
}: {
  searchParams: Promise<SourcesPageParams>;
}) {
  const session = await auth();
  if (!session?.user) redirect('/sign-in');
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) redirect('/sign-in');
  const scope = withTeam(db, active.teamId, session.user.id);
  const [params, role, summary, model, inboundEmail] = await Promise.all([
    searchParams,
    scope.requireMembership(),
    getSourcesStatusSummary(scope),
    loadIntegrationsPageModel({
      teamId: active.teamId,
      userId: session.user.id,
    }),
    loadInboundEmailSettings(active.teamId, active.teamSlug),
  ]);
  const isAdmin = role === 'owner' || role === 'admin';
  return (
    <SourcesPageView
      params={params}
      active={active}
      isAdmin={isAdmin}
      summary={summary}
      model={model}
      inboundEmail={inboundEmail}
    />
  );
}

export function SourcesPageView({
  params,
  active,
  isAdmin,
  summary,
  model,
  inboundEmail,
}: {
  params: SourcesPageParams;
  active: { teamName: string };
  isAdmin: boolean;
  summary: SourcesStatusSummary;
  model: IntegrationsPageModel;
  inboundEmail?: InboundEmailSettings;
}) {
  const directory = buildDirectoryProviders({
    model,
    slackConnections: summary.slackConnections,
  });
  const mcpCatalog = partitionMcpCatalog(model.mcpCatalogAvailable, model.nativeCatalog);
  const mcpServers = partitionMcpServers(model.mcpServerRows, model.nativeCatalog);
  const attentionCount = directory.connected.filter(
    (provider) => provider.status === 'attention',
  ).length;
  const emailSettings: InboundEmailSettings = inboundEmail ?? {
    inboundEmail: summary.inboundEmail,
    enabled: true,
    senders: [],
    placeholderInbound: false,
  };
  const openProviderId = initialOpenProviderId({
    providers: [...directory.connected, ...directory.available],
    connectedRows: model.connectedRows,
    integrationId: params.integrationId,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        variant="collection"
        title="Connections"
        subtitle="Provider accounts and team sync."
        srLabel={`Connections · ${active.teamName} · ${String(directory.connected.length)} connected · ${String(attentionCount)} need attention · ${String(directory.available.length)} available`}
        metadata={connectionHeaderMetadata(
          active.teamName,
          directory.connected.length,
          attentionCount,
          directory.available.length,
        )}
      />

      <RedirectActionToast
        id="integrations:oauth"
        error={params.error ? connectionErrorMessage(params.error) : null}
        success={params.connected ? 'MCP server connected' : null}
      />

      <ConnectionHealthNotices model={model} />
      <ConnectionsDirectory
        isAdmin={isAdmin}
        model={model}
        connected={directory.connected}
        available={directory.available}
        initialProviderId={openProviderId}
      />
      <AdvancedConnections
        isAdmin={isAdmin}
        model={model}
        inboundEmail={emailSettings}
        mcpServerRows={mcpServers.advanced}
        mcpCatalog={mcpCatalog.advanced}
      />
    </div>
  );
}

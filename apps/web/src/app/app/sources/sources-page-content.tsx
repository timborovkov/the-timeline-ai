import { getEnv } from '@timeline/shared/env';
import { withTeam, type TeamScope } from '@timeline/shared/team-scope';
import { redirect } from 'next/navigation';

import type { Metadata } from 'next';

import { AdvancedConnections } from '@/app/app/sources/advanced-connections';
import {
  buildDirectoryProviders,
  connectionHeaderMetadata,
  EMPTY_TELEGRAM_SETUP,
  initialOpenProviderId,
  partitionMcpCatalog,
  partitionMcpServers,
  type InboundEmailSettings,
  type TelegramSetupSnapshot,
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

function inboundEmailFromTeam(
  team: {
    inboundEmail: string | null;
    inboundSenderWhitelistEnabled: boolean;
    inboundSenderWhitelist: string[];
  } | null,
  teamSlug: string,
): InboundEmailSettings {
  const inboundEmail = displayInboundEmail({
    slug: teamSlug,
    inboundEmail: team?.inboundEmail ?? null,
  });
  return {
    inboundEmail,
    enabled: team?.inboundSenderWhitelistEnabled ?? true,
    senders: team?.inboundSenderWhitelist ?? [],
    placeholderInbound: shouldWarnPlaceholderInboundEmail(team?.inboundEmail, inboundEmail),
  };
}

async function loadTelegramSetup(scope: TeamScope): Promise<TelegramSetupSnapshot> {
  const env = getEnv();
  const [tokens, bindings, linkedUsers] = await Promise.all([
    scope.telegram.listActiveLinkTokens(),
    scope.telegram.listChatBindings(),
    scope.telegram.listLinkedUsers(),
  ]);
  return {
    botUsername: env.TELEGRAM_BOT_USERNAME ?? null,
    webhookConfigured: Boolean(env.TELEGRAM_WEBHOOK_SECRET),
    currentUserId: scope.userId,
    tokens: tokens.map((token) => ({
      id: token.id,
      scope: token.scope,
      expiresAt: token.expiresAt.toISOString(),
      issuedByUserId: token.issuedByUserId,
    })),
    bindings: bindings.map((binding) => ({
      id: binding.id,
      title: binding.title,
      tgChatId: binding.tgChatId,
      createdAt: binding.createdAt.toISOString(),
    })),
    linkedUsers,
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
  const [params, role, summary, model, team, telegramSetup] = await Promise.all([
    searchParams,
    scope.requireMembership(),
    getSourcesStatusSummary(scope),
    loadIntegrationsPageModel({
      teamId: active.teamId,
      userId: session.user.id,
    }),
    scope.timeline.team(),
    loadTelegramSetup(scope),
  ]);
  const isAdmin = role === 'owner' || role === 'admin';
  return (
    <SourcesPageView
      params={params}
      active={active}
      isAdmin={isAdmin}
      summary={summary}
      model={model}
      inboundEmail={inboundEmailFromTeam(team, active.teamSlug)}
      telegramSetup={telegramSetup}
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
  telegramSetup,
}: {
  params: SourcesPageParams;
  active: { teamName: string };
  isAdmin: boolean;
  summary: SourcesStatusSummary;
  model: IntegrationsPageModel;
  inboundEmail?: InboundEmailSettings;
  telegramSetup?: TelegramSetupSnapshot;
}) {
  const emailSettings: InboundEmailSettings = inboundEmail ?? {
    inboundEmail: summary.inboundEmail,
    enabled: true,
    senders: [],
    placeholderInbound: false,
  };
  const telegram = telegramSetup ?? EMPTY_TELEGRAM_SETUP;
  const directory = buildDirectoryProviders({
    model,
    slackConnections: summary.slackConnections,
    telegramConnections: summary.telegramConnections,
    telegramWebhookConfigured: telegram.webhookConfigured,
    inboundEmail: emailSettings,
  });
  const mcpCatalog = partitionMcpCatalog(model.mcpCatalogAvailable, model.nativeCatalog);
  const mcpServers = partitionMcpServers(model.mcpServerRows, model.nativeCatalog);
  const attentionCount = directory.connected.filter(
    (provider) => provider.status === 'attention',
  ).length;
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
        inboundEmail={emailSettings}
        telegramSetup={telegram}
      />
      <AdvancedConnections
        isAdmin={isAdmin}
        model={model}
        mcpServerRows={mcpServers.advanced}
        mcpCatalog={mcpCatalog.advanced}
      />
    </div>
  );
}

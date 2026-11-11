import { getEnv } from '@timeline/shared/env';
import { withTeam, type TeamScope } from '@timeline/shared/team-scope';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import type { Metadata } from 'next';

import {
  buildDirectoryProviders,
  connectionHeaderMetadata,
  directoryProviderList,
  EMPTY_TELEGRAM_SETUP,
  parseConnectionsLocation,
  type ConnectionsTab,
  type InboundEmailSettings,
  type TelegramSetupSnapshot,
} from '@/app/app/connections/connection-directory';
import { ConnectionsWorkspace } from '@/app/app/connections/connections-workspace';
import {
  loadIntegrationsPageModel,
  type IntegrationsPageModel,
} from '@/app/app/team/integrations/integrations-page-model';
import { PageHeader } from '@/components/page-header';
import { RedirectActionToast } from '@/components/redirect-action-toast';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { connectionsHref, connectionsTabFromSearch } from '@/lib/connections';
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
  description: 'Connect the tools this team already uses.',
};

interface SourcesPageParams {
  connected?: string;
  error?: string;
  integrationId?: string;
  tab?: string;
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

export default async function ConnectionsPage({
  tab,
  searchParams,
}: {
  tab: ConnectionsTab;
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
  if (params.tab && connectionsTabFromSearch(params.tab) !== tab) {
    redirect(connectionsHref(params));
  }
  const isAdmin = role === 'owner' || role === 'admin';
  return (
    <SourcesPageView
      tab={tab}
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
  tab = 'sources',
  params,
  active,
  isAdmin,
  summary,
  model,
  inboundEmail,
  telegramSetup,
}: {
  tab?: ConnectionsTab;
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
  const providers = directoryProviderList(directory);
  const connectedCount = directory.connected.length + (directory.email.connected ? 1 : 0);
  const availableCount = directory.available.length + (directory.email.connected ? 0 : 1);
  const attentionCount = providers.filter((provider) => provider.status === 'attention').length;
  const location = parseConnectionsLocation({
    tab,
    providers,
    connectedRows: model.connectedRows,
    integrationId: params.integrationId,
  });

  return (
    <div className="space-y-4">
      <PageHeader
        variant="collection"
        title="Connections"
        subtitle="Connect the tools this team already uses."
        srLabel={`Connections · ${active.teamName} · ${String(connectedCount)} connected · ${String(attentionCount)} need attention · ${String(availableCount)} available`}
        metadata={connectionHeaderMetadata(
          active.teamName,
          connectedCount,
          attentionCount,
          availableCount,
        )}
      />

      <RedirectActionToast
        id="integrations:oauth"
        error={params.error ? connectionErrorMessage(params.error) : null}
        success={params.connected ? 'MCP server connected' : null}
      />

      {tab === 'sources' && (
        <Link href="/app/connections/websites" className="mb-4 block text-sm underline">
          Website sources — add, scan, and schedule
        </Link>
      )}
      <ConnectionsWorkspace
        isAdmin={isAdmin}
        model={model}
        email={directory.email}
        connected={directory.connected}
        available={directory.available}
        inboundEmail={emailSettings}
        telegramSetup={telegram}
        initialTab={location.tab}
        initialHash={location.hash}
        integrationId={params.integrationId}
      />
    </div>
  );
}

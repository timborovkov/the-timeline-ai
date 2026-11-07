import { withTeam } from '@timeline/shared/team-scope';
import { redirect } from 'next/navigation';

import type { Metadata } from 'next';

import { AgentReportingSettings } from '@/components/agent-reporting-settings';
import { Breadcrumb } from '@/components/breadcrumb';
import { ConnectAgentScreen } from '@/components/connect-agent/connect-agent-screen';
import { PageHeader } from '@/components/page-header';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { AGENT_MEMORY_WEBHOOK_NAME, mcpServerUrl } from '@/lib/connect-agent-content';
import { db } from '@/lib/db';
import { displayInboundEmail } from '@/lib/hub-status';
import { appUrl, getSiteUrl } from '@/lib/site-url';

export const metadata: Metadata = {
  title: 'Connect your agent',
  description: 'Connect Claude, Codex, ChatGPT, Cursor, and other MCP clients to this team.',
};

export const dynamic = 'force-dynamic';

function asScopes(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((scope): scope is string => typeof scope === 'string')
    : ['read'];
}

export default async function ConnectAgentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect('/sign-in');
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) redirect('/sign-in');

  const scope = withTeam(db, active.teamId, session.user.id);
  const [role, params, grants, team] = await Promise.all([
    scope.requireMembership(),
    searchParams,
    scope.mcpOAuth.listConnectedAgents(),
    scope.timeline.team(),
  ]);
  const isAdmin = role === 'owner' || role === 'admin';
  const [keys, webhooks] = isAdmin
    ? await Promise.all([scope.mcpOutbound.listKeys(), scope.ingestWebhooks.listWebhooks()])
    : [[], []];

  const reporting = isAdmin ? await scope.agentReporting.list() : null;

  const teamEmail = displayInboundEmail(team);
  const extraSenders = Array.isArray(team?.inboundSenderWhitelist)
    ? team.inboundSenderWhitelist.filter((sender): sender is string => typeof sender === 'string')
    : [];
  const agentWebhookConfigured = webhooks.some(
    (webhook) => webhook.name === AGENT_MEMORY_WEBHOOK_NAME && !webhook.disabledAt,
  );
  const mcpUrl = appUrl('/api/mcp/server').toString();
  const revoked = firstQueryValue(params.mcpRevoked) === '1';
  const revokeError = firstQueryValue(params.mcpError);

  return (
    <div className="space-y-6">
      <Breadcrumb
        items={[
          { label: 'Connections', href: '/app/connections' },
          { label: 'Connect your agent' },
        ]}
      />
      <PageHeader
        title="Connect your agent"
        subtitle="Pick a client, then sign in with OAuth. Answers appear once work is captured; remember works now."
      />
      {reporting ? <AgentReportingSettings teamId={active.teamId} {...reporting} /> : null}
      <ConnectAgentScreen
        teamId={active.teamId}
        mcpUrl={mcpUrl || mcpServerUrl(getSiteUrl())}
        origin={getSiteUrl()}
        isAdmin={isAdmin}
        teamEmail={teamEmail}
        currentUserEmail={session.user.email ?? ''}
        extraSenders={extraSenders}
        grants={grants.map((grant) => ({
          id: grant.id,
          clientId: grant.clientId,
          clientName: grant.clientName,
          scopes: asScopes(grant.scopes),
          createdAt: grant.createdAt.toISOString(),
          lastUsedAt: grant.lastUsedAt ? grant.lastUsedAt.toISOString() : null,
          ownerUserId: grant.ownerUserId,
          ownerName: grant.ownerName,
          ownerEmail: grant.ownerEmail,
        }))}
        keys={keys.map((key) => ({
          id: key.id,
          name: key.name,
          prefix: key.prefix,
          scopes: asScopes(key.scopes),
          lastUsedAt: key.lastUsedAt ? key.lastUsedAt.toISOString() : null,
          createdAt: key.createdAt.toISOString(),
        }))}
        agentWebhookConfigured={agentWebhookConfigured}
        revokedNotice={revoked}
        revokeError={revokeError}
      />
    </div>
  );
}

function firstQueryValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

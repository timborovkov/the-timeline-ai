import {
  slackConversationBindings,
  slackUsers,
  slackUserTeams,
  slackWorkspaces,
  slackWorkspaceTeams,
  users,
} from '@timeline/db';
import { getEnv } from '@timeline/shared/env';
import * as slack from '@timeline/shared/slack';
import { withTeam } from '@timeline/shared/team-scope';
import { and, desc, eq, inArray } from 'drizzle-orm';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import type { Metadata } from 'next';

import { bindSlackConversationAction, unbindSlackConversationAction } from '@/app/actions/slack';
import { HistoryBackLink } from '@/components/history-back-link';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

export const metadata: Metadata = {
  title: 'Slack',
  description: 'Configure Slack capture and bindings.',
};

interface SlackSettingsInstall {
  name: string | null;
  slackTeamId: string;
  enabled: boolean;
}

interface SlackSettingsBinding {
  id: string;
  slackConversationId: string;
  title: string | null;
  conversationType: string;
  visibilityDefault: string;
}

interface SlackSettingsLinkedUser {
  id: string;
  slackUserId: string;
  name: string | null;
  realName: string | null;
  email: string | null;
  isActive: boolean;
  appUser: { name: string | null; email: string | null } | null;
}

interface SlackSettingsConversation {
  id: string;
  name?: string | null;
  is_member?: boolean;
}

interface SlackSettingsViewModel {
  configured: boolean;
  isAdmin: boolean;
  teamName: string;
  install: SlackSettingsInstall | null;
  bindings: SlackSettingsBinding[];
  linkedSlackUsers: SlackSettingsLinkedUser[];
  unboundConversations: SlackSettingsConversation[];
}

export default async function SlackSettingsPage() {
  const session = await auth();
  if (!session?.user) redirect('/sign-in');
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) redirect('/sign-in');

  const scope = withTeam(db, active.teamId, session.user.id);
  const role = await scope.requireMembership();
  const isAdmin = role === 'owner' || role === 'admin';
  const env = getEnv();
  const configured = Boolean(
    env.SLACK_CLIENT_ID && env.SLACK_CLIENT_SECRET && env.SLACK_SIGNING_SECRET,
  );

  const [installs, bindings, linkedSlackUsers] = await Promise.all([
    db
      .select({
        workspaceId: slackWorkspaces.id,
        name: slackWorkspaces.name,
        slackTeamId: slackWorkspaces.slackTeamId,
        enabled: slackWorkspaceTeams.enabled,
      })
      .from(slackWorkspaceTeams)
      .innerJoin(slackWorkspaces, eq(slackWorkspaces.id, slackWorkspaceTeams.workspaceId))
      .where(eq(slackWorkspaceTeams.teamId, active.teamId)),
    db
      .select()
      .from(slackConversationBindings)
      .where(
        and(
          eq(slackConversationBindings.teamId, active.teamId),
          eq(slackConversationBindings.enabled, true),
        ),
      )
      .orderBy(desc(slackConversationBindings.createdAt)),
    db
      .select({
        id: slackUsers.id,
        slackUserId: slackUsers.slackUserId,
        name: slackUsers.name,
        realName: slackUsers.realName,
        email: slackUsers.email,
        userId: slackUserTeams.userId,
        isActive: slackUserTeams.isActive,
      })
      .from(slackUserTeams)
      .innerJoin(slackUsers, eq(slackUsers.id, slackUserTeams.slackUserId))
      .where(eq(slackUserTeams.teamId, active.teamId)),
  ]);
  const install = installs[0] ?? null;

  const userIds = linkedSlackUsers.map((u) => u.userId);
  const appUsers =
    userIds.length > 0
      ? await db
          .select({ id: users.id, name: users.name, email: users.email })
          .from(users)
          .where(inArray(users.id, userIds))
      : [];
  const userMap = new Map(appUsers.map((u) => [u.id, u] as const));
  const conversations =
    install && isAdmin
      ? await slack.listSlackConversationsForTeam({ db, teamId: active.teamId })
      : [];
  const boundIds = new Set(bindings.map((b) => b.slackConversationId));

  return (
    <SlackSettingsPageView
      model={{
        configured,
        isAdmin,
        teamName: active.teamName,
        install,
        bindings,
        linkedSlackUsers: linkedSlackUsers.map((user) => ({
          ...user,
          appUser: userMap.get(user.userId) ?? null,
        })),
        unboundConversations: conversations.filter(
          (conversation) => !boundIds.has(conversation.id),
        ),
      }}
    />
  );
}

export function SlackSettingsPageView({ model }: { model: SlackSettingsViewModel }) {
  return (
    <div className="space-y-6">
      <HistoryBackLink fallbackHref="/app/team" label="Back" />
      <PageHeader
        title="Slack"
        subtitle="Capture DMs, channel messages, slash-command answers, and linked sender context."
        srLabel={`Slack capture for ${model.teamName} · ${model.bindings.length} bound conversations · ${model.linkedSlackUsers.length} linked users`}
        metadata={[
          { label: 'team', value: model.teamName, signal: true },
          { label: 'channels', value: model.bindings.length },
          { label: 'users', value: model.linkedSlackUsers.length },
        ]}
      />

      {!model.configured ? (
        <Card>
          <CardContent className="py-4 text-sm text-muted-foreground">
            Set <code className="font-mono">SLACK_CLIENT_ID</code>,{' '}
            <code className="font-mono">SLACK_CLIENT_SECRET</code>, and{' '}
            <code className="font-mono">SLACK_SIGNING_SECRET</code> to enable Slack.
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Workspace install</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {model.install ? (
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">{model.install.name ?? 'Slack workspace'}</p>
                <p className="text-xs text-muted-foreground">
                  workspace {model.install.slackTeamId} ·{' '}
                  {model.install.enabled ? 'enabled' : 'disabled'}
                </p>
              </div>
              {model.isAdmin ? (
                <Button asChild variant="outline" size="sm">
                  <Link href="/api/slack/install/start">Reconnect</Link>
                </Button>
              ) : null}
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">
                Install the Slack app before binding channels or private channels.
              </p>
              {model.isAdmin ? (
                <Button asChild size="sm">
                  <Link href="/api/slack/install/start">Install Slack</Link>
                </Button>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Your Slack identity</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            Linking lets Slack DMs route to this team and lets /ask run with your personal identity.
          </p>
          <Button asChild variant="outline" size="sm">
            <Link href="/api/slack/user-link/start">Connect identity</Link>
          </Button>
        </CardContent>
      </Card>

      {model.isAdmin && model.install ? (
        <Card>
          <CardHeader>
            <CardTitle>Bind a conversation</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={bindSlackConversationAction} className="flex gap-2">
              <select
                name="conversationId"
                className="min-w-0 flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
                defaultValue=""
              >
                <option value="" disabled>
                  Choose a channel
                </option>
                {model.unboundConversations.map((c) => (
                  <option key={c.id} value={c.id}>
                    #{c.name ?? 'Unnamed channel'}
                    {c.is_member === false ? ' (invite bot first)' : ''}
                  </option>
                ))}
              </select>
              <Button type="submit">Bind</Button>
            </form>
            <p className="mt-2 text-xs text-muted-foreground">
              Channel capture is source-owned by the person who binds it. Sender context is still
              preserved for every message.
            </p>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Bound conversations</CardTitle>
        </CardHeader>
        <CardContent>
          {model.bindings.length === 0 ? (
            <p className="text-sm text-muted-foreground">No Slack conversations bound yet.</p>
          ) : (
            <ul className="divide-y">
              {model.bindings.map((b) => (
                <li key={b.id} className="flex items-center justify-between py-3">
                  <div>
                    <p className="text-sm font-medium">{b.title ?? 'Unnamed channel'}</p>
                    <p className="text-xs text-muted-foreground">
                      {b.conversationType} · default visibility {b.visibilityDefault}
                    </p>
                  </div>
                  {model.isAdmin ? (
                    <form action={unbindSlackConversationAction}>
                      <input type="hidden" name="id" value={b.id} />
                      <Button type="submit" variant="ghost" size="sm">
                        Unbind
                      </Button>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Linked Slack users</CardTitle>
        </CardHeader>
        <CardContent>
          {model.linkedSlackUsers.length === 0 ? (
            <p className="text-sm text-muted-foreground">No Slack identities linked yet.</p>
          ) : (
            <ul className="divide-y">
              {model.linkedSlackUsers.map((u) => {
                return (
                  <li key={u.id} className="flex items-center justify-between py-3">
                    <div>
                      <p className="text-sm font-medium">
                        {u.appUser?.name ?? u.appUser?.email ?? 'Timeline user'}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Slack {u.realName ?? u.name ?? 'member'}
                        {u.email ? ` · ${u.email}` : ''}
                      </p>
                    </div>
                    {u.isActive ? <Badge variant="outline">active DM</Badge> : null}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

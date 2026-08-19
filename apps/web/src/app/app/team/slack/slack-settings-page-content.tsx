// Shared page content is kept outside the route module so its test helper is not a route export.
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
import { CollectionRow } from '@/components/collections/collection-row';
import { CollectionStatus } from '@/components/collections/collection-status';
import { HistoryBackLink } from '@/components/history-back-link';
import { PageHeader } from '@/components/page-header';
import { SettingsSection } from '@/components/section-heading';
import { TechnicalDetails } from '@/components/technical-details';
import { Button } from '@/components/ui/button';
import { ItemActionGroup } from '@/components/ui/item-actions';
import { NativeSelect } from '@/components/ui/native-select';
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

function sentenceCaseEnum(value: string): string {
  const label = value.replaceAll('_', ' ').trim().toLowerCase();
  return label ? `${label[0]?.toUpperCase() ?? ''}${label.slice(1)}` : 'Unknown';
}

function visibilityLabel(value: string): string {
  if (value === 'team') return 'Team visibility';
  if (value === 'private') return 'Private visibility';
  if (value === 'specific_users') return 'Selected people';
  return 'Custom visibility';
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
    <div className="space-y-4">
      <HistoryBackLink fallbackHref="/app/team" label="Team settings" />
      <PageHeader
        variant="collection"
        title="Slack"
        subtitle="Capture DMs, channel messages, slash-command answers, and linked sender context."
        srLabel={`Slack capture for ${model.teamName} · ${model.bindings.length} bound conversations · ${model.linkedSlackUsers.length} linked users`}
        metadata={[
          { label: 'Team', value: model.teamName },
          { label: 'Channels', value: model.bindings.length, mono: true },
          { label: 'Users', value: model.linkedSlackUsers.length, mono: true },
        ]}
      />

      {!model.configured ? (
        <p className="text-sm text-fg-muted">
          Set <code className="font-mono">SLACK_CLIENT_ID</code>,{' '}
          <code className="font-mono">SLACK_CLIENT_SECRET</code>, and{' '}
          <code className="font-mono">SLACK_SIGNING_SECRET</code> to enable Slack.
        </p>
      ) : null}

      <SettingsSection title="Workspace install">
        {model.install ? (
          <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 flex-1 space-y-2">
              <p className="text-sm font-medium">{model.install.name ?? 'Slack workspace'}</p>
              <p className="text-xs text-muted-foreground">
                {model.install.enabled ? 'Enabled' : 'Disabled'}
              </p>
              <TechnicalDetails
                items={[
                  {
                    label: 'Slack workspace ID',
                    value: model.install.slackTeamId,
                    copyValue: model.install.slackTeamId,
                  },
                ]}
              />
            </div>
            {model.isAdmin ? (
              <Button asChild variant="outline" size="sm">
                <Link href="/api/slack/install/start">Reconnect</Link>
              </Button>
            ) : null}
          </div>
        ) : (
          <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              Install the Slack app before binding channels, including private ones.
            </p>
            {model.isAdmin ? (
              <Button asChild size="sm">
                <Link href="/api/slack/install/start">Install Slack</Link>
              </Button>
            ) : null}
          </div>
        )}
      </SettingsSection>

      <SettingsSection title="Your Slack identity">
        <p className="text-sm text-muted-foreground">
          Linking lets Slack DMs route to this team and lets /ask run with your personal identity.
        </p>
        <Button asChild variant="outline" size="sm">
          <Link href="/api/slack/user-link/start">Connect identity</Link>
        </Button>
      </SettingsSection>

      {model.isAdmin && model.install ? (
        <SettingsSection title="Bind a conversation">
          <form action={bindSlackConversationAction} className="flex items-end gap-2">
            <label className="sr-only" htmlFor="slack-conversation-id">
              Conversation to bind
            </label>
            <NativeSelect
              id="slack-conversation-id"
              name="conversationId"
              required
              aria-describedby="bind-conversation-help"
              className="min-w-0 flex-1"
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
            </NativeSelect>
            <Button type="submit" size="sm">
              Bind
            </Button>
          </form>
          <p id="bind-conversation-help" className="mt-2 text-xs text-muted-foreground">
            Channel capture is source-owned by the person who binds it. Sender context is still
            preserved for every message.
          </p>
        </SettingsSection>
      ) : null}

      <SettingsSection title="Bound conversations">
        {model.bindings.length === 0 ? (
          <p className="text-sm text-muted-foreground">No Slack conversations bound yet.</p>
        ) : (
          <ul>
            {model.bindings.map((b) => (
              <li key={b.id}>
                <CollectionRow>
                  <CollectionRow.Title>{b.title ?? 'Unnamed channel'}</CollectionRow.Title>
                  <CollectionRow.Context>
                    {sentenceCaseEnum(b.conversationType)} · {visibilityLabel(b.visibilityDefault)}
                  </CollectionRow.Context>
                  <CollectionRow.Actions>
                    {model.isAdmin ? (
                      <ItemActionGroup label={`Actions for ${b.title ?? 'Unnamed channel'}`}>
                        <form action={unbindSlackConversationAction}>
                          <input type="hidden" name="id" value={b.id} />
                          <Button type="submit" variant="ghost" size="sm">
                            Unbind
                          </Button>
                        </form>
                      </ItemActionGroup>
                    ) : undefined}
                  </CollectionRow.Actions>
                </CollectionRow>
                <div className="px-3 pb-2">
                  <TechnicalDetails
                    items={[
                      {
                        label: 'Slack conversation ID',
                        value: b.slackConversationId,
                        copyValue: b.slackConversationId,
                      },
                      { label: 'Conversation type', value: b.conversationType },
                      { label: 'Default visibility', value: b.visibilityDefault },
                    ]}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </SettingsSection>

      <SettingsSection title="Linked Slack users">
        {model.linkedSlackUsers.length === 0 ? (
          <p className="text-sm text-muted-foreground">No Slack identities linked yet.</p>
        ) : (
          <ul>
            {model.linkedSlackUsers.map((u) => {
              return (
                <li key={u.id}>
                  <CollectionRow>
                    <CollectionRow.Title>
                      {u.appUser?.name ?? u.appUser?.email ?? 'Timeline user'}
                    </CollectionRow.Title>
                    <CollectionRow.Context>
                      Slack {u.realName ?? u.name ?? 'member'}
                      {u.email ? ` · ${u.email}` : ''}
                    </CollectionRow.Context>
                    <CollectionRow.Metadata>
                      {u.isActive ? (
                        <CollectionStatus value="active" label="Active DM" />
                      ) : undefined}
                    </CollectionRow.Metadata>
                  </CollectionRow>
                </li>
              );
            })}
          </ul>
        )}
      </SettingsSection>
    </div>
  );
}

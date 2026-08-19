import {
  telegramChatBindings,
  telegramLinkTokens,
  telegramUsers,
  telegramUserTeams,
  users,
} from '@timeline/db';
import { getEnv } from '@timeline/shared/env';
import { withTeam } from '@timeline/shared/team-scope';
import { and, desc, eq, gt, inArray, isNull } from 'drizzle-orm';
import { Hash, Users } from 'lucide-react';
import { redirect } from 'next/navigation';

import type { Metadata } from 'next';

import { revokeLinkTokenAction, unbindChatAction } from '@/app/actions/telegram';
import { CollectionRow } from '@/components/collections/collection-row';
import { CollectionStatus } from '@/components/collections/collection-status';
import { EmptyState } from '@/components/empty-state';
import { HistoryBackLink } from '@/components/history-back-link';
import { PageHeader } from '@/components/page-header';
import { RelativeTimestamp } from '@/components/relative-timestamp';
import { SettingsSection } from '@/components/section-heading';
import { TechnicalDetails } from '@/components/technical-details';
import { GenerateGroupTokenForm, GeneratePersonalTokenForm } from '@/components/telegram-forms';
import { Button } from '@/components/ui/button';
import { ItemActionGroup } from '@/components/ui/item-actions';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

export const metadata: Metadata = {
  title: 'Telegram',
  description: 'Configure Telegram capture and bindings.',
};

export default async function TelegramSettingsPage() {
  const session = await auth();
  if (!session?.user) redirect('/sign-in');
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) redirect('/sign-in');

  const scope = withTeam(db, active.teamId, session.user.id);
  const role = await scope.requireMembership();
  const isAdmin = role === 'owner' || role === 'admin';

  const env = getEnv();
  const botUsername = env.TELEGRAM_BOT_USERNAME ?? null;
  const webhookConfigured = Boolean(env.TELEGRAM_WEBHOOK_SECRET);

  const now = new Date();
  // Tokens are secrets. The cleartext value is only shown once, on the
  // generating client's own form-state response. Persistent server-rendered
  // lists never include the token value. Members see only their own pending
  // tokens (so they can see what's outstanding); admins see all tokens so
  // they can revoke stale ones across the team.
  const tokensWhere = isAdmin
    ? and(
        eq(telegramLinkTokens.teamId, active.teamId),
        isNull(telegramLinkTokens.consumedAt),
        gt(telegramLinkTokens.expiresAt, now),
      )
    : and(
        eq(telegramLinkTokens.teamId, active.teamId),
        eq(telegramLinkTokens.issuedByUserId, session.user.id),
        isNull(telegramLinkTokens.consumedAt),
        gt(telegramLinkTokens.expiresAt, now),
      );
  const [activeTokens, bindings, linkedTgUsers] = await Promise.all([
    db
      .select({
        id: telegramLinkTokens.id,
        scope: telegramLinkTokens.scope,
        expiresAt: telegramLinkTokens.expiresAt,
        issuedByUserId: telegramLinkTokens.issuedByUserId,
      })
      .from(telegramLinkTokens)
      .where(tokensWhere)
      .orderBy(desc(telegramLinkTokens.createdAt)),
    db
      .select()
      .from(telegramChatBindings)
      .where(eq(telegramChatBindings.teamId, active.teamId))
      .orderBy(desc(telegramChatBindings.createdAt)),
    db
      .select({
        id: telegramUsers.id,
        tgUserId: telegramUsers.tgUserId,
        username: telegramUsers.username,
        firstName: telegramUsers.firstName,
        lastName: telegramUsers.lastName,
        userId: telegramUsers.userId,
        isActive: telegramUserTeams.isActive,
      })
      .from(telegramUserTeams)
      .innerJoin(telegramUsers, eq(telegramUserTeams.telegramUserId, telegramUsers.id))
      .where(eq(telegramUserTeams.teamId, active.teamId)),
  ]);

  const userIds = linkedTgUsers.map((u) => u.userId).filter((id): id is string => Boolean(id));
  const userRows =
    userIds.length > 0
      ? await db
          .select({ id: users.id, name: users.name, email: users.email })
          .from(users)
          .where(inArray(users.id, userIds))
      : [];
  const userMap = new Map(userRows.map((u) => [u.id, u] as const));

  return (
    <div className="space-y-4">
      <HistoryBackLink fallbackHref="/app/team" label="Team settings" />
      <PageHeader
        variant="collection"
        title="Telegram"
        subtitle="Route chat and voice notes into the same capture pipeline."
        srLabel={`Telegram integration for ${active.teamName} · ${bindings.length} bound groups · ${linkedTgUsers.length} linked users`}
        metadata={[
          { label: 'Team', value: active.teamName },
          { label: 'Groups', value: bindings.length, mono: true },
          { label: 'Users', value: linkedTgUsers.length, mono: true },
        ]}
      />

      {!webhookConfigured ? (
        <p className="text-sm text-fg-muted">
          Telegram is not configured in this environment. Set{' '}
          <code className="font-mono">TELEGRAM_BOT_TOKEN</code> and{' '}
          <code className="font-mono">TELEGRAM_WEBHOOK_SECRET</code> and register the webhook (see{' '}
          <code className="font-mono">docs/setup/telegram.md</code>). Link tokens still generate,
          but Telegram will not deliver messages until the webhook is live.
        </p>
      ) : null}

      <SettingsSection title="Link a personal DM">
        <p className="text-sm text-muted-foreground">
          Generate a single-use token, then DM the bot{' '}
          <code className="font-mono">/link &lt;token&gt;</code>. 15-minute TTL.
        </p>
        <GeneratePersonalTokenForm botUsername={botUsername} />
      </SettingsSection>

      {isAdmin ? (
        <SettingsSection title="Bind a group chat">
          <p className="text-sm text-muted-foreground">
            Add the bot to the group with the deep-link, or have an admin run{' '}
            <code className="font-mono">/link &lt;token&gt;</code> inside the group. Group binding
            lets everyone in the group capture messages and use /ask against team-visible history.
          </p>
          <GenerateGroupTokenForm botUsername={botUsername} />
        </SettingsSection>
      ) : null}

      {activeTokens.length > 0 ? (
        <SettingsSection title="Pending tokens">
          <p className="text-xs text-muted-foreground">
            Token values are only shown once, when you generate them. Lost a token? Revoke it and
            generate a new one.
          </p>
          <ul>
            {activeTokens.map((t) => (
              <li key={t.id}>
                <CollectionRow>
                  <CollectionRow.Title>
                    {t.scope === 'group' ? 'Group binding' : 'Personal link'}
                  </CollectionRow.Title>
                  <CollectionRow.Context>
                    {isAdmin && t.issuedByUserId !== session.user.id
                      ? 'Issued by another teammate'
                      : undefined}
                  </CollectionRow.Context>
                  <CollectionRow.Metadata>
                    <RelativeTimestamp prefix="Expires" value={t.expiresAt} />
                  </CollectionRow.Metadata>
                  <CollectionRow.Actions>
                    {isAdmin ? (
                      <ItemActionGroup
                        label={`Actions for ${t.scope === 'group' ? 'group binding' : 'personal link'} token`}
                      >
                        <form action={revokeLinkTokenAction}>
                          <input type="hidden" name="id" value={t.id} />
                          <Button type="submit" variant="ghost" size="sm">
                            Revoke
                          </Button>
                        </form>
                      </ItemActionGroup>
                    ) : undefined}
                  </CollectionRow.Actions>
                </CollectionRow>
              </li>
            ))}
          </ul>
        </SettingsSection>
      ) : null}

      <SettingsSection title="Bound group chats">
        {bindings.length === 0 ? (
          <EmptyState
            icon={Hash}
            size="inset"
            title="No groups bound yet"
            body="Generate a group token and run it in the Telegram chat you want Timeline to capture."
          />
        ) : (
          <ul>
            {bindings.map((b) => (
              <li key={b.id}>
                <CollectionRow>
                  <CollectionRow.Title>{b.title ?? 'Unnamed chat'}</CollectionRow.Title>
                  <CollectionRow.Metadata>
                    <RelativeTimestamp prefix="Bound" value={b.createdAt} />
                  </CollectionRow.Metadata>
                  <CollectionRow.Actions>
                    {isAdmin ? (
                      <ItemActionGroup label={`Actions for ${b.title ?? 'Unnamed chat'}`}>
                        <form action={unbindChatAction}>
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
                        label: 'Telegram chat ID',
                        value: String(b.tgChatId),
                        copyValue: String(b.tgChatId),
                      },
                      {
                        label: 'Bound at',
                        value: b.createdAt.toISOString(),
                        copyValue: b.createdAt.toISOString(),
                      },
                    ]}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </SettingsSection>

      <SettingsSection title="Linked Telegram users">
        {linkedTgUsers.length === 0 ? (
          <EmptyState
            icon={Users}
            size="inset"
            title="No Telegram users linked yet"
            body="People appear here after they complete a personal Telegram link for this team."
          />
        ) : (
          <ul>
            {linkedTgUsers.map((u) => {
              const appUser = u.userId ? userMap.get(u.userId) : undefined;
              const fullName = [u.firstName, u.lastName].filter(Boolean).join(' ');
              const tgName = u.username ?? (fullName || 'Telegram member');
              return (
                <li key={`${u.id}-${u.userId ?? 'unverified'}`}>
                  <CollectionRow>
                    <CollectionRow.Title>
                      {appUser?.name ?? appUser?.email ?? 'Unverified Telegram user'}
                    </CollectionRow.Title>
                    <CollectionRow.Context>
                      {tgName} · {appUser?.email ?? 'no app account'}
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

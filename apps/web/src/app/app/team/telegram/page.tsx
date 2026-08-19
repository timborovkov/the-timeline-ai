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
import { EmptyState } from '@/components/empty-state';
import { HistoryBackLink } from '@/components/history-back-link';
import { PageHeader } from '@/components/page-header';
import { SettingsSection } from '@/components/section-heading';
import { TechnicalDetails } from '@/components/technical-details';
import { GenerateGroupTokenForm, GeneratePersonalTokenForm } from '@/components/telegram-forms';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ItemActionGroup } from '@/components/ui/item-actions';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { formatDisplayDateTime } from '@/lib/display-dates';

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
  const [activeTokens, bindings, linkedTgUsers, calendarSettings] = await Promise.all([
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
    scope.calendar.getCalendarSettings(),
  ]);
  const timezone = calendarSettings.defaultTimezone;

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
    <div className="space-y-6">
      <HistoryBackLink fallbackHref="/app/team" label="Team settings" />
      <PageHeader
        title="Telegram"
        subtitle="Route chat and voice notes into the same capture pipeline."
        srLabel={`Telegram integration for ${active.teamName} · ${bindings.length} bound groups · ${linkedTgUsers.length} linked users`}
        metadata={[
          { label: 'team', value: active.teamName, signal: true },
          { label: 'groups', value: bindings.length },
          { label: 'users', value: linkedTgUsers.length },
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
          <ul className="divide-y">
            {activeTokens.map((t) => (
              <li
                key={t.id}
                className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex flex-col">
                  <span className="text-sm">
                    {t.scope === 'group' ? 'Group binding' : 'Personal link'}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Expires {formatDisplayDateTime(t.expiresAt, { timezone })}
                    {isAdmin && t.issuedByUserId !== session.user.id
                      ? ` · issued by another teammate`
                      : ''}
                  </span>
                </div>
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
                ) : null}
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
          <ul className="divide-y">
            {bindings.map((b) => (
              <li
                key={b.id}
                className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 flex-1 space-y-2">
                  <span className="text-sm font-medium">{b.title ?? 'Unnamed chat'}</span>
                  <span className="text-xs text-muted-foreground">
                    Bound {formatDisplayDateTime(b.createdAt, { timezone })}
                  </span>
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
                {isAdmin ? (
                  <ItemActionGroup label={`Actions for ${b.title ?? 'Unnamed chat'}`}>
                    <form action={unbindChatAction}>
                      <input type="hidden" name="id" value={b.id} />
                      <Button type="submit" variant="ghost" size="sm">
                        Unbind
                      </Button>
                    </form>
                  </ItemActionGroup>
                ) : null}
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
          <ul className="divide-y">
            {linkedTgUsers.map((u) => {
              const appUser = u.userId ? userMap.get(u.userId) : undefined;
              const fullName = [u.firstName, u.lastName].filter(Boolean).join(' ');
              const tgName = u.username ?? (fullName || 'Telegram member');
              return (
                <li
                  key={`${u.id}-${u.userId ?? 'unverified'}`}
                  className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 flex-1">
                    <span className="text-sm font-medium">
                      {appUser?.name ?? appUser?.email ?? 'Unverified Telegram user'}
                    </span>
                    <span className="block break-words text-xs text-muted-foreground">
                      tg:{tgName} · {appUser?.email ?? 'no app account'}
                    </span>
                  </div>
                  {u.isActive ? <Badge variant="outline">active DM</Badge> : null}
                </li>
              );
            })}
          </ul>
        )}
      </SettingsSection>
    </div>
  );
}

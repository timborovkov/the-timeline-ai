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
import { redirect } from 'next/navigation';

import type { Metadata } from 'next';

import { revokeLinkTokenAction, unbindChatAction } from '@/app/actions/telegram';
import { IndexStrip } from '@/components/index-strip';
import { GenerateGroupTokenForm, GeneratePersonalTokenForm } from '@/components/telegram-forms';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
    <div className="mx-auto max-w-3xl space-y-6">
      <IndexStrip
        srLabel={`Telegram integration for ${active.teamName} · ${bindings.length} bound groups · ${linkedTgUsers.length} linked users`}
        segments={[
          { value: 'TEAM / TELEGRAM' },
          { label: 'team', value: active.teamName, signal: true },
          { label: 'groups', value: bindings.length },
          { label: 'users', value: linkedTgUsers.length },
        ]}
      />

      {!webhookConfigured ? (
        <Card>
          <CardContent className="py-4 text-sm text-muted-foreground">
            <p>
              Telegram is not configured in this environment. Set{' '}
              <code className="font-mono">TELEGRAM_BOT_TOKEN</code> and{' '}
              <code className="font-mono">TELEGRAM_WEBHOOK_SECRET</code> and register the webhook
              (see <code className="font-mono">docs/setup/telegram.md</code>). Link tokens still
              generate, but Telegram will not deliver messages until the webhook is live.
            </p>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Link a personal DM</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Generate a single-use token, then DM the bot{' '}
            <code className="font-mono">/link &lt;token&gt;</code>. 15-minute TTL.
          </p>
          <GeneratePersonalTokenForm botUsername={botUsername} />
        </CardContent>
      </Card>

      {isAdmin ? (
        <Card>
          <CardHeader>
            <CardTitle>Bind a group chat</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Add the bot to the group with the deep-link, or have an admin run{' '}
              <code className="font-mono">/link &lt;token&gt;</code> inside the group. Group binding
              requires a team admin to issue the token and a group admin to consume it.
            </p>
            <GenerateGroupTokenForm botUsername={botUsername} />
          </CardContent>
        </Card>
      ) : null}

      {activeTokens.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Pending tokens</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Token values are only shown once, when you generate them. Lost a token? Revoke it and
              generate a new one.
            </p>
            <ul className="divide-y">
              {activeTokens.map((t) => (
                <li key={t.id} className="flex items-center justify-between py-3">
                  <div className="flex flex-col">
                    <span className="text-sm">
                      {t.scope === 'group' ? 'Group binding' : 'Personal link'}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      expires {t.expiresAt.toISOString()}
                      {isAdmin && t.issuedByUserId !== session.user.id
                        ? ` · issued by another teammate`
                        : ''}
                    </span>
                  </div>
                  {isAdmin ? (
                    <form action={revokeLinkTokenAction}>
                      <input type="hidden" name="id" value={t.id} />
                      <Button type="submit" variant="ghost" size="sm">
                        Revoke
                      </Button>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Bound group chats</CardTitle>
        </CardHeader>
        <CardContent>
          {bindings.length === 0 ? (
            <p className="text-sm text-muted-foreground">No groups bound yet.</p>
          ) : (
            <ul className="divide-y">
              {bindings.map((b) => (
                <li key={b.id} className="flex items-center justify-between py-3">
                  <div className="flex flex-col">
                    <span className="text-sm font-medium">{b.title ?? `Chat ${b.tgChatId}`}</span>
                    <span className="text-xs text-muted-foreground">
                      chat_id {b.tgChatId} · bound {b.createdAt.toISOString()}
                    </span>
                  </div>
                  {isAdmin ? (
                    <form action={unbindChatAction}>
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
          <CardTitle>Linked Telegram users</CardTitle>
        </CardHeader>
        <CardContent>
          {linkedTgUsers.length === 0 ? (
            <p className="text-sm text-muted-foreground">No Telegram users linked yet.</p>
          ) : (
            <ul className="divide-y">
              {linkedTgUsers.map((u) => {
                const appUser = u.userId ? userMap.get(u.userId) : undefined;
                const fullName = [u.firstName, u.lastName].filter(Boolean).join(' ');
                const tgName = u.username ?? (fullName || `tg:${u.tgUserId}`);
                return (
                  <li
                    key={`${u.id}-${u.userId ?? 'unverified'}`}
                    className="flex items-center justify-between py-3"
                  >
                    <div className="flex flex-col">
                      <span className="text-sm font-medium">
                        {appUser?.name ?? appUser?.email ?? 'Unverified Telegram user'}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        tg:{tgName} · {appUser?.email ?? 'no app account'}
                      </span>
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

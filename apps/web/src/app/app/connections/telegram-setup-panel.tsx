'use client';

import { Hash, Users } from 'lucide-react';

import type { TelegramSetupSnapshot } from '@/app/app/connections/connection-directory';
import type { ReactNode } from 'react';

import { revokeLinkTokenAction, unbindChatAction } from '@/app/actions/telegram';
import { CollectionRow } from '@/components/collections/collection-row';
import { CollectionStatus } from '@/components/collections/collection-status';
import { EmptyState } from '@/components/empty-state';
import { RelativeTimestamp } from '@/components/relative-timestamp';
import { TechnicalDetails } from '@/components/technical-details';
import { GenerateGroupTokenForm, GeneratePersonalTokenForm } from '@/components/telegram-forms';
import { Button } from '@/components/ui/button';
import { ItemActionGroup } from '@/components/ui/item-actions';

function SetupSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-medium text-fg-muted">{title}</h3>
      {children}
    </section>
  );
}

function PendingTokens({
  tokens,
  isAdmin,
  currentUserId,
}: {
  tokens: TelegramSetupSnapshot['tokens'];
  isAdmin: boolean;
  currentUserId: string;
}) {
  if (tokens.length === 0) return null;
  return (
    <SetupSection title="Pending tokens">
      <p className="text-xs text-fg-muted">
        Token values are only shown once, when you generate them. Lost a token? Revoke it and
        generate a new one.
      </p>
      <ul>
        {tokens.map((token) => (
          <li key={token.id}>
            <CollectionRow>
              <CollectionRow.Title>
                {token.scope === 'group' ? 'Group binding' : 'Personal link'}
              </CollectionRow.Title>
              <CollectionRow.Context>
                {isAdmin && token.issuedByUserId !== currentUserId
                  ? 'Issued by another teammate'
                  : undefined}
              </CollectionRow.Context>
              <CollectionRow.Metadata>
                <RelativeTimestamp prefix="Expires" value={token.expiresAt} />
              </CollectionRow.Metadata>
              <CollectionRow.Actions>
                {isAdmin ? (
                  <ItemActionGroup
                    label={`Actions for ${token.scope === 'group' ? 'group binding' : 'personal link'} token`}
                  >
                    <form action={revokeLinkTokenAction}>
                      <input type="hidden" name="id" value={token.id} />
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
    </SetupSection>
  );
}

function BoundGroups({
  bindings,
  isAdmin,
}: {
  bindings: TelegramSetupSnapshot['bindings'];
  isAdmin: boolean;
}) {
  return (
    <SetupSection title="Bound group chats">
      {bindings.length === 0 ? (
        <EmptyState
          icon={Hash}
          size="inset"
          title="No groups bound yet"
          body="Generate a group token and run it in the Telegram chat you want Timeline to capture."
        />
      ) : (
        <ul>
          {bindings.map((binding) => (
            <li key={binding.id}>
              <CollectionRow>
                <CollectionRow.Title>{binding.title ?? 'Unnamed chat'}</CollectionRow.Title>
                <CollectionRow.Metadata>
                  <RelativeTimestamp prefix="Bound" value={binding.createdAt} />
                </CollectionRow.Metadata>
                <CollectionRow.Actions>
                  {isAdmin ? (
                    <ItemActionGroup label={`Actions for ${binding.title ?? 'Unnamed chat'}`}>
                      <form action={unbindChatAction}>
                        <input type="hidden" name="id" value={binding.id} />
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
                      value: String(binding.tgChatId),
                      copyValue: String(binding.tgChatId),
                    },
                    {
                      label: 'Bound at',
                      value: binding.createdAt,
                      copyValue: binding.createdAt,
                    },
                  ]}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </SetupSection>
  );
}

function LinkedUsers({ users }: { users: TelegramSetupSnapshot['linkedUsers'] }) {
  return (
    <SetupSection title="Linked Telegram users">
      {users.length === 0 ? (
        <EmptyState
          icon={Users}
          size="inset"
          title="No Telegram users linked yet"
          body="People appear here after they complete a personal Telegram link for this team."
        />
      ) : (
        <ul>
          {users.map((user) => {
            const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ');
            const tgName = user.username ?? (fullName || 'Telegram member');
            return (
              <li key={user.id}>
                <CollectionRow>
                  <CollectionRow.Title>
                    {user.appName ?? user.appEmail ?? 'Unverified Telegram user'}
                  </CollectionRow.Title>
                  <CollectionRow.Context>
                    {tgName} · {user.appEmail ?? 'no app account'}
                  </CollectionRow.Context>
                  <CollectionRow.Metadata>
                    {user.isActive ? (
                      <CollectionStatus value="active" label="Active DM" />
                    ) : undefined}
                  </CollectionRow.Metadata>
                </CollectionRow>
              </li>
            );
          })}
        </ul>
      )}
    </SetupSection>
  );
}

export function TelegramSetupBody({
  setup,
  isAdmin,
}: {
  setup: TelegramSetupSnapshot;
  isAdmin: boolean;
}) {
  return (
    <>
      {!setup.webhookConfigured ? (
        <p className="text-sm text-fg-muted">
          Telegram is not configured in this environment. Set{' '}
          <code className="font-mono">TELEGRAM_BOT_TOKEN</code> and{' '}
          <code className="font-mono">TELEGRAM_WEBHOOK_SECRET</code> and register the webhook. Link
          tokens still generate, but Telegram will not deliver messages until the webhook is live.
        </p>
      ) : null}

      <SetupSection title="Link a personal DM">
        <p className="text-sm text-fg-muted">
          Generate a single-use token, then DM the bot{' '}
          <code className="font-mono">/link &lt;token&gt;</code>. 15-minute TTL.
        </p>
        <GeneratePersonalTokenForm botUsername={setup.botUsername} />
      </SetupSection>

      {isAdmin ? (
        <SetupSection title="Bind a group chat">
          <p className="text-sm text-fg-muted">
            Add the bot to the group with the deep-link, or have an admin run{' '}
            <code className="font-mono">/link &lt;token&gt;</code> inside the group. Group binding
            lets everyone in the group capture messages and use /ask against team-visible history.
          </p>
          <GenerateGroupTokenForm botUsername={setup.botUsername} />
        </SetupSection>
      ) : null}

      <PendingTokens tokens={setup.tokens} isAdmin={isAdmin} currentUserId={setup.currentUserId} />
      <BoundGroups bindings={setup.bindings} isAdmin={isAdmin} />
      <LinkedUsers users={setup.linkedUsers} />
    </>
  );
}

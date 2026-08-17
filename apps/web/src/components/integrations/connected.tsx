'use client';

import { useRouter } from 'next/navigation';
import { useActionState, useId, useState } from 'react';

import { setIntegrationVisibilityDefaultAction } from '@/app/actions/visibility';
import { FormActionToast } from '@/components/form-action-toast';
import { InlineError } from '@/components/inline-error';
import { Button } from '@/components/ui/button';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { ItemActionGroup, ItemOverflowMenu } from '@/components/ui/item-actions';
import { notifyAction } from '@/lib/notify';
import { providerLabel } from '@/lib/resource-labels';
import { connectionErrorMessage } from '@/lib/ux-errors';

interface ConnectedRow {
  id: string;
  provider: string;
  displayName: string;
  enabled: boolean;
  lastSyncedAt: string | null;
  lastError: string | null;
  syncPause: { retryAt: string; reason: string; scope: string | null } | null;
  attention: ConnectedAttention[];
  visibilityDefault: 'team' | 'private' | 'specific_users';
  visibilityDefaultUserIds: string[] | null;
}

interface ConnectedAttention {
  id: string;
  category:
    | 'needs_reconnect'
    | 'needs_new_owner'
    | 'access_changed'
    | 'sync_error'
    | 'webhook_degraded';
  summary: string;
  lastSeenAt: string;
}

interface MemberOption {
  id: string;
  label: string;
}

const EMPTY_MEMBERS: MemberOption[] = [];
const DATE_FORMAT = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'UTC',
});

function syncPauseText(syncPause: ConnectedRow['syncPause']): string | null {
  if (!syncPause) return null;
  const retryAt = new Date(syncPause.retryAt);
  const formattedRetryAt = Number.isNaN(retryAt.getTime())
    ? syncPause.retryAt
    : DATE_FORMAT.format(retryAt);
  const scope = syncPause.scope ? ` (${syncPause.scope})` : '';
  return `Provider quota cooldown${scope}. Sync resumes at ${formattedRetryAt}.`;
}

function attentionTitle(category: ConnectedAttention['category']): string {
  switch (category) {
    case 'needs_reconnect':
      return 'Reconnect required';
    case 'needs_new_owner':
      return 'Connection owner needed';
    case 'access_changed':
      return 'Source access changed';
    case 'sync_error':
      return 'Sync needs attention';
    case 'webhook_degraded':
      return 'Webhook delivery degraded';
  }
}

function hasBlockingAttention(attention: ConnectedAttention[]): boolean {
  return attention.some(
    (item) =>
      item.category === 'needs_reconnect' ||
      item.category === 'needs_new_owner' ||
      item.category === 'access_changed',
  );
}

function hasOnlyWebhookDegradedAttention(attention: ConnectedAttention[]): boolean {
  return attention.length > 0 && attention.every((item) => item.category === 'webhook_degraded');
}

function blockingAttentionAction(
  attention: ConnectedAttention[],
): { href: string; label: string } | null {
  if (attention.some((item) => item.category === 'needs_reconnect')) {
    return { href: '/app/me/connections', label: 'Reconnect account' };
  }
  if (attention.some((item) => item.category === 'needs_new_owner')) {
    return { href: '#available-shared-sources', label: 'Choose replacement' };
  }
  if (attention.some((item) => item.category === 'access_changed')) {
    return { href: '#available-shared-sources', label: 'Review sources' };
  }
  return null;
}

function needsReplacementFromLastError(lastError: string | null): boolean {
  return lastError?.includes('Provider connection deleted') ?? false;
}

function dedupeAttention(attention: ConnectedAttention[]): ConnectedAttention[] {
  const seen = new Set<string>();
  const deduped: ConnectedAttention[] = [];
  for (const item of attention) {
    const key = `${item.category}\x00${item.summary}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }
  return deduped;
}

export function ConnectedIntegrations({
  connected,
  members = EMPTY_MEMBERS,
}: {
  connected: ConnectedRow[];
  members?: MemberOption[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDisconnectId, setConfirmDisconnectId] = useState<string | null>(null);
  const [locallyDisconnectedIds, setLocallyDisconnectedIds] = useState<Set<string>>(
    () => new Set(),
  );
  const visibleConnected = connected.filter((row) => !locallyDisconnectedIds.has(row.id));

  if (visibleConnected.length === 0) {
    return <p className="text-sm text-fg-muted">No integrations connected yet.</p>;
  }

  async function call(method: 'sync' | 'disconnect', id: string) {
    setBusy(`${method}:${id}`);
    const result = await notifyAction({
      id: `integration:${id}:${method}`,
      loading: method === 'sync' ? 'Syncing…' : 'Disconnecting…',
      success: method === 'sync' ? 'Sync started' : 'Integration disconnected',
      error: method === 'sync' ? 'Couldn’t sync integration' : 'Couldn’t disconnect integration',
      run: async () => {
        const res = await fetch(`/api/integrations/manage/${id}/${method}`, { method: 'POST' });
        if (!res.ok) return { error: 'request_failed' };
        return { ok: true };
      },
    });
    setBusy(null);
    if (result.error) return;
    if (method === 'disconnect') {
      setConfirmDisconnectId((current) => (current === id ? null : current));
      setLocallyDisconnectedIds((current) => {
        const next = new Set(current);
        next.add(id);
        return next;
      });
    }
    router.refresh();
  }

  return (
    <>
      <ul className="divide-y divide-border rounded-md border border-border bg-surface">
        {visibleConnected.map((c) => {
          const pauseText = syncPauseText(c.syncPause);
          const attention = dedupeAttention(c.attention);
          const needsReplacement =
            attention.length === 0 && needsReplacementFromLastError(c.lastError);
          const blockingAction =
            blockingAttentionAction(attention) ??
            (needsReplacement
              ? { href: '#available-shared-sources', label: 'Choose replacement' }
              : null);
          const syncDisabled =
            busy !== null ||
            !c.enabled ||
            Boolean(c.syncPause) ||
            hasBlockingAttention(attention) ||
            needsReplacement;
          return (
            <li key={c.id} className="flex flex-col gap-3 px-3 py-2 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{providerLabel(c.provider)}</span>
                  <span className="truncate text-sm text-fg-muted">{c.displayName}</span>
                  {!c.enabled ? (
                    <span className="rounded-sm border border-border px-1 text-[10px] uppercase text-fg-muted">
                      Disabled
                    </span>
                  ) : null}
                </div>
                <div className="text-xs text-fg-muted">
                  {c.lastSyncedAt
                    ? `Last synced ${DATE_FORMAT.format(new Date(c.lastSyncedAt))}`
                    : 'Never synced'}
                </div>
                {attention.length > 0 ? (
                  <IntegrationAttentionPanel attention={attention} details={c.lastError} />
                ) : null}
                {pauseText ? (
                  <output className="mt-2 block rounded-sm border border-border bg-surface-2 px-3 py-2 text-sm text-fg-muted">
                    {pauseText}
                  </output>
                ) : null}
                {c.lastError && !pauseText && c.attention.length === 0 ? (
                  <InlineError
                    message={connectionErrorMessage(c.lastError)}
                    details={c.lastError}
                    onRetry={needsReplacement ? undefined : () => void call('sync', c.id)}
                    retrying={busy === `sync:${c.id}`}
                    retryLabel="Retry sync"
                    className="mt-2"
                  />
                ) : null}
                {confirmDisconnectId === c.id ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2 rounded-sm border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">
                    <span className="min-w-0 flex-1 text-destructive">
                      Future sync stops, but existing timeline events remain available.
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={busy !== null}
                      onClick={() => {
                        setConfirmDisconnectId(null);
                      }}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="destructive"
                      disabled={busy !== null}
                      onClick={() => {
                        void call('disconnect', c.id);
                      }}
                    >
                      {busy === `disconnect:${c.id}` ? 'Disconnecting' : 'Confirm disconnect'}
                    </Button>
                  </div>
                ) : null}
                <IntegrationVisibilityForm integration={c} members={members} />
              </div>
              <ItemActionGroup label={`Actions for ${c.displayName}`}>
                {blockingAction ? (
                  <Button asChild size="sm" variant="secondary" className="flex-1 sm:flex-none">
                    <a href={blockingAction.href}>{blockingAction.label}</a>
                  </Button>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="flex-1 sm:flex-none"
                    disabled={syncDisabled}
                    onClick={() => {
                      void call('sync', c.id);
                    }}
                  >
                    {busy === `sync:${c.id}`
                      ? 'Syncing…'
                      : !c.enabled
                        ? 'Disabled'
                        : c.syncPause
                          ? 'Paused'
                          : 'Sync now'}
                  </Button>
                )}
                {confirmDisconnectId === c.id ? null : (
                  <ItemOverflowMenu targetLabel={c.displayName}>
                    <DropdownMenuItem
                      disabled={busy !== null}
                      className="text-destructive focus:text-destructive"
                      onSelect={() => {
                        setConfirmDisconnectId(c.id);
                      }}
                    >
                      Disconnect
                    </DropdownMenuItem>
                  </ItemOverflowMenu>
                )}
              </ItemActionGroup>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function IntegrationAttentionPanel({
  attention,
  details,
}: {
  attention: ConnectedAttention[];
  details: string | null;
}) {
  const [showDetails, setShowDetails] = useState(false);
  const sorted = [...attention].sort((a, b) => a.category.localeCompare(b.category));
  const softStatus = hasOnlyWebhookDegradedAttention(sorted);
  return (
    <div
      className={
        softStatus
          ? 'mt-2 rounded-sm border border-signal/30 bg-signal/10 px-3 py-2 text-sm text-fg'
          : 'mt-2 rounded-sm border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger'
      }
    >
      <ul className="space-y-1.5">
        {sorted.map((item) => (
          <li key={item.id}>
            <span className={softStatus ? 'font-medium text-signal' : 'font-medium'}>
              {attentionTitle(item.category)}:
            </span>{' '}
            <span>{item.summary}</span>
          </li>
        ))}
      </ul>
      {details ? (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => {
              setShowDetails((v) => !v);
            }}
            className="text-xs text-fg-muted transition-colors hover:text-fg"
            aria-expanded={showDetails}
          >
            {showDetails ? 'Hide details' : 'Details'}
          </button>
          {showDetails ? (
            <pre className="mt-1 overflow-auto rounded-sm bg-bg/60 p-2 font-mono text-[11px] text-fg-muted">
              {details}
            </pre>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function IntegrationVisibilityForm({
  integration,
  members,
}: {
  integration: ConnectedRow;
  members: MemberOption[];
}) {
  const [state, action, pending] = useActionState(setIntegrationVisibilityDefaultAction, {});
  const visibilityId = useId();
  const formKey = `${integration.id}:${integration.visibilityDefault}:${(
    integration.visibilityDefaultUserIds ?? []
  ).join(',')}`;
  const [selectedVisibility, setSelectedVisibility] = useState(integration.visibilityDefault);

  return (
    <form key={formKey} action={action} className="mt-2 flex flex-wrap items-center gap-2 text-xs">
      <input type="hidden" name="id" value={integration.id} />
      <label htmlFor={visibilityId} className="font-medium text-fg">
        Default visibility for {providerLabel(integration.provider)}
      </label>
      <select
        id={visibilityId}
        name="visibility"
        value={selectedVisibility}
        onChange={(e) => {
          setSelectedVisibility(e.currentTarget.value as ConnectedRow['visibilityDefault']);
        }}
        className="min-h-9 rounded-sm border border-border bg-bg px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        <option value="team">Team</option>
        <option value="private">Private</option>
        <option value="specific_users">Specific users</option>
      </select>
      {selectedVisibility === 'specific_users' ? (
        <fieldset className="flex flex-wrap items-center gap-2">
          <legend className="sr-only">People who can view new captured events</legend>
          {members.map((m) => (
            <label key={m.id} className="flex items-center gap-1 text-fg-muted">
              <input
                type="checkbox"
                name="visibilityUserIds"
                value={m.id}
                defaultChecked={integration.visibilityDefaultUserIds?.includes(m.id) ?? false}
              />
              {m.label}
            </label>
          ))}
        </fieldset>
      ) : null}
      <Button type="submit" size="sm" variant="outline" className="min-h-9" disabled={pending}>
        {pending ? 'Saving' : 'Save default'}
      </Button>
      <FormActionToast
        id={`integration-visibility:${integration.id}`}
        error={state.error}
        success={state.ok ? 'Default visibility saved' : undefined}
      />
    </form>
  );
}

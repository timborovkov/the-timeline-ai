'use client';

import {
  isTimelineEventClass,
  TIMELINE_EVENT_CLASS_OPTIONS,
  type TimelineEventClass,
} from '@timeline/shared/event-class';
import { useRouter } from 'next/navigation';
import { useEffect, useReducer } from 'react';

import { CollectionRow } from '@/components/collections/collection-row';
import { CopyButton } from '@/components/copy-button';
import { RelativeTimestamp } from '@/components/relative-timestamp';
import { useAppDialog } from '@/components/ui/app-dialog';
import { Button } from '@/components/ui/button';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { ItemActionGroup, ItemOverflowMenu } from '@/components/ui/item-actions';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { notifyAction } from '@/lib/notify';

interface CredentialRow {
  id: string;
  prefix: string;
  lastUsedAt: string | null;
  createdAt: string;
}

export interface IngestWebhookRow {
  id: string;
  name: string;
  visibilityDefault: string;
  eventClass: TimelineEventClass;
  proposalGenerationEnabled: boolean;
  disabledAt: string | null;
  createdAt: string;
  credentials: CredentialRow[];
}

interface MintedCredential {
  webhookName: string;
  plaintext: string;
}

async function webhookActionError(response: Response, fallback: string): Promise<string> {
  const payload = (await response.json().catch(() => null)) as { error?: unknown } | null;
  const code = typeof payload?.error === 'string' ? payload.error : null;
  switch (code) {
    case 'forbidden':
      return 'You do not have permission to make this change.';
    case 'not_found':
      return 'This webhook no longer exists. Refresh the page and try again.';
    case 'unauthorized':
      return 'Sign in again to manage ingest webhooks.';
    case 'no_team':
      return 'Choose a team before managing ingest webhooks.';
    default:
      return fallback;
  }
}

interface State {
  showCreate: boolean;
  name: string;
  visibilityDefault: 'team' | 'private';
  eventClass: TimelineEventClass;
  proposalGenerationEnabled: boolean;
  busy: boolean;
  minted: MintedCredential | null;
  origin: string;
}

type Action =
  | { type: 'showCreate'; showCreate: boolean }
  | { type: 'name'; name: string }
  | { type: 'visibilityDefault'; visibilityDefault: 'team' | 'private' }
  | { type: 'eventClass'; eventClass: TimelineEventClass }
  | { type: 'proposalGenerationEnabled'; proposalGenerationEnabled: boolean }
  | { type: 'busy'; busy: boolean }
  | { type: 'minted'; minted: MintedCredential | null }
  | { type: 'origin'; origin: string }
  | { type: 'created'; minted: MintedCredential };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'showCreate':
      return { ...state, showCreate: action.showCreate };
    case 'name':
      return { ...state, name: action.name };
    case 'visibilityDefault':
      return { ...state, visibilityDefault: action.visibilityDefault };
    case 'eventClass':
      return { ...state, eventClass: action.eventClass };
    case 'proposalGenerationEnabled':
      return { ...state, proposalGenerationEnabled: action.proposalGenerationEnabled };
    case 'busy':
      return { ...state, busy: action.busy };
    case 'minted':
      return { ...state, minted: action.minted };
    case 'origin':
      return { ...state, origin: action.origin };
    case 'created':
      return {
        ...state,
        minted: action.minted,
        name: '',
        visibilityDefault: 'team',
        eventClass: 'pulse',
        proposalGenerationEnabled: true,
        showCreate: false,
      };
  }
}

function parseEventClass(value: string): TimelineEventClass | null {
  return isTimelineEventClass(value) ? value : null;
}

function eventClassLabel(value: TimelineEventClass): string {
  return TIMELINE_EVENT_CLASS_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

// react-doctor-disable-next-line react-doctor/no-multi-comp -- Shared Timeline type select for create and row editors.
function EventClassSelect({
  id,
  value,
  disabled,
  onChange,
}: {
  id?: string;
  value: TimelineEventClass;
  disabled?: boolean;
  onChange: (value: TimelineEventClass) => void;
}) {
  return (
    <NativeSelect
      id={id}
      value={value}
      disabled={disabled}
      onChange={(e) => {
        const next = parseEventClass(e.target.value);
        if (!next) return;
        onChange(next);
      }}
      className="h-8"
    >
      {TIMELINE_EVENT_CLASS_OPTIONS.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </NativeSelect>
  );
}

export function IngestWebhooksUi({ webhooks }: { webhooks: IngestWebhookRow[] }) {
  const router = useRouter();
  const dialog = useAppDialog();
  const [
    {
      showCreate,
      name,
      visibilityDefault,
      eventClass,
      proposalGenerationEnabled,
      busy,
      minted,
      origin,
    },
    dispatch,
  ] = useReducer(reducer, {
    showCreate: false,
    name: '',
    visibilityDefault: 'team',
    eventClass: 'pulse',
    proposalGenerationEnabled: true,
    busy: false,
    minted: null,
    origin: '',
  });

  useEffect(() => {
    dispatch({ type: 'origin', origin: window.location.origin });
  }, []);

  function endpointFor(plaintext: string): string {
    return `${origin || 'https://thetimeline.cc'}/api/webhooks/ingest/${plaintext}`;
  }

  async function create() {
    dispatch({ type: 'busy', busy: true });
    const result = await notifyAction({
      id: 'ingest-webhook:create',
      loading: 'Creating webhook…',
      success: 'Webhook created',
      error: 'Couldn’t create webhook',
      run: async () => {
        const res = await fetch('/api/team/ingest-webhooks', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name, visibilityDefault, eventClass, proposalGenerationEnabled }),
        });
        if (!res.ok) return { error: await webhookActionError(res, 'Couldn’t create webhook') };
        const data = (await res.json()) as { name: string; credential: { plaintext: string } };
        dispatch({
          type: 'created',
          minted: { webhookName: data.name, plaintext: data.credential.plaintext },
        });
        return { ok: true };
      },
    });
    dispatch({ type: 'busy', busy: false });
    if (!result.error) router.refresh();
  }

  async function patch(id: string, body: Record<string, unknown>) {
    const result = await notifyAction({
      id: `ingest-webhook:${id}:update`,
      loading: 'Updating webhook…',
      success: 'Webhook updated',
      error: 'Couldn’t update webhook',
      run: async () => {
        const res = await fetch(`/api/team/ingest-webhooks/${id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!res.ok) return { error: await webhookActionError(res, 'Couldn’t update webhook') };
        const data = (await res.json()) as {
          name?: string;
          credential?: { plaintext: string };
        };
        if (data.credential?.plaintext && data.name) {
          dispatch({
            type: 'minted',
            minted: { webhookName: data.name, plaintext: data.credential.plaintext },
          });
        }
        return { ok: true };
      },
    });
    if (!result.error) router.refresh();
  }

  async function rotate(id: string, label: string) {
    const confirmed = await dialog.confirm({
      title: 'Rotate credential?',
      description: `"${label}" will get a new URL and the old URL will stop working.`,
      confirmLabel: 'Rotate',
    });
    if (!confirmed) return;
    const result = await notifyAction({
      id: `ingest-webhook:${id}:rotate`,
      loading: 'Rotating credential…',
      success: 'Credential rotated',
      error: 'Couldn’t rotate credential',
      run: async () => {
        const res = await fetch(`/api/team/ingest-webhooks/${id}/credentials`, { method: 'POST' });
        if (!res.ok) return { error: await webhookActionError(res, 'Couldn’t rotate credential') };
        const data = (await res.json()) as { plaintext: string };
        dispatch({ type: 'minted', minted: { webhookName: label, plaintext: data.plaintext } });
        return { ok: true };
      },
    });
    if (!result.error) router.refresh();
  }

  async function disable(id: string, label: string) {
    const confirmed = await dialog.confirm({
      title: 'Disable webhook?',
      description: `"${label}" will stop accepting new events. Existing timeline evidence stays.`,
      confirmLabel: 'Disable',
      destructive: true,
    });
    if (!confirmed) return;
    const result = await notifyAction({
      id: `ingest-webhook:${id}:disable`,
      loading: 'Disabling webhook…',
      success: 'Webhook disabled',
      error: 'Couldn’t disable webhook',
      run: async () => {
        const res = await fetch(`/api/team/ingest-webhooks/${id}`, { method: 'DELETE' });
        if (!res.ok) return { error: await webhookActionError(res, 'Couldn’t disable webhook') };
        return { ok: true };
      },
    });
    if (!result.error) router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-fg-muted">
          Send any textual webhook payload. Timeline stores the payload as evidence and uses AI to
          interpret it.
        </p>
        <Button
          size="sm"
          onClick={() => {
            dispatch({ type: 'showCreate', showCreate: !showCreate });
          }}
        >
          {showCreate ? 'Cancel' : 'New webhook'}
        </Button>
      </div>

      {minted ? (
        <div className="space-y-3 border-y border-border py-4">
          <div>
            <div className="text-sm font-medium">Copy the new URL for {minted.webhookName}</div>
            <p className="text-sm text-fg-muted">This is the only time the secret URL is shown.</p>
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 break-all rounded-sm border border-signal/40 bg-surface-2 px-2 py-1.5 font-mono text-xs">
              {endpointFor(minted.plaintext)}
            </code>
            <CopyButton value={endpointFor(minted.plaintext)} />
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              dispatch({ type: 'minted', minted: null });
            }}
          >
            I&apos;ve copied it, dismiss
          </Button>
        </div>
      ) : null}

      {showCreate ? (
        <IngestWebhookCreateForm
          name={name}
          visibilityDefault={visibilityDefault}
          eventClass={eventClass}
          proposalGenerationEnabled={proposalGenerationEnabled}
          busy={busy}
          dispatch={dispatch}
          onCreate={() => void create()}
        />
      ) : null}

      {webhooks.length === 0 ? (
        <p className="border-y border-border py-4 text-sm text-fg-muted">No ingest webhooks yet.</p>
      ) : (
        <ul className="divide-y divide-border border-y border-border">
          {webhooks.map((webhook) => (
            <IngestWebhookListItem
              key={webhook.id}
              webhook={webhook}
              onPatch={patch}
              onRotate={rotate}
              onDisable={disable}
            />
          ))}
        </ul>
      )}
      {dialog.node}
    </div>
  );
}

// react-doctor-disable-next-line react-doctor/no-multi-comp -- Create form shares webhook reducer types and stays with the Connections ingest UI.
function IngestWebhookCreateForm({
  name,
  visibilityDefault,
  eventClass,
  proposalGenerationEnabled,
  busy,
  dispatch,
  onCreate,
}: {
  name: string;
  visibilityDefault: 'team' | 'private';
  eventClass: TimelineEventClass;
  proposalGenerationEnabled: boolean;
  busy: boolean;
  dispatch: (action: Action) => void;
  onCreate: () => void;
}) {
  return (
    <div className="space-y-4 border-y border-border py-4">
      <div className="space-y-1">
        <Label htmlFor="ingest-webhook-name">Name</Label>
        <Input
          id="ingest-webhook-name"
          value={name}
          onChange={(e) => {
            dispatch({ type: 'name', name: e.target.value });
          }}
          placeholder="Pipedrive webhook"
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={visibilityDefault === 'team'}
            onChange={(e) => {
              dispatch({
                type: 'visibilityDefault',
                visibilityDefault: e.target.checked ? 'team' : 'private',
              });
            }}
          />
          Team-visible by default
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={proposalGenerationEnabled}
            onChange={(e) => {
              dispatch({
                type: 'proposalGenerationEnabled',
                proposalGenerationEnabled: e.target.checked,
              });
            }}
          />
          Generate approval proposals
        </label>
      </div>
      <div className="space-y-1">
        <Label htmlFor="ingest-webhook-event-class">Timeline type</Label>
        <EventClassSelect
          id="ingest-webhook-event-class"
          value={eventClass}
          onChange={(next) => {
            dispatch({ type: 'eventClass', eventClass: next });
          }}
        />
        <p className="text-xs text-fg-muted">
          {TIMELINE_EVENT_CLASS_OPTIONS.find((option) => option.value === eventClass)?.hint}
        </p>
      </div>
      <Button size="sm" disabled={busy || !name.trim()} onClick={onCreate}>
        {busy ? 'Creating…' : 'Create webhook'}
      </Button>
    </div>
  );
}

// react-doctor-disable-next-line react-doctor/no-multi-comp -- Row editor is local to the ingest webhook list and shares the same patch contract.
function IngestWebhookListItem({
  webhook,
  onPatch,
  onRotate,
  onDisable,
}: {
  webhook: IngestWebhookRow;
  onPatch: (id: string, body: Record<string, unknown>) => Promise<void>;
  onRotate: (id: string, label: string) => Promise<void>;
  onDisable: (id: string, label: string) => Promise<void>;
}) {
  const credential = webhook.credentials[0];
  const disabled = Boolean(webhook.disabledAt);
  const context = [
    disabled ? 'disabled' : 'active',
    eventClassLabel(webhook.eventClass),
    `visibility ${webhook.visibilityDefault}`,
    `proposals ${webhook.proposalGenerationEnabled ? 'on' : 'off'}`,
    credential ? `${credential.prefix}...` : 'no active credential',
  ].join(' · ');
  return (
    <li>
      <CollectionRow>
        <CollectionRow.Title>{webhook.name}</CollectionRow.Title>
        <CollectionRow.Context>{context}</CollectionRow.Context>
        <CollectionRow.Metadata>
          <>
            <RelativeTimestamp
              prefix="Last used"
              value={credential?.lastUsedAt}
              empty={credential ? 'Never used' : undefined}
            />
            <label
              className="flex min-w-40 items-center gap-2"
              htmlFor={`ingest-webhook-type-${webhook.id}`}
            >
              <span className="sr-only">Timeline type</span>
              <EventClassSelect
                id={`ingest-webhook-type-${webhook.id}`}
                value={webhook.eventClass}
                disabled={disabled}
                onChange={(next) => {
                  void onPatch(webhook.id, { eventClass: next });
                }}
              />
            </label>
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={webhook.visibilityDefault === 'team'}
                disabled={disabled}
                onChange={(e) =>
                  void onPatch(webhook.id, {
                    visibilityDefault: e.target.checked ? 'team' : 'private',
                  })
                }
              />
              Team-visible
            </label>
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={webhook.proposalGenerationEnabled}
                disabled={disabled}
                onChange={(e) =>
                  void onPatch(webhook.id, {
                    proposalGenerationEnabled: e.target.checked,
                  })
                }
              />
              Proposals
            </label>
          </>
        </CollectionRow.Metadata>
        <CollectionRow.Actions>
          <ItemActionGroup label={`Actions for ${webhook.name}`}>
            <Button
              size="sm"
              variant="ghost"
              disabled={disabled}
              onClick={() => void onRotate(webhook.id, webhook.name)}
            >
              Rotate
            </Button>
            <ItemOverflowMenu targetLabel={webhook.name}>
              <DropdownMenuItem
                disabled={disabled}
                className="text-destructive focus:text-destructive"
                onSelect={() => void onDisable(webhook.id, webhook.name)}
              >
                Disable
              </DropdownMenuItem>
            </ItemOverflowMenu>
          </ItemActionGroup>
        </CollectionRow.Actions>
      </CollectionRow>
    </li>
  );
}

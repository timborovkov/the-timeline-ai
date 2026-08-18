'use client';

import { useActionState, useMemo, useState } from 'react';
import { useFormStatus } from 'react-dom';

import {
  addDigestDestinationAction,
  removeDigestDestinationAction,
  type DigestDestinationState,
} from '@/app/actions/teams';
import { CollectionRow } from '@/components/collections/collection-row';
import { Button } from '@/components/ui/button';
import { ItemActionGroup } from '@/components/ui/item-actions';
import { Label } from '@/components/ui/label';

const SELECT_CLASS =
  'h-9 w-full rounded-sm border border-border bg-bg px-3 text-sm text-fg transition-colors hover:border-border-strong ring-offset-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/50 focus-visible:ring-offset-2';

export interface DigestDestinationRow {
  id: string;
  kind:
    | 'email_members'
    | 'slack_channel'
    | 'slack_dm_members'
    | 'telegram_chat'
    | 'telegram_dm_members';
  targetId: string | null;
  label: string | null;
}

export interface DigestDestinationOption {
  kind: DigestDestinationRow['kind'];
  targetId?: string;
  label: string;
}

function destinationLabel(destination: DigestDestinationRow): string {
  if (destination.kind === 'email_members') return 'Email every member';
  if (destination.kind === 'slack_dm_members') return 'Slack DM every linked member';
  if (destination.kind === 'telegram_dm_members') return 'Telegram DM every linked member';
  if (destination.kind === 'slack_channel') {
    return destination.label ? `Slack ${destination.label}` : 'Slack channel';
  }
  return destination.label ? `Telegram · ${destination.label}` : 'Telegram chat';
}

export function DigestDestinationsForm({
  destinations,
  options,
}: {
  destinations: DigestDestinationRow[];
  options: DigestDestinationOption[];
}) {
  const configuredKeys = new Set(
    destinations.map((destination) => `${destination.kind}:${destination.targetId ?? ''}`),
  );
  const available = options.filter(
    (option) => !configuredKeys.has(`${option.kind}:${option.targetId ?? ''}`),
  );
  const [selected, setSelected] = useState(available[0] ? optionValue(available[0]) : '');

  return (
    <div className="space-y-4">
      <p className="text-sm text-fg-muted">
        Choose where the daily digest should go. Shared chats get one team-visible digest from the
        bot. Email and direct messages stay personalized per member.
      </p>
      {destinations.length === 0 ? (
        <p className="text-sm text-fg-muted">
          No destinations yet. Email every member remains the default until you add one.
        </p>
      ) : (
        <ul className="border-x border-border">
          {destinations.map((destination) => (
            <li key={destination.id}>
              <CollectionRow>
                <CollectionRow.Title>{destinationLabel(destination)}</CollectionRow.Title>
                <CollectionRow.Actions>
                  <RemoveDestinationForm
                    destinationId={destination.id}
                    label={destinationLabel(destination)}
                  />
                </CollectionRow.Actions>
              </CollectionRow>
            </li>
          ))}
        </ul>
      )}
      {available.length > 0 ? (
        <AddDestinationForm
          available={available}
          selected={selected}
          onSelectedChange={setSelected}
        />
      ) : (
        <p className="text-sm text-fg-muted">
          Connect Slack or Telegram, or bind a chat, to add more destinations.
        </p>
      )}
    </div>
  );
}

function optionValue(option: DigestDestinationOption): string {
  if (!option.targetId) return option.kind;
  return `${option.kind}::${option.targetId}::${option.label}`;
}

function AddDestinationForm({
  available,
  selected,
  onSelectedChange,
}: {
  available: DigestDestinationOption[];
  selected: string;
  onSelectedChange: (value: string) => void;
}) {
  const [state, action] = useActionState<DigestDestinationState, FormData>(
    addDigestDestinationAction,
    {},
  );
  const selectedOption = useMemo(
    () => available.find((option) => optionValue(option) === selected) ?? available[0],
    [available, selected],
  );
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="kind" value={selectedOption?.kind ?? ''} />
      {selectedOption?.targetId ? (
        <input
          type="hidden"
          name="target"
          value={`${selectedOption.targetId}::${selectedOption.label}`}
        />
      ) : null}
      <div className="space-y-2">
        <Label htmlFor="digest-destination">Add destination</Label>
        <select
          id="digest-destination"
          className={SELECT_CLASS}
          value={selected}
          onChange={(event) => {
            onSelectedChange(event.target.value);
          }}
        >
          {available.map((option) => (
            <option key={optionValue(option)} value={optionValue(option)}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Submit label="Add destination" />
        <FormStatus
          error={state.error}
          success={state.ok ? 'Digest destination added.' : undefined}
        />
      </div>
    </form>
  );
}

function RemoveDestinationForm({ destinationId, label }: { destinationId: string; label: string }) {
  const [state, action] = useActionState<DigestDestinationState, FormData>(
    removeDigestDestinationAction,
    {},
  );
  return (
    <form action={action}>
      <input type="hidden" name="destinationId" value={destinationId} />
      <ItemActionGroup label={`Remove ${label}`}>
        <Submit label="Remove" pendingLabel="Removing…" variant="ghost" />
      </ItemActionGroup>
      <FormStatus error={state.error} />
    </form>
  );
}

function Submit({
  label,
  pendingLabel = 'Working…',
  variant = 'default',
}: {
  label: string;
  pendingLabel?: string;
  variant?: 'default' | 'ghost';
}) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant={variant}
      size={variant === 'ghost' ? 'sm' : 'default'}
      disabled={pending}
    >
      {pending ? pendingLabel : label}
    </Button>
  );
}

function FormStatus({ error, success }: { error?: string; success?: string }) {
  const { pending } = useFormStatus();
  const status = pending ? 'Saving changes…' : error ? undefined : success;
  return (
    <>
      {status ? (
        <p aria-live="polite" className="text-sm text-fg-muted" role="status">
          {status}
        </p>
      ) : null}
      {pending || !error ? null : (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

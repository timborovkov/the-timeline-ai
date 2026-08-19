'use client';

import { Mail } from 'lucide-react';
import { useActionState, useMemo, useState } from 'react';
import { useFormStatus } from 'react-dom';

import {
  addDigestDestinationAction,
  removeDigestDestinationAction,
  type DigestDestinationState,
} from '@/app/actions/teams';
import { CollectionRow } from '@/components/collections/collection-row';
import { EmptyState } from '@/components/empty-state';
import { FormActionToast } from '@/components/form-action-toast';
import { Button } from '@/components/ui/button';
import { ItemActionGroup } from '@/components/ui/item-actions';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';

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
    <div className="space-y-3">
      <p className="text-sm text-fg-muted">
        Choose where the daily digest should go. Shared chats get one team-visible digest from the
        bot. Email and direct messages stay personalized per member.
      </p>
      {destinations.length === 0 ? (
        <EmptyState
          icon={Mail}
          size="inset"
          title="No destinations yet"
          body="Email every member remains the default until you add a Slack, Telegram, or extra email destination."
        />
      ) : (
        <ul>
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
    <form action={action} className="flex flex-col gap-2 sm:flex-row sm:items-end">
      <input type="hidden" name="kind" value={selectedOption?.kind ?? ''} />
      {selectedOption?.targetId ? (
        <input
          type="hidden"
          name="target"
          value={`${selectedOption.targetId}::${selectedOption.label}`}
        />
      ) : null}
      <div className="min-w-0 flex-1 space-y-1.5">
        <Label htmlFor="digest-destination" size="sm">
          Add destination
        </Label>
        <NativeSelect
          id="digest-destination"
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
        </NativeSelect>
      </div>
      <Submit label="Add destination" />
      <FormActionToast
        id="digest:destination:add"
        error={state.error}
        success={state.ok ? 'Digest destination added' : undefined}
      />
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
      <FormActionToast
        id={`digest:destination:remove:${destinationId}`}
        error={state.error}
        success={state.ok ? 'Digest destination removed' : undefined}
      />
    </form>
  );
}

function Submit({
  label,
  pendingLabel = 'Working…',
  variant = 'outline',
}: {
  label: string;
  pendingLabel?: string;
  variant?: 'default' | 'ghost' | 'outline';
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} size="sm" disabled={pending}>
      {pending ? pendingLabel : label}
    </Button>
  );
}

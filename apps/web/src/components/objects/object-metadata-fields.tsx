'use client';

import {
  humanizeMetadataKey,
  readableMetadataEntries,
  slugifyMetadataLabel,
  typedMetadataKeysFor,
} from '@timeline/shared/objects/metadata-schemas';
import { Plus, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useId, useState, useTransition } from 'react';

import type * as objects from '@timeline/shared/objects/types';

import { updateObjectMetadataAction } from '@/app/actions/objects';
import {
  ObjectRailRow,
  ObjectRailSection,
  RAIL_FIELD_VALUE,
  RAIL_GHOST_ICON_BUTTON,
  RAIL_QUIET_ACTION,
  RAIL_UNDERLINE_CONTROL,
} from '@/components/objects/object-rail-chrome';
import { notifyAction } from '@/lib/notify';

function metadataFieldLabel(key: string): string {
  return humanizeMetadataKey(key);
}

/** Soften leftover snake_case seed values for display only. */
function displayMetadataValue(value: string): string {
  if (/^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/.test(value)) {
    return humanizeMetadataKey(value);
  }
  return value;
}

export function ObjectMetadataFields({
  detail,
  disabled = false,
}: {
  detail: objects.ObjectDetail;
  disabled?: boolean;
}) {
  const router = useRouter();
  const formId = useId();
  const [pending, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newValue, setNewValue] = useState('');
  const typedKeys = typedMetadataKeysFor(detail.type);
  const entries = readableMetadataEntries(detail.type, detail.metadata);
  const knownKeys = new Set(typedKeys);
  const customEntries = entries.filter((entry) => !knownKeys.has(entry.key));
  const busy = disabled || pending;

  function saveField(key: string, rawValue: string): void {
    const label = metadataFieldLabel(key);
    startTransition(async () => {
      const result = await notifyAction({
        id: `object:${detail.id}:metadata:${key}`,
        loading: `Updating ${label}…`,
        success: `${label} updated`,
        error: `Couldn’t update ${label}`,
        run: () =>
          updateObjectMetadataAction({
            id: detail.id,
            metadata: { [key]: rawValue.trim() || null },
          }),
      });
      if (!result.error) router.refresh();
    });
  }

  function addCustomField(): void {
    const label = newLabel.trim();
    const value = newValue.trim();
    const key = slugifyMetadataLabel(label);
    if (!label || !value || !key) return;
    startTransition(async () => {
      const result = await notifyAction({
        id: `object:${detail.id}:metadata:add:${key}`,
        loading: 'Adding field…',
        success: 'Field added',
        error: 'Couldn’t add field',
        run: () =>
          updateObjectMetadataAction({
            id: detail.id,
            metadata: { [label]: value },
          }),
      });
      if (!result.error) {
        setAdding(false);
        setNewLabel('');
        setNewValue('');
        router.refresh();
      }
    });
  }

  function removeCustomField(key: string): void {
    startTransition(async () => {
      const result = await notifyAction({
        id: `object:${detail.id}:metadata:remove:${key}`,
        loading: 'Removing field…',
        success: 'Field removed',
        error: 'Couldn’t remove field',
        run: () =>
          updateObjectMetadataAction({
            id: detail.id,
            metadata: { [key]: null },
          }),
      });
      if (!result.error) router.refresh();
    });
  }

  return (
    <ObjectRailSection label="Details" aria-label="Metadata">
      {typedKeys.map((key) => {
        const raw = metadataValue(detail.metadata, key);
        return (
          <RailTextField
            key={`${key}:${raw}`}
            label={metadataFieldLabel(key)}
            initialValue={raw}
            displayValue={raw ? displayMetadataValue(raw) : ''}
            disabled={busy}
            onSave={(value) => {
              saveField(key, value);
            }}
          />
        );
      })}
      {customEntries.map((entry) => (
        <RailTextField
          key={`${entry.key}:${entry.value}`}
          label={metadataFieldLabel(entry.key)}
          initialValue={entry.value}
          displayValue={displayMetadataValue(entry.value)}
          disabled={busy}
          onSave={(value) => {
            saveField(entry.key, value);
          }}
          onRemove={() => {
            removeCustomField(entry.key);
          }}
        />
      ))}
      {adding ? (
        <div className="grid gap-2 px-2 py-1">
          <input
            id={`${formId}-label`}
            value={newLabel}
            onChange={(event) => {
              setNewLabel(event.target.value);
            }}
            placeholder="Field name"
            aria-label="New field name"
            className={RAIL_UNDERLINE_CONTROL}
          />
          <input
            id={`${formId}-value`}
            value={newValue}
            onChange={(event) => {
              setNewValue(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                addCustomField();
              }
              if (event.key === 'Escape') {
                setAdding(false);
                setNewLabel('');
                setNewValue('');
              }
            }}
            placeholder="Value"
            aria-label="New field value"
            className={RAIL_UNDERLINE_CONTROL}
          />
          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={busy || !slugifyMetadataLabel(newLabel) || !newValue.trim()}
              onClick={addCustomField}
              className="text-xs font-normal text-fg-muted hover:text-fg disabled:opacity-50"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => {
                setAdding(false);
                setNewLabel('');
                setNewValue('');
              }}
              className="text-xs font-normal text-fg-muted hover:text-fg"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setAdding(true);
          }}
          className={RAIL_QUIET_ACTION}
        >
          <Plus aria-hidden="true" className="size-3.5" />
          Add field
        </button>
      )}
    </ObjectRailSection>
  );
}

function RailTextField({
  label,
  initialValue,
  displayValue,
  disabled,
  onSave,
  onRemove,
}: {
  label: string;
  initialValue: string;
  displayValue: string;
  disabled: boolean;
  onSave: (value: string) => void;
  onRemove?: () => void;
}) {
  const inputId = useId();
  const [draft, setDraft] = useState(displayValue || initialValue);
  const [focused, setFocused] = useState(false);
  const shown = focused ? draft : displayValue || draft;

  return (
    <ObjectRailRow
      label={label}
      htmlFor={inputId}
      action={
        onRemove ? (
          <button
            type="button"
            disabled={disabled}
            onClick={onRemove}
            aria-label={`Remove ${label}`}
            className={RAIL_GHOST_ICON_BUTTON}
          >
            <X aria-hidden="true" className="size-3.5" />
          </button>
        ) : null
      }
    >
      <input
        id={inputId}
        aria-label={label}
        value={shown}
        disabled={disabled}
        onFocus={() => {
          setFocused(true);
          setDraft(initialValue);
        }}
        onChange={(event) => {
          setDraft(event.target.value);
        }}
        onBlur={(event) => {
          setFocused(false);
          const next = event.target.value.trim();
          setDraft(next);
          if (next === initialValue.trim()) return;
          onSave(next);
        }}
        placeholder={`No ${label.toLowerCase()}`}
        className={RAIL_FIELD_VALUE}
      />
    </ObjectRailRow>
  );
}

function metadataValue(metadata: Record<string, unknown>, key: string): string {
  const value = metadata[key];
  return typeof value === 'string' ? value : '';
}

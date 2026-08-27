'use client';

import {
  humanizeMetadataKey,
  readableMetadataEntries,
  slugifyMetadataLabel,
  typedMetadataKeysFor,
} from '@timeline/shared/objects/metadata-schemas';
import { Plus, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import type * as objects from '@timeline/shared/objects/types';

import { updateObjectMetadataAction } from '@/app/actions/objects';
import { EditableMetadata } from '@/components/collections/editable-metadata';
import { notifyAction } from '@/lib/notify';
import { cn } from '@/lib/utils';

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
    <section aria-label="Metadata" className="flex flex-col">
      <h2 className="px-1.5 text-xs font-normal text-fg-dim">Details</h2>
      {typedKeys.map((key) => (
        <MetadataEditableRow
          key={key}
          label={metadataFieldLabel(key)}
          value={metadataValue(detail.metadata, key)}
          disabled={busy}
          onSave={(value) => {
            saveField(key, value);
          }}
        />
      ))}
      {customEntries.map((entry) => (
        <MetadataEditableRow
          key={entry.key}
          label={metadataFieldLabel(entry.key)}
          value={entry.value}
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
        <div className="grid gap-1.5 px-1.5 py-1.5">
          <input
            value={newLabel}
            onChange={(event) => {
              setNewLabel(event.target.value);
            }}
            placeholder="Field name"
            aria-label="New field name"
            className="h-9 rounded-sm border border-border bg-bg px-2 text-xs"
          />
          <input
            value={newValue}
            onChange={(event) => {
              setNewValue(event.target.value);
            }}
            placeholder="Value"
            aria-label="New field value"
            className="h-9 rounded-sm border border-border bg-bg px-2 text-xs"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={busy || !slugifyMetadataLabel(newLabel) || !newValue.trim()}
              onClick={addCustomField}
              className="text-xs text-fg-muted hover:text-fg disabled:opacity-50"
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
              className="text-xs text-fg-muted hover:text-fg"
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
          className="inline-flex min-h-8 items-center gap-1.5 px-1.5 text-xs text-fg-muted transition-colors hover:text-fg disabled:opacity-50"
        >
          <Plus aria-hidden="true" className="size-3" />
          Add field
        </button>
      )}
    </section>
  );
}

function MetadataEditableRow({
  label,
  value,
  disabled,
  onSave,
  onRemove,
}: {
  label: string;
  value: string;
  disabled: boolean;
  onSave: (value: string) => void;
  onRemove?: () => void;
}) {
  const display = value ? displayMetadataValue(value) : null;
  return (
    <div className="group flex min-h-8 items-center gap-1 px-1.5">
      <span className="w-16 shrink-0 truncate text-xs text-fg-dim" title={label}>
        {label}
      </span>
      <EditableMetadata
        label={label}
        disabled={disabled}
        className="min-h-8 min-w-0 flex-1 justify-start px-1"
      >
        <EditableMetadata.Value>
          {display ? (
            <span className="truncate text-xs text-fg">{display}</span>
          ) : (
            <span className="truncate text-xs text-fg-dim">Empty</span>
          )}
        </EditableMetadata.Value>
        <EditableMetadata.Editor>
          <MetadataTextEditor
            label={label}
            initialValue={value}
            disabled={disabled}
            onApply={onSave}
          />
        </EditableMetadata.Editor>
      </EditableMetadata>
      {onRemove ? (
        <button
          type="button"
          disabled={disabled}
          onClick={onRemove}
          aria-label={`Remove ${label}`}
          className={cn(
            'grid size-6 shrink-0 place-items-center rounded-sm text-fg-muted transition-colors',
            'opacity-0 focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100',
            'hover:bg-danger/10 hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/50 disabled:opacity-50',
          )}
        >
          <X aria-hidden="true" className="size-3" />
        </button>
      ) : (
        <span className="size-6 shrink-0" aria-hidden="true" />
      )}
    </div>
  );
}

function MetadataTextEditor({
  label,
  initialValue,
  disabled,
  onApply,
}: {
  label: string;
  initialValue: string;
  disabled: boolean;
  onApply: (value: string) => void;
}) {
  return (
    <form
      className="flex flex-col gap-2"
      action={(formData) => {
        const raw = formData.get('value');
        const next = typeof raw === 'string' ? raw : '';
        if (next === initialValue) return;
        onApply(next);
      }}
    >
      <input
        name="value"
        aria-label={label}
        defaultValue={initialValue}
        disabled={disabled}
        className="h-10 w-full rounded-sm border border-border bg-bg px-2 text-xs disabled:opacity-60"
        placeholder={`Add ${label.toLowerCase()}`}
      />
      <button
        type="submit"
        disabled={disabled}
        className="min-h-8 self-start rounded-sm bg-signal px-3 text-xs font-medium text-signal-fg disabled:opacity-60"
      >
        Save
      </button>
    </form>
  );
}

function metadataValue(metadata: Record<string, unknown>, key: string): string {
  const value = metadata[key];
  return typeof value === 'string' ? value : '';
}

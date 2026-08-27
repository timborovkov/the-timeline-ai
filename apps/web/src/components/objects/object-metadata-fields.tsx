'use client';

import {
  readableMetadataEntries,
  typedMetadataKeysFor,
} from '@timeline/shared/objects/metadata-schemas';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import type * as objects from '@timeline/shared/objects/types';

import { updateObjectMetadataAction } from '@/app/actions/objects';
import { notifyAction } from '@/lib/notify';

const FIELD_LABELS: Record<string, string> = {
  domain: 'Domain',
  website: 'Website',
  relationship: 'Relationship',
  role: 'Role',
  value: 'Value',
  closeDate: 'Close date',
};

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
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const typedKeys = typedMetadataKeysFor(detail.type);
  const entries = readableMetadataEntries(detail.type, detail.metadata);
  const knownKeys = new Set(typedKeys);
  const customEntries = entries.filter((entry) => !knownKeys.has(entry.key));

  function saveField(key: string, rawValue: string): void {
    startTransition(async () => {
      const label = FIELD_LABELS[key] ?? key;
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
    const key = newKey.trim();
    const value = newValue.trim();
    if (!key || !value) return;
    startTransition(async () => {
      const result = await notifyAction({
        id: `object:${detail.id}:metadata:add:${key}`,
        loading: 'Adding field…',
        success: 'Field added',
        error: 'Couldn’t add field',
        run: () =>
          updateObjectMetadataAction({
            id: detail.id,
            metadata: { [key]: value },
          }),
      });
      if (!result.error) {
        setAdding(false);
        setNewKey('');
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
    <section aria-label="Metadata">
      <h2 className="px-1.5 text-xs font-normal text-fg-dim">Details</h2>
      <div className="mt-0.5 flex flex-col">
        {typedKeys.map((key) => (
          <MetadataFieldRow
            key={key}
            label={FIELD_LABELS[key] ?? key}
            initialValue={metadataValue(detail.metadata, key)}
            disabled={disabled || pending}
            onSave={(value) => {
              saveField(key, value);
            }}
          />
        ))}
        {customEntries.map((entry) => (
          <div key={entry.key} className="flex min-h-8 items-center gap-2 px-1.5">
            <label className="flex min-w-0 flex-1 items-center gap-3">
              <span className="w-20 shrink-0 truncate text-xs text-fg-dim" title={entry.key}>
                {FIELD_LABELS[entry.key] ?? entry.key}
              </span>
              <CustomMetadataInput
                label={FIELD_LABELS[entry.key] ?? entry.key}
                initialValue={entry.value}
                disabled={disabled || pending}
                onSave={(value) => {
                  saveField(entry.key, value);
                }}
              />
            </label>
            <button
              type="button"
              disabled={disabled || pending}
              onClick={() => {
                removeCustomField(entry.key);
              }}
              className="shrink-0 text-xs text-fg-muted hover:text-fg hover:underline disabled:opacity-50"
            >
              Remove
            </button>
          </div>
        ))}
        {adding ? (
          <div className="grid gap-1.5 px-1.5 pt-1">
            <input
              value={newKey}
              onChange={(event) => {
                setNewKey(event.target.value);
              }}
              placeholder="Field name"
              aria-label="New metadata key"
              className="h-8 rounded-sm border border-border bg-bg px-2 text-xs"
            />
            <input
              value={newValue}
              onChange={(event) => {
                setNewValue(event.target.value);
              }}
              placeholder="Value"
              aria-label="New metadata value"
              className="h-8 rounded-sm border border-border bg-bg px-2 text-xs"
            />
            <div className="flex gap-2">
              <button
                type="button"
                disabled={disabled || pending}
                onClick={addCustomField}
                className="text-xs text-fg-muted hover:text-fg hover:underline disabled:opacity-50"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => {
                  setAdding(false);
                  setNewKey('');
                  setNewValue('');
                }}
                className="text-xs text-fg-muted hover:text-fg hover:underline"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            disabled={disabled || pending}
            onClick={() => {
              setAdding(true);
            }}
            className="px-1.5 pt-1 text-left text-xs text-fg-muted hover:text-fg hover:underline disabled:opacity-50"
          >
            Add field
          </button>
        )}
      </div>
    </section>
  );
}

function MetadataFieldRow({
  label,
  initialValue,
  disabled,
  onSave,
}: {
  label: string;
  initialValue: string;
  disabled: boolean;
  onSave: (value: string) => void;
}) {
  return (
    <label className="flex min-h-8 items-center gap-3 px-1.5">
      <span className="w-20 shrink-0 text-xs text-fg-dim">{label}</span>
      <CustomMetadataInput
        label={label}
        initialValue={initialValue}
        disabled={disabled}
        onSave={onSave}
      />
    </label>
  );
}

function CustomMetadataInput({
  label,
  initialValue,
  disabled,
  onSave,
}: {
  label: string;
  initialValue: string;
  disabled: boolean;
  onSave: (value: string) => void;
}) {
  const [draft, setDraft] = useState(initialValue);
  return (
    <input
      aria-label={label}
      value={draft}
      disabled={disabled}
      onChange={(event) => {
        setDraft(event.target.value);
      }}
      onBlur={(event) => {
        const value = event.target.value;
        if (value === initialValue) return;
        onSave(value);
      }}
      placeholder={`Add ${label.toLowerCase()}`}
      className="min-w-0 flex-1 bg-transparent text-xs text-fg outline-none focus-visible:ring-2 focus-visible:ring-signal/50"
    />
  );
}

function metadataValue(metadata: Record<string, unknown>, key: string): string {
  const value = metadata[key];
  return typeof value === 'string' ? value : '';
}

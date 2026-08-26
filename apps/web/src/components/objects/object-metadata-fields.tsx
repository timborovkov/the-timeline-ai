'use client';

import { readableMetadataEntries } from '@timeline/shared/objects';
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

const EDITABLE_KEYS: Partial<Record<objects.ObjectType, readonly string[]>> = {
  company: ['domain', 'website', 'relationship'],
  person: ['role'],
  deal: ['value', 'closeDate'],
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
  const editableKeys = EDITABLE_KEYS[detail.type] ?? [];
  const entries = readableMetadataEntries(detail.type, detail.metadata);
  const knownKeys = new Set(editableKeys);
  const extraEntries = entries.filter((entry) => !knownKeys.has(entry.key));

  function saveField(key: string, rawValue: string): void {
    startTransition(async () => {
      const result = await notifyAction({
        id: `object:${detail.id}:metadata:${key}`,
        loading: `Updating ${FIELD_LABELS[key] ?? key}…`,
        success: `${FIELD_LABELS[key] ?? key} updated`,
        error: `Couldn’t update ${FIELD_LABELS[key] ?? key}`,
        run: () =>
          updateObjectMetadataAction({
            id: detail.id,
            metadata: { [key]: rawValue.trim() || null },
          }),
      });
      if (!result.error) router.refresh();
    });
  }

  if (editableKeys.length === 0 && extraEntries.length === 0) return null;

  return (
    <section aria-label="Metadata">
      <h2 className="px-1.5 text-xs font-normal text-fg-dim">Details</h2>
      <div className="mt-0.5 flex flex-col">
        {editableKeys.map((key) => (
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
        {extraEntries.map((entry) => (
          <div key={entry.key} className="min-h-8 px-1.5 py-1 text-xs text-fg-muted">
            <span className="text-fg-dim">{FIELD_LABELS[entry.key] ?? entry.key}: </span>
            {entry.value}
          </div>
        ))}
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
  const [draft, setDraft] = useState(initialValue);
  return (
    <label className="flex min-h-8 items-center gap-3 px-1.5">
      <span className="w-20 shrink-0 text-xs text-fg-dim">{label}</span>
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
    </label>
  );
}

function metadataValue(metadata: Record<string, unknown>, key: string): string {
  const value = metadata[key];
  return typeof value === 'string' ? value : '';
}

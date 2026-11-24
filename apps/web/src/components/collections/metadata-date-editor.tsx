'use client';

import { presentDueDate } from '@timeline/shared/time';

import { useEditableMetadataOpen } from '@/components/collections/editable-metadata';
import { useWorkspaceTimezone } from '@/components/workspace-timezone-context';
import { toDateOrNull } from '@/lib/iso-timestamp';

export function MetadataDateEditor({
  defaultValue,
  onApply,
  disabled = false,
  label = 'Due date',
}: {
  defaultValue: string;
  onApply: (value: string) => void;
  disabled?: boolean;
  label?: string;
}) {
  const setEditorOpen = useEditableMetadataOpen();
  return (
    <form
      className="flex items-center gap-2"
      action={(formData) => {
        const rawDate = formData.get('date');
        onApply(typeof rawDate === 'string' ? rawDate : '');
        setEditorOpen?.(false);
      }}
    >
      <input
        type="date"
        name="date"
        defaultValue={defaultValue}
        disabled={disabled}
        className="h-10 rounded-sm border border-border bg-bg px-2 text-xs disabled:opacity-60"
        aria-label={label}
      />
      <button
        type="submit"
        disabled={disabled}
        className="min-h-10 rounded-sm bg-signal px-3 text-xs font-medium text-signal-fg disabled:opacity-60"
      >
        Apply
      </button>
    </form>
  );
}

export function MetadataDueDateEditor({
  value,
  timezone,
  onApply,
}: {
  value: Date | string | null;
  timezone?: string;
  onApply: (value: Date | null) => void;
}) {
  const workspaceTimezone = useWorkspaceTimezone();
  const deadline = toDateOrNull(value);
  const date = presentDueDate(deadline, { timezone: timezone ?? workspaceTimezone }).dateKey ?? '';
  return (
    <MetadataDateEditor
      defaultValue={date}
      onApply={(selected) => {
        const next =
          selected === date ? deadline : selected ? new Date(`${selected}T00:00:00.000Z`) : null;
        onApply(next);
      }}
    />
  );
}

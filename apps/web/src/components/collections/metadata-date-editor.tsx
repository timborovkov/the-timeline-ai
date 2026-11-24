'use client';

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
  return (
    <form
      className="flex items-center gap-2"
      action={(formData) => {
        const rawDate = formData.get('date');
        onApply(typeof rawDate === 'string' ? rawDate : '');
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

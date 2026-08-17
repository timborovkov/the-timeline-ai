'use client';

import { useRef } from 'react';

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
  const inputRef = useRef<HTMLInputElement>(null);

  function commit() {
    onApply(inputRef.current?.value ?? '');
  }

  return (
    <div className="flex items-center gap-2">
      <input
        ref={inputRef}
        type="date"
        name="date"
        defaultValue={defaultValue}
        disabled={disabled}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return;
          commit();
        }}
        className="h-10 rounded-sm border border-border bg-bg px-2 text-xs disabled:opacity-60"
        aria-label={label}
      />
      <button
        type="button"
        disabled={disabled}
        onClick={commit}
        className="min-h-10 rounded-sm bg-signal px-3 text-xs font-medium text-signal-fg disabled:opacity-60"
      >
        Apply
      </button>
    </div>
  );
}

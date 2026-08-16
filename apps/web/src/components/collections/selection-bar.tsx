import { X } from 'lucide-react';

import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

export function SelectionBar({
  count,
  label = 'selected',
  actions,
  onClear,
  className,
}: {
  count: number;
  label?: string;
  actions: ReactNode;
  onClear: () => void;
  className?: string;
}) {
  if (count === 0) return null;
  return (
    <div
      className={cn(
        'flex min-h-11 flex-wrap items-center gap-2 border-y border-signal/30 bg-signal-soft px-3 py-1.5',
        className,
      )}
    >
      <output className="mr-auto text-xs font-medium text-fg" aria-live="polite">
        <span className="font-mono tabular-nums">{count}</span> {label}
      </output>
      {actions}
      <button
        type="button"
        onClick={onClear}
        className="inline-flex size-10 items-center justify-center rounded-sm text-fg-muted transition-[background-color,color,transform] duration-150 hover:bg-surface hover:text-fg active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/50 motion-reduce:transition-none motion-reduce:active:scale-100"
        aria-label="Clear selection"
      >
        <X aria-hidden="true" className="size-4" />
      </button>
    </div>
  );
}

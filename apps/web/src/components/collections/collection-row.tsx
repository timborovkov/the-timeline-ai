import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

export function CollectionRow({
  leading,
  title,
  subtitle,
  context,
  metadata,
  actions,
  selected = false,
  className,
}: {
  leading?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  context?: ReactNode;
  metadata?: ReactNode;
  actions?: ReactNode;
  selected?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'group/collection-row grid min-h-11 min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 border-b border-border/80 px-2 transition-[background-color,border-color] duration-150 last:border-b-0 hover:bg-surface focus-within:bg-surface motion-reduce:transition-none sm:px-3',
        selected && 'bg-signal-soft shadow-[inset_2px_0_0_var(--color-signal)]',
        className,
      )}
    >
      <div className="flex min-h-10 shrink-0 items-center">{leading}</div>
      <div className="flex min-w-0 flex-col justify-center py-1 sm:flex-row sm:items-center sm:gap-3">
        <div className="min-w-0 flex-1">
          <div className="min-w-0 truncate text-sm font-medium leading-5 text-fg">{title}</div>
          {subtitle ? (
            <div className="min-w-0 truncate text-[11px] font-normal leading-4 text-fg-dim">
              {subtitle}
            </div>
          ) : null}
          {context ? (
            <div className="min-w-0 truncate text-[11px] leading-4 text-fg-dim sm:hidden">
              {context}
            </div>
          ) : null}
        </div>
        {context ? (
          <div className="hidden min-w-0 max-w-[22rem] truncate text-xs text-fg-dim sm:block">
            {context}
          </div>
        ) : null}
        {metadata ? (
          <div className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5 sm:ml-auto sm:flex-nowrap sm:justify-end">
            {metadata}
          </div>
        ) : null}
      </div>
      <div className="flex min-h-10 shrink-0 items-center">{actions}</div>
    </div>
  );
}

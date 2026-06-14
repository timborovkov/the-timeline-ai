'use client';

import { Search, X } from 'lucide-react';

import { cn } from '@/lib/utils';

interface Props {
  query: string;
  onQueryChange: (query: string) => void;
  resultCount: number;
  totalCount: number;
  className?: string;
  placeholder?: string;
}

export function ObjectTextFilter({
  query,
  onQueryChange,
  resultCount,
  totalCount,
  className,
  placeholder = 'Filter objects...',
}: Props) {
  const active = query.trim().length > 0;

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <label className="relative min-w-[14rem] flex-1 sm:max-w-sm">
        <span className="sr-only">Filter objects</span>
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-fg-dim"
          aria-hidden
        />
        <input
          type="search"
          value={query}
          onChange={(event) => {
            onQueryChange(event.target.value);
          }}
          placeholder={placeholder}
          className="h-8 w-full rounded-sm border border-border bg-bg py-1 pl-8 pr-8 font-mono text-[11px] uppercase tracking-[0.12em] text-fg outline-none transition-colors placeholder:text-fg-dim focus:border-signal/60 focus:bg-surface"
        />
        {active ? (
          <button
            type="button"
            onClick={() => {
              onQueryChange('');
            }}
            className="absolute right-1.5 top-1/2 inline-flex size-5 -translate-y-1/2 items-center justify-center rounded-sm text-fg-dim transition-colors hover:bg-surface-2 hover:text-fg"
            aria-label="Clear object filter"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        ) : null}
      </label>
      <output
        className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-dim"
        aria-live="polite"
      >
        {active ? `${resultCount} / ${totalCount}` : `${totalCount} visible`}
      </output>
    </div>
  );
}

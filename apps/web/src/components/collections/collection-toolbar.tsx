'use client';

import { SlidersHorizontal, X } from 'lucide-react';

import type { ReactNode } from 'react';

import { findSlot } from '@/components/collections/collection-slots';
import { CollectionToolbarClearAll } from '@/components/collections/collection-toolbar-clear-all';
import { CollectionToolbarFilters } from '@/components/collections/collection-toolbar-filters';
import { CollectionToolbarSearch } from '@/components/collections/collection-toolbar-search';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

interface ActiveFilter {
  key: string;
  label: ReactNode;
  value?: ReactNode;
  clear?: ReactNode;
  href?: string;
  onRemove?: () => void;
}

const EMPTY_ACTIVE_FILTERS: ActiveFilter[] = [];

function filterLabelText(label: ReactNode, fallback: string): string {
  return typeof label === 'string' || typeof label === 'number' ? String(label) : fallback;
}

export function CollectionToolbar({
  count,
  activeFilters,
  clearAll,
  view,
  viewControls,
  actions,
  filterTitle = 'Filters',
  className,
  children,
}: {
  count?: ReactNode;
  activeFilters?: ActiveFilter[];
  clearAll?: ReactNode;
  view?: ReactNode;
  viewControls?: ReactNode;
  actions?: ReactNode;
  filterTitle?: string;
  className?: string;
  children?: ReactNode;
}) {
  const resolvedActiveFilters = activeFilters ?? EMPTY_ACTIVE_FILTERS;
  const filterCount = resolvedActiveFilters.length;
  const resolvedView = viewControls ?? view;
  const search = findSlot(children, CollectionToolbarSearch);
  const filters = findSlot(children, CollectionToolbarFilters);
  const clearAllSlot = findSlot(children, CollectionToolbarClearAll);
  const resolvedClearAll = clearAllSlot ?? clearAll;
  const filterTrigger = (
    <button
      type="button"
      className={cn(
        'inline-flex min-h-10 items-center gap-2 rounded-sm px-2.5 text-xs font-medium text-fg-muted transition-[background-color,color,transform] duration-150 hover:bg-surface-2 hover:text-fg active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/50 motion-reduce:transition-none motion-reduce:active:scale-100',
        filterCount > 0 && 'bg-signal-soft text-fg',
      )}
    >
      <SlidersHorizontal aria-hidden="true" className="size-3.5" />
      Filters
      {filterCount > 0 ? (
        <span className="font-mono tabular-nums text-signal">{filterCount}</span>
      ) : null}
    </button>
  );

  return (
    <div className={cn('border-b border-border bg-bg', className)}>
      <div className="flex min-h-11 min-w-0 flex-wrap items-center gap-1.5 px-2 sm:px-3">
        {search}
        {count ? (
          <output className="px-1.5 text-xs tabular-nums text-fg-dim">{count}</output>
        ) : null}
        {filters ? (
          <>
            <div className="hidden sm:block">
              <Popover>
                <PopoverTrigger asChild>{filterTrigger}</PopoverTrigger>
                <PopoverContent align="end" className="w-[min(48rem,calc(100vw-2rem))] p-3">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-fg">{filterTitle}</p>
                    {resolvedClearAll}
                  </div>
                  {filters}
                </PopoverContent>
              </Popover>
            </div>
            <div className="sm:hidden">
              <Dialog>
                <DialogTrigger asChild>{filterTrigger}</DialogTrigger>
                <DialogContent className="bottom-0 top-auto max-w-none translate-y-0 rounded-b-none p-4">
                  <DialogHeader>
                    <DialogTitle className="text-base">{filterTitle}</DialogTitle>
                    <DialogDescription>Refine the visible collection.</DialogDescription>
                  </DialogHeader>
                  <div className="max-h-[65dvh] overflow-y-auto overscroll-contain">{filters}</div>
                  {resolvedClearAll}
                </DialogContent>
              </Dialog>
            </div>
          </>
        ) : null}
        {resolvedView ? (
          <div className="ml-auto flex min-h-10 items-center">{resolvedView}</div>
        ) : null}
        {actions ? (
          <div className={cn('flex min-h-10 items-center', !resolvedView && 'ml-auto')}>
            {actions}
          </div>
        ) : null}
      </div>
      {filterCount > 0 ? (
        <div className="flex min-h-9 items-center gap-1 overflow-x-auto border-t border-border/70 px-2 sm:px-3">
          {resolvedActiveFilters.map((filter) => (
            <span
              key={filter.key}
              className="inline-flex min-h-7 shrink-0 items-center gap-1.5 rounded-sm bg-surface-2 px-2 text-[11px] text-fg-muted"
            >
              <span>{filter.label}</span>
              {filter.value ? <span className="text-fg">{filter.value}</span> : null}
              {filter.clear ??
                (filter.href ? (
                  <a
                    href={filter.href}
                    aria-label={`Remove ${filterLabelText(filter.label, filter.key)} filter`}
                    className="inline-flex size-6 items-center justify-center rounded-sm hover:bg-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/50"
                  >
                    <X aria-hidden="true" className="size-3" />
                  </a>
                ) : filter.onRemove ? (
                  <button
                    type="button"
                    onClick={filter.onRemove}
                    aria-label={`Remove ${filterLabelText(filter.label, filter.key)} filter`}
                    className="inline-flex size-6 items-center justify-center rounded-sm hover:bg-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/50"
                  >
                    <X aria-hidden="true" className="size-3" />
                  </button>
                ) : (
                  <X aria-hidden="true" className="size-3" />
                ))}
            </span>
          ))}
          {resolvedClearAll ? <span className="ml-1 shrink-0">{resolvedClearAll}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

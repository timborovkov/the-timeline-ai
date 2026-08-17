'use client';

import { SlidersHorizontal, X } from 'lucide-react';

import type { ReactNode } from 'react';

import {
  createCollectionSlot,
  readCollectionSlots,
} from '@/components/collections/collection-slot';
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
  href?: string;
  onRemove?: () => void;
}

const EMPTY_FILTERS: ActiveFilter[] = [];

const CollectionToolbarSearch = createCollectionSlot('search');
const CollectionToolbarCount = createCollectionSlot('count');
const CollectionToolbarFilters = createCollectionSlot('filters');
const CollectionToolbarClearAll = createCollectionSlot('clearAll');
const CollectionToolbarView = createCollectionSlot('view');
const CollectionToolbarActions = createCollectionSlot('actions');

const TOOLBAR_SLOTS = {
  search: CollectionToolbarSearch,
  count: CollectionToolbarCount,
  filters: CollectionToolbarFilters,
  clearAll: CollectionToolbarClearAll,
  view: CollectionToolbarView,
  actions: CollectionToolbarActions,
};

function filterLabelText(label: ReactNode, fallback: string): string {
  return typeof label === 'string' || typeof label === 'number' ? String(label) : fallback;
}

export function CollectionToolbar({
  children,
  activeFilters = EMPTY_FILTERS,
  filterTitle = 'Filters',
  className,
}: {
  children?: ReactNode;
  activeFilters?: ActiveFilter[];
  filterTitle?: string;
  className?: string;
}) {
  const slots = readCollectionSlots(children, TOOLBAR_SLOTS);
  const search = slots.search;
  const resolvedCount = slots.count;
  const filters = slots.filters;
  const clearAll = slots.clearAll;
  const resolvedView = slots.view;
  const actions = slots.actions;
  const filterCount = activeFilters.length;
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
        {search ? <div className="min-w-48 flex-1 sm:max-w-sm">{search}</div> : null}
        {resolvedCount ? (
          <output className="px-1.5 text-xs tabular-nums text-fg-dim">{resolvedCount}</output>
        ) : null}
        {filters ? (
          <>
            <div className="hidden sm:block">
              <Popover>
                <PopoverTrigger asChild>{filterTrigger}</PopoverTrigger>
                <PopoverContent align="end" className="w-[min(48rem,calc(100vw-2rem))] p-3">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-fg">{filterTitle}</p>
                    {clearAll}
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
                  {clearAll}
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
          {activeFilters.map((filter) => (
            <span
              key={filter.key}
              className="inline-flex min-h-7 shrink-0 items-center gap-1.5 rounded-sm bg-surface-2 px-2 text-[11px] text-fg-muted"
            >
              <span>{filter.label}</span>
              {filter.value ? <span className="text-fg">{filter.value}</span> : null}
              {filter.href ? (
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
              )}
            </span>
          ))}
          {clearAll ? <span className="ml-1 shrink-0">{clearAll}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

CollectionToolbar.Search = CollectionToolbarSearch;
CollectionToolbar.Count = CollectionToolbarCount;
CollectionToolbar.Filters = CollectionToolbarFilters;
CollectionToolbar.ClearAll = CollectionToolbarClearAll;
CollectionToolbar.View = CollectionToolbarView;
CollectionToolbar.Actions = CollectionToolbarActions;

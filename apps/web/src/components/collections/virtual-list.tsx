'use client';

import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useRef, type ReactNode } from 'react';

import { getAppMainScrollElement } from '@/lib/app-scroll';
import { useCommittedRef } from '@/lib/use-committed-ref';
import { cn } from '@/lib/utils';

interface VirtualListProps<T> {
  items: readonly T[];
  getItemKey: (item: T, index: number) => string;
  estimateSize: number | ((item: T, index: number) => number);
  renderItem: (item: T, index: number) => ReactNode;
  overscan?: number;
  gap?: number;
  getScrollElement?: () => HTMLElement | null;
  className?: string;
  itemClassName?: string;
  ariaLabel?: string;
  renderSticky?: (firstVisible: T | undefined) => ReactNode;
  onEndReached?: () => void;
}

export function VirtualList<T>({
  items,
  getItemKey,
  estimateSize,
  renderItem,
  overscan = 8,
  gap = 0,
  getScrollElement,
  className,
  itemClassName,
  ariaLabel,
  renderSticky,
  onEndReached,
}: VirtualListProps<T>) {
  const fallbackParentRef = useRef<HTMLDivElement | null>(null);
  const onEndReachedRef = useCommittedRef(onEndReached);
  const requestedCountRef = useRef(0);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => {
      if (getScrollElement) return getScrollElement() ?? fallbackParentRef.current;
      return getAppMainScrollElement() ?? fallbackParentRef.current;
    },
    estimateSize: (index) => {
      const item = items[index];
      const size =
        typeof estimateSize === 'function'
          ? item === undefined
            ? 48
            : estimateSize(item, index)
          : estimateSize;
      return size + (index < items.length - 1 ? gap : 0);
    },
    overscan,
    getItemKey: (index) => {
      const item = items[index];
      return item === undefined ? String(index) : getItemKey(item, index);
    },
    measureElement: (element) => element.getBoundingClientRect().height,
    initialRect: { width: 1024, height: 900 },
  });

  const virtualItems = virtualizer.getVirtualItems();
  const firstVisible = virtualItems[0] ? items[virtualItems[0].index] : items[0];
  const lastRenderedIndex = virtualItems.at(-1)?.index;

  useEffect(() => {
    if (onEndReachedRef.current === undefined) return;
    if (lastRenderedIndex === undefined || items.length === 0) return;
    if (requestedCountRef.current > items.length) requestedCountRef.current = 0;
    if (lastRenderedIndex < items.length - overscan) return;
    if (requestedCountRef.current === items.length) return;
    requestedCountRef.current = items.length;
    onEndReachedRef.current();
  }, [items.length, lastRenderedIndex, overscan, onEndReachedRef]);

  return (
    <div
      ref={fallbackParentRef}
      className={cn('relative w-full', className)}
      aria-label={ariaLabel}
    >
      {renderSticky?.(firstVisible)}
      <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
        {virtualItems.map((virtualRow) => {
          const item = items[virtualRow.index];
          if (item === undefined) return null;
          return (
            <div
              key={virtualRow.key}
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
              className={cn('absolute top-0 left-0 w-full', itemClassName)}
              style={{ transform: `translateY(${String(virtualRow.start)}px)` }}
            >
              {/* Virtualizer windows rows through a callback; the item component
                  owns its own state. */}
              {/* react-doctor-disable-next-line react-doctor/no-render-in-render */}
              {renderItem(item, virtualRow.index)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

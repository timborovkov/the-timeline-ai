'use client';

import { useVirtualizer } from '@tanstack/react-virtual';
import { useRef, type ReactNode } from 'react';

import { getAppMainScrollElement } from '@/lib/app-scroll';
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
}: VirtualListProps<T>) {
  const fallbackParentRef = useRef<HTMLDivElement | null>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => {
      if (getScrollElement) return getScrollElement() ?? fallbackParentRef.current;
      return getAppMainScrollElement() ?? fallbackParentRef.current;
    },
    estimateSize: (index) => {
      const item = itemsRef.current[index];
      const size =
        typeof estimateSize === 'function'
          ? item === undefined
            ? 48
            : estimateSize(item, index)
          : estimateSize;
      return size + (index < itemsRef.current.length - 1 ? gap : 0);
    },
    overscan,
    getItemKey: (index) => {
      const item = itemsRef.current[index];
      return item === undefined ? String(index) : getItemKey(item, index);
    },
    measureElement: (element) => element.getBoundingClientRect().height,
    initialRect: { width: 1024, height: 900 },
  });

  const virtualItems = virtualizer.getVirtualItems();
  const firstVisible = virtualItems[0] ? items[virtualItems[0].index] : items[0];

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

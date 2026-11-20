'use client';

import { defaultRangeExtractor, useVirtualizer, type VirtualItem } from '@tanstack/react-virtual';
import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

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
  offsetWithinScrollElement?: boolean;
  className?: string;
  itemClassName?: string;
  ariaLabel?: string;
  stickyGroupHeader?: { isHeader: (item: T) => boolean; className: string };
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
  offsetWithinScrollElement = false,
  className,
  itemClassName,
  ariaLabel,
  stickyGroupHeader,
  onEndReached,
}: VirtualListProps<T>) {
  const fallbackParentRef = useRef<HTMLDivElement | null>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  useLayoutEffect(() => {
    if (!offsetWithinScrollElement) return;
    const list = fallbackParentRef.current;
    const scrollElement = getScrollElement?.() ?? null;
    if (!list || !scrollElement) return;
    const measureOffset = () => {
      setScrollMargin(
        list.getBoundingClientRect().top -
          scrollElement.getBoundingClientRect().top +
          scrollElement.scrollTop -
          scrollElement.clientTop,
      );
    };
    const observer = new ResizeObserver(measureOffset);
    // Changes in preceding groups or dialog controls move this list without
    // resizing the scrollport. Observe their layout boxes as well.
    for (let ancestor: Element | null = list; ancestor; ancestor = ancestor.parentElement) {
      observer.observe(ancestor);
      if (ancestor.parentElement) {
        for (const sibling of ancestor.parentElement.children) observer.observe(sibling);
      }
      if (ancestor === scrollElement) break;
    }
    measureOffset();
    return () => {
      observer.disconnect();
    };
  }, [getScrollElement, offsetWithinScrollElement]);
  const onEndReachedRef = useCommittedRef(onEndReached);
  const requestedCountRef = useRef(0);
  const isGroupHeader = stickyGroupHeader?.isHeader;
  const headerIndexes = useMemo(() => {
    const indexes = new Set<number>();
    if (isGroupHeader) {
      items.forEach((item, index) => {
        if (isGroupHeader(item)) indexes.add(index);
      });
    }
    return indexes;
  }, [items, isGroupHeader]);
  const extractGroupRange = useCallback(
    (range: Parameters<typeof defaultRangeExtractor>[0]) => {
      const indexes = defaultRangeExtractor(range);
      const firstIndex = indexes[0];
      if (firstIndex === undefined || headerIndexes.has(firstIndex)) return indexes;
      // Keep the enclosing header mounted when its day starts before the window.
      let headerIndex: number | undefined;
      for (const index of headerIndexes) {
        if (index >= firstIndex) break;
        headerIndex = index;
      }
      return headerIndex === undefined ? indexes : [headerIndex, ...indexes];
    },
    [headerIndexes],
  );

  const virtualizer = useVirtualizer({
    count: items.length,
    scrollMargin: offsetWithinScrollElement ? scrollMargin : 0,
    getScrollElement: () => {
      if (getScrollElement) {
        const element = getScrollElement();
        return element ?? (offsetWithinScrollElement ? null : fallbackParentRef.current);
      }
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
    rangeExtractor: isGroupHeader ? extractGroupRange : defaultRangeExtractor,
    getItemKey: (index) => {
      const item = items[index];
      return item === undefined ? String(index) : getItemKey(item, index);
    },
    measureElement: (element) => element.getBoundingClientRect().height,
    initialRect: { width: 1024, height: 900 },
  });

  const virtualItems = virtualizer.getVirtualItems();
  const windowStart = virtualItems[0]?.start ?? 0;
  const windowEnd = virtualItems.at(-1)?.end ?? 0;
  const offset = offsetWithinScrollElement ? scrollMargin : 0;
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

  const renderRow = (virtualRow: VirtualItem) => {
    const item = items[virtualRow.index];
    if (item === undefined) return null;
    return (
      <div
        key={virtualRow.key}
        data-index={virtualRow.index}
        ref={virtualizer.measureElement}
        className={cn(
          'relative w-full',
          itemClassName,
          headerIndexes.has(virtualRow.index) && stickyGroupHeader?.className,
        )}
      >
        {/* Virtualizer windows rows through a callback; the item component owns its own state. */}
        {/* react-doctor-disable-next-line react-doctor/no-render-in-render */}
        {renderItem(item, virtualRow.index)}
      </div>
    );
  };

  return (
    <div
      ref={fallbackParentRef}
      className={cn('relative w-full', className)}
      aria-label={ariaLabel}
    >
      <div
        className="relative w-full"
        style={{
          paddingTop: Math.max(0, windowStart - offset),
          paddingBottom: Math.max(
            0,
            virtualizer.getTotalSize() - (virtualItems.length ? windowEnd - offset : 0),
          ),
        }}
      >
        {stickyGroupHeader
          ? groupVirtualRows(virtualItems, headerIndexes).map((group) => (
              // A native sticky header stops at the end of its own group.
              <section key={group[0]?.key}>
                {group.map((row, index) => {
                  const previous = group[index - 1];
                  const skippedHeight = previous ? row.start - previous.end : 0;
                  return (
                    <Fragment key={row.key}>
                      {skippedHeight > 0 ? (
                        <div aria-hidden="true" style={{ height: skippedHeight }} />
                      ) : null}
                      {renderRow(row)}
                    </Fragment>
                  );
                })}
              </section>
            ))
          : virtualItems.map(renderRow)}
      </div>
    </div>
  );
}

function groupVirtualRows(rows: VirtualItem[], headerIndexes: Set<number>): VirtualItem[][] {
  const groups: VirtualItem[][] = [];
  for (const row of rows) {
    const currentGroup = groups.at(-1);
    if (currentGroup && !headerIndexes.has(row.index)) currentGroup.push(row);
    else groups.push([row]);
  }
  return groups;
}

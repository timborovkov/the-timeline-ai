'use client';

import type { ComponentType, ReactNode } from 'react';

import { cn } from '@/lib/utils';

const FOLD_CONTROL_CLASS = 'text-xs font-medium text-fg-muted transition-colors hover:text-fg';

export function ShowMoreList<T>({
  items,
  previewCount = 3,
  getKey,
  Item,
  moreLabel,
  hasMore = false,
  className,
  listClassName,
  itemClassName,
  footer,
}: {
  items: readonly T[];
  previewCount?: number;
  getKey: (item: T, index: number) => string;
  Item: ComponentType<{ item: T; index: number }>;
  moreLabel?: (hiddenCount: number, options: { hasMore: boolean }) => string;
  /** Keep a fold control even when every loaded item fits the preview (e.g. pagination). */
  hasMore?: boolean;
  className?: string;
  listClassName?: string;
  itemClassName?: string;
  /** Rendered inside the expanded fold (e.g. infinite-scroll sentinel). */
  footer?: ReactNode;
}) {
  const safePreview = Math.max(0, previewCount);
  const preview = items.slice(0, safePreview);
  const remaining = items.slice(safePreview);
  const hiddenCount = remaining.length;
  const showFold = hiddenCount > 0 || hasMore;
  const label =
    moreLabel?.(hiddenCount, { hasMore }) ??
    (hiddenCount > 0 ? `Show ${hiddenCount}${hasMore ? '+' : ''} more` : 'Show more');

  if (items.length === 0 && !showFold) return null;

  return (
    <div className={className}>
      {preview.length > 0 ? (
        <ul className={cn('divide-y divide-border', listClassName)}>
          {preview.map((item, index) => (
            <li key={getKey(item, index)} className={cn('min-w-0 py-2 first:pt-0', itemClassName)}>
              <Item item={item} index={index} />
            </li>
          ))}
        </ul>
      ) : null}
      {showFold ? (
        <details className={preview.length > 0 ? 'mt-1' : undefined}>
          <summary
            className={cn(
              FOLD_CONTROL_CLASS,
              'cursor-pointer list-none py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/50',
            )}
          >
            {label}
          </summary>
          <div className="mt-1">
            {remaining.length > 0 ? (
              <ul className={cn('divide-y divide-border', listClassName)}>
                {remaining.map((item, index) => (
                  <li
                    key={getKey(item, safePreview + index)}
                    className={cn('min-w-0 py-2', itemClassName)}
                  >
                    <Item item={item} index={safePreview + index} />
                  </li>
                ))}
              </ul>
            ) : null}
            {footer}
          </div>
        </details>
      ) : null}
    </div>
  );
}

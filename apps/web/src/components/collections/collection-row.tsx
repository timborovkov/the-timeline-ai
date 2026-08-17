import type { ReactNode } from 'react';

import { CollectionRowContext } from '@/components/collections/collection-row-context';
import { CollectionRowLeading } from '@/components/collections/collection-row-leading';
import { CollectionRowMetadata } from '@/components/collections/collection-row-metadata';
import { findSlot } from '@/components/collections/collection-slots';
import { cn } from '@/lib/utils';

export function CollectionRow({
  title,
  context,
  actions,
  selected = false,
  className,
  children,
}: {
  title: ReactNode;
  context?: ReactNode;
  actions?: ReactNode;
  selected?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  const leading = findSlot(children, CollectionRowLeading);
  const metadata = findSlot(children, CollectionRowMetadata);
  const contextSlot = findSlot(children, CollectionRowContext);
  const resolvedContext = contextSlot?.props.children ?? context;

  return (
    <div
      className={cn(
        'group/collection-row grid min-h-11 min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 border-b border-border/80 px-2 transition-[background-color,border-color] duration-150 last:border-b-0 hover:bg-surface focus-within:bg-surface motion-reduce:transition-none sm:px-3',
        selected && 'bg-signal-soft shadow-[inset_2px_0_0_var(--color-signal)]',
        className,
      )}
    >
      {leading ?? <div className="flex min-h-10 shrink-0 items-center" />}
      <div className="flex min-w-0 flex-col justify-center py-1 sm:flex-row sm:items-center sm:gap-3">
        <div className="min-w-0 flex-1">
          <div className="min-w-0 truncate text-sm font-medium leading-5 text-fg">{title}</div>
          {resolvedContext ? (
            <div className="min-w-0 truncate text-[11px] leading-4 text-fg-dim sm:hidden">
              {resolvedContext}
            </div>
          ) : null}
        </div>
        {resolvedContext ? (
          <div className="hidden min-w-0 max-w-[22rem] truncate text-xs text-fg-dim sm:block">
            {resolvedContext}
          </div>
        ) : null}
        {metadata}
      </div>
      <div className="flex min-h-10 shrink-0 items-center">{actions}</div>
    </div>
  );
}

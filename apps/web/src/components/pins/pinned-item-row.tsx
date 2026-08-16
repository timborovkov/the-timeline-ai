'use client';
import Link from 'next/link';

import type { PinnedItem } from '@timeline/shared/pins';

import { PinTargetIcon } from '@/components/pins/pin-icon';
import { PinMenuItem } from '@/components/pins/pin-menu-item';
import { ItemActionGroup, ItemOverflowMenu } from '@/components/ui/item-actions';
import { displayText } from '@/lib/display-dates';
import { cn } from '@/lib/utils';

export function PinnedItemRow({
  item,
  actions,
  draggable = false,
  onDragStart,
  onDragOver,
  onDrop,
  onRemoved,
}: {
  item: PinnedItem;
  actions?: React.ReactNode;
  draggable?: boolean;
  onDragStart?: () => void;
  onDragOver?: (event: React.DragEvent) => void;
  onDrop?: () => void;
  onRemoved?: () => void;
}) {
  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={cn(
        'group grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border py-3 last:border-b-0',
        draggable && 'cursor-grab active:cursor-grabbing',
      )}
    >
      <Link
        href={item.href}
        className="flex min-w-0 items-center gap-3 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex size-8 shrink-0 items-center justify-center border border-border bg-surface text-fg-muted">
          <PinTargetIcon kind={item.iconKind} className="size-3.5" />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-fg">
            {displayText(item.title)}
          </span>
          {item.subtitle ? (
            <span className="mt-0.5 block truncate text-xs text-fg-dim">
              {displayText(item.subtitle)}
            </span>
          ) : null}
        </span>
      </Link>
      <ItemActionGroup label={`Actions for ${item.title}`}>
        {actions}
        <ItemOverflowMenu targetLabel={item.title}>
          <PinMenuItem
            target={item.target}
            title={item.title}
            initialPinned
            onPinnedChange={(pinned) => {
              if (!pinned) onRemoved?.();
            }}
          />
        </ItemOverflowMenu>
      </ItemActionGroup>
    </div>
  );
}

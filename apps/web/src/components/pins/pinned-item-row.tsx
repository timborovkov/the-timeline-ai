'use client';
import Link from 'next/link';

import type { PinnedItem } from '@timeline/shared/pins';

import { CollectionRow } from '@/components/collections/collection-row';
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
      className={cn('group min-w-0', draggable && 'cursor-grab active:cursor-grabbing')}
    >
      <CollectionRow
        leading={
          <span className="flex size-7 shrink-0 items-center justify-center text-fg-muted">
            <PinTargetIcon kind={item.iconKind} className="size-3.5" />
          </span>
        }
        title={
          <Link
            href={item.href}
            className="block truncate rounded-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {displayText(item.title)}
          </Link>
        }
        context={item.subtitle ? displayText(item.subtitle) : undefined}
        actions={
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
        }
      />
    </div>
  );
}

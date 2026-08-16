'use client';

import { MoreHorizontal } from 'lucide-react';
import Link from 'next/link';

import type { PinnedItem } from '@timeline/shared/pins';

import { CollectionRow } from '@/components/collections/collection-row';
import { PinTargetIcon } from '@/components/pins/pin-icon';
import { PinMenuItem } from '@/components/pins/pin-menu-item';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
          <span className="flex items-center gap-1">
            {actions}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Actions for ${item.title}`}
                  className="size-8 text-fg-dim"
                >
                  <MoreHorizontal aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <PinMenuItem
                  target={item.target}
                  title={item.title}
                  initialPinned
                  onPinnedChange={(pinned) => {
                    if (!pinned) onRemoved?.();
                  }}
                />
              </DropdownMenuContent>
            </DropdownMenu>
          </span>
        }
      />
    </div>
  );
}

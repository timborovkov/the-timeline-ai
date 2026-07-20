'use client';

import { MoreHorizontal } from 'lucide-react';

import type { PinTargetRef } from '@timeline/shared/pins';

import { PinMenuItem } from '@/components/pins/pin-menu-item';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export function PinOverflowMenu({
  target,
  title,
  initialPinned,
}: {
  target: PinTargetRef;
  title: string;
  initialPinned: boolean;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 shrink-0 text-fg-dim"
          aria-label={`Actions for ${title}`}
        >
          <MoreHorizontal aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <PinMenuItem target={target} title={title} initialPinned={initialPinned} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

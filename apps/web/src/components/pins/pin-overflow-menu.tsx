'use client';

import type { PinTargetRef } from '@timeline/shared/pins';

import { PinMenuItem } from '@/components/pins/pin-menu-item';
import { ItemOverflowMenu } from '@/components/ui/item-actions';

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
    <ItemOverflowMenu targetLabel={title}>
      <PinMenuItem target={target} title={title} initialPinned={initialPinned} />
    </ItemOverflowMenu>
  );
}

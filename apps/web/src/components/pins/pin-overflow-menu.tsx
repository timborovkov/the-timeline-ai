'use client';

import { useEffect, useState } from 'react';

import type { PinTargetRef } from '@timeline/shared/pins';

import { PinnedGlyph } from '@/components/pins/pin-glyph';
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
  const [pinned, setPinned] = useState(initialPinned);

  useEffect(() => {
    setPinned(initialPinned);
  }, [initialPinned]);

  return (
    <>
      {pinned ? <PinnedGlyph /> : null}
      <ItemOverflowMenu targetLabel={title}>
        <PinMenuItem
          target={target}
          title={title}
          initialPinned={pinned}
          onPinnedChange={setPinned}
        />
      </ItemOverflowMenu>
    </>
  );
}

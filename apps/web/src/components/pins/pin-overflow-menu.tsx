'use client';

import { useState } from 'react';

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
  return (
    <PinOverflowControls
      key={`${target.kind}:${target.key}:${String(initialPinned)}`}
      target={target}
      title={title}
      initialPinned={initialPinned}
    />
  );
}

// react-doctor-disable-next-line react-doctor/no-multi-comp -- keyed inner control remounts when the server pin state changes
function PinOverflowControls({
  target,
  title,
  initialPinned,
}: {
  target: PinTargetRef;
  title: string;
  initialPinned: boolean;
}) {
  const [pinned, setPinned] = useState(initialPinned);
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

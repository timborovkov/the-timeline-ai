'use client';

import { Pin, PinOff } from 'lucide-react';
import { useState } from 'react';

import type { PinTargetRef } from '@timeline/shared/pins';

import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { notifyAction } from '@/lib/notify';

async function mutatePin(target: PinTargetRef, pinned: boolean) {
  const { pinTargetAction, unpinTargetAction } = await import('@/app/actions/pins');
  return pinned ? pinTargetAction(target) : unpinTargetAction(target);
}

export function PinMenuItem({
  target,
  title,
  initialPinned,
  onPinnedChange,
}: {
  target: PinTargetRef;
  title: string;
  initialPinned: boolean;
  onPinnedChange?: (pinned: boolean) => void;
}) {
  const [pinned, setPinned] = useState(initialPinned);
  const [pending, setPending] = useState(false);
  const action = pending === pinned ? 'Pin' : 'Unpin';
  const Icon = action === 'Unpin' ? PinOff : Pin;
  return (
    <DropdownMenuItem
      disabled={pending}
      aria-label={`${action} ${title}`}
      aria-busy={pending}
      onSelect={(event) => {
        event.preventDefault();
        const next = !pinned;
        const previous = pinned;
        setPinned(next);
        setPending(true);
        void notifyAction({
          id: `pin:${target.kind}:${target.key}`,
          loading: next ? 'Pinning…' : 'Unpinning…',
          success: next ? 'Pinned' : 'Unpinned',
          error: next ? 'Couldn’t pin item' : 'Couldn’t unpin item',
          run: () => mutatePin(target, next),
          undo: {
            run: async () => {
              setPinned(previous);
              onPinnedChange?.(previous);
              return mutatePin(target, previous);
            },
            success: previous ? 'Pinned' : 'Unpinned',
          },
        }).then((result) => {
          if (result.error) {
            setPinned(previous);
          } else {
            onPinnedChange?.(next);
          }
          setPending(false);
        });
      }}
    >
      <Icon aria-hidden="true" className="size-4" />
      {`${action} item`}
    </DropdownMenuItem>
  );
}

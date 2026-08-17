'use client';

import { Pin, PinOff } from 'lucide-react';
import { useState } from 'react';

import type { PinTargetRef } from '@timeline/shared/pins';

import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { toastMutation } from '@/lib/mutation-toast';

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
  const [pendingAction, setPendingAction] = useState<'pin' | 'unpin' | null>(null);
  const Icon = pinned ? PinOff : Pin;
  const action = pinned ? 'Unpin' : 'Pin';
  const pendingLabel = `Saving ${pendingAction ?? action.toLowerCase()}…`;
  return (
    <DropdownMenuItem
      disabled={pending}
      aria-label={pending ? `${pendingLabel} ${title}` : `${action} ${title}`}
      aria-busy={pending}
      onSelect={(event) => {
        event.preventDefault();
        const next = !pinned;
        setPinned(next);
        setPending(true);
        setPendingAction(next ? 'pin' : 'unpin');
        void toastMutation(mutatePin(target, next), {
          loading: next ? `Pinning ${title}` : `Unpinning ${title}`,
          success: next ? `Pinned ${title}` : `Unpinned ${title}`,
          error: next ? 'Failed to pin item' : 'Failed to unpin item',
        })
          .then((result) => {
            if (result.error) {
              setPinned(!next);
              return;
            }
            onPinnedChange?.(next);
          })
          .catch(() => {
            setPinned(!next);
          })
          .finally(() => {
            setPending(false);
            setPendingAction(null);
          });
      }}
    >
      <Icon aria-hidden="true" className="size-4" />
      {pending ? pendingLabel : `${action} item`}
    </DropdownMenuItem>
  );
}

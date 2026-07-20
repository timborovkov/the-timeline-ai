'use client';

import { Pin, PinOff } from 'lucide-react';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import type { PinTargetRef } from '@timeline/shared/pins';

import { DropdownMenuItem } from '@/components/ui/dropdown-menu';

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
  const [pending, startTransition] = useTransition();
  const Icon = pinned ? PinOff : Pin;
  const action = pinned ? 'Unpin' : 'Pin';
  return (
    <DropdownMenuItem
      disabled={pending}
      aria-label={`${action} ${title}`}
      onSelect={(event) => {
        event.preventDefault();
        const next = !pinned;
        setPinned(next);
        onPinnedChange?.(next);
        startTransition(() => {
          void mutatePin(target, next)
            .then((result) => {
              if (result.error) {
                setPinned(!next);
                onPinnedChange?.(!next);
                toast.error(result.error);
              }
            })
            .catch(() => {
              setPinned(!next);
              onPinnedChange?.(!next);
              toast.error(next ? 'Failed to pin item' : 'Failed to unpin item');
            });
        });
      }}
    >
      <Icon aria-hidden="true" className="size-4" />
      {pending ? 'Saving…' : `${action} item`}
    </DropdownMenuItem>
  );
}

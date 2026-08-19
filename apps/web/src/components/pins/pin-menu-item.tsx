'use client';

import { Pin } from 'lucide-react';
import { useState } from 'react';

import type { PinTargetRef } from '@timeline/shared/pins';

import { pinControlLabel, pinNotifyCopy } from '@/components/pins/pin-copy';
import { mutatePin } from '@/components/pins/pin-mutate';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { notifyAction } from '@/lib/notify';
import { cn } from '@/lib/utils';

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
  return (
    <PinMenuItemControl
      key={`${target.kind}:${target.key}:${String(initialPinned)}`}
      target={target}
      title={title}
      initialPinned={initialPinned}
      onPinnedChange={onPinnedChange}
    />
  );
}

// react-doctor-disable-next-line react-doctor/no-multi-comp -- keyed inner control remounts when the server pin state changes
function PinMenuItemControl({
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
  const action = pinControlLabel(pinned);
  const pendingLabel = pinControlLabel(pinned, true);
  return (
    <DropdownMenuItem
      disabled={pending}
      aria-label={pending ? `${pendingLabel} ${title}` : `${action} ${title}`}
      aria-busy={pending}
      onSelect={(event) => {
        event.preventDefault();
        const next = !pinned;
        const previous = pinned;
        const copy = pinNotifyCopy(next);
        setPinned(next);
        setPending(true);
        void notifyAction({
          id: `pin:${target.kind}:${target.key}`,
          loading: copy.loading,
          success: copy.success,
          error: copy.error,
          run: () => mutatePin(target, next),
          undo: {
            run: async () => {
              setPinned(previous);
              onPinnedChange?.(previous);
              return mutatePin(target, previous);
            },
            success: pinNotifyCopy(previous).success,
          },
        })
          .then((result) => {
            if (result.error) {
              setPinned(previous);
            } else {
              onPinnedChange?.(next);
            }
          })
          .catch(() => {
            setPinned(previous);
          })
          .finally(() => {
            setPending(false);
          });
      }}
    >
      <Pin aria-hidden="true" className={cn('size-4', pinned && 'fill-current text-signal')} />
      {pending ? pendingLabel : action}
    </DropdownMenuItem>
  );
}

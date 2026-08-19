'use client';

import { Pin } from 'lucide-react';
import { useEffect, useState } from 'react';

import type { PinTargetRef } from '@timeline/shared/pins';

import { pinControlLabel, pinNotifyCopy } from '@/components/pins/pin-copy';
import { mutatePin } from '@/components/pins/pin-mutate';
import { ItemIconButton } from '@/components/ui/item-icon-button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { notifyAction } from '@/lib/notify';
import { cn } from '@/lib/utils';

export function PinButton({
  target,
  initialPinned,
}: {
  target: PinTargetRef;
  initialPinned: boolean;
}) {
  const [pinned, setPinned] = useState(initialPinned);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!pending) setPinned(initialPinned);
  }, [initialPinned, pending]);

  function toggle(): void {
    const nextPinned = !pinned;
    const previous = pinned;
    const copy = pinNotifyCopy(nextPinned);
    setPinned(nextPinned);
    setPending(true);
    void notifyAction({
      id: `pin:${target.kind}:${target.key}`,
      loading: copy.loading,
      success: copy.success,
      error: copy.error,
      run: () => mutatePin(target, nextPinned),
      undo: {
        run: async () => {
          setPinned(previous);
          return mutatePin(target, previous);
        },
        success: pinNotifyCopy(previous).success,
      },
    }).then((result) => {
      if (result.error) setPinned(previous);
      setPending(false);
    });
  }

  const label = pinControlLabel(pinned, pending);

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <ItemIconButton
            label={label}
            title={undefined}
            aria-pressed={pinned}
            aria-busy={pending}
            disabled={pending}
            onClick={toggle}
            className={cn(pinned && 'text-signal hover:bg-signal-soft hover:text-signal')}
          >
            <Pin aria-hidden="true" className={cn('size-3.5', pinned && 'fill-current')} />
          </ItemIconButton>
        </TooltipTrigger>
        <TooltipContent className="font-sans text-xs font-normal tracking-normal">
          {label}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

'use client';

import { Pin, PinOff } from 'lucide-react';
import { useState } from 'react';

import type { PinTargetRef } from '@timeline/shared/pins';

import { notifyAction } from '@/lib/notify';
import { cn } from '@/lib/utils';

async function mutatePin(target: PinTargetRef, pinned: boolean) {
  const { pinTargetAction, unpinTargetAction } = await import('@/app/actions/pins');
  return pinned ? pinTargetAction(target) : unpinTargetAction(target);
}

export function PinButton({
  target,
  initialPinned,
  compact = false,
  icon = false,
}: {
  target: PinTargetRef;
  initialPinned: boolean;
  compact?: boolean;
  icon?: boolean;
}) {
  const [pinned, setPinned] = useState(initialPinned);
  const [pending, setPending] = useState(false);

  function toggle(): void {
    const nextPinned = !pinned;
    const previous = pinned;
    setPinned(nextPinned);
    setPending(true);
    void notifyAction({
      id: `pin:${target.kind}:${target.key}`,
      loading: nextPinned ? 'Pinning…' : 'Unpinning…',
      success: nextPinned ? 'Pinned' : 'Unpinned',
      error: nextPinned ? 'Couldn’t pin item' : 'Couldn’t unpin item',
      run: () => mutatePin(target, nextPinned),
      undo: {
        run: async () => {
          setPinned(previous);
          return mutatePin(target, previous);
        },
        success: previous ? 'Pinned' : 'Unpinned',
      },
    }).then((result) => {
      if (result.error) setPinned(previous);
      setPending(false);
    });
  }
  const Icon = pinned ? PinOff : Pin;

  const label = pending ? `Saving ${pinned ? 'pin' : 'unpin'}…` : pinned ? 'Unpin' : 'Pin';

  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pinned}
      aria-busy={pending}
      disabled={pending}
      onClick={toggle}
      className={cn(
        'inline-flex items-center rounded-sm text-xs font-medium transition-colors motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-50',
        icon
          ? 'size-8 justify-center text-fg-muted hover:bg-surface-2 hover:text-fg'
          : 'h-9 gap-2 border px-3',
        !icon &&
          (pinned
            ? 'border-signal/40 bg-signal-soft text-signal hover:bg-signal/20'
            : 'border-border bg-bg text-fg-muted hover:border-signal/50 hover:text-signal'),
        !icon && compact && 'h-8 px-2',
        icon && pinned && 'text-signal hover:bg-signal-soft',
      )}
    >
      <Icon aria-hidden="true" className="size-3.5" />
      {icon ? null : pinned ? 'Unpin' : 'Pin'}
    </button>
  );
}

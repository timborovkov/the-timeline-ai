'use client';

import { Pin, PinOff } from 'lucide-react';
import { useState, useTransition } from 'react';

import type { PinTargetRef } from '@timeline/shared/pins';

import { cn } from '@/lib/utils';

async function mutatePin(target: PinTargetRef, pinned: boolean) {
  const { pinTargetAction, unpinTargetAction } = await import('@/app/actions/pins');
  return pinned ? pinTargetAction(target) : unpinTargetAction(target);
}

export function PinButton({
  target,
  initialPinned,
  compact = false,
}: {
  target: PinTargetRef;
  initialPinned: boolean;
  compact?: boolean;
}) {
  const [pinned, setPinned] = useState(initialPinned);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggle(): void {
    const nextPinned = !pinned;
    setError(null);
    setPinned(nextPinned);
    startTransition(() => {
      void mutatePin(target, nextPinned)
        .then((result) => {
          if (result.error) {
            setPinned(!nextPinned);
            setError(result.error);
          }
        })
        .catch(() => {
          setPinned(!nextPinned);
          setError(nextPinned ? 'Failed to pin item' : 'Failed to unpin item');
        });
    });
  }
  const Icon = pinned ? PinOff : Pin;

  return (
    <span className="inline-flex flex-col items-start gap-1 lg:items-end">
      <button
        type="button"
        aria-pressed={pinned}
        disabled={pending}
        onClick={toggle}
        className={cn(
          'inline-flex items-center gap-2 rounded-sm border px-3 py-2 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50',
          pinned
            ? 'border-signal/40 bg-signal-soft text-signal hover:bg-signal/20'
            : 'border-border bg-bg text-fg-muted hover:border-signal/50 hover:text-signal',
          compact && 'px-2 py-1.5',
        )}
      >
        <Icon aria-hidden="true" className="size-3.5" />
        {pending ? 'Saving…' : pinned ? 'Unpin' : 'Pin'}
      </button>
      {error ? (
        <span role="alert" className="text-xs text-danger">
          {error}
        </span>
      ) : null}
    </span>
  );
}

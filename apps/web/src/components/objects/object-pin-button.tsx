'use client';

import { Pin } from 'lucide-react';
import { useState, useTransition } from 'react';

import { pinObjectAction, unpinObjectAction } from '@/app/actions/objects';
import { cn } from '@/lib/utils';

export function ObjectPinButton({
  objectId,
  initialPinned,
  compact = false,
}: {
  objectId: string;
  initialPinned: boolean;
  compact?: boolean;
}) {
  const [pinned, setPinned] = useState(initialPinned);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggle(): void {
    const nextPinned = !pinned;
    setError(null);
    startTransition(() => {
      void (nextPinned ? pinObjectAction({ id: objectId }) : unpinObjectAction({ id: objectId }))
        .then((result) => {
          if ('error' in result && result.error) {
            setError(result.error);
            return;
          }
          setPinned(nextPinned);
        })
        .catch(() => {
          setError(nextPinned ? 'Failed to pin object' : 'Failed to unpin object');
        });
    });
  }

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
        <Pin aria-hidden="true" className={cn('size-3.5', pinned && 'fill-current')} />
        {pending ? 'Saving…' : pinned ? 'Pinned' : 'Pin'}
      </button>
      {error ? (
        <span role="alert" className="text-xs text-danger">
          {error}
        </span>
      ) : null}
    </span>
  );
}

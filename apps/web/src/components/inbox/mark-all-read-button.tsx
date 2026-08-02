'use client';

import { Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { markAllNotificationsReadAction } from '@/app/actions/objects';

export function MarkAllReadButton({ hasUnread }: { hasUnread: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [optimisticRead, setOptimisticRead] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const disabled = !hasUnread || optimisticRead || pending;
  const busy = optimisticRead || pending;

  function markAllRead(): void {
    setError(null);
    setOptimisticRead(true);
    window.dispatchEvent(new CustomEvent('timeline:notifications-read-all', { detail: true }));
    startTransition(async () => {
      try {
        const result = await markAllNotificationsReadAction();
        if (!('error' in result) || !result.error) {
          setOptimisticRead(false);
          router.refresh();
          return;
        }
      } catch {
        // Fall through to the same rollback as an explicit action error.
      }
      setOptimisticRead(false);
      setError('Unable to mark notifications as read. Your notifications remain unread.');
      window.dispatchEvent(new CustomEvent('timeline:notifications-read-all', { detail: false }));
    });
  }

  return (
    <div className="flex max-w-xs flex-col items-end gap-2">
      <p aria-live="polite" className="sr-only">
        {busy ? 'Marking all notifications as read.' : ''}
      </p>
      <button
        type="button"
        disabled={disabled}
        aria-busy={busy}
        onClick={markAllRead}
        className="inline-flex min-h-9 items-center gap-2 rounded-sm border border-signal/40 bg-signal-soft px-3 text-sm font-medium text-signal transition-colors hover:bg-signal-soft/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:opacity-50"
      >
        <span>Mark all read</span>
        {optimisticRead || pending ? (
          <Loader2
            aria-hidden="true"
            className="size-3.5 animate-spin motion-reduce:animate-none"
          />
        ) : null}
      </button>
      {error ? (
        <div
          role="alert"
          className="flex items-center justify-end gap-2 text-right text-xs text-danger"
        >
          <p>{error}</p>
          <button
            type="button"
            disabled={busy}
            onClick={markAllRead}
            className="min-h-9 shrink-0 rounded-sm px-2 font-medium text-danger underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:cursor-not-allowed disabled:opacity-50"
          >
            Try again
          </button>
        </div>
      ) : null}
    </div>
  );
}

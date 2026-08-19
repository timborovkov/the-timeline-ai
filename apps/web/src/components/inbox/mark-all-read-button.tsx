'use client';

import { Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { markAllNotificationsReadAction } from '@/app/actions/objects';
import { notifyAction } from '@/lib/notify';

export function MarkAllReadButton({ hasUnread }: { hasUnread: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [optimisticRead, setOptimisticRead] = useState(false);
  const disabled = !hasUnread || optimisticRead || pending;
  const busy = optimisticRead || pending;

  function markAllRead(): void {
    setOptimisticRead(true);
    window.dispatchEvent(new CustomEvent('timeline:notifications-read-all', { detail: true }));
    startTransition(async () => {
      const result = await notifyAction({
        id: 'inbox:mark-all-read',
        loading: 'Marking notifications read…',
        success: 'Notifications marked read',
        error: 'Couldn’t mark notifications read',
        run: () => markAllNotificationsReadAction(),
      });
      if (!result.error) {
        setOptimisticRead(false);
        router.refresh();
        return;
      }
      setOptimisticRead(false);
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
    </div>
  );
}

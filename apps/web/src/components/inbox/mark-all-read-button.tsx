'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';

import { markAllNotificationsReadAction } from '@/app/actions/objects';

export function MarkAllReadButton({ hasUnread }: { hasUnread: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [locallyRead, setLocallyRead] = useState(!hasUnread);
  const disabled = locallyRead || pending;

  useEffect(() => {
    setLocallyRead(!hasUnread);
  }, [hasUnread]);

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => {
        setLocallyRead(true);
        window.dispatchEvent(new CustomEvent('timeline:notifications-read-all', { detail: true }));
        startTransition(async () => {
          try {
            const result = await markAllNotificationsReadAction();
            if (!('error' in result) || !result.error) {
              router.refresh();
              return;
            }
          } catch {
            // Fall through to the same rollback as an explicit action error.
          }
          setLocallyRead(false);
          window.dispatchEvent(
            new CustomEvent('timeline:notifications-read-all', { detail: false }),
          );
        });
      }}
      className="rounded-md border border-primary/40 bg-primary/10 px-3 py-1.5 text-sm font-medium text-primary hover:bg-primary/20 disabled:opacity-50"
    >
      Mark all read
    </button>
  );
}

'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

import { markAllNotificationsReadAction } from '@/app/actions/objects';

export function MarkAllReadButton({ hasUnread }: { hasUnread: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={!hasUnread || pending}
      onClick={() => {
        startTransition(async () => {
          await markAllNotificationsReadAction();
          router.refresh();
        });
      }}
      className="rounded-md border border-primary/40 bg-primary/10 px-3 py-1.5 text-sm font-medium text-primary hover:bg-primary/20 disabled:opacity-50"
    >
      Mark all read
    </button>
  );
}

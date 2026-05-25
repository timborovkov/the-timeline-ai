'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';

import { markNotificationReadAction } from '@/app/actions/objects';

interface Props {
  id: string;
  kind: string;
  summary: string;
  entityId: string | null;
  createdAt: string;
  initiallyRead: boolean;
}

export function NotificationRow({ id, kind, summary, entityId, createdAt, initiallyRead }: Props) {
  const router = useRouter();
  const search = useSearchParams();
  const [pending, startTransition] = useTransition();
  // Optimistic read state so clicking through to an object instantly clears
  // the unread dot — the server action runs async without blocking the
  // navigation.
  const [read, setRead] = useState(initiallyRead);

  function markRead(): void {
    if (read) return;
    setRead(true);
    const onUnreadFilter = search.get('unread') === '1';
    startTransition(async () => {
      await markNotificationReadAction(id);
      // On the unread-only view, the server filter excludes read rows —
      // refresh so the now-read row drops out instead of lingering with
      // muted styling. On the All view, the optimistic state is enough.
      if (onUnreadFilter) router.refresh();
    });
  }

  return (
    <li className={`rounded-lg border px-4 py-3 text-sm ${read ? 'bg-card/40' : 'bg-card'}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {!read && <span className="h-2 w-2 rounded-full bg-primary" />}
            <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
              {kind.replace(/_/g, ' ')}
            </span>
          </div>
          <p className="mt-1">
            {entityId ? (
              <Link
                href={`/app/objects/${entityId}`}
                className="font-medium hover:underline"
                onClick={markRead}
              >
                {summary}
              </Link>
            ) : (
              <span>{summary}</span>
            )}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className="text-[11px] text-muted-foreground">
            {new Date(createdAt).toLocaleString()}
          </span>
          {!read && (
            <button
              type="button"
              disabled={pending}
              onClick={markRead}
              className="text-[11px] text-primary hover:underline disabled:opacity-50"
            >
              Mark read
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

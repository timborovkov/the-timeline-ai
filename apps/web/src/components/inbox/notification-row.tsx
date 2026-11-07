'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Suspense, useTransition } from 'react';

import { markNotificationReadAction } from '@/app/actions/objects';
import { useInboxReadState } from '@/components/inbox/inbox-read-state';
import { RelativeTimestamp } from '@/components/relative-timestamp';
import { notificationHref } from '@/lib/notification-href';
import { notificationKindLabel } from '@/lib/notification-labels';
import { notifyAction } from '@/lib/notify';
import { cn } from '@/lib/utils';

interface Props {
  id: string;
  kind: string;
  summary: string;
  entityId: string | null;
  agentSuggestionId: string | null;
  payload?: Record<string, unknown> | null;
  createdAt: string;
  initiallyRead: boolean;
}

export function NotificationRow(props: Props) {
  return (
    <Suspense fallback={null}>
      <NotificationRowContent {...props} />
    </Suspense>
  );
}

function NotificationRowContent({
  id,
  kind,
  summary,
  entityId,
  agentSuggestionId,
  payload,
  createdAt,
  initiallyRead,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const { isRead, beginRead, finishRead } = useInboxReadState();
  const read = isRead(id, initiallyRead);

  function markRead(): void {
    if (initiallyRead || !beginRead(id)) return;
    startTransition(async () => {
      const result = await notifyAction({
        id: `inbox:${id}:read`,
        loading: 'Marking notification read…',
        success: 'Notification marked read',
        error: 'Couldn’t mark notification read',
        run: () => markNotificationReadAction(id),
      });
      finishRead(id, !result.error);
      if (!result.error) {
        // On the unread-only view, the server filter excludes read rows —
        // refresh so the now-read row drops out instead of lingering with
        // muted styling. On the All view, refresh still matters because the
        // shell inbox badge and dropdown are loaded by the server layout.
        router.refresh();
        return;
      }
    });
  }

  return (
    <li
      className={cn(
        'grid grid-cols-1 gap-x-4 gap-y-2 border-b border-border px-1 py-3 text-sm transition-colors hover:bg-surface sm:grid-cols-[18ch_minmax(0,1fr)_auto] sm:gap-y-1',
        read ? 'opacity-70' : 'opacity-100',
      )}
    >
      <RelativeTimestamp value={createdAt} className="text-xs" />
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-xs text-fg-dim">
          {!read ? (
            <span className="inline-flex items-center gap-1.5 font-medium text-fg-muted">
              <span aria-hidden="true" className="size-1.5 bg-signal" />
              Unread
            </span>
          ) : null}
          <span>{notificationKindLabel(kind)}</span>
        </div>
        <p className="mt-1 text-fg">
          {entityId || agentSuggestionId ? (
            <Link
              href={notificationHref({ kind, entityId, agentSuggestionId, payload })}
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
      {!read ? (
        <button
          type="button"
          disabled={pending}
          onClick={markRead}
          aria-label={`Mark ${summary} as read`}
          className="inline-flex min-h-9 items-center self-start rounded-sm px-2 text-xs font-medium text-signal transition-colors hover:bg-signal-soft hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:opacity-50"
        >
          Mark read
        </button>
      ) : null}
    </li>
  );
}

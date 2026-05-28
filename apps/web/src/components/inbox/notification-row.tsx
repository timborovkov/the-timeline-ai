'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';

import { markNotificationReadAction } from '@/app/actions/objects';
import { cn } from '@/lib/utils';

interface Props {
  id: string;
  kind: string;
  summary: string;
  entityId: string | null;
  agentSuggestionId: string | null;
  createdAt: string;
  initiallyRead: boolean;
}

function formatTs(ts: string): string {
  const d = new Date(ts);
  const date = d.toLocaleDateString('en-CA');
  const time = d.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return `${date} ${time}`;
}

export function NotificationRow({
  id,
  kind,
  summary,
  entityId,
  agentSuggestionId,
  createdAt,
  initiallyRead,
}: Props) {
  const router = useRouter();
  const search = useSearchParams();
  const [pending, startTransition] = useTransition();
  // Optimistic read state so clicking through to an object instantly
  // clears the unread dot — the server action runs async without
  // blocking the navigation.
  const [read, setRead] = useState(initiallyRead);
  const latestInitiallyReadRef = useRef(initiallyRead);
  const individuallyReadRef = useRef(initiallyRead);
  const bulkReadRef = useRef(false);
  // Sync from props when the parent refreshes (e.g. MarkAllReadButton
  // calls router.refresh() and notifications now report as read). Only
  // ratchet toward "read" — never override a local optimistic-read back
  // to unread, since the user's click is the authoritative intent and
  // the server may not have caught up yet.
  useEffect(() => {
    latestInitiallyReadRef.current = initiallyRead;
    if (initiallyRead) {
      individuallyReadRef.current = true;
      setRead(true);
    }
  }, [initiallyRead]);

  useEffect(() => {
    function onAllRead(event: Event): void {
      if (!(event instanceof CustomEvent) || typeof event.detail !== 'boolean') return;
      if (event.detail) {
        bulkReadRef.current = bulkReadRef.current || !read;
        setRead(true);
        return;
      }
      setRead((current) => {
        if (!bulkReadRef.current) return current;
        bulkReadRef.current = false;
        return individuallyReadRef.current || initiallyRead;
      });
    }
    window.addEventListener('timeline:notifications-read-all', onAllRead);
    return () => {
      window.removeEventListener('timeline:notifications-read-all', onAllRead);
    };
  }, [initiallyRead, read]);

  function markRead(): void {
    if (read) return;
    individuallyReadRef.current = true;
    setRead(true);
    const onUnreadFilter = search.get('unread') === '1';
    startTransition(async () => {
      const result = await markNotificationReadAction(id);
      if ('error' in result && result.error) {
        // Action failed (DB blip, scope mismatch). Roll back the
        // optimistic state so the UI reflects what the server
        // actually recorded — otherwise the row shows as read while
        // the server still has it as unread, and on ?unread=1 it'd
        // linger with read styling but never drop out.
        individuallyReadRef.current = latestInitiallyReadRef.current;
        setRead(latestInitiallyReadRef.current);
        return;
      }
      // On the unread-only view, the server filter excludes read rows —
      // refresh so the now-read row drops out instead of lingering with
      // muted styling. On the All view, the optimistic state is enough.
      if (onUnreadFilter) router.refresh();
    });
  }

  return (
    <li
      className={cn(
        'grid grid-cols-[18ch_1fr_auto] gap-x-4 gap-y-1 border-b border-border px-1 py-3 text-sm transition-colors hover:bg-surface',
        read ? 'opacity-70' : 'opacity-100',
      )}
    >
      <time dateTime={createdAt} className="font-mono text-xs text-fg-dim">
        {formatTs(createdAt)}
      </time>
      <div className="min-w-0">
        <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-fg-dim">
          {!read ? <span aria-label="unread" className="size-1.5 rounded-sm bg-signal" /> : null}
          <span>{kind.replace(/_/g, ' ')}</span>
        </div>
        <p className="mt-1 text-fg">
          {entityId || agentSuggestionId ? (
            <Link
              href={entityId ? `/app/objects/${entityId}` : '/app/approvals'}
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
          className="self-start font-mono text-[11px] uppercase tracking-[0.12em] text-signal hover:underline disabled:opacity-50"
        >
          Mark read
        </button>
      ) : null}
    </li>
  );
}

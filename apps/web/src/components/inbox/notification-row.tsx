'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Suspense, useEffect, useRef, useState, useTransition } from 'react';

import { markNotificationReadAction } from '@/app/actions/objects';
import { useWorkspaceTimezone } from '@/components/workspace-timezone-context';
import { formatDisplayDateTime } from '@/lib/display-dates';
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

function formatTs(ts: string, timezone: string): string {
  return formatDisplayDateTime(ts, { timezone });
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
  createdAt,
  initiallyRead,
}: Props) {
  const timezone = useWorkspaceTimezone();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // Optimistic read state so clicking through to an object instantly
  // clears the unread dot — the server action runs async without
  // blocking the navigation.
  const [read, setRead] = useState(initiallyRead);
  const readRef = useRef(initiallyRead);
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
      readRef.current = true;
      setRead(true);
    }
  }, [initiallyRead]);

  useEffect(() => {
    function onAllRead(event: Event): void {
      if (!(event instanceof CustomEvent) || typeof event.detail !== 'boolean') return;
      if (event.detail) {
        bulkReadRef.current = bulkReadRef.current || !readRef.current;
        readRef.current = true;
        setRead(true);
        return;
      }
      if (!bulkReadRef.current) return;
      bulkReadRef.current = false;
      const next = individuallyReadRef.current || latestInitiallyReadRef.current;
      readRef.current = next;
      setRead(next);
    }
    window.addEventListener('timeline:notifications-read-all', onAllRead);
    return () => {
      window.removeEventListener('timeline:notifications-read-all', onAllRead);
    };
  }, []);

  function markRead(): void {
    if (
      read &&
      (individuallyReadRef.current || latestInitiallyReadRef.current || !bulkReadRef.current)
    ) {
      return;
    }
    individuallyReadRef.current = true;
    readRef.current = true;
    setRead(true);
    startTransition(async () => {
      try {
        const result = await markNotificationReadAction(id);
        if (!('error' in result) || !result.error) {
          // On the unread-only view, the server filter excludes read rows —
          // refresh so the now-read row drops out instead of lingering with
          // muted styling. On the All view, refresh still matters because the
          // shell inbox badge and dropdown are loaded by the server layout.
          router.refresh();
          return;
        }
      } catch {
        // Fall through to the same rollback as an explicit action error.
      }
      // Action failed (DB blip, scope mismatch). Roll back the
      // optimistic state so the UI reflects what the server
      // actually recorded — otherwise the row shows as read while
      // the server still has it as unread, and on ?unread=1 it'd
      // linger with read styling but never drop out.
      individuallyReadRef.current = latestInitiallyReadRef.current;
      const next = latestInitiallyReadRef.current || bulkReadRef.current;
      readRef.current = next;
      setRead(next);
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
        {formatTs(createdAt, timezone)}
      </time>
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-xs text-fg-dim">
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
          className="self-start text-xs text-signal hover:underline disabled:opacity-50"
        >
          Mark read
        </button>
      ) : null}
    </li>
  );
}

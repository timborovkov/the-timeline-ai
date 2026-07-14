'use client';

import { Bell } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

import { markAllNotificationsReadAction, markNotificationReadAction } from '@/app/actions/objects';
import { formatNavBadge } from '@/components/nav-items';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { formatDisplayDate } from '@/lib/display-dates';
import { cn } from '@/lib/utils';

export interface InboxBellNotification {
  id: string;
  kind: string;
  summary: string;
  entityId: string | null;
  agentSuggestionId: string | null;
  createdAt: string;
  readAt: string | null;
}

interface InboxBellProps {
  unreadCount: number;
  notifications: InboxBellNotification[];
}

function formatPreviewTime(ts: string): string {
  return formatDisplayDate(ts);
}

function notificationHref(notification: InboxBellNotification): string {
  if (notification.entityId) return `/app/objects/${notification.entityId}`;
  if (notification.agentSuggestionId) return '/app/approvals';
  return '/app/inbox';
}

export function InboxBell({ unreadCount, notifications }: InboxBellProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const badge = formatNavBadge(unreadCount);

  function refreshAfter(action: () => Promise<unknown>): void {
    startTransition(async () => {
      await action();
      router.refresh();
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={unreadCount > 0 ? `Open inbox, ${unreadCount} unread` : 'Open inbox'}
          className="relative grid size-9 place-items-center rounded-sm text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong focus-visible:ring-offset-1 focus-visible:ring-offset-bg"
        >
          <Bell aria-hidden="true" className="size-4" />
          {badge ? (
            <span
              aria-hidden="true"
              className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-sm border border-danger/40 bg-bg px-1 font-mono text-[10px] leading-4 text-danger"
            >
              {badge}
            </span>
          ) : null}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={8}
        className="w-[min(26rem,calc(100vw-1.5rem))] p-0"
      >
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <div className="text-xs text-fg">
            Inbox
            <span className="ml-2 text-fg-dim">{unreadCount} unread</span>
          </div>
          <button
            type="button"
            disabled={unreadCount === 0 || pending}
            onClick={() => {
              refreshAfter(markAllNotificationsReadAction);
            }}
            className="text-xs text-signal hover:underline disabled:opacity-40"
          >
            Mark all read
          </button>
        </div>

        {notifications.length === 0 ? (
          <div className="px-3 py-8 text-center text-sm text-fg-muted">No notifications yet.</div>
        ) : (
          <ul className="max-h-[22rem] overflow-y-auto">
            {notifications.map((notification) => {
              const unread = notification.readAt === null;
              return (
                <li key={notification.id} className="border-b border-border last:border-b-0">
                  <Link
                    href={notificationHref(notification)}
                    onClick={() => {
                      if (!unread) return;
                      refreshAfter(() => markNotificationReadAction(notification.id));
                    }}
                    className={cn(
                      'grid grid-cols-[auto_1fr] gap-x-2 px-3 py-2.5 text-sm transition-colors hover:bg-surface-2',
                      !unread && 'opacity-70',
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        'mt-1 size-1.5 rounded-sm',
                        unread ? 'bg-signal' : 'bg-transparent',
                      )}
                    />
                    <span className="min-w-0">
                      <span className="flex items-center gap-2 text-[11px] text-fg-dim">
                        <span className="truncate">{notification.kind.replace(/_/g, ' ')}</span>
                        <time dateTime={notification.createdAt} className="shrink-0">
                          {formatPreviewTime(notification.createdAt)}
                        </time>
                      </span>
                      <span className="mt-1 line-clamp-2 block text-fg">
                        {notification.summary}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}

        <div className="border-t border-border p-2">
          <Link
            href="/app/inbox"
            className="flex h-9 items-center justify-center rounded-sm border border-border text-xs text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
          >
            View all
          </Link>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

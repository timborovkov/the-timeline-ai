'use client';

import { Bell } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type MouseEvent, useState, useTransition } from 'react';

import { markAllNotificationsReadAction, markNotificationReadAction } from '@/app/actions/objects';
import { formatNavBadge } from '@/components/nav-items';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useWorkspaceTimezone } from '@/components/workspace-timezone-context';
import { formatDisplayDate } from '@/lib/display-dates';
import { notificationKindLabel } from '@/lib/notification-labels';
import { notifyAction } from '@/lib/notify';
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

function formatPreviewTime(ts: string, timezone: string): string {
  return formatDisplayDate(ts, { timezone });
}

function notificationHref(notification: InboxBellNotification): string {
  if (notification.entityId) return `/app/objects/${notification.entityId}`;
  if (notification.agentSuggestionId) return '/app/approvals';
  return '/app/inbox';
}

export function InboxBell({ unreadCount, notifications }: InboxBellProps) {
  const timezone = useWorkspaceTimezone();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [pendingNotificationId, setPendingNotificationId] = useState<string | null>(null);
  const badge = formatNavBadge(unreadCount);

  function completeReadAction(
    action: () => Promise<{ error?: string }>,
    onSuccess: () => void,
    notificationId?: string,
  ): void {
    setPendingNotificationId(notificationId ?? null);
    startTransition(async () => {
      const result = await notifyAction({
        id: notificationId ? `inbox:${notificationId}:read` : 'inbox:mark-all-read',
        loading: notificationId ? 'Marking notification read…' : 'Marking notifications read…',
        success: notificationId ? 'Notification marked read' : 'Notifications marked read',
        error: notificationId
          ? 'Couldn’t mark notification read'
          : 'Couldn’t mark notifications read',
        run: action,
      });
      setPendingNotificationId(null);
      if (result.error) return;
      onSuccess();
      router.refresh();
    });
  }

  function markReadAndNavigate(
    event: MouseEvent<HTMLAnchorElement>,
    notification: InboxBellNotification,
  ): void {
    if (notification.readAt !== null) return;
    event.preventDefault();
    if (pending) return;
    completeReadAction(
      () => markNotificationReadAction(notification.id),
      () => {
        router.push(notificationHref(notification));
      },
      notification.id,
    );
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
            aria-busy={pending}
            onClick={() => {
              completeReadAction(markAllNotificationsReadAction, () => undefined);
            }}
            className="text-xs text-signal hover:underline disabled:opacity-40"
          >
            {pending ? 'Marking all read…' : 'Mark all read'}
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
                    aria-disabled={pending && unread ? true : undefined}
                    tabIndex={pending && unread ? -1 : undefined}
                    onClick={(event) => {
                      markReadAndNavigate(event, notification);
                    }}
                    className={cn(
                      'grid grid-cols-[auto_1fr] gap-x-2 px-3 py-2.5 text-sm transition-colors hover:bg-surface-2',
                      !unread && 'opacity-70',
                      pending && unread && 'pointer-events-none opacity-50',
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
                        <span className="truncate">{notificationKindLabel(notification.kind)}</span>
                        <time dateTime={notification.createdAt} className="shrink-0">
                          {formatPreviewTime(notification.createdAt, timezone)}
                        </time>
                      </span>
                      <span className="mt-1 line-clamp-2 block text-fg">
                        {notification.summary}
                      </span>
                      {pendingNotificationId === notification.id ? (
                        <span className="sr-only" aria-live="polite">
                          Marking notification as read
                        </span>
                      ) : null}
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

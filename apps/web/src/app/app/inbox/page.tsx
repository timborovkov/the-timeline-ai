import { withTeam } from '@timeline/shared/team-scope';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import type { Metadata } from 'next';

import { EmptyAction } from '@/components/empty-action';
import { HistoryBackLink } from '@/components/history-back-link';
import { MarkAllReadButton } from '@/components/inbox/mark-all-read-button';
import { NotificationRow } from '@/components/inbox/notification-row';
import { IndexStrip } from '@/components/index-strip';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

export const metadata: Metadata = {
  title: 'Inbox',
  description: 'Review notifications and timeline updates.',
};

const PAGE_SIZE = 25;

function pageHref(page: number, unreadOnly: boolean): string {
  const params = new URLSearchParams();
  if (unreadOnly) params.set('unread', '1');
  if (page > 1) params.set('page', String(page));
  const query = params.toString();
  return query ? `/app/inbox?${query}` : '/app/inbox';
}

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; unread?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect('/sign-in');
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) redirect('/sign-in');

  const scope = withTeam(db, active.teamId, session.user.id);
  const params = await searchParams;
  const unreadOnly = params.unread === '1';
  const page = Math.max(Number.parseInt(params.page ?? '1', 10) || 1, 1);
  const offset = (page - 1) * PAGE_SIZE;

  const [rows, totalCount, unreadCount] = await Promise.all([
    scope.objects.listNotifications({
      unreadOnly,
      limit: PAGE_SIZE,
      offset,
    }),
    scope.objects.notificationCount(),
    scope.objects.notificationCount({ unreadOnly: true }),
  ]);
  const filteredTotal = unreadOnly ? unreadCount : totalCount;
  const hasPrevious = page > 1;
  const hasNext = offset + rows.length < filteredTotal;
  const firstVisible = rows.length > 0 ? offset + 1 : 0;
  const lastVisible = offset + rows.length;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <HistoryBackLink fallbackHref="/app" label="Back" />

      <IndexStrip
        srLabel={`Inbox · ${totalCount} notifications · ${unreadCount} unread${unreadOnly ? ' · unread filter on' : ''}`}
        segments={[
          { value: 'INBOX' },
          { label: 'total', value: totalCount },
          { label: 'unread', value: unreadCount, signal: unreadCount > 0 },
        ]}
      >
        <MarkAllReadButton hasUnread={unreadCount > 0} />
      </IndexStrip>

      <nav
        aria-label="Filter notifications"
        className="flex gap-1.5 font-mono text-[11px] uppercase tracking-[0.12em]"
      >
        <Link
          href="/app/inbox"
          aria-current={!unreadOnly ? 'page' : undefined}
          className={`rounded-sm border px-2.5 py-1 transition-colors ${!unreadOnly ? 'border-signal/40 bg-signal-soft text-signal' : 'border-border text-fg-muted hover:bg-surface-2 hover:text-fg'}`}
        >
          All
        </Link>
        <Link
          href="/app/inbox?unread=1"
          aria-current={unreadOnly ? 'page' : undefined}
          className={`rounded-sm border px-2.5 py-1 transition-colors ${unreadOnly ? 'border-signal/40 bg-signal-soft text-signal' : 'border-border text-fg-muted hover:bg-surface-2 hover:text-fg'}`}
        >
          Unread
        </Link>
      </nav>

      {rows.length === 0 ? (
        <EmptyAction
          title={unreadOnly ? 'No unread notifications' : 'No notifications yet'}
          body="Notifications appear when objects you own change or agent suggestions need your attention."
          href={unreadOnly ? '/app/inbox' : '/app/objects'}
          action={unreadOnly ? 'Show all notifications' : 'Open objects'}
        />
      ) : (
        <>
          <div className="flex items-center justify-between gap-3 border-y border-border py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-fg-dim">
            <span>
              Showing {firstVisible}-{lastVisible} of {filteredTotal}
            </span>
            <div className="flex items-center gap-1.5">
              <Link
                href={pageHref(page - 1, unreadOnly)}
                aria-disabled={!hasPrevious}
                className={`rounded-sm border px-2.5 py-1 transition-colors ${hasPrevious ? 'border-border text-fg-muted hover:bg-surface-2 hover:text-fg' : 'pointer-events-none border-border text-fg-dim opacity-45'}`}
              >
                Previous
              </Link>
              <Link
                href={pageHref(page + 1, unreadOnly)}
                aria-disabled={!hasNext}
                className={`rounded-sm border px-2.5 py-1 transition-colors ${hasNext ? 'border-border text-fg-muted hover:bg-surface-2 hover:text-fg' : 'pointer-events-none border-border text-fg-dim opacity-45'}`}
              >
                Next
              </Link>
            </div>
          </div>
          <ul>
            {rows.map((n) => (
              <NotificationRow
                key={n.id}
                id={n.id}
                kind={n.kind}
                summary={n.summary}
                entityId={n.entityId}
                agentSuggestionId={n.agentSuggestionId}
                createdAt={n.createdAt.toISOString()}
                initiallyRead={n.readAt !== null}
              />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

import { withTeam } from '@timeline/shared/team-scope';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import type { Metadata } from 'next';

import { EmptyAction } from '@/components/empty-action';
import { HistoryBackLink } from '@/components/history-back-link';
import { InboxList } from '@/components/inbox/inbox-list';
import { MarkAllReadButton } from '@/components/inbox/mark-all-read-button';
import { PageHeader } from '@/components/page-header';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { INBOX_PAGE_SIZE } from '@/lib/collection-page-sizes';
import { db } from '@/lib/db';

export const metadata: Metadata = {
  title: 'Inbox',
  description: 'Review notifications and timeline updates.',
};

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ unread?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect('/sign-in');
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) redirect('/sign-in');

  const scope = withTeam(db, active.teamId, session.user.id);
  const params = await searchParams;
  const unreadOnly = params.unread === '1';

  const [rows, totalCount, unreadCount] = await Promise.all([
    scope.objects.listNotifications({
      unreadOnly,
      limit: INBOX_PAGE_SIZE + 1,
      offset: 0,
    }),
    scope.objects.notificationCount(),
    scope.objects.notificationCount({ unreadOnly: true }),
  ]);
  const pageRows = rows.slice(0, INBOX_PAGE_SIZE);
  const matchingCount = unreadOnly ? unreadCount : totalCount;

  return (
    <div className="space-y-6">
      <HistoryBackLink fallbackHref="/app" label="Back" />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <PageHeader
          title="Inbox"
          subtitle="Review notifications and changes that need your attention."
          srLabel={`Inbox · ${totalCount} notifications · ${unreadCount} unread${unreadOnly ? ' · unread filter on' : ''}`}
          metadata={[
            { label: 'Total', value: totalCount, mono: true },
            { label: 'Unread', value: unreadCount, mono: true, signal: unreadCount > 0 },
          ]}
        />
        <MarkAllReadButton hasUnread={unreadCount > 0} />
      </div>

      <nav aria-label="Filter notifications" className="flex flex-wrap gap-1.5 text-sm">
        <Link
          href="/app/inbox"
          aria-current={!unreadOnly ? 'page' : undefined}
          className={`inline-flex min-h-9 items-center rounded-sm border px-2.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong focus-visible:ring-offset-2 focus-visible:ring-offset-bg ${!unreadOnly ? 'border-signal/40 bg-signal-soft text-signal' : 'border-border text-fg-muted hover:bg-surface-2 hover:text-fg'}`}
        >
          All
        </Link>
        <Link
          href="/app/inbox?unread=1"
          aria-current={unreadOnly ? 'page' : undefined}
          className={`inline-flex min-h-9 items-center rounded-sm border px-2.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong focus-visible:ring-offset-2 focus-visible:ring-offset-bg ${unreadOnly ? 'border-signal/40 bg-signal-soft text-signal' : 'border-border text-fg-muted hover:bg-surface-2 hover:text-fg'}`}
        >
          Unread
        </Link>
      </nav>

      {pageRows.length === 0 ? (
        <EmptyAction
          title={unreadOnly ? 'No unread notifications' : 'No notifications yet'}
          body="Notifications appear when objects you own change or agent suggestions need your attention."
          href={unreadOnly ? '/app/inbox' : '/app/objects'}
          action={unreadOnly ? 'Show all notifications' : 'Open objects'}
        />
      ) : (
        <InboxList
          initialRows={pageRows.map((n) => ({
            id: n.id,
            kind: n.kind,
            summary: n.summary,
            entityId: n.entityId,
            agentSuggestionId: n.agentSuggestionId,
            createdAt: n.createdAt.toISOString(),
            readAt: n.readAt?.toISOString() ?? null,
          }))}
          nextOffset={rows.length > INBOX_PAGE_SIZE ? INBOX_PAGE_SIZE : null}
          unreadOnly={unreadOnly}
          matchingCount={matchingCount}
          totalCount={totalCount}
        />
      )}
    </div>
  );
}

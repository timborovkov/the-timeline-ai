import { withTeam } from '@timeline/shared';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { MarkAllReadButton } from '@/components/inbox/mark-all-read-button';
import { NotificationRow } from '@/components/inbox/notification-row';
import { IndexStrip } from '@/components/index-strip';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

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

  const rows = await scope.objects.listNotifications({
    unreadOnly,
    limit: 200,
  });
  const unreadCount = rows.filter((r) => r.readAt === null).length;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <IndexStrip
        srLabel={`Inbox · ${rows.length} notifications · ${unreadCount} unread${unreadOnly ? ' · unread filter on' : ''}`}
        segments={[
          { value: 'INBOX' },
          { label: 'total', value: rows.length },
          { label: 'unread', value: unreadCount, signal: unreadCount > 0 },
        ]}
        trailing={<MarkAllReadButton hasUnread={unreadCount > 0} />}
      />

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
        <div className="py-10 text-center font-mono text-xs uppercase tracking-[0.12em] text-fg-dim">
          {unreadOnly
            ? 'NO UNREAD NOTIFICATIONS'
            : 'NO NOTIFICATIONS YET → CHANGES TO OBJECTS YOU OWN WILL LAND HERE'}
        </div>
      ) : (
        <ul className="border-t border-border">
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
      )}
    </div>
  );
}

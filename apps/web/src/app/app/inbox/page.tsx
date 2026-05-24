import { objects, withTeam } from '@timeline/shared';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { MarkAllReadButton } from '@/components/inbox/mark-all-read-button';
import { NotificationRow } from '@/components/inbox/notification-row';
import { NarrowContainer } from '@/components/narrow-container';
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

  const rows = await objects.listNotifications(db, scope, { unreadOnly, limit: 200 });

  return (
    <NarrowContainer>
      <header className="mb-10 flex items-end justify-between gap-6">
        <div>
          <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Inbox</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Notifications</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Changes to objects you own or are assigned to. Overdue tasks and agent suggestions also
            land here.
          </p>
        </div>
        <MarkAllReadButton hasUnread={rows.some((r) => r.readAt === null)} />
      </header>

      <nav className="mb-6 flex gap-2 text-xs">
        <Link
          href="/app/inbox"
          className={`rounded-full border px-3 py-1 ${!unreadOnly ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border text-muted-foreground'}`}
        >
          All
        </Link>
        <Link
          href="/app/inbox?unread=1"
          className={`rounded-full border px-3 py-1 ${unreadOnly ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border text-muted-foreground'}`}
        >
          Unread
        </Link>
      </nav>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-card/40 px-6 py-16 text-center text-sm text-muted-foreground">
          {unreadOnly ? 'No unread notifications.' : 'No notifications yet.'}
        </div>
      ) : (
        <ul className="space-y-2">
          {rows.map((n) => (
            <NotificationRow
              key={n.id}
              id={n.id}
              kind={n.kind}
              summary={n.summary}
              entityId={n.entityId}
              createdAt={n.createdAt.toISOString()}
              initiallyRead={n.readAt !== null}
            />
          ))}
        </ul>
      )}
    </NarrowContainer>
  );
}

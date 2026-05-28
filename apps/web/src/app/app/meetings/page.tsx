import { users } from '@timeline/db';
import { withTeam } from '@timeline/shared';
import { inArray } from 'drizzle-orm';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { ScheduleMeetingBotForm } from '@/components/meeting-forms';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

export default async function MeetingsPage() {
  const session = await auth();
  if (!session?.user) redirect('/sign-in');
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) redirect('/sign-in');

  const scope = withTeam(db, active.teamId, session.user.id);
  await scope.requireMembership();

  const [list, usedMinutes, settings, defaultRow, members] = await Promise.all([
    scope.meetings.listMeetings({ limit: 50 }),
    scope.meetings.getCurrentMonthMinutes(),
    scope.meetings.getMeetingSettings(),
    scope.timeline.resolveVisibilityDefault('meeting'),
    scope.timeline.listMembers(),
  ]);
  const memberIds = members.map((m) => m.userId);
  const memberUsers =
    memberIds.length > 0
      ? await db
          .select({ id: users.id, name: users.name, email: users.email })
          .from(users)
          .where(inArray(users.id, memberIds))
      : [];
  const memberUserMap = new Map(memberUsers.map((u) => [u.id, u] as const));
  const cap = settings.meetingMinutesCap;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Meeting notetaker</h1>
        <p className="text-sm text-muted-foreground">
          Paste a Google Meet, Microsoft Teams, or Zoom link to invite the silent Timeline notetaker
          to capture the transcript.
        </p>
        <p className="text-xs text-muted-foreground">
          This month: {String(usedMinutes)} minutes
          {cap !== null ? ` / ${String(cap)} cap` : ''}
        </p>
      </header>

      <ScheduleMeetingBotForm
        defaultVisibility={defaultRow.visibility}
        defaultVisibilityUserIds={defaultRow.visibilityUserIds}
        members={members.map((m) => {
          const u = memberUserMap.get(m.userId);
          return { id: m.userId, label: u?.name ?? u?.email ?? m.userId };
        })}
      />

      <section className="space-y-2">
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          Recent
        </h2>
        {list.length === 0 ? (
          <p className="text-sm text-muted-foreground">No meetings yet.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {list.map((m) => (
              <li key={m.id} className="p-3">
                <Link
                  href={`/app/meetings/${m.id}`}
                  className="flex items-center justify-between gap-3"
                >
                  <span className="flex flex-col">
                    <span className="font-medium">{m.title ?? m.meetingUrl.slice(0, 60)}</span>
                    <span className="text-xs text-muted-foreground">
                      {m.platform} · {m.status} · {new Date(m.createdAt).toLocaleString()}
                    </span>
                  </span>
                  <span className="text-xs text-muted-foreground">→</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

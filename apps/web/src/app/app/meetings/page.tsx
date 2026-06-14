import { users } from '@timeline/db';
import { withTeam } from '@timeline/shared/team-scope';
import { inArray } from 'drizzle-orm';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import type { Metadata } from 'next';

import {
  ArchiveSavedMeetingButton,
  EditSavedMeetingForm,
  JoinSavedMeetingButton,
  SavedMeetingForm,
  ScheduleMeetingBotForm,
  SkipScheduledMeetingButton,
} from '@/components/meeting-forms';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

export const metadata: Metadata = {
  title: 'Meetings',
  description: 'Schedule and review meeting notes.',
};

export default async function MeetingsPage({
  searchParams,
}: {
  searchParams?: Promise<{ tab?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect('/sign-in');
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) redirect('/sign-in');

  const scope = withTeam(db, active.teamId, session.user.id);
  await scope.requireMembership();

  const params = (await searchParams) ?? {};
  const tab = params.tab === 'saved' ? 'saved' : 'captures';

  const [list, savedMeetings, usedMinutes, settings, calendarSettings, defaultRow, members] =
    await Promise.all([
      scope.meetings.listMeetings({ limit: 50 }),
      scope.meetings.listSavedMeetings(),
      scope.meetings.getCurrentMonthMinutes(),
      scope.meetings.getMeetingSettings(),
      scope.calendar.getCalendarSettings(),
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
  const memberOptions = members.map((m) => {
    const u = memberUserMap.get(m.userId);
    return { id: m.userId, label: u?.name ?? u?.email ?? m.userId };
  });
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

      <nav className="flex gap-2 border-b">
        <Link
          href="/app/meetings"
          className={`px-3 py-2 text-sm ${tab === 'captures' ? 'border-b-2 border-fg font-medium' : 'text-muted-foreground'}`}
        >
          Captures
        </Link>
        <Link
          href="/app/meetings?tab=saved"
          className={`px-3 py-2 text-sm ${tab === 'saved' ? 'border-b-2 border-fg font-medium' : 'text-muted-foreground'}`}
        >
          Saved
        </Link>
      </nav>

      {tab === 'captures' ? (
        <ScheduleMeetingBotForm
          defaultVisibility={defaultRow.visibility}
          defaultVisibilityUserIds={defaultRow.visibilityUserIds}
          members={memberOptions}
        />
      ) : (
        <SavedMeetingForm
          defaultVisibility={defaultRow.visibility}
          defaultVisibilityUserIds={defaultRow.visibilityUserIds}
          defaultTimezone={calendarSettings.defaultTimezone}
          members={memberOptions}
        />
      )}

      {tab === 'saved' ? (
        <section className="space-y-2">
          <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            Saved meetings
          </h2>
          {savedMeetings.length === 0 ? (
            <p className="text-sm text-muted-foreground">No saved meetings yet.</p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {savedMeetings.map((saved) => (
                <li key={saved.id} className="space-y-2 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <span className="flex flex-col">
                      <span className="font-medium">{saved.title}</span>
                      <span className="text-xs text-muted-foreground">
                        {saved.platform} ·{' '}
                        {saved.aliases.length ? saved.aliases.join(', ') : 'no aliases'} ·{' '}
                        {saved.autoJoinEnabled ? 'auto-join on' : 'manual join'}
                      </span>
                    </span>
                    <span className="flex gap-2">
                      <JoinSavedMeetingButton query={saved.aliases[0] ?? saved.title} />
                      <ArchiveSavedMeetingButton savedMeetingId={saved.id} />
                    </span>
                  </div>
                  {saved.description ? (
                    <p className="text-sm text-muted-foreground">{saved.description}</p>
                  ) : null}
                  <EditSavedMeetingForm
                    saved={saved}
                    defaultTimezone={calendarSettings.defaultTimezone}
                    members={memberOptions}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      <section className="space-y-2">
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          {tab === 'saved' ? 'Scheduled and recent captures' : 'Recent'}
        </h2>
        {list.length === 0 ? (
          <p className="text-sm text-muted-foreground">No meetings yet.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {list.map((m) => (
              <li key={m.id} className="p-3">
                <div className="flex items-center justify-between gap-3">
                  <Link href={`/app/meetings/${m.id}`} className="flex flex-col">
                    <span className="font-medium">{m.title ?? m.meetingUrl.slice(0, 60)}</span>
                    <span className="text-xs text-muted-foreground">
                      {m.platform} · {m.status} ·{' '}
                      {new Date(m.scheduledStartAt ?? m.createdAt).toLocaleString()}
                    </span>
                  </Link>
                  {m.status === 'scheduled' ? (
                    <SkipScheduledMeetingButton meetingId={m.id} />
                  ) : (
                    <span className="text-xs text-muted-foreground">→</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

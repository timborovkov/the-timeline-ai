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
import { PageHeader } from '@/components/page-header';
import { PinOverflowMenu } from '@/components/pins/pin-overflow-menu';
import { SectionHeading } from '@/components/section-heading';
import { StatusBadge } from '@/components/status-badge';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { formatDisplayDateTime } from '@/lib/display-dates';
import { displayMeetingLabel, displayMemberLabel, displaySourceLabel } from '@/lib/display-labels';

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
  const pinState = await scope.pins.isPinnedMany([
    ...list.map((meeting) => ({ kind: 'meeting' as const, key: meeting.id })),
    ...savedMeetings.map((meeting) => ({ kind: 'saved_meeting' as const, key: meeting.id })),
  ]);
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
    return { id: m.userId, label: displayMemberLabel(u) };
  });
  const cap = settings.meetingMinutesCap;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Meetings"
        subtitle="Invite the silent notetaker or manage meeting links for automatic capture."
        metadata={[
          { label: 'This month', value: `${String(usedMinutes)} minutes`, mono: true },
          ...(cap !== null ? [{ label: 'Cap', value: `${String(cap)} minutes`, mono: true }] : []),
        ]}
      />

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
          <SectionHeading>Saved meetings</SectionHeading>
          {savedMeetings.length === 0 ? (
            <p className="text-sm text-muted-foreground">No saved meetings yet.</p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {savedMeetings.map((saved) => (
                <li
                  id={`saved-meeting-${saved.id}`}
                  key={saved.id}
                  className="scroll-mt-24 space-y-2 p-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="flex flex-col">
                      <span className="font-medium">{displayMeetingLabel(saved)}</span>
                      <span className="text-xs text-muted-foreground">
                        {displaySourceLabel(saved.platform)} ·{' '}
                        {saved.aliases.length ? saved.aliases.join(', ') : 'no aliases'} ·{' '}
                        {saved.autoJoinEnabled ? 'auto-join on' : 'manual join'}
                      </span>
                    </span>
                    <span className="flex gap-2">
                      <JoinSavedMeetingButton query={saved.aliases[0] ?? saved.title} />
                      <PinOverflowMenu
                        target={{ kind: 'saved_meeting', key: saved.id }}
                        title={displayMeetingLabel(saved)}
                        initialPinned={pinState[`saved_meeting:${saved.id}`] ?? false}
                      />
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
        <SectionHeading>
          {tab === 'saved' ? 'Scheduled and recent captures' : 'Recent captures'}
        </SectionHeading>
        {list.length === 0 ? (
          <p className="text-sm text-muted-foreground">No meetings yet.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {list.map((m) => (
              <li key={m.id} className="p-3">
                <div className="flex items-center justify-between gap-3">
                  <Link href={`/app/meetings/${m.id}`} className="flex flex-col">
                    <span className="font-medium">{displayMeetingLabel(m)}</span>
                    <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span>{displaySourceLabel(m.platform)}</span>
                      <StatusBadge status={m.status} />
                      <time dateTime={new Date(m.scheduledStartAt ?? m.createdAt).toISOString()}>
                        {formatDisplayDateTime(m.scheduledStartAt ?? m.createdAt, {
                          timezone: calendarSettings.defaultTimezone,
                        })}
                      </time>
                    </span>
                  </Link>
                  <span className="flex items-center gap-1">
                    {m.status === 'scheduled' ? (
                      <SkipScheduledMeetingButton meetingId={m.id} />
                    ) : null}
                    <PinOverflowMenu
                      target={{ kind: 'meeting', key: m.id }}
                      title={displayMeetingLabel(m)}
                      initialPinned={pinState[`meeting:${m.id}`] ?? false}
                    />
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

import { users } from '@timeline/db';
import { withTeam } from '@timeline/shared';
import { inArray } from 'drizzle-orm';
import { redirect } from 'next/navigation';

import type { Metadata } from 'next';

import { ApprovalsClient } from '@/components/approvals/approvals-client';
import { CalendarView } from '@/components/calendar/calendar-view';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { serializeSuggestionBundle } from '@/lib/suggestions';

export const metadata: Metadata = {
  title: 'Calendar',
  description: 'Review team calendar events and suggestions.',
};

interface PageProps {
  searchParams: Promise<{ date?: string; view?: string }>;
}

export default async function CalendarPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user) redirect('/sign-in');
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) redirect('/sign-in');

  const scope = withTeam(db, active.teamId, session.user.id);
  await scope.requireMembership();

  const [params, settings, pendingSuggestions] = await Promise.all([
    searchParams,
    scope.calendar.getCalendarSettings(),
    scope.suggestions.listPendingSuggestions(),
  ]);
  const now = new Date();
  const anchor = params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date) ? params.date : null;
  const anchorDate = anchor ? new Date(`${anchor}T00:00:00.000Z`) : now;
  const view =
    params.view === 'day' || params.view === 'week' || params.view === 'month'
      ? params.view
      : 'month';
  const rangeDays = view === 'day' ? 2 : view === 'week' ? 14 : 70;

  const from = new Date(anchorDate);
  from.setUTCDate(from.getUTCDate() - rangeDays);
  const to = new Date(anchorDate);
  to.setUTCDate(to.getUTCDate() + rangeDays);

  const [events, defaultRow, members] = await Promise.all([
    scope.calendar.listCalendarEvents({ from, to }),
    scope.timeline.resolveVisibilityDefault('calendar'),
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

  const serialized = events.map((e) => ({
    id: e.id,
    title: e.title,
    description: e.description,
    startAt: e.startAt.toISOString(),
    endAt: e.endAt.toISOString(),
    timezone: e.timezone,
    allDay: e.allDay,
    location: e.location,
    redacted: e.redacted,
    visibility: e.visibility,
    visibilityUserIds: e.visibilityUserIds,
  }));
  const calendarSuggestions = pendingSuggestions.flatMap((bundle) => {
    const items = bundle.items.filter((item) => item.targetKind === 'calendar_event');
    return items.length > 0 ? [serializeSuggestionBundle({ ...bundle, items })] : [];
  });

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Calendar</h1>
        <p className="text-sm text-muted-foreground">
          Track deadlines, meetings, and follow-ups. Events appear on the timeline.
        </p>
      </header>

      {calendarSuggestions.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-sm font-medium tracking-tight">Calendar approvals</h2>
          <ApprovalsClient suggestions={calendarSuggestions} />
        </section>
      ) : null}

      <CalendarView
        events={serialized}
        timezone={settings.defaultTimezone}
        defaultVisibility={defaultRow.visibility}
        defaultVisibilityUserIds={defaultRow.visibilityUserIds}
        members={members.map((m) => {
          const u = memberUserMap.get(m.userId);
          return { id: m.userId, label: u?.name ?? u?.email ?? m.userId };
        })}
      />
    </div>
  );
}

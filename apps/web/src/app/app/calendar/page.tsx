import { withTeam } from '@timeline/shared';
import { redirect } from 'next/navigation';

import { CreateCalendarEventForm } from '@/components/calendar/calendar-event-form';
import { CalendarView } from '@/components/calendar/calendar-view';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

interface PageProps {
  searchParams: Promise<{ year?: string; month?: string }>;
}

export default async function CalendarPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user) redirect('/sign-in');
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) redirect('/sign-in');

  const scope = withTeam(db, active.teamId, session.user.id);
  await scope.requireMembership();

  const params = await searchParams;
  const now = new Date();
  const rawYear = params.year ? parseInt(params.year, 10) : NaN;
  const rawMonth = params.month ? parseInt(params.month, 10) : NaN;
  const year = Number.isFinite(rawYear) ? rawYear : now.getFullYear();
  const month =
    Number.isFinite(rawMonth) && rawMonth >= 0 && rawMonth <= 11 ? rawMonth : now.getMonth();

  const from = new Date(Date.UTC(year, month, 1));
  const to = new Date(Date.UTC(year, month + 1, 1));

  const events = await scope.calendar.listCalendarEvents({ from, to });

  const serialized = events.map((e) => ({
    id: e.id,
    title: e.title,
    startAt: e.startAt.toISOString(),
    endAt: e.endAt.toISOString(),
    timezone: e.timezone,
    allDay: e.allDay,
    location: e.location,
    redacted: e.redacted,
    visibility: e.visibility,
  }));

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Calendar</h1>
        <p className="text-sm text-muted-foreground">
          Track deadlines, meetings, and follow-ups. Events appear on the timeline.
        </p>
      </header>

      <CreateCalendarEventForm />
      <CalendarView events={serialized} />
    </div>
  );
}

import { Temporal } from '@js-temporal/polyfill';
import { teamCalendarSubscriptions, users } from '@timeline/db';
import { withTeam } from '@timeline/shared/team-scope';
import { and, eq, inArray } from 'drizzle-orm';
import { redirect } from 'next/navigation';

import type { CalendarEvent } from '@/components/calendar/calendar-overlay';
import type { Metadata } from 'next';

import { ApprovalsClient } from '@/components/approvals/approvals-client';
import { CalendarSubscriptionPanel } from '@/components/calendar/calendar-subscription-panel';
import { CalendarView } from '@/components/calendar/calendar-view';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { isActionableSuggestionStatus } from '@/lib/suggestion-status';
import { serializeSuggestionBundle } from '@/lib/suggestions';

export const metadata: Metadata = {
  title: 'Calendar',
  description: 'Review team calendar events and suggestions.',
};

interface PageProps {
  searchParams: Promise<{
    date?: string;
    view?: string;
    eventScope?: string;
    eventQ?: string;
    eventPage?: string;
  }>;
}

function calendarShowAs(showAs: string): CalendarEvent['showAs'] {
  return showAs === 'free' || showAs === 'tentative' ? showAs : 'busy';
}

function serializeCalendarEvent(e: {
  id: string;
  title: string;
  description: string | null;
  startAt: Date;
  endAt: Date;
  timezone: string;
  allDay: boolean;
  location: string | null;
  showAs: string;
  rrule: string | null;
  recurringParentId: string | null;
  originalStartAt: Date | null;
  isException: boolean;
  metadata: Record<string, unknown>;
  redacted: boolean;
  visibility: CalendarEvent['visibility'];
  visibilityUserIds: string[] | null;
}): CalendarEvent {
  return {
    id: e.id,
    title: e.title,
    description: e.description,
    startAt: e.startAt.toISOString(),
    endAt: e.endAt.toISOString(),
    timezone: e.timezone,
    allDay: e.allDay,
    location: e.location,
    showAs: calendarShowAs(e.showAs),
    rrule: e.rrule,
    recurringParentId: e.recurringParentId,
    originalStartAt: e.originalStartAt?.toISOString() ?? null,
    isException: e.isException,
    metadata: e.metadata,
    redacted: e.redacted,
    visibility: e.visibility,
    visibilityUserIds: e.visibilityUserIds,
  };
}

function startOfToday(timezone: string): Date {
  const date = Temporal.Now.zonedDateTimeISO(timezone).toPlainDate();
  return new Date(date.toZonedDateTime({ timeZone: timezone }).toInstant().epochMilliseconds);
}

const EVENT_LIST_PAGE_SIZE = 12;
const EVENT_LIST_RANGE_DAYS = 730;

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
  const eventScope =
    params.eventScope === 'past' || params.eventScope === 'all' ? params.eventScope : 'future';
  const eventQuery = params.eventQ?.trim() ?? '';
  const parsedEventPage = Number.parseInt(params.eventPage ?? '1', 10);
  const eventPage = Number.isFinite(parsedEventPage) && parsedEventPage > 0 ? parsedEventPage : 1;
  const rangeDays = view === 'day' ? 2 : view === 'week' ? 14 : 70;

  const from = new Date(anchorDate);
  from.setUTCDate(from.getUTCDate() - rangeDays);
  const to = new Date(anchorDate);
  to.setUTCDate(to.getUTCDate() + rangeDays);
  const eventListToday = startOfToday(settings.defaultTimezone);
  const eventListFrom = new Date(eventListToday);
  eventListFrom.setUTCDate(eventListFrom.getUTCDate() - EVENT_LIST_RANGE_DAYS);
  const eventListTo = new Date(eventListToday);
  eventListTo.setUTCDate(eventListTo.getUTCDate() + EVENT_LIST_RANGE_DAYS);

  const eventListRange =
    eventScope === 'future'
      ? { from: eventListToday, to: eventListTo, order: 'asc' as const }
      : eventScope === 'past'
        ? { from: eventListFrom, to: eventListToday, order: 'desc' as const }
        : { from: eventListFrom, to: eventListTo, order: 'asc' as const };

  const [events, eventList, defaultRow, members, subscriptionRows] = await Promise.all([
    scope.calendar.listCalendarEvents({ from, to }),
    scope.calendar.listCalendarEventPage({
      ...eventListRange,
      search: eventQuery,
      limit: EVENT_LIST_PAGE_SIZE,
      offset: (eventPage - 1) * EVENT_LIST_PAGE_SIZE,
    }),
    scope.timeline.resolveVisibilityDefault('calendar'),
    scope.timeline.listMembers(),
    db
      .select({
        tokenPrefix: teamCalendarSubscriptions.tokenPrefix,
        lastUsedAt: teamCalendarSubscriptions.lastUsedAt,
        createdAt: teamCalendarSubscriptions.createdAt,
        updatedAt: teamCalendarSubscriptions.updatedAt,
      })
      .from(teamCalendarSubscriptions)
      .where(
        and(
          eq(teamCalendarSubscriptions.teamId, active.teamId),
          eq(teamCalendarSubscriptions.userId, session.user.id),
        ),
      )
      .limit(1),
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

  const serialized = events.map(serializeCalendarEvent);
  const serializedEventList = eventList.events.map(serializeCalendarEvent);
  const calendarSuggestions = pendingSuggestions.flatMap((bundle) => {
    const items = bundle.items.filter(
      (item) => item.targetKind === 'calendar_event' && isActionableSuggestionStatus(item.status),
    );
    return items.length > 0 ? [serializeSuggestionBundle({ ...bundle, items })] : [];
  });
  const calendarSuggestionItemCount = calendarSuggestions.reduce(
    (sum, suggestion) => sum + suggestion.items.length,
    0,
  );

  return (
    <div className="mx-auto max-w-[92rem] space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Calendar</h1>
        <p className="text-sm text-muted-foreground">
          Track deadlines, meetings, and follow-ups. Events appear on the timeline.
        </p>
      </header>

      <CalendarView
        events={serialized}
        eventListEvents={serializedEventList}
        eventListTotal={eventList.total}
        eventListPage={eventPage - 1}
        eventListQuery={eventQuery}
        eventListScope={eventScope}
        timezone={settings.defaultTimezone}
        defaultVisibility={defaultRow.visibility}
        defaultVisibilityUserIds={defaultRow.visibilityUserIds}
        members={members.map((m) => {
          const u = memberUserMap.get(m.userId);
          return { id: m.userId, label: u?.name ?? u?.email ?? m.userId };
        })}
      />

      <CalendarSubscriptionPanel
        subscription={
          subscriptionRows[0]
            ? {
                prefix: subscriptionRows[0].tokenPrefix,
                lastUsedAt: subscriptionRows[0].lastUsedAt?.toISOString() ?? null,
                createdAt: subscriptionRows[0].createdAt.toISOString(),
                updatedAt: subscriptionRows[0].updatedAt.toISOString(),
              }
            : null
        }
      />

      {calendarSuggestions.length > 0 ? (
        <details className="border-y border-border py-4">
          <summary className="cursor-pointer list-none">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-mono text-[11px] uppercase tracking-[0.14em] text-fg">
                  Calendar approvals
                </h2>
                <p className="mt-1 text-sm text-fg-muted">
                  {calendarSuggestionItemCount} pending calendar proposal
                  {calendarSuggestionItemCount === 1 ? '' : 's'}
                </p>
              </div>
              <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-dim">
                Open
              </span>
            </div>
          </summary>
          <div className="mt-4">
            <ApprovalsClient suggestions={calendarSuggestions} allowBulkAccept={false} />
          </div>
        </details>
      ) : null}
    </div>
  );
}

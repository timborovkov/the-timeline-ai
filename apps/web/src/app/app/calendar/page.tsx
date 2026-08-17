import { teamCalendarSubscriptions, users } from '@timeline/db';
import { getEnv } from '@timeline/shared/env';
import { withTeam } from '@timeline/shared/team-scope';
import { and, eq, inArray } from 'drizzle-orm';
import { redirect } from 'next/navigation';

import type { Metadata } from 'next';

import { ApprovalsClient } from '@/components/approvals/approvals-client';
import { CalendarSubscriptionPanel } from '@/components/calendar/calendar-subscription-panel';
import { CalendarView } from '@/components/calendar/calendar-view';
import { PageHeader } from '@/components/page-header';
import { WorkSubnav } from '@/components/work-subnav';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { calendarEventListWindow } from '@/lib/calendar-event-list-range';
import { CALENDAR_EVENT_LIST_PAGE_SIZE } from '@/lib/collection-page-sizes';
import { db } from '@/lib/db';
import { displayMemberLabel } from '@/lib/display-labels';
import {
  groupLinkedObjectsByEvent,
  serializeCalendarEvent,
} from '@/lib/serialize-calendar-event';
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
    event?: string;
  }>;
}

const EVENT_LIST_RANGE_DAYS = 730;

export default async function CalendarPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user) redirect('/sign-in');
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) redirect('/sign-in');

  const scope = withTeam(db, active.teamId, session.user.id);

  const membership = scope.requireMembership();
  const [params, settings, pendingSuggestions] = await Promise.all([
    searchParams,
    membership.then(() => scope.calendar.getCalendarSettings()),
    membership.then(async () => {
      const pendingSuggestionRows = await scope.suggestions.listPendingSuggestions();
      return await scope.suggestions.withCalendarResolutionHints(pendingSuggestionRows);
    }),
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
  const rangeDays = view === 'day' ? 2 : view === 'week' ? 14 : 70;

  const from = new Date(anchorDate);
  from.setUTCDate(from.getUTCDate() - rangeDays);
  const to = new Date(anchorDate);
  to.setUTCDate(to.getUTCDate() + rangeDays);
  const {
    today: eventListToday,
    from: eventListFrom,
    to: eventListTo,
  } = calendarEventListWindow(settings.defaultTimezone, EVENT_LIST_RANGE_DAYS);

  const eventListRange =
    eventScope === 'future'
      ? { from: eventListToday, to: eventListTo, startFrom: eventListToday, order: 'asc' as const }
      : eventScope === 'past'
        ? {
            from: eventListFrom,
            to: eventListToday,
            startTo: eventListToday,
            order: 'desc' as const,
          }
        : { from: eventListFrom, to: eventListTo, order: 'asc' as const };

  const eventListInput = {
    ...eventListRange,
    search: eventQuery,
    limit: CALENDAR_EVENT_LIST_PAGE_SIZE + 1,
  };

  const [events, initialEventList, defaultRow, members, subscriptionRows] = await Promise.all([
    scope.calendar.listCalendarEvents({ from, to }),
    scope.calendar.listCalendarEventPage({
      ...eventListInput,
      offset: 0,
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
  const eventList = {
    ...initialEventList,
    events: initialEventList.events.slice(0, CALENDAR_EVENT_LIST_PAGE_SIZE),
  };
  const eventListNextOffset =
    initialEventList.events.length > CALENDAR_EVENT_LIST_PAGE_SIZE
      ? CALENDAR_EVENT_LIST_PAGE_SIZE
      : null;
  const allEvents = [...events, ...eventList.events];
  const linkedRows = await scope.calendar.listLinkedObjectsForEvents(
    allEvents.map((event) => event.id),
  );
  const linkedByEventId = groupLinkedObjectsByEvent(linkedRows);
  const pinState = await scope.pins.isPinnedMany(
    allEvents.flatMap((event) =>
      event.redacted ? [] : [{ kind: 'calendar_event' as const, key: event.id }],
    ),
  );
  const memberIds = members.map((m) => m.userId);
  const memberUsers =
    memberIds.length > 0
      ? await db
          .select({ id: users.id, name: users.name, email: users.email })
          .from(users)
          .where(inArray(users.id, memberIds))
      : [];
  const memberUserMap = new Map(memberUsers.map((u) => [u.id, u] as const));

  const serialized = events.map((event) =>
    serializeCalendarEvent(
      event,
      pinState[`calendar_event:${event.id}`] ?? false,
      linkedByEventId.get(event.id) ?? [],
    ),
  );
  const serializedEventList = eventList.events.map((event) =>
    serializeCalendarEvent(
      event,
      pinState[`calendar_event:${event.id}`] ?? false,
      linkedByEventId.get(event.id) ?? [],
    ),
  );
  const calendarSuggestions = pendingSuggestions.flatMap((bundle) => {
    const items = bundle.items.filter(
      (item) => item.targetKind === 'calendar_event' && item.status === 'pending',
    );
    return items.length > 0 ? [serializeSuggestionBundle({ ...bundle, items })] : [];
  });
  return (
    <div className="space-y-6">
      <PageHeader
        variant="collection"
        title="Calendar"
        subtitle="Track deadlines, meetings, and follow-ups."
      />
      <WorkSubnav current="/app/calendar" />

      <CalendarView
        events={serialized}
        eventListEvents={serializedEventList}
        eventListTotal={eventList.total}
        eventListNextOffset={eventListNextOffset}
        eventListQuery={eventQuery}
        eventListScope={eventScope}
        timezone={settings.defaultTimezone}
        defaultVisibility={defaultRow.visibility}
        defaultVisibilityUserIds={defaultRow.visibilityUserIds}
        members={members.map((m) => {
          const u = memberUserMap.get(m.userId);
          return { id: m.userId, label: displayMemberLabel(u) };
        })}
        focusEventId={params.event ?? null}
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
        <ApprovalsClient
          suggestions={calendarSuggestions}
          allowBulkAccept={false}
          taskCategoriesEnabled={getEnv().TASK_CATEGORY_UI_ENABLED}
          timezone={settings.defaultTimezone}
          folded={{
            title: 'Calendar approvals',
            summary: {
              singular: 'pending calendar proposal',
              plural: 'pending calendar proposals',
            },
            className: 'border-y border-border py-4',
          }}
        />
      ) : null}
    </div>
  );
}

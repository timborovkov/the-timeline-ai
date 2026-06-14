import { calendarEvents, teamCalendarSubscriptions, teamMembers, teams } from '@timeline/db';
import {
  calendarSubscriptionHashesMatch,
  hashCalendarSubscriptionToken,
  isCalendarSubscriptionToken,
} from '@timeline/shared/calendar';
import { and, asc, eq, gte, isNull, lt, sql } from 'drizzle-orm';
import ical, {
  ICalCalendarMethod,
  ICalEventBusyStatus,
  ICalEventClass,
  ICalEventStatus,
} from 'ical-generator';
import { after } from 'next/server';

import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ token: string }>;
}

function cleanToken(raw: string): string {
  return raw.endsWith('.ics') ? raw.slice(0, -4) : raw;
}

function rollingWindow(now = new Date()): { from: Date; to: Date } {
  const from = new Date(now);
  from.setUTCFullYear(from.getUTCFullYear() - 1);
  const to = new Date(now);
  to.setUTCFullYear(to.getUTCFullYear() + 2);
  return { from, to };
}

function eventUrl(origin: string, startAt: Date): string {
  return new URL(
    `/app/calendar?view=day&date=${startAt.toISOString().slice(0, 10)}`,
    origin,
  ).toString();
}

function eventStatus(showAs: string, redacted: boolean): ICalEventStatus {
  if (!redacted && showAs === 'tentative') return ICalEventStatus.TENTATIVE;
  return ICalEventStatus.CONFIRMED;
}

function eventBusyStatus(showAs: string, redacted: boolean): ICalEventBusyStatus {
  if (redacted) return ICalEventBusyStatus.BUSY;
  if (showAs === 'free') return ICalEventBusyStatus.FREE;
  if (showAs === 'tentative') return ICalEventBusyStatus.TENTATIVE;
  return ICalEventBusyStatus.BUSY;
}

function calendarFeedVisibility(userId: string) {
  return sql`(
    ${calendarEvents.visibility} = 'team'
    OR ${calendarEvents.visibility} = 'private'
    OR ${calendarEvents.createdByUserId} = ${userId}::uuid
    OR (${calendarEvents.visibility} = 'specific_users' AND ${userId}::uuid = ANY(${calendarEvents.visibilityUserIds}))
  )`;
}

// react-doctor-disable-next-line react-doctor/nextjs-no-side-effect-in-get-handler -- Calendar apps poll feeds with GET and no cookies; the token is the credential, and this only records post-response last-used metadata.
export async function GET(req: Request, context: RouteContext): Promise<Response> {
  const { token: rawToken } = await context.params;
  const token = cleanToken(rawToken);
  if (!isCalendarSubscriptionToken(token)) return new Response('Not found', { status: 404 });

  const hash = hashCalendarSubscriptionToken(token);
  const rows = await db
    .select({
      subscriptionId: teamCalendarSubscriptions.id,
      teamId: teamCalendarSubscriptions.teamId,
      userId: teamCalendarSubscriptions.userId,
      tokenHash: teamCalendarSubscriptions.tokenHash,
      teamName: teams.name,
    })
    .from(teamCalendarSubscriptions)
    .innerJoin(teams, eq(teams.id, teamCalendarSubscriptions.teamId))
    .innerJoin(
      teamMembers,
      and(
        eq(teamMembers.teamId, teamCalendarSubscriptions.teamId),
        eq(teamMembers.userId, teamCalendarSubscriptions.userId),
        isNull(teamMembers.removedAt),
      ),
    )
    .where(eq(teamCalendarSubscriptions.tokenHash, hash))
    .limit(1);
  const subscription = rows[0];
  if (!subscription || !calendarSubscriptionHashesMatch(subscription.tokenHash, hash)) {
    return new Response('Not found', { status: 404 });
  }
  after(() => {
    const usedAt = new Date();
    void db
      .update(teamCalendarSubscriptions)
      .set({ lastUsedAt: usedAt, updatedAt: usedAt })
      .where(eq(teamCalendarSubscriptions.id, subscription.subscriptionId))
      .catch(() => undefined);
  });

  const now = new Date();
  const { from, to } = rollingWindow(now);
  const events = await db
    .select()
    .from(calendarEvents)
    .where(
      and(
        eq(calendarEvents.teamId, subscription.teamId),
        calendarFeedVisibility(subscription.userId),
        isNull(calendarEvents.deletedAt),
        gte(calendarEvents.endAt, from),
        lt(calendarEvents.startAt, to),
      ),
    )
    .orderBy(asc(calendarEvents.startAt));

  const origin = new URL(req.url).origin;
  const feedUrl = new URL(req.url).toString();
  const calendar = ical({
    name: `Timeline · ${subscription.teamName}`,
    description: 'Read-only Timeline team calendar subscription.',
    prodId: { company: 'Timeline', product: 'Timeline Calendar', language: 'EN' },
    method: ICalCalendarMethod.PUBLISH,
    ttl: 60 * 60 * 24,
    url: feedUrl,
    source: feedUrl,
  });

  for (const event of events) {
    const redacted =
      event.visibility === 'private' && event.createdByUserId !== subscription.userId;
    calendar.createEvent({
      id: event.id,
      start: event.startAt,
      end: event.endAt,
      timezone: event.timezone,
      allDay: event.allDay,
      summary: redacted ? 'Busy' : event.title,
      description: redacted ? null : event.description,
      location: redacted ? null : event.location,
      url: eventUrl(origin, event.startAt),
      status: eventStatus(event.showAs, redacted),
      class: event.visibility === 'team' ? ICalEventClass.PUBLIC : ICalEventClass.PRIVATE,
      busystatus: eventBusyStatus(event.showAs, redacted),
      created: event.createdAt,
      lastModified: event.updatedAt,
    });
  }

  return new Response(calendar.toString(), {
    status: 200,
    headers: {
      'content-type': 'text/calendar; charset=utf-8',
      'cache-control': 'private, no-store',
    },
  });
}

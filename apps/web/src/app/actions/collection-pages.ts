'use server';

import { pageWindow } from '@timeline/shared/pagination';
import { z } from 'zod';

import type { CalendarEvent } from '@/components/calendar/calendar-overlay';

import { resolveScope } from '@/lib/action-scope';
import { calendarEventListWindow } from '@/lib/calendar-event-list-range';
import {
  CALENDAR_EVENT_LIST_PAGE_SIZE,
  CHAT_SESSIONS_PAGE_SIZE,
  INBOX_PAGE_SIZE,
  MEETINGS_PAGE_SIZE,
  SUGGESTIONS_PAGE_SIZE,
} from '@/lib/collection-page-sizes';
import { displayObjectLabel } from '@/lib/display-labels';
import { runSentryServerAction } from '@/lib/sentry-action';
import { groupLinkedObjectsByEvent, serializeCalendarEvent } from '@/lib/serialize-calendar-event';
import { serializeSuggestionBundle } from '@/lib/suggestions';

const cursorSchema = z.string().max(500).nullable().optional();

export async function loadMeetingsPageAction(input: unknown): Promise<{
  meetings: {
    id: string;
    title: string | null;
    platform: string;
    status: string;
    createdAt: string;
    scheduledStartAt: string | null;
    pinned: boolean;
  }[];
  nextCursor: string | null;
  error?: string;
}> {
  return runSentryServerAction('load_meetings_page', async () => {
    const parsed = z.object({ cursor: cursorSchema }).safeParse(input);
    if (!parsed.success) return { meetings: [], nextCursor: null, error: 'Invalid cursor' };
    const r = await resolveScope();
    if (!r.ok) return { meetings: [], nextCursor: null, error: r.error };
    const rows = await r.scope.meetings.listMeetings({
      limit: MEETINGS_PAGE_SIZE + 1,
      cursor: parsed.data.cursor ?? null,
    });
    const page = pageWindow(rows, MEETINGS_PAGE_SIZE, (row) => ({
      at: row.createdAt.toISOString(),
      id: row.id,
    }));
    const pinState = await r.scope.pins.isPinnedMany(
      page.items.map((meeting) => ({ kind: 'meeting' as const, key: meeting.id })),
    );
    return {
      meetings: page.items.map((meeting) => ({
        id: meeting.id,
        title: meeting.title,
        platform: meeting.platform,
        status: meeting.status,
        createdAt: meeting.createdAt.toISOString(),
        scheduledStartAt: meeting.scheduledStartAt?.toISOString() ?? null,
        pinned: pinState[`meeting:${meeting.id}`] ?? false,
      })),
      nextCursor: page.nextCursor,
    };
  });
}

export async function loadSuggestionsPageAction(input: unknown): Promise<{
  suggestions: ReturnType<typeof serializeSuggestionBundle>[];
  nextCursor: string | null;
  error?: string;
}> {
  return runSentryServerAction('load_suggestions_page', async () => {
    const parsed = z
      .object({
        cursor: cursorSchema,
        status: z.enum(['pending', 'failed', 'resolved', 'all']).default('pending'),
      })
      .safeParse(input);
    if (!parsed.success) return { suggestions: [], nextCursor: null, error: 'Invalid cursor' };
    const r = await resolveScope();
    if (!r.ok) return { suggestions: [], nextCursor: null, error: r.error };
    const rows = await r.scope.suggestions.withCalendarResolutionHints(
      await r.scope.suggestions.listSuggestions({
        status: parsed.data.status,
        limit: SUGGESTIONS_PAGE_SIZE + 1,
        cursor: parsed.data.cursor ?? null,
      }),
    );
    const page = pageWindow(rows, SUGGESTIONS_PAGE_SIZE, (row) => ({
      at: row.createdAt.toISOString(),
      id: row.id,
    }));
    return {
      suggestions: page.items.map((bundle) => serializeSuggestionBundle(bundle)),
      nextCursor: page.nextCursor,
    };
  });
}

export async function loadChatSessionsPageAction(input: unknown): Promise<{
  sessions: {
    id: string;
    surface: string;
    title: string | null;
    pinnedEntityId: string | null;
    pinnedEntityName: string | null;
    updatedAt: string;
  }[];
  nextCursor: string | null;
  error?: string;
}> {
  return runSentryServerAction('load_chat_sessions_page', async () => {
    const parsed = z.object({ cursor: cursorSchema }).safeParse(input);
    if (!parsed.success) return { sessions: [], nextCursor: null, error: 'Invalid cursor' };
    const r = await resolveScope();
    if (!r.ok) return { sessions: [], nextCursor: null, error: r.error };
    const rows = await r.scope.objects.listChatSessions({
      limit: CHAT_SESSIONS_PAGE_SIZE + 1,
      cursor: parsed.data.cursor ?? null,
    });
    const page = pageWindow(rows, CHAT_SESSIONS_PAGE_SIZE, (row) => ({
      at: row.updatedAt.toISOString(),
      id: row.id,
    }));
    const pinnedIds = page.items
      .map((session) => session.pinnedEntityId)
      .filter((id): id is string => Boolean(id));
    const names = new Map<string, string>();
    if (pinnedIds.length > 0) {
      const objects = await r.scope.objects.listObjects({
        id: pinnedIds,
        archived: false,
        limit: pinnedIds.length,
      });
      for (const object of objects) names.set(object.id, displayObjectLabel(object));
    }
    return {
      sessions: page.items.map((session) => ({
        id: session.id,
        surface: session.surface,
        title: session.title,
        pinnedEntityId: session.pinnedEntityId,
        pinnedEntityName: session.pinnedEntityId
          ? (names.get(session.pinnedEntityId) ?? null)
          : null,
        updatedAt: session.updatedAt.toISOString(),
      })),
      nextCursor: page.nextCursor,
    };
  });
}

export async function loadNotificationsPageAction(input: unknown): Promise<{
  rows: {
    id: string;
    kind: string;
    summary: string;
    entityId: string | null;
    agentSuggestionId: string | null;
    createdAt: string;
    readAt: string | null;
  }[];
  nextOffset: number | null;
  error?: string;
}> {
  return runSentryServerAction('load_notifications_page', async () => {
    const parsed = z
      .object({
        offset: z.number().int().min(0).max(100_000).default(0),
        unreadOnly: z.boolean().default(false),
      })
      .safeParse(input);
    if (!parsed.success) return { rows: [], nextOffset: null, error: 'Invalid page' };
    const r = await resolveScope();
    if (!r.ok) return { rows: [], nextOffset: null, error: r.error };
    const rows = await r.scope.objects.listNotifications({
      unreadOnly: parsed.data.unreadOnly,
      limit: INBOX_PAGE_SIZE + 1,
      offset: parsed.data.offset,
    });
    const pageRows = rows.slice(0, INBOX_PAGE_SIZE);
    return {
      rows: pageRows.map((row) => ({
        id: row.id,
        kind: row.kind,
        summary: row.summary,
        entityId: row.entityId,
        agentSuggestionId: row.agentSuggestionId,
        createdAt: row.createdAt.toISOString(),
        readAt: row.readAt?.toISOString() ?? null,
      })),
      nextOffset: rows.length > INBOX_PAGE_SIZE ? parsed.data.offset + INBOX_PAGE_SIZE : null,
    };
  });
}

export async function loadCalendarEventListPageAction(input: unknown): Promise<{
  events: CalendarEvent[];
  nextOffset: number | null;
  error?: string;
}> {
  return runSentryServerAction('load_calendar_event_list_page', async () => {
    const parsed = z
      .object({
        offset: z.number().int().min(0).max(100_000).default(0),
        search: z.string().max(200).optional(),
        scope: z.enum(['future', 'past', 'all']).default('future'),
      })
      .safeParse(input);
    if (!parsed.success) return { events: [], nextOffset: null, error: 'Invalid page' };
    const r = await resolveScope();
    if (!r.ok) return { events: [], nextOffset: null, error: r.error };
    const settings = await r.scope.calendar.getCalendarSettings();
    const window = calendarEventListWindow(settings.defaultTimezone, 730);
    const range =
      parsed.data.scope === 'future'
        ? {
            from: window.today,
            to: window.to,
            startFrom: window.today,
            order: 'asc' as const,
          }
        : parsed.data.scope === 'past'
          ? {
              from: window.from,
              to: window.today,
              startTo: window.today,
              order: 'desc' as const,
            }
          : { from: window.from, to: window.to, order: 'asc' as const };
    const page = await r.scope.calendar.listCalendarEventPage({
      ...range,
      search: parsed.data.search,
      limit: CALENDAR_EVENT_LIST_PAGE_SIZE + 1,
      offset: parsed.data.offset,
    });
    const items = page.events.slice(0, CALENDAR_EVENT_LIST_PAGE_SIZE);
    const linkedRows = await r.scope.calendar.listLinkedObjectsForEvents(
      items.map((event) => event.id),
    );
    const linkedByEventId = groupLinkedObjectsByEvent(linkedRows);
    const pinState = await r.scope.pins.isPinnedMany(
      items.flatMap((event) =>
        event.redacted ? [] : [{ kind: 'calendar_event' as const, key: event.id }],
      ),
    );
    return {
      events: items.map((event) =>
        serializeCalendarEvent(
          event,
          pinState[`calendar_event:${event.id}`] ?? false,
          linkedByEventId.get(event.id) ?? [],
        ),
      ),
      nextOffset:
        page.events.length > CALENDAR_EVENT_LIST_PAGE_SIZE
          ? parsed.data.offset + CALENDAR_EVENT_LIST_PAGE_SIZE
          : null,
    };
  });
}

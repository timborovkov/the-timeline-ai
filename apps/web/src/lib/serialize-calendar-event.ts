import type { CalendarEvent, CalendarLinkedObject } from '@/components/calendar/calendar-overlay';
import type { CalendarLinkedObjectRow } from '@timeline/shared/calendar';

function calendarShowAs(showAs: string): CalendarEvent['showAs'] {
  return showAs === 'free' || showAs === 'tentative' ? showAs : 'busy';
}

const EMPTY_LINKED_OBJECTS: CalendarLinkedObject[] = [];

export function groupLinkedObjectsByEvent(
  rows: CalendarLinkedObjectRow[],
): Map<string, CalendarLinkedObject[]> {
  const grouped = new Map<string, CalendarLinkedObject[]>();
  for (const row of rows) {
    const current = grouped.get(row.calendarEventId) ?? [];
    current.push({
      id: row.id,
      title: row.title,
      type: row.type,
      relationshipType: row.relationshipType,
    });
    grouped.set(row.calendarEventId, current);
  }
  return grouped;
}

export function serializeCalendarEvent(
  event: {
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
  },
  pinned: boolean,
  linkedObjects: CalendarLinkedObject[] = EMPTY_LINKED_OBJECTS,
): CalendarEvent {
  return {
    id: event.id,
    title: event.title,
    description: event.description,
    startAt: event.startAt.toISOString(),
    endAt: event.endAt.toISOString(),
    timezone: event.timezone,
    allDay: event.allDay,
    location: event.location,
    showAs: calendarShowAs(event.showAs),
    rrule: event.rrule,
    recurringParentId: event.recurringParentId,
    originalStartAt: event.originalStartAt?.toISOString() ?? null,
    isException: event.isException,
    metadata: event.metadata,
    redacted: event.redacted,
    visibility: event.visibility,
    visibilityUserIds: event.visibilityUserIds,
    pinned,
    linkedObjects: event.redacted ? [] : linkedObjects,
  };
}

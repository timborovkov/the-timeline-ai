export interface CalendarLinkedObject {
  id: string;
  title: string;
  type: string;
  relationshipType: string;
}

export interface CalendarEvent {
  id: string;
  title: string;
  description: string | null;
  startAt: string;
  endAt: string;
  timezone: string;
  allDay: boolean;
  location: string | null;
  showAs: 'busy' | 'free' | 'tentative';
  rrule: string | null;
  recurringParentId: string | null;
  originalStartAt: string | null;
  isException: boolean;
  metadata: Record<string, unknown>;
  redacted: boolean;
  visibility: string;
  visibilityUserIds: string[] | null;
  pinned: boolean;
  linkedObjects: CalendarLinkedObject[];
}

export interface CalendarOverlayState {
  upserts: Record<string, CalendarEvent>;
  removedIds: string[];
}

export type CalendarOverlayAction =
  | { type: 'upsert'; event: CalendarEvent }
  | { type: 'replace-id'; previousId: string; event: CalendarEvent }
  | { type: 'remove'; id: string }
  | { type: 'restore'; event: CalendarEvent }
  | { type: 'discard'; id: string }
  | {
      type: 'reconcile-server-events';
      currentIds: string[];
      previousIds?: string[];
      deletedIds?: string[];
    };

export const EMPTY_CALENDAR_OVERLAY: CalendarOverlayState = { upserts: {}, removedIds: [] };

export function calendarOverlayReducer(
  state: CalendarOverlayState,
  action: CalendarOverlayAction,
): CalendarOverlayState {
  if (action.type === 'upsert') {
    return {
      upserts: { ...state.upserts, [action.event.id]: action.event },
      removedIds: state.removedIds.filter((id) => id !== action.event.id),
    };
  }
  if (action.type === 'replace-id') {
    const { [action.previousId]: _discarded, ...rest } = state.upserts;
    return {
      upserts: { ...rest, [action.event.id]: action.event },
      removedIds: state.removedIds.filter(
        (id) => id !== action.previousId && id !== action.event.id,
      ),
    };
  }
  if (action.type === 'remove') {
    const { [action.id]: _discarded, ...rest } = state.upserts;
    return {
      upserts: rest,
      removedIds: state.removedIds.includes(action.id)
        ? state.removedIds
        : [...state.removedIds, action.id],
    };
  }
  if (action.type === 'restore') {
    return {
      upserts: { ...state.upserts, [action.event.id]: action.event },
      removedIds: state.removedIds.filter((id) => id !== action.event.id),
    };
  }
  if (action.type === 'reconcile-server-events') {
    const currentIds = new Set(action.currentIds);
    const deletedIds = new Set(
      action.deletedIds ?? action.previousIds?.filter((id) => !currentIds.has(id)) ?? [],
    );
    const upserts = Object.fromEntries(
      Object.entries(state.upserts).filter(([id]) => !currentIds.has(id) && !deletedIds.has(id)),
    );
    return {
      upserts,
      removedIds: state.removedIds.filter((id) => !deletedIds.has(id)),
    };
  }
  const { [action.id]: _discarded, ...rest } = state.upserts;
  return { ...state, upserts: rest };
}

export function mergeCalendarEvents(
  events: CalendarEvent[],
  overlay: CalendarOverlayState,
): CalendarEvent[] {
  const removed = new Set(overlay.removedIds);
  const merged = new Map<string, CalendarEvent>();
  for (const event of events) {
    if (!removed.has(event.id)) merged.set(event.id, event);
  }
  for (const event of Object.values(overlay.upserts)) {
    if (!removed.has(event.id)) merged.set(event.id, event);
  }
  return Array.from(merged.values());
}

export function applyCalendarPageOverlay(
  events: CalendarEvent[],
  overlay: CalendarOverlayState,
): CalendarEvent[] {
  const removed = new Set(overlay.removedIds);
  const visibleEvents: CalendarEvent[] = [];
  for (const event of events) {
    if (!removed.has(event.id)) visibleEvents.push(overlay.upserts[event.id] ?? event);
  }
  return visibleEvents;
}

export function calendarEventsSignature(events: CalendarEvent[]): string {
  return events
    .map((event) =>
      [
        event.id,
        event.title,
        event.description ?? '',
        event.startAt,
        event.endAt,
        event.timezone,
        String(event.allDay),
        event.location ?? '',
        event.showAs,
        event.rrule ?? '',
        event.recurringParentId ?? '',
        event.originalStartAt ?? '',
        String(event.isException),
        JSON.stringify(event.metadata),
        String(event.redacted),
        event.visibility,
        event.visibilityUserIds?.join(',') ?? '',
        (event.linkedObjects ?? [])
          .map((object) => `${object.id}:${object.relationshipType}:${object.title}`)
          .join(','),
      ].join('\u001f'),
    )
    .sort()
    .join('\u001e');
}

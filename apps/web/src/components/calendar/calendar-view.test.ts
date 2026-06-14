import { describe, expect, it } from 'vitest';

import type { CalendarEvent } from '@/components/calendar/calendar-overlay';

import { calendarOverlayReducer } from '@/components/calendar/calendar-overlay';

function event(id: string, title = id): CalendarEvent {
  return {
    id,
    title,
    description: null,
    startAt: '2026-06-03T09:00:00Z',
    endAt: '2026-06-03T10:00:00Z',
    timezone: 'UTC',
    allDay: false,
    location: null,
    showAs: 'busy',
    rrule: null,
    recurringParentId: null,
    originalStartAt: null,
    isException: false,
    metadata: {},
    redacted: false,
    visibility: 'team',
    visibilityUserIds: null,
  };
}

describe('calendarOverlayReducer', () => {
  it('discards optimistic upserts once fresh server rows include the event id', () => {
    const state = {
      upserts: { 'event-1': event('event-1', 'Optimistic title') },
      removedIds: [],
    };

    expect(
      calendarOverlayReducer(state, {
        type: 'reconcile-server-events',
        previousIds: ['event-1'],
        currentIds: ['event-1'],
      }),
    ).toEqual({ upserts: {}, removedIds: [] });
  });

  it('discards optimistic upserts when a fresh server payload deleted the event id', () => {
    const state = {
      upserts: { 'event-1': event('event-1', 'Stale optimistic title') },
      removedIds: ['event-1'],
    };

    expect(
      calendarOverlayReducer(state, {
        type: 'reconcile-server-events',
        previousIds: ['event-1'],
        currentIds: [],
      }),
    ).toEqual({ upserts: {}, removedIds: [] });
  });
});

// @vitest-environment happy-dom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CalendarEvent } from '@/components/calendar/calendar-overlay';

import { calendarOverlayReducer } from '@/components/calendar/calendar-overlay';

const fakes = vi.hoisted(() => ({
  createCalendarEventAction: vi.fn(),
  updateCalendarEventAction: vi.fn(),
  deleteCalendarEventAction: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
  searchParams: 'view=month&date=2026-06-03',
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: fakes.push, refresh: fakes.refresh }),
  useSearchParams: () => new URLSearchParams(fakes.searchParams),
}));
vi.mock('@/app/actions/calendar', () => ({
  createCalendarEventAction: fakes.createCalendarEventAction,
  updateCalendarEventAction: fakes.updateCalendarEventAction,
  deleteCalendarEventAction: fakes.deleteCalendarEventAction,
}));

const { CalendarView } = await import('@/components/calendar/calendar-view');

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

beforeEach(() => {
  vi.clearAllMocks();
  fakes.searchParams = 'view=month&date=2026-06-03';
  fakes.createCalendarEventAction.mockResolvedValue({ ok: true, id: 'new-event' });
  fakes.updateCalendarEventAction.mockResolvedValue({ ok: true, id: 'event-1' });
  fakes.deleteCalendarEventAction.mockResolvedValue({ ok: true, id: 'event-1' });
});

afterEach(() => {
  cleanup();
  document.body.style.pointerEvents = '';
});

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

describe('CalendarView recurrence and tentative UI', () => {
  it('labels tentative recurring events in the calendar grid', () => {
    const html = renderToStaticMarkup(
      createElement(CalendarView, {
        events: [
          {
            ...event('event-1', 'Apple slot'),
            showAs: 'tentative',
            rrule: 'FREQ=WEEKLY;BYDAY=WE',
          },
        ],
        timezone: 'UTC',
      }),
    );

    expect(html).toContain('Tentative');
    expect(html).toContain('aria-label="Recurring"');
    expect(html).toContain('Apple slot');
  });

  it('saves rrule, show-as, and recurrence edit scope from the edit dialog', async () => {
    const user = userEvent.setup();
    render(
      createElement(CalendarView, {
        events: [
          {
            ...event('event-1', 'Daily call'),
            showAs: 'tentative',
            rrule: 'FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR,SU',
          },
        ],
        timezone: 'UTC',
      }),
    );

    await user.click(screen.getByRole('button', { name: /Daily call/ }));

    expect(screen.getByLabelText('Show as')).toHaveProperty('value', 'tentative');
    expect(screen.getByLabelText('RRULE')).toHaveProperty(
      'value',
      'FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR,SU',
    );
    expect(screen.getByLabelText('Edit scope')).toHaveProperty('value', 'series');

    await user.selectOptions(screen.getByLabelText('Show as'), 'free');
    await user.clear(screen.getByLabelText('RRULE'));
    await user.type(screen.getByLabelText('RRULE'), 'FREQ=WEEKLY;BYDAY=MO');
    await user.selectOptions(screen.getByLabelText('Edit scope'), 'this_and_future');
    await user.click(screen.getByRole('button', { name: /^Save$/ }));

    await waitFor(() => {
      expect(fakes.updateCalendarEventAction).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'event-1',
          showAs: 'free',
          rrule: 'FREQ=WEEKLY;BYDAY=MO',
          recurrenceEditMode: 'this_and_future',
        }),
      );
    });
    expect(fakes.refresh).toHaveBeenCalled();
  });

  it('forwards the selected recurrence scope when deleting from the edit dialog', async () => {
    const user = userEvent.setup();
    render(
      createElement(CalendarView, {
        events: [
          {
            ...event('event-1', 'Daily call'),
            recurringParentId: 'parent-1',
            originalStartAt: '2026-06-03T09:00:00Z',
          },
        ],
        timezone: 'UTC',
      }),
    );

    await user.click(screen.getByRole('button', { name: /Daily call/ }));

    expect(screen.getByLabelText('Edit scope')).toHaveProperty('value', 'single');
    await user.selectOptions(screen.getByLabelText('Edit scope'), 'series');
    await user.click(screen.getByRole('button', { name: /Delete/ }));

    await waitFor(() => {
      expect(fakes.deleteCalendarEventAction).toHaveBeenCalledWith('event-1', {
        recurrenceEditMode: 'series',
      });
    });
    expect(fakes.refresh).toHaveBeenCalled();
  });
});

// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act, createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CalendarEvent } from '@/components/calendar/calendar-overlay';

import {
  applyCalendarPageOverlay,
  calendarOverlayReducer,
} from '@/components/calendar/calendar-overlay';

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
vi.mock('@/lib/notify', () => ({
  notifyAction: async ({ run }: { run: () => Promise<{ error?: string; ok?: boolean }> }) => {
    try {
      return await run();
    } catch {
      return { error: 'failed' };
    }
  },
}));
vi.mock('@/app/actions/calendar', () => ({
  createCalendarEventAction: fakes.createCalendarEventAction,
  updateCalendarEventAction: fakes.updateCalendarEventAction,
  deleteCalendarEventAction: fakes.deleteCalendarEventAction,
}));
vi.mock('@/app/actions/pins', () => ({
  pinTargetAction: vi.fn(),
  unpinTargetAction: vi.fn(),
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
    pinned: false,
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

  it('reconciles optimistic edits for refreshed list-only events', () => {
    const state = {
      upserts: { 'event-1': event('event-1', 'Stale optimistic list title') },
      removedIds: [],
    };
    const refreshedState = calendarOverlayReducer(state, {
      type: 'reconcile-server-events',
      previousIds: ['event-1'],
      currentIds: ['event-1'],
    });

    expect(
      applyCalendarPageOverlay([event('event-1', 'Server list title')], refreshedState),
    ).toEqual([event('event-1', 'Server list title')]);
  });

  it('keeps an optimistic delete hidden when a stale refresh still includes the id', () => {
    const state = {
      upserts: {},
      removedIds: ['event-1'],
    };
    const refreshedState = calendarOverlayReducer(state, {
      type: 'reconcile-server-events',
      currentIds: ['event-1'],
      deletedIds: [],
    });

    expect(
      applyCalendarPageOverlay([event('event-1', 'Server stale title')], refreshedState),
    ).toEqual([]);
  });

  it('keeps optimistic state when a paginated list snapshot is not authoritative for deletion', () => {
    const state = {
      upserts: { 'event-2': event('event-2', 'Optimistic off-page title') },
      removedIds: ['event-3'],
    };

    expect(
      calendarOverlayReducer(state, {
        type: 'reconcile-server-events',
        currentIds: ['event-1'],
        deletedIds: [],
      }),
    ).toEqual(state);
  });

  it('clears optimistic state when refreshed server rows include the same list event', () => {
    const state = {
      upserts: { 'event-2': event('event-2', 'Optimistic list title') },
      removedIds: ['event-3'],
    };

    expect(
      calendarOverlayReducer(state, {
        type: 'reconcile-server-events',
        currentIds: ['event-2', 'event-3'],
        deletedIds: [],
      }),
    ).toEqual({ upserts: {}, removedIds: ['event-3'] });
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
        eventListEvents: [],
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
        eventListEvents: [],
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

  it('keeps normalized stored rrules mapped to their recurrence preset', async () => {
    const user = userEvent.setup();
    render(
      createElement(CalendarView, {
        events: [
          {
            ...event('event-1', 'Weekly sync'),
            rrule: 'RRULE:FREQ=WEEKLY',
          },
        ],
        eventListEvents: [],
        timezone: 'UTC',
      }),
    );

    await user.click(screen.getByRole('button', { name: /Weekly sync/ }));

    expect(screen.getByLabelText('Repeats')).toHaveProperty('value', 'weekly');
    expect(screen.getByLabelText('RRULE')).toHaveProperty('value', 'RRULE:FREQ=WEEKLY');
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
        eventListEvents: [],
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

  it('drives the event list filters and pagination through URL params', async () => {
    const user = userEvent.setup();
    fakes.searchParams = 'view=month&date=2026-06-03';

    render(
      createElement(CalendarView, {
        events: [],
        eventListEvents: [event('event-1', 'Roadmap review')],
        eventListTotal: 13,
        eventListPage: 0,
        eventListQuery: '',
        eventListScope: 'future',
        timezone: 'UTC',
      }),
    );

    expect(screen.getByText('13 upcoming events')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Past' }));
    expect(await screen.findByText('13 past events')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Past' }).getAttribute('aria-pressed')).toBe('true');
    expect(fakes.push).toHaveBeenLastCalledWith(
      '/app/calendar?view=month&date=2026-06-03&eventScope=past',
    );

    await user.click(screen.getByRole('button', { name: 'Next events' }));
    expect(fakes.push).toHaveBeenLastCalledWith(
      '/app/calendar?view=month&date=2026-06-03&eventScope=past&eventPage=2',
    );

    await user.type(screen.getByPlaceholderText('Search events'), 'budget');
    await waitFor(
      () => {
        expect(fakes.push).toHaveBeenLastCalledWith(
          '/app/calendar?view=month&date=2026-06-03&eventQ=budget&eventScope=past',
        );
      },
      { timeout: 1000 },
    );
  });

  it('renders server-filtered event list results and empty states for search/scope params', () => {
    fakes.searchParams = 'view=month&date=2026-06-03&eventQ=budget&eventScope=all';
    const budget = { ...event('event-1', 'Budget review'), location: 'Finance room' };
    const roadmap = event('event-2', 'Roadmap review');
    const { rerender } = render(
      createElement(CalendarView, {
        events: [],
        eventListEvents: [budget],
        eventListTotal: 1,
        eventListPage: 0,
        eventListQuery: 'budget',
        eventListScope: 'all',
        timezone: 'UTC',
      }),
    );

    const eventList = screen.getByText('Calendar events').closest('section');
    if (!eventList) throw new Error('Calendar events section not found');

    expect(screen.getByPlaceholderText('Search events')).toHaveProperty('value', 'budget');
    expect(within(eventList).getByText('1 event')).toBeTruthy();
    expect(within(eventList).getByRole('button', { name: 'Budget review' })).toBeTruthy();
    expect(within(eventList).getAllByText('Finance room')).toHaveLength(2);
    expect(within(eventList).queryByRole('button', { name: /Roadmap review/ })).toBeNull();

    rerender(
      createElement(CalendarView, {
        events: [roadmap],
        eventListEvents: [],
        eventListTotal: 0,
        eventListPage: 0,
        eventListQuery: 'budget',
        eventListScope: 'all',
        timezone: 'UTC',
      }),
    );

    expect(within(eventList).getByText('0 events')).toBeTruthy();
    expect(within(eventList).getByText('No events match these filters')).toBeTruthy();
    expect(within(eventList).getByRole('button', { name: 'Clear filters' })).toBeTruthy();
    expect(within(eventList).queryByRole('button', { name: /Roadmap review/ })).toBeNull();
  });

  it('keeps search text typed while committed query props catch up', () => {
    vi.useFakeTimers();
    try {
      const props = {
        events: [],
        eventListEvents: [event('event-1', 'Roadmap review')],
        eventListTotal: 1,
        eventListPage: 0,
        eventListQuery: '',
        eventListScope: 'future' as const,
        timezone: 'UTC',
      };
      const { rerender } = render(createElement(CalendarView, props));
      const input = screen.getByPlaceholderText('Search events');

      fireEvent.change(input, { target: { value: 'bud' } });
      act(() => {
        vi.advanceTimersByTime(350);
      });
      expect(fakes.push).toHaveBeenLastCalledWith(
        '/app/calendar?view=month&date=2026-06-03&eventQ=bud',
      );

      fireEvent.change(input, { target: { value: 'budget' } });
      rerender(createElement(CalendarView, { ...props, eventListQuery: 'bud' }));

      expect(screen.getByPlaceholderText('Search events')).toHaveProperty('value', 'budget');
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses the server-clamped event page when URL params lag behind props', async () => {
    const user = userEvent.setup();
    fakes.searchParams = 'view=month&date=2026-06-03&eventPage=999';

    render(
      createElement(CalendarView, {
        events: [],
        eventListEvents: [event('event-1', 'Roadmap review')],
        eventListTotal: 36,
        eventListPage: 2,
        eventListQuery: '',
        eventListScope: 'future',
        timezone: 'UTC',
      }),
    );

    await user.click(screen.getByRole('button', { name: 'Previous events' }));
    expect(fakes.push).toHaveBeenLastCalledWith(
      '/app/calendar?view=month&date=2026-06-03&eventPage=2',
    );
  });

  it('does not append optimistic creates to the server-paginated event list', async () => {
    const user = userEvent.setup();
    fakes.createCalendarEventAction.mockResolvedValue({ ok: true, id: 'created-event' });

    render(
      createElement(CalendarView, {
        events: [],
        eventListEvents: [event('event-1', 'Roadmap review')],
        eventListTotal: 1,
        eventListPage: 0,
        eventListQuery: '',
        eventListScope: 'future',
        timezone: 'UTC',
      }),
    );

    await user.click(screen.getByRole('button', { name: /New/ }));
    await user.type(screen.getByLabelText('Title'), 'New sales sync');
    await user.click(screen.getByRole('button', { name: /^Save$/ }));

    expect(await screen.findByRole('button', { name: /New sales sync/ })).toBeTruthy();
    expect(screen.getByText('1 upcoming event')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Roadmap review' })).toBeTruthy();
    const eventList = screen.getByText('Calendar events').closest('section');
    if (!eventList) throw new Error('Calendar events section not found');
    expect(within(eventList).queryByRole('button', { name: 'New sales sync' })).toBeNull();
  });

  it('validates create title and sends specific-user visibility selections', async () => {
    const user = userEvent.setup();
    render(
      createElement(CalendarView, {
        events: [],
        eventListEvents: [],
        timezone: 'UTC',
        defaultVisibility: 'specific_users',
        defaultVisibilityUserIds: ['member-1'],
        members: [
          { id: 'member-1', label: 'Ada Lovelace' },
          { id: 'member-2', label: 'Grace Hopper' },
        ],
      }),
    );

    await user.click(screen.getByRole('button', { name: /New/ }));
    expect(screen.getByLabelText<HTMLSelectElement>('Visibility').value).toBe('specific_users');
    expect(screen.getByLabelText<HTMLInputElement>('Ada Lovelace').checked).toBe(true);
    expect(screen.getByLabelText<HTMLInputElement>('Grace Hopper').checked).toBe(false);

    await user.click(screen.getByRole('button', { name: /^Save$/ }));
    expect(screen.getByText('Enter a title for this event.')).toBeTruthy();
    expect(screen.getByLabelText('Title').getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(screen.getByLabelText('Title'));
    expect(fakes.createCalendarEventAction).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: 'Private launch review' },
    });
    await user.click(screen.getByLabelText('Ada Lovelace'));
    await user.click(screen.getByLabelText('Grace Hopper'));
    await user.selectOptions(screen.getByLabelText('Show as'), 'tentative');
    await user.click(screen.getByRole('button', { name: /^Save$/ }));

    await waitFor(() => {
      expect(fakes.createCalendarEventAction).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Private launch review',
          visibility: 'specific_users',
          visibilityUserIds: ['member-2'],
          showAs: 'tentative',
          allDay: true,
        }),
      );
    });
    expect(fakes.refresh).toHaveBeenCalled();
  });

  it('reopens the create dialog and discards optimistic UI when save fails', async () => {
    const user = userEvent.setup();
    fakes.createCalendarEventAction.mockResolvedValueOnce({
      ok: false,
      error: 'Calendar write denied',
    });

    render(
      createElement(CalendarView, {
        events: [],
        eventListEvents: [],
        timezone: 'UTC',
      }),
    );

    await user.click(screen.getByRole('button', { name: /New/ }));
    await user.type(screen.getByLabelText('Title'), 'Denied customer sync');
    await user.click(screen.getByRole('button', { name: /^Save$/ }));

    await waitFor(() => {
      expect(screen.getAllByText('Calendar write denied')).toHaveLength(2);
    });
    expect(screen.getByRole('dialog', { name: 'New event' })).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>('Title').value).toBe('Denied customer sync');
    expect(screen.queryByRole('button', { name: /Denied customer sync/ })).toBeNull();
    expect(fakes.refresh).toHaveBeenCalled();
  });

  it('renders redacted events as busy and does not open the edit dialog', async () => {
    const user = userEvent.setup();
    render(
      createElement(CalendarView, {
        events: [{ ...event('event-1', 'Sensitive customer call'), redacted: true }],
        eventListEvents: [],
        timezone: 'UTC',
      }),
    );

    await user.click(screen.getByRole('button', { name: /09:00 AM Busy/ }));

    expect(screen.queryByRole('dialog', { name: 'Edit event' })).toBeNull();
    expect(screen.queryByText('Sensitive customer call')).toBeNull();
  });

  it('communicates view selection and keeps date creation keyboard-operable', async () => {
    const user = userEvent.setup();
    render(
      createElement(CalendarView, {
        events: [],
        eventListEvents: [],
        timezone: 'UTC',
      }),
    );

    const viewControls = screen.getByRole('group', { name: 'Calendar view' });
    expect(
      within(viewControls).getByRole('button', { name: 'Month' }).getAttribute('aria-pressed'),
    ).toBe('true');
    expect(
      within(viewControls).getByRole('button', { name: 'Week' }).getAttribute('aria-pressed'),
    ).toBe('false');
    expect(screen.getByRole('button', { name: 'Previous month' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Next month' })).toBeTruthy();

    const dayControl = screen.getByRole('button', {
      name: /Create event on Wednesday, June 3, 2026/,
    });
    dayControl.focus();
    await user.keyboard('{Enter}');

    expect(screen.getByRole('dialog', { name: 'New event' })).toBeTruthy();
  });

  it('keeps long event labels inside the compact grid while announcing the filtered result count', () => {
    const title = 'Review the cross-functional customer migration readiness plan';
    render(
      createElement(CalendarView, {
        events: [event('event-1', title)],
        eventListEvents: [],
        eventListTotal: 1,
        timezone: 'UTC',
      }),
    );

    const grid = screen.getByRole('region', { name: /Calendar for June 2026/ });
    expect(grid.className).toContain('min-w-0');
    expect(grid.className).toContain('overflow-hidden');

    const eventControl = screen.getByRole('button', { name: new RegExp(title) });
    expect(eventControl.className).toContain('min-w-0');
    expect(within(eventControl).getByText(new RegExp(title)).className).toContain('truncate');
    expect(screen.getByRole('status').textContent).toBe('1 upcoming event');
  });

  it('keeps the event search field visibly focused for keyboard users', () => {
    render(
      createElement(CalendarView, {
        events: [],
        eventListEvents: [],
        timezone: 'UTC',
      }),
    );

    const search = screen.getByRole('textbox', { name: 'Search calendar events' });
    search.focus();

    expect(document.activeElement).toBe(search);
    expect(search.className).toContain('focus-visible:ring-2');
    expect(search.className).not.toContain('focus-visible:ring-0');
  });

  it('offers a clear next action when there are no upcoming events', async () => {
    const user = userEvent.setup();
    render(
      createElement(CalendarView, {
        events: [],
        eventListEvents: [],
        eventListTotal: 0,
        timezone: 'UTC',
      }),
    );

    expect(screen.getByText('No upcoming events')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Create event' }));

    expect(screen.getByRole('dialog', { name: 'New event' })).toBeTruthy();
  });
});

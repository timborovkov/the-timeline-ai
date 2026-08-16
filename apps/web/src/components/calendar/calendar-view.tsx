'use client';

import { Temporal } from '@js-temporal/polyfill';
import {
  assertValidTimezone,
  isoWeekYear,
  localDateSpanToUtcRange,
  startOfIsoWeek,
} from '@timeline/shared/time';
import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Pencil,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useTransition,
} from 'react';

import type { CalendarEvent } from '@/components/calendar/calendar-overlay';
import type { SaveState } from '@/lib/utils';
import type { Dispatch, RefObject, SetStateAction } from 'react';

import {
  createCalendarEventAction,
  deleteCalendarEventAction,
  updateCalendarEventAction,
} from '@/app/actions/calendar';
import {
  EMPTY_CALENDAR_OVERLAY,
  applyCalendarPageOverlay,
  calendarEventsSignature,
  calendarOverlayReducer,
  mergeCalendarEvents,
} from '@/components/calendar/calendar-overlay';
import { CollectionRow } from '@/components/collections/collection-row';
import { CollectionStatus } from '@/components/collections/collection-status';
import { CollectionToolbar } from '@/components/collections/collection-toolbar';
import { PinButton } from '@/components/pins/pin-button';
import { PinOverflowMenu } from '@/components/pins/pin-overflow-menu';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { statusLabel } from '@/lib/status-labels';
import { errorMessage } from '@/lib/utils';

type CalendarViewMode = 'month' | 'week' | 'day';

interface CalendarViewProps {
  events: CalendarEvent[];
  eventListEvents?: CalendarEvent[];
  eventListTotal?: number;
  eventListPage?: number;
  eventListQuery?: string;
  eventListScope?: 'future' | 'past' | 'all';
  timezone: string;
  defaultVisibility?: 'team' | 'private' | 'specific_users';
  defaultVisibilityUserIds?: string[] | null;
  members?: { id: string; label: string }[];
  focusEventId?: string | null;
}

const EMPTY_MEMBERS: NonNullable<CalendarViewProps['members']> = [];

interface Draft {
  title: string;
  description: string;
  location: string;
  visibility: 'team' | 'private' | 'specific_users';
  visibilityUserIds: string[];
  showAs: 'busy' | 'free' | 'tentative';
  rrule: string;
  recurrenceEditMode: 'single' | 'series' | 'this_and_future';
  allDay: boolean;
  timezone: string;
  startDate: string;
  endDate: string;
  startDateTime: string;
  endDateTime: string;
}

const RECURRENCE_PRESETS = [
  { label: 'Does not repeat', value: '', rrule: '' },
  { label: 'Daily', value: 'daily', rrule: 'FREQ=DAILY' },
  { label: 'Weekdays', value: 'weekdays', rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' },
  { label: 'Weekly', value: 'weekly', rrule: 'FREQ=WEEKLY' },
  { label: 'Monthly', value: 'monthly', rrule: 'FREQ=MONTHLY' },
] as const;

function recurrencePresetValue(rrule: string): string {
  const normalized = rrule
    .trim()
    .split(/\r?\n/)
    .find((line) => /^(RRULE:)?FREQ=/i.test(line.trim()))
    ?.trim()
    .replace(/^RRULE:/i, '');
  return RECURRENCE_PRESETS.find((preset) => preset.rrule === normalized)?.value ?? 'custom';
}

interface CalendarUiState {
  editing: CalendarEvent | null;
  draft: Draft;
  open: boolean;
  error: string | null;
  surfaceError: string | null;
  saveState: SaveState;
}

type CalendarUiAction = Partial<CalendarUiState> | ((state: CalendarUiState) => CalendarUiState);

const WEEKDAYS = [
  { short: 'Mon', label: 'Monday' },
  { short: 'Tue', label: 'Tuesday' },
  { short: 'Wed', label: 'Wednesday' },
  { short: 'Thu', label: 'Thursday' },
  { short: 'Fri', label: 'Friday' },
  { short: 'Sat', label: 'Saturday' },
  { short: 'Sun', label: 'Sunday' },
] as const;
const EVENT_LIST_PAGE_SIZE = 12;
const TITLE_REQUIRED_ERROR = 'Enter a title for this event.';
type EventListScope = 'future' | 'past' | 'all';
interface EventListParams {
  query: string;
  scope: EventListScope;
  page: number;
}

function sameEventListParams(a: EventListParams, b: EventListParams): boolean {
  return a.query === b.query && a.scope === b.scope && a.page === b.page;
}

function eventListParamsFromSearch(searchParams: {
  get(name: string): string | null;
}): EventListParams {
  const scope = searchParams.get('eventScope');
  const parsedPage = Number.parseInt(searchParams.get('eventPage') ?? '1', 10);
  return {
    query: searchParams.get('eventQ')?.trim() ?? '',
    scope: scope === 'past' || scope === 'all' ? scope : 'future',
    page: Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage - 1 : 0,
  };
}

function initCalendarUiState({
  anchor,
  timezone,
  defaultVisibility,
  defaultVisibilityUserIds,
}: {
  anchor: Temporal.PlainDate;
  timezone: string;
  defaultVisibility: Draft['visibility'];
  defaultVisibilityUserIds: string[] | null;
}): CalendarUiState {
  return {
    editing: null,
    draft: blankDraft(anchor, timezone, defaultVisibility, defaultVisibilityUserIds),
    open: false,
    error: null,
    surfaceError: null,
    saveState: 'idle',
  };
}

function calendarUiReducer(state: CalendarUiState, action: CalendarUiAction): CalendarUiState {
  return typeof action === 'function' ? action(state) : { ...state, ...action };
}

function today(timezone: string): Temporal.PlainDate {
  return Temporal.Now.zonedDateTimeISO(timezone).toPlainDate();
}

function parseDateParam(value: string | null, timezone: string): Temporal.PlainDate {
  if (!value) return today(timezone);
  try {
    return Temporal.PlainDate.from(value);
  } catch {
    return today(timezone);
  }
}

function localDateTime(value: string, timezone: string): string {
  return Temporal.PlainDateTime.from(value).toZonedDateTime(timezone).toInstant().toString();
}

function dateSpan(
  startDate: string,
  endDate: string,
  timezone: string,
): { start: string; end: string } {
  const range = localDateSpanToUtcRange(startDate, endDate, timezone);
  return { start: range.from.toISOString(), end: range.to.toISOString() };
}

function eventLocalStart(event: CalendarEvent, timezone: string): Temporal.PlainDateTime {
  return Temporal.Instant.from(event.startAt).toZonedDateTimeISO(timezone).toPlainDateTime();
}

function eventLocalEnd(event: CalendarEvent, timezone: string): Temporal.PlainDateTime {
  return Temporal.Instant.from(event.endAt).toZonedDateTimeISO(timezone).toPlainDateTime();
}

function isoDate(date: Temporal.PlainDate): string {
  return date.toString();
}

function monthGrid(anchor: Temporal.PlainDate): Temporal.PlainDate[] {
  const first = Temporal.PlainDate.from({ year: anchor.year, month: anchor.month, day: 1 });
  const start = startOfIsoWeek(first);
  return Array.from({ length: 42 }, (_, i) => start.add({ days: i }));
}

function weekGrid(anchor: Temporal.PlainDate): Temporal.PlainDate[] {
  const start = startOfIsoWeek(anchor);
  return Array.from({ length: 7 }, (_, i) => start.add({ days: i }));
}

function titleFor(mode: CalendarViewMode, anchor: Temporal.PlainDate): string {
  if (mode === 'day') {
    return anchor.toLocaleString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
  }
  if (mode === 'week') return `Week ${String(anchor.weekOfYear)}, ${String(isoWeekYear(anchor))}`;
  return anchor.toLocaleString(undefined, { month: 'long', year: 'numeric' });
}

function formatTime(event: CalendarEvent, timezone: string): string {
  const start = Temporal.Instant.from(event.startAt).toZonedDateTimeISO(timezone);
  return start.toLocaleString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function formatEventDateTime(value: string, timezone: string): string {
  return Temporal.Instant.from(value).toZonedDateTimeISO(timezone).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatEventRange(event: CalendarEvent, timezone: string): string {
  if (event.allDay) {
    const start = Temporal.Instant.from(event.startAt)
      .toZonedDateTimeISO(assertValidTimezone(event.timezone))
      .toPlainDate();
    const end = Temporal.Instant.from(event.endAt)
      .toZonedDateTimeISO(assertValidTimezone(event.timezone))
      .toPlainDate()
      .subtract({ days: 1 });
    return Temporal.PlainDate.compare(start, end) === 0
      ? start.toLocaleString(undefined, { month: 'short', day: 'numeric' })
      : `${start.toLocaleString(undefined, { month: 'short', day: 'numeric' })} - ${end.toLocaleString(undefined, { month: 'short', day: 'numeric' })}`;
  }
  return `${formatEventDateTime(event.startAt, timezone)} - ${formatEventDateTime(event.endAt, timezone)}`;
}

function eventTouchesDate(
  event: CalendarEvent,
  date: Temporal.PlainDate,
  timezone: string,
): boolean {
  const displayTimezone = event.allDay ? assertValidTimezone(event.timezone) : timezone;
  const startInstant = Temporal.Instant.from(event.startAt);
  const endInstant = Temporal.Instant.from(event.endAt);
  if (Temporal.Instant.compare(endInstant, startInstant) <= 0) return false;
  const start = startInstant.toZonedDateTimeISO(displayTimezone).toPlainDate();
  const effectiveEndInstant = event.allDay ? endInstant : endInstant.subtract({ nanoseconds: 1 });
  const rawEnd = effectiveEndInstant.toZonedDateTimeISO(displayTimezone).toPlainDate();
  const end = event.allDay ? rawEnd.subtract({ days: 1 }) : rawEnd;
  return Temporal.PlainDate.compare(start, date) <= 0 && Temporal.PlainDate.compare(end, date) >= 0;
}

function blankDraft(
  anchor: Temporal.PlainDate,
  timezone: string,
  visibility: Draft['visibility'] = 'team',
  visibilityUserIds: string[] | null = null,
): Draft {
  const next = anchor.add({ days: 1 });
  return {
    title: '',
    description: '',
    location: '',
    visibility,
    visibilityUserIds: visibility === 'specific_users' ? (visibilityUserIds ?? []) : [],
    showAs: 'busy',
    rrule: '',
    recurrenceEditMode: 'series',
    allDay: true,
    timezone: assertValidTimezone(timezone),
    startDate: isoDate(anchor),
    endDate: isoDate(next),
    startDateTime: `${isoDate(anchor)}T09:00`,
    endDateTime: `${isoDate(anchor)}T10:00`,
  };
}

function draftFromEvent(event: CalendarEvent, timezone: string): Draft {
  const displayTimezone = event.allDay ? assertValidTimezone(event.timezone) : timezone;
  const start = eventLocalStart(event, displayTimezone);
  const end = eventLocalEnd(event, displayTimezone);
  return {
    title: event.redacted ? 'Busy' : event.title,
    description: event.description ?? '',
    location: event.location ?? '',
    visibility:
      event.visibility === 'private' || event.visibility === 'specific_users'
        ? event.visibility
        : 'team',
    visibilityUserIds: event.visibility === 'specific_users' ? (event.visibilityUserIds ?? []) : [],
    showAs: event.showAs,
    rrule: event.rrule ?? '',
    recurrenceEditMode: event.recurringParentId ? 'single' : 'series',
    allDay: event.allDay,
    timezone: displayTimezone,
    startDate: start.toPlainDate().toString(),
    endDate: end.toPlainDate().toString(),
    startDateTime: start.toString({ smallestUnit: 'minute' }),
    endDateTime: end.toString({ smallestUnit: 'minute' }),
  };
}

export function CalendarView(props: CalendarViewProps) {
  return (
    <Suspense fallback={null}>
      <CalendarViewContent {...props} />
    </Suspense>
  );
}

function CalendarViewContent(props: CalendarViewProps) {
  const model = useCalendarViewModel(props);
  return <CalendarViewLayout model={model} />;
}

function useCalendarViewModel({
  events,
  eventListEvents = events,
  eventListTotal = eventListEvents.length,
  eventListPage = 0,
  eventListQuery = '',
  eventListScope = 'future',
  timezone,
  defaultVisibility = 'team',
  defaultVisibilityUserIds = null,
  members = EMPTY_MEMBERS,
  focusEventId = null,
}: CalendarViewProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const searchParamsKey = searchParams.toString();
  const mode = (searchParams.get('view') as CalendarViewMode | null) ?? 'month';
  const safeMode: CalendarViewMode = ['month', 'week', 'day'].includes(mode) ? mode : 'month';
  const anchor = parseDateParam(searchParams.get('date'), timezone);
  const anchorKey = anchor.toString();
  const visibleDays = useMemo(() => {
    const stableAnchor = Temporal.PlainDate.from(anchorKey);
    return safeMode === 'month'
      ? monthGrid(stableAnchor)
      : safeMode === 'week'
        ? weekGrid(stableAnchor)
        : [stableAnchor];
  }, [anchorKey, safeMode]);
  const currentToday = today(timezone);
  const [eventOverlay, dispatchEventOverlay] = useReducer(
    calendarOverlayReducer,
    EMPTY_CALENDAR_OVERLAY,
  );
  const [{ editing, draft, open, error, surfaceError, saveState }, dispatchCalendarUi] = useReducer(
    calendarUiReducer,
    { anchor, timezone, defaultVisibility, defaultVisibilityUserIds },
    initCalendarUiState,
  );
  const [pending, startTransition] = useTransition();
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const dialogContextRef = useRef(0);
  const openedFocusRef = useRef<string | null>(null);
  const eventListParamsRef = useRef<EventListParams | null>(null);
  const serverEventsSnapshotRef = useRef<{
    signature: string;
    ids: string[];
  } | null>(null);
  const eventListRawUrlParams = useMemo(
    () => eventListParamsFromSearch(new URLSearchParams(searchParamsKey)),
    [searchParamsKey],
  );
  const eventListServerParams = useMemo(
    () => ({
      query: eventListQuery.trim(),
      scope: eventListScope,
      page: eventListPage,
    }),
    [eventListPage, eventListQuery, eventListScope],
  );
  const eventListUrlParams = useMemo(() => {
    if (
      eventListRawUrlParams.query === eventListServerParams.query &&
      eventListRawUrlParams.scope === eventListServerParams.scope &&
      eventListRawUrlParams.page !== eventListServerParams.page
    ) {
      return eventListServerParams;
    }
    return eventListRawUrlParams;
  }, [eventListRawUrlParams, eventListServerParams]);
  const [optimisticEventListParams, setOptimisticEventListParams] = useState<{
    params: EventListParams;
    sourceSearchParamsKey: string;
  } | null>(null);
  const eventListDisplayParams =
    optimisticEventListParams?.sourceSearchParamsKey === searchParamsKey &&
    !sameEventListParams(optimisticEventListParams.params, eventListUrlParams)
      ? optimisticEventListParams.params
      : eventListUrlParams;
  eventListParamsRef.current = eventListDisplayParams;

  useEffect(() => {
    return () => {
      if (savedTimer.current) clearTimeout(savedTimer.current);
    };
  }, []);

  useEffect(() => {
    const signature = calendarEventsSignature([...events, ...eventListEvents]);
    const gridIds = events.map((event) => event.id);
    const refreshedIds = Array.from(
      new Set([...gridIds, ...eventListEvents.map((event) => event.id)]),
    );
    const previous = serverEventsSnapshotRef.current;
    if (!previous) {
      serverEventsSnapshotRef.current = { signature, ids: gridIds };
      return;
    }
    if (previous.signature === signature || pending) return;
    const currentGridIds = new Set(gridIds);
    const deletedIds = previous.ids.filter((id) => !currentGridIds.has(id));
    serverEventsSnapshotRef.current = { signature, ids: gridIds };
    dispatchEventOverlay({
      type: 'reconcile-server-events',
      currentIds: refreshedIds,
      deletedIds,
    });
  }, [events, eventListEvents, pending]);

  const displayEvents = useMemo(
    () => mergeCalendarEvents(events, eventOverlay),
    [events, eventOverlay],
  );
  const displayEventListEvents = useMemo(
    () => applyCalendarPageOverlay(eventListEvents, eventOverlay),
    [eventListEvents, eventOverlay],
  );

  useEffect(() => {
    if (!focusEventId || openedFocusRef.current === focusEventId) return;
    const focused = [...displayEvents, ...displayEventListEvents].find(
      (event) => event.id === focusEventId,
    );
    if (!focused || focused.redacted) return;
    openedFocusRef.current = focusEventId;
    dialogContextRef.current += 1;
    dispatchCalendarUi({
      editing: focused,
      draft: draftFromEvent(focused, timezone),
      error: null,
      surfaceError: null,
      open: true,
    });
  }, [displayEventListEvents, displayEvents, focusEventId, timezone]);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const day of visibleDays) {
      const matches = displayEvents
        .filter((event) => eventTouchesDate(event, day, timezone))
        .sort((a, b) => a.startAt.localeCompare(b.startAt));
      map.set(day.toString(), matches);
    }
    return map;
  }, [displayEvents, timezone, visibleDays]);

  const updateEventListParams = useCallback(
    ({
      query,
      scope,
      page,
    }: {
      query?: string;
      scope?: 'future' | 'past' | 'all';
      page?: number;
    }) => {
      const next = new URLSearchParams(searchParams.toString());
      const current = eventListParamsRef.current ?? eventListUrlParams;
      const nextQuery = query ?? current.query;
      const nextScope = scope ?? current.scope;
      const nextPage = page ?? current.page;
      const nextParams = { query: nextQuery.trim(), scope: nextScope, page: nextPage };
      eventListParamsRef.current = nextParams;
      setOptimisticEventListParams({ params: nextParams, sourceSearchParamsKey: searchParamsKey });

      if (nextQuery.trim()) next.set('eventQ', nextQuery.trim());
      else next.delete('eventQ');
      if (nextScope === 'future') next.delete('eventScope');
      else next.set('eventScope', nextScope);
      if (nextPage > 0) next.set('eventPage', String(nextPage + 1));
      else next.delete('eventPage');

      router.push(`/app/calendar?${next.toString()}`);
    },
    [eventListUrlParams, router, searchParams, searchParamsKey],
  );

  function push(nextMode: CalendarViewMode, nextDate: Temporal.PlainDate) {
    const next = new URLSearchParams(searchParams.toString());
    next.set('view', nextMode);
    next.set('date', nextDate.toString());
    router.push(`/app/calendar?${next.toString()}`);
  }

  function move(direction: -1 | 1) {
    const unit =
      safeMode === 'month'
        ? { months: direction }
        : { days: direction * (safeMode === 'week' ? 7 : 1) };
    push(safeMode, anchor.add(unit));
  }

  function openCreate(day = anchor) {
    dialogContextRef.current += 1;
    dispatchCalendarUi({
      editing: null,
      draft: blankDraft(day, timezone, defaultVisibility, defaultVisibilityUserIds),
      error: null,
      surfaceError: null,
      open: true,
    });
  }

  function openEdit(event: CalendarEvent) {
    if (event.redacted) return;
    dialogContextRef.current += 1;
    dispatchCalendarUi({
      editing: event,
      draft: draftFromEvent(event, timezone),
      error: null,
      surfaceError: null,
      open: true,
    });
  }

  function save() {
    dispatchCalendarUi({ error: null });
    const title = draft.title.trim();
    if (!title) {
      dispatchCalendarUi({ error: TITLE_REQUIRED_ERROR });
      titleInputRef.current?.focus();
      return;
    }
    let times: { start: string; end: string };
    try {
      times = draft.allDay
        ? dateSpan(draft.startDate, draft.endDate, draft.timezone)
        : {
            start: localDateTime(draft.startDateTime, draft.timezone),
            end: localDateTime(draft.endDateTime, draft.timezone),
          };
    } catch {
      dispatchCalendarUi({
        error: draft.allDay
          ? 'Enter valid start and exclusive end dates.'
          : 'Enter valid start and end times.',
      });
      return;
    }
    if (
      Temporal.Instant.compare(
        Temporal.Instant.from(times.end),
        Temporal.Instant.from(times.start),
      ) <= 0
    ) {
      dispatchCalendarUi({
        error: draft.allDay
          ? 'Exclusive end date must be after start date.'
          : 'End must be after start.',
      });
      return;
    }
    startTransition(async () => {
      const saveDialogContext = dialogContextRef.current;
      const input = {
        title,
        description: draft.description.trim() || undefined,
        startAt: times.start,
        endAt: times.end,
        timezone: draft.timezone,
        allDay: draft.allDay,
        location: draft.location.trim() || undefined,
        visibility: draft.visibility,
        showAs: draft.showAs,
        rrule: draft.rrule.trim() || null,
        recurrenceEditMode: draft.recurrenceEditMode,
        ...(draft.visibility === 'specific_users'
          ? { visibilityUserIds: draft.visibilityUserIds }
          : {}),
      };
      const optimisticId = editing?.id ?? `optimistic-${crypto.randomUUID()}`;
      const originalEvent = editing
        ? (mergeCalendarEvents(events, eventOverlay).find((event) => event.id === editing.id) ??
          null)
        : null;
      const optimisticEvent: CalendarEvent = {
        id: optimisticId,
        pinned: editing?.pinned ?? false,
        title,
        description: draft.description.trim() || null,
        startAt: times.start,
        endAt: times.end,
        timezone: draft.timezone,
        allDay: draft.allDay,
        location: draft.location.trim() || null,
        showAs: draft.showAs,
        rrule: draft.rrule.trim() || null,
        recurringParentId: editing?.recurringParentId ?? null,
        originalStartAt: editing?.originalStartAt ?? null,
        isException: editing?.isException ?? false,
        metadata: editing?.metadata ?? {},
        redacted: false,
        visibility: draft.visibility,
        visibilityUserIds: draft.visibility === 'specific_users' ? draft.visibilityUserIds : null,
      };
      dispatchCalendarUi({ surfaceError: null });
      if (savedTimer.current) clearTimeout(savedTimer.current);
      dispatchCalendarUi({ saveState: 'saving', open: false });
      dispatchEventOverlay({ type: 'upsert', event: optimisticEvent });
      try {
        const result = editing
          ? await updateCalendarEventAction({ id: editing.id, ...input })
          : await createCalendarEventAction(input);
        if (!result.ok) {
          throw new Error(result.error ?? 'Failed to save event.');
        }
        const savedId = result.id;
        if (!editing && typeof savedId === 'string') {
          dispatchEventOverlay({
            type: 'replace-id',
            previousId: optimisticId,
            event: { ...optimisticEvent, id: savedId },
          });
        }
        dispatchCalendarUi({ saveState: 'saved' });
        router.refresh();
        savedTimer.current = setTimeout(() => {
          dispatchCalendarUi({ saveState: 'idle' });
        }, 1600);
      } catch (err) {
        const message = errorMessage(err, 'Failed to save event.');
        if (editing && originalEvent) {
          dispatchEventOverlay({ type: 'restore', event: originalEvent });
        } else {
          dispatchEventOverlay({ type: 'discard', id: optimisticId });
        }
        dispatchCalendarUi({ saveState: 'idle', surfaceError: message });
        if (dialogContextRef.current === saveDialogContext) {
          dispatchCalendarUi({ open: true, error: message });
        }
        router.refresh();
      }
    });
  }

  function remove() {
    if (!editing) return;
    startTransition(async () => {
      const result = await deleteCalendarEventAction(editing.id, {
        recurrenceEditMode: draft.recurrenceEditMode,
      });
      if (!result.ok) {
        dispatchCalendarUi({ error: result.error ?? 'Failed to delete event.' });
        return;
      }
      dispatchEventOverlay({ type: 'remove', id: editing.id });
      dispatchCalendarUi({ open: false });
      router.refresh();
    });
  }

  const gridCols =
    safeMode === 'day' ? 'grid-cols-1' : 'grid-cols-7 sm:grid-cols-[3rem_repeat(7,minmax(0,1fr))]';

  return {
    anchor,
    currentToday,
    displayEventListEvents,
    draft,
    editing,
    error,
    eventListPage: eventListDisplayParams.page,
    eventListQuery: eventListDisplayParams.query,
    eventListScope: eventListDisplayParams.scope,
    eventListTotal,
    eventsByDay,
    gridCols,
    members,
    move,
    open,
    openCreate,
    openEdit,
    pending,
    push,
    remove,
    safeMode,
    save,
    saveState,
    surfaceError,
    timezone,
    titleInputRef,
    updateEventListParams,
    visibleDays,
    dispatchCalendarUi,
  };
}

function CalendarViewLayout({ model }: { model: ReturnType<typeof useCalendarViewModel> }) {
  return (
    <div className="space-y-4">
      <CalendarToolbar
        mode={model.safeMode}
        anchor={model.anchor}
        timezone={model.timezone}
        title={titleFor(model.safeMode, model.anchor)}
        today={model.currentToday}
        onPush={model.push}
        onMove={model.move}
        onCreate={() => {
          model.openCreate();
        }}
      />
      <CalendarSaveStatus saveState={model.saveState} surfaceError={model.surfaceError} />
      <CalendarBody
        mode={model.safeMode}
        gridCols={model.gridCols}
        anchor={model.anchor}
        visibleDays={model.visibleDays}
        eventsByDay={model.eventsByDay}
        timezone={model.timezone}
        today={model.currentToday}
        onCreate={model.openCreate}
        onEdit={model.openEdit}
      />
      <CalendarEventList
        events={model.displayEventListEvents}
        total={model.eventListTotal}
        timezone={model.timezone}
        query={model.eventListQuery}
        scope={model.eventListScope}
        page={model.eventListPage}
        onQueryChange={(query) => {
          model.updateEventListParams({ query, page: 0 });
        }}
        onScopeChange={(scope) => {
          model.updateEventListParams({ scope, page: 0 });
        }}
        onPageChange={(page) => {
          model.updateEventListParams({ page });
        }}
        onCreate={() => {
          model.openCreate(model.anchor);
        }}
        onClearFilters={() => {
          model.updateEventListParams({ query: '', scope: 'future', page: 0 });
        }}
        onEdit={model.openEdit}
      />
      <CalendarEventDialog
        open={model.open}
        editing={model.editing}
        draft={model.draft}
        error={model.error}
        pending={model.pending}
        timezone={model.timezone}
        titleInputRef={model.titleInputRef}
        members={model.members}
        onOpenChange={(nextOpen) => {
          model.dispatchCalendarUi({ open: nextOpen });
        }}
        onDraftChange={(action) => {
          model.dispatchCalendarUi((current) => ({
            ...current,
            draft: typeof action === 'function' ? action(current.draft) : action,
          }));
        }}
        onSave={model.save}
        onRemove={model.remove}
      />
    </div>
  );
}

function CalendarEventList({
  events,
  total,
  timezone,
  query,
  scope,
  page,
  onQueryChange,
  onScopeChange,
  onPageChange,
  onCreate,
  onClearFilters,
  onEdit,
}: {
  events: CalendarEvent[];
  total: number;
  timezone: string;
  query: string;
  scope: 'future' | 'past' | 'all';
  page: number;
  onQueryChange: (query: string) => void;
  onScopeChange: (scope: 'future' | 'past' | 'all') => void;
  onPageChange: (page: number) => void;
  onCreate: () => void;
  onClearFilters: () => void;
  onEdit: (event: CalendarEvent) => void;
}) {
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const committedSearchRef = useRef(query);
  const pageCount = Math.max(1, Math.ceil(total / EVENT_LIST_PAGE_SIZE));
  const effectivePage = Math.min(page, pageCount - 1);
  const pageStart = effectivePage * EVENT_LIST_PAGE_SIZE;
  const hasActiveFilters = Boolean(query) || scope !== 'future';
  const eventCountLabel =
    scope === 'future'
      ? `${total} upcoming event${total === 1 ? '' : 's'}`
      : scope === 'past'
        ? `${total} past event${total === 1 ? '' : 's'}`
        : `${total} event${total === 1 ? '' : 's'}`;

  useEffect(() => {
    if (query === committedSearchRef.current) return;
    committedSearchRef.current = query;
    if (searchInputRef.current) searchInputRef.current.value = query;
  }, [query]);

  useEffect(() => {
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, []);

  return (
    <section className="border-t border-border" aria-labelledby="calendar-events-heading">
      <h2 id="calendar-events-heading" className="sr-only">
        Calendar events
      </h2>
      <CollectionToolbar
        count={eventCountLabel}
        search={
          <div className="flex w-full items-center gap-2 px-2">
            <Search className="size-4 shrink-0 text-fg-dim" aria-hidden="true" />
            <Label htmlFor="calendar-event-search" className="sr-only">
              Search calendar events
            </Label>
            <Input
              id="calendar-event-search"
              ref={searchInputRef}
              defaultValue={query}
              onChange={(event) => {
                const nextQuery = event.target.value;
                if (searchTimer.current) clearTimeout(searchTimer.current);
                searchTimer.current = setTimeout(() => {
                  committedSearchRef.current = nextQuery.trim();
                  onQueryChange(nextQuery);
                }, 350);
              }}
              placeholder="Search events"
              className="h-9 border-0 bg-transparent px-0"
            />
          </div>
        }
        activeFilters={[
          ...(query
            ? [{ key: 'query', label: 'Search', value: query, onRemove: () => onQueryChange('') }]
            : []),
          ...(scope !== 'future'
            ? [
                {
                  key: 'scope',
                  label: 'Range',
                  value: scope,
                  onRemove: () => onScopeChange('future'),
                },
              ]
            : []),
        ]}
        viewControls={
          <fieldset className="grid grid-cols-3 gap-1 border-0 p-0 sm:flex">
            <legend className="sr-only">Event range</legend>
            {(['future', 'past', 'all'] as const).map((nextScope) => (
              <Button
                key={nextScope}
                type="button"
                size="sm"
                variant={scope === nextScope ? 'secondary' : 'outline'}
                aria-pressed={scope === nextScope}
                onClick={() => {
                  onScopeChange(nextScope);
                }}
              >
                {nextScope === 'future' ? 'Upcoming' : nextScope === 'past' ? 'Past' : 'All'}
              </Button>
            ))}
          </fieldset>
        }
      />

      <div className="border-x border-border bg-bg">
        {events.length > 0 ? (
          events.map((event) => (
            <CollectionRow
              key={event.id}
              className="min-h-13"
              title={
                <button
                  type="button"
                  disabled={event.redacted}
                  className="block min-w-0 truncate rounded-sm text-left hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:opacity-100"
                  onClick={() => {
                    onEdit(event);
                  }}
                >
                  {event.redacted ? 'Busy' : event.title}
                </button>
              }
              context={
                [event.location, event.description].filter(Boolean).join(' · ') ||
                (event.allDay ? 'All day' : statusLabel(event.showAs))
              }
              metadata={
                <>
                  <span className="text-xs text-fg-dim">{formatEventRange(event, timezone)}</span>
                  <CollectionStatus value={event.showAs} label={statusLabel(event.showAs)} />
                  <span className="text-xs text-fg-dim">{statusLabel(event.visibility)}</span>
                </>
              }
              actions={
                !event.redacted ? (
                  <PinOverflowMenu
                    target={{ kind: 'calendar_event', key: event.id }}
                    title={event.title}
                    initialPinned={event.pinned}
                  />
                ) : null
              }
            />
          ))
        ) : (
          <div className="p-4">
            <p className="text-sm font-medium text-fg">
              {hasActiveFilters ? 'No events match these filters' : 'No upcoming events'}
            </p>
            <p className="mt-1 text-sm text-fg-muted">
              {hasActiveFilters
                ? 'Clear the filters to review all upcoming events.'
                : 'Create an event to add it to the calendar.'}
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="mt-3"
              onClick={hasActiveFilters ? onClearFilters : onCreate}
            >
              {hasActiveFilters ? 'Clear filters' : 'Create event'}
            </Button>
          </div>
        )}
      </div>

      {total > EVENT_LIST_PAGE_SIZE ? (
        <nav
          className="mt-3 flex flex-wrap items-center justify-between gap-3"
          aria-label="Calendar events pages"
        >
          <p className="text-xs text-fg-dim">
            {pageStart + 1}-{Math.min(pageStart + events.length, total)} of {total}
          </p>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="icon"
              variant="outline"
              disabled={effectivePage === 0}
              aria-label="Previous events"
              onClick={() => {
                onPageChange(Math.max(0, effectivePage - 1));
              }}
            >
              <ChevronLeft className="size-4" />
            </Button>
            <p className="text-xs text-fg-dim">
              Page {effectivePage + 1} / {pageCount}
            </p>
            <Button
              type="button"
              size="icon"
              variant="outline"
              disabled={effectivePage >= pageCount - 1}
              aria-label="Next events"
              onClick={() => {
                onPageChange(Math.min(pageCount - 1, effectivePage + 1));
              }}
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </nav>
      ) : null}
    </section>
  );
}

function CalendarToolbar({
  mode,
  anchor,
  timezone,
  title,
  today,
  onPush,
  onMove,
  onCreate,
}: {
  mode: CalendarViewMode;
  anchor: Temporal.PlainDate;
  timezone: string;
  title: string;
  today: Temporal.PlainDate;
  onPush: (mode: CalendarViewMode, date: Temporal.PlainDate) => void;
  onMove: (direction: -1 | 1) => void;
  onCreate: () => void;
}) {
  return (
    <section
      className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
      aria-labelledby="calendar-view-heading"
    >
      <div className="flex min-w-0 items-center gap-2">
        <CalendarDays className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div>
          <h2 id="calendar-view-heading" className="text-lg font-semibold">
            {title}
          </h2>
          <p className="text-xs text-muted-foreground">{timezone} · ISO weeks</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <fieldset className="flex items-center gap-1 border-0 p-0">
          <legend className="sr-only">Calendar view</legend>
          {(['month', 'week', 'day'] as const).map((view) => (
            <Button
              key={view}
              type="button"
              variant={mode === view ? 'secondary' : 'outline'}
              size="sm"
              aria-pressed={mode === view}
              onClick={() => {
                onPush(view, anchor);
              }}
            >
              {view === 'month' ? 'Month' : view === 'week' ? 'Week' : 'Day'}
            </Button>
          ))}
        </fieldset>
        <fieldset className="flex items-center gap-1 border-0 p-0">
          <legend className="sr-only">Calendar navigation</legend>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              onMove(-1);
            }}
            aria-label={`Previous ${mode}`}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              onPush(mode, today);
            }}
          >
            Today
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              onMove(1);
            }}
            aria-label={`Next ${mode}`}
          >
            <ChevronRight className="size-4" />
          </Button>
        </fieldset>
        <Button type="button" size="sm" onClick={onCreate}>
          <Plus className="mr-1 size-4" aria-hidden="true" />
          New event
        </Button>
      </div>
    </section>
  );
}

function CalendarSaveStatus({
  saveState,
  surfaceError,
}: {
  saveState: SaveState;
  surfaceError: string | null;
}) {
  if (saveState === 'idle' && !surfaceError) return null;
  return (
    <div
      role={surfaceError ? 'alert' : 'status'}
      aria-live="polite"
      className={`text-xs ${surfaceError ? 'text-danger' : 'text-fg-dim'}`}
    >
      {surfaceError ?? (saveState === 'saving' ? 'Saving…' : 'Saved')}
    </div>
  );
}

function CalendarBody({
  mode,
  gridCols,
  anchor,
  visibleDays,
  eventsByDay,
  timezone,
  today,
  onCreate,
  onEdit,
}: {
  mode: CalendarViewMode;
  gridCols: string;
  anchor: Temporal.PlainDate;
  visibleDays: Temporal.PlainDate[];
  eventsByDay: Map<string, CalendarEvent[]>;
  timezone: string;
  today: Temporal.PlainDate;
  onCreate: (day: Temporal.PlainDate) => void;
  onEdit: (event: CalendarEvent) => void;
}) {
  const calendarLabel = `Calendar for ${titleFor(mode, anchor)}`;
  if (mode === 'day') {
    return (
      <section className="rounded-md border bg-background" aria-label={calendarLabel}>
        <DayCell
          day={anchor}
          anchor={anchor}
          mode="day"
          events={eventsByDay.get(anchor.toString()) ?? []}
          timezone={timezone}
          today={today}
          onCreate={onCreate}
          onEdit={onEdit}
        />
      </section>
    );
  }
  return (
    <section
      className={`grid min-w-0 overflow-hidden ${gridCols} gap-px rounded-md border bg-border`}
      aria-label={calendarLabel}
    >
      <div className="hidden bg-muted/40 p-2 text-center text-xs font-medium text-muted-foreground sm:block">
        <span aria-hidden="true">Wk</span>
        <span className="sr-only">Week number</span>
      </div>
      {WEEKDAYS.map((day) => (
        <div
          key={day.short}
          className="min-w-0 bg-muted/40 p-1 text-center text-xs font-medium text-muted-foreground sm:p-2"
        >
          <abbr title={day.label} className="no-underline">
            {day.short}
          </abbr>
        </div>
      ))}
      {Array.from({ length: Math.ceil(visibleDays.length / 7) }, (_, weekIndex) => {
        const week = visibleDays.slice(weekIndex * 7, weekIndex * 7 + 7);
        return [
          <div
            key={`week-${week[0]?.toString() ?? weekIndex}`}
            className="hidden min-h-28 bg-background p-2 text-center text-xs font-medium text-muted-foreground sm:block"
          >
            <span aria-hidden="true">{week[0]?.weekOfYear}</span>
            <span className="sr-only">Week {week[0]?.weekOfYear}</span>
          </div>,
          ...week.map((day) => (
            <DayCell
              key={day.toString()}
              day={day}
              anchor={anchor}
              mode={mode}
              events={eventsByDay.get(day.toString()) ?? []}
              timezone={timezone}
              today={today}
              onCreate={onCreate}
              onEdit={onEdit}
            />
          )),
        ];
      })}
    </section>
  );
}

function CalendarEventDialog({
  open,
  editing,
  draft,
  error,
  pending,
  timezone,
  titleInputRef,
  members,
  onOpenChange,
  onDraftChange,
  onSave,
  onRemove,
}: {
  open: boolean;
  editing: CalendarEvent | null;
  draft: Draft;
  error: string | null;
  pending: boolean;
  timezone: string;
  titleInputRef: RefObject<HTMLInputElement | null>;
  members: NonNullable<CalendarViewProps['members']>;
  onOpenChange: (open: boolean) => void;
  onDraftChange: Dispatch<SetStateAction<Draft>>;
  onSave: () => void;
  onRemove: () => void;
}) {
  const titleError = error === TITLE_REQUIRED_ERROR ? error : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit event' : 'New event'}</DialogTitle>
          <DialogDescription>
            Times are saved in {timezone}. All-day events use an exclusive end date.
          </DialogDescription>
        </DialogHeader>
        {editing && !editing.redacted ? (
          <div className="flex justify-end">
            <PinButton
              target={{ kind: 'calendar_event', key: editing.id }}
              initialPinned={editing.pinned}
              compact
            />
          </div>
        ) : null}
        <div className="grid gap-4">
          <CalendarDraftFields
            draft={draft}
            members={members}
            titleErrorId={titleError ? 'calendar-title-error' : undefined}
            titleInputRef={titleInputRef}
            onDraftChange={onDraftChange}
          />
          {error ? (
            <p
              id={titleError ? 'calendar-title-error' : undefined}
              role="alert"
              className="text-sm text-destructive"
            >
              {error}
            </p>
          ) : null}
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          <div>
            {editing ? (
              <Button type="button" variant="outline" onClick={onRemove} disabled={pending}>
                <Trash2 className="mr-1 size-4" />
                Delete
              </Button>
            ) : null}
          </div>
          <Button type="button" onClick={onSave} disabled={pending}>
            <Check className="mr-1 size-4" />
            {pending ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CalendarDraftFields({
  draft,
  members,
  titleErrorId,
  titleInputRef,
  onDraftChange,
}: {
  draft: Draft;
  members: NonNullable<CalendarViewProps['members']>;
  titleErrorId?: string;
  titleInputRef: RefObject<HTMLInputElement | null>;
  onDraftChange: Dispatch<SetStateAction<Draft>>;
}) {
  return (
    <>
      <div className="space-y-2">
        <Label htmlFor="calendar-title">Title</Label>
        <Input
          id="calendar-title"
          ref={titleInputRef}
          value={draft.title}
          aria-describedby={titleErrorId}
          aria-invalid={Boolean(titleErrorId)}
          onChange={(e) => {
            onDraftChange((d) => ({ ...d, title: e.target.value }));
          }}
          maxLength={200}
        />
      </div>
      <CalendarDraftOptions draft={draft} members={members} onDraftChange={onDraftChange} />
      <CalendarDraftTimes draft={draft} onDraftChange={onDraftChange} />
      <CalendarDraftRecurrence draft={draft} onDraftChange={onDraftChange} />
      <div className="space-y-2">
        <Label htmlFor="calendar-location">Location</Label>
        <Input
          id="calendar-location"
          value={draft.location}
          onChange={(e) => {
            onDraftChange((d) => ({ ...d, location: e.target.value }));
          }}
          maxLength={500}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="calendar-description">Description</Label>
        <Textarea
          id="calendar-description"
          value={draft.description}
          onChange={(e) => {
            onDraftChange((d) => ({ ...d, description: e.target.value }));
          }}
          rows={3}
          maxLength={2000}
        />
      </div>
    </>
  );
}

function CalendarDraftOptions({
  draft,
  members,
  onDraftChange,
}: {
  draft: Draft;
  members: NonNullable<CalendarViewProps['members']>;
  onDraftChange: Dispatch<SetStateAction<Draft>>;
}) {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
          <input
            type="checkbox"
            checked={draft.allDay}
            onChange={(e) => {
              onDraftChange((d) => ({ ...d, allDay: e.target.checked }));
            }}
          />
          All day
        </label>
        <div className="space-y-1">
          <Label htmlFor="calendar-visibility">Visibility</Label>
          <select
            id="calendar-visibility"
            value={draft.visibility}
            onChange={(e) => {
              onDraftChange((d) => ({ ...d, visibility: e.target.value as Draft['visibility'] }));
            }}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          >
            <option value="team">Team</option>
            <option value="private">Private</option>
            <option value="specific_users">Specific users</option>
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="calendar-show-as">Show as</Label>
          <select
            id="calendar-show-as"
            value={draft.showAs}
            onChange={(e) => {
              onDraftChange((d) => ({ ...d, showAs: e.target.value as Draft['showAs'] }));
            }}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          >
            <option value="busy">Busy</option>
            <option value="tentative">Tentative</option>
            <option value="free">Free</option>
          </select>
        </div>
      </div>
      {draft.visibility === 'specific_users' ? (
        <div className="flex flex-wrap gap-3">
          {members.map((m) => (
            <label key={m.id} className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={draft.visibilityUserIds.includes(m.id)}
                onChange={(e) => {
                  onDraftChange((d) => ({
                    ...d,
                    visibilityUserIds: e.target.checked
                      ? Array.from(new Set([...d.visibilityUserIds, m.id]))
                      : d.visibilityUserIds.filter((id) => id !== m.id),
                  }));
                }}
              />
              {m.label}
            </label>
          ))}
        </div>
      ) : null}
    </>
  );
}

function CalendarDraftRecurrence({
  draft,
  onDraftChange,
}: {
  draft: Draft;
  onDraftChange: Dispatch<SetStateAction<Draft>>;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-[12rem_1fr_12rem]">
      <div className="space-y-2">
        <Label htmlFor="calendar-recurrence-preset">Repeats</Label>
        <select
          id="calendar-recurrence-preset"
          value={recurrencePresetValue(draft.rrule)}
          onChange={(e) => {
            const preset = RECURRENCE_PRESETS.find((item) => item.value === e.target.value);
            if (!preset) return;
            onDraftChange((d) => ({ ...d, rrule: preset.rrule }));
          }}
          className="w-full rounded-md border bg-background px-3 py-2 text-sm"
        >
          {RECURRENCE_PRESETS.map((preset) => (
            <option key={preset.value} value={preset.value}>
              {preset.label}
            </option>
          ))}
          <option value="custom">Custom</option>
        </select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="calendar-rrule">RRULE</Label>
        <Input
          id="calendar-rrule"
          placeholder="FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"
          value={draft.rrule}
          onChange={(e) => {
            onDraftChange((d) => ({ ...d, rrule: e.target.value }));
          }}
          maxLength={2000}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="calendar-recurrence-edit">Edit scope</Label>
        <select
          id="calendar-recurrence-edit"
          value={draft.recurrenceEditMode}
          onChange={(e) => {
            onDraftChange((d) => ({
              ...d,
              recurrenceEditMode: e.target.value as Draft['recurrenceEditMode'],
            }));
          }}
          className="w-full rounded-md border bg-background px-3 py-2 text-sm"
        >
          <option value="single">This event</option>
          <option value="this_and_future">This and future</option>
          <option value="series">Series</option>
        </select>
      </div>
    </div>
  );
}

function CalendarDraftTimes({
  draft,
  onDraftChange,
}: {
  draft: Draft;
  onDraftChange: Dispatch<SetStateAction<Draft>>;
}) {
  if (draft.allDay) {
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="calendar-start-date">Start date</Label>
          <Input
            id="calendar-start-date"
            type="date"
            value={draft.startDate}
            onChange={(e) => {
              onDraftChange((d) => ({ ...d, startDate: e.target.value }));
            }}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="calendar-end-date">End date (exclusive)</Label>
          <Input
            id="calendar-end-date"
            type="date"
            value={draft.endDate}
            onChange={(e) => {
              onDraftChange((d) => ({ ...d, endDate: e.target.value }));
            }}
          />
        </div>
      </div>
    );
  }
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-2">
        <Label htmlFor="calendar-start-time">Start</Label>
        <Input
          id="calendar-start-time"
          type="datetime-local"
          value={draft.startDateTime}
          onChange={(e) => {
            onDraftChange((d) => ({ ...d, startDateTime: e.target.value }));
          }}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="calendar-end-time">End</Label>
        <Input
          id="calendar-end-time"
          type="datetime-local"
          value={draft.endDateTime}
          onChange={(e) => {
            onDraftChange((d) => ({ ...d, endDateTime: e.target.value }));
          }}
        />
      </div>
    </div>
  );
}

function DayCell({
  day,
  anchor,
  mode,
  events,
  timezone,
  today,
  onCreate,
  onEdit,
}: {
  day: Temporal.PlainDate;
  anchor: Temporal.PlainDate;
  mode: CalendarViewMode;
  events: CalendarEvent[];
  timezone: string;
  today: Temporal.PlainDate;
  onCreate: (day: Temporal.PlainDate) => void;
  onEdit: (event: CalendarEvent) => void;
}) {
  const muted = mode === 'month' && day.month !== anchor.month;
  const isToday = Temporal.PlainDate.compare(day, today) === 0;
  const dayLabel = day.toLocaleString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
  return (
    <div
      className={`min-w-0 bg-background p-1 sm:min-h-28 sm:p-2 ${isToday ? 'ring-2 ring-inset ring-signal' : ''}`}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <button
          type="button"
          aria-label={`Create event on ${dayLabel}`}
          onClick={() => {
            onCreate(day);
          }}
          className={`rounded-sm px-1 text-xs font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 ${muted ? 'text-muted-foreground' : ''} ${
            isToday ? 'text-signal' : ''
          }`}
        >
          {day.day}
        </button>
        <span className="text-[10px] text-muted-foreground">W{day.weekOfYear}</span>
      </div>
      <div className="space-y-1">
        {events.map((event) => (
          <button
            key={event.id}
            type="button"
            disabled={event.redacted || event.id.startsWith('optimistic-')}
            onClick={() => {
              onEdit(event);
            }}
            className={`block w-full min-w-0 overflow-hidden rounded-sm px-2 py-1 text-left text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 ${
              event.redacted
                ? 'bg-muted text-muted-foreground italic'
                : event.showAs === 'tentative'
                  ? 'border border-warning/40 bg-warning/10 text-foreground hover:bg-warning/15'
                  : event.allDay
                    ? 'bg-signal/15 text-signal hover:bg-signal/25'
                    : 'bg-primary/10 text-foreground hover:bg-primary/15'
            } disabled:opacity-70`}
          >
            <span className="flex min-w-0 items-center gap-1">
              {event.allDay ? null : <Clock className="size-3" aria-hidden="true" />}
              {event.showAs === 'tentative' ? <span className="text-[11px]">Tentative</span> : null}
              {event.rrule || event.recurringParentId ? (
                <span className="font-mono text-[10px]" aria-label="Recurring">
                  R
                </span>
              ) : null}
              <span className="min-w-0 truncate">
                {event.allDay
                  ? event.redacted
                    ? 'Busy'
                    : event.title
                  : `${formatTime(event, timezone)} ${event.redacted ? 'Busy' : event.title}`}
              </span>
              {!event.redacted ? (
                <Pencil className="hidden size-3 shrink-0 opacity-50 sm:block" aria-hidden="true" />
              ) : null}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

'use client';

import { Temporal } from '@js-temporal/polyfill';
import type { EventVisibility } from '@timeline/db/contracts/workspace-access';
import type {
  CalendarRecurrenceEditMode,
  CalendarShowAs,
} from '@timeline/shared/calendar/contract';
import {
  assertValidTimezone,
  isoWeekYear,
  localDateSpanToUtcRange,
  startOfIsoWeek,
} from '@timeline/shared/time';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  FileText,
  Plus,
  Search,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useTransition,
} from 'react';
import type { Dispatch, RefObject, SetStateAction } from 'react';

import {
  createCalendarEventAction,
  deleteCalendarEventAction,
  updateCalendarEventAction,
} from '@/app/actions/calendar';
import { loadCalendarEventListPageAction } from '@/app/actions/collection-pages';
import { CalendarEventDisclosure } from '@/components/calendar/calendar-event-disclosure';
import type { CalendarEvent } from '@/components/calendar/calendar-overlay';
import {
  EMPTY_CALENDAR_OVERLAY,
  applyCalendarPageOverlay,
  calendarEventsSignature,
  calendarOverlayReducer,
  mergeCalendarEvents,
} from '@/components/calendar/calendar-overlay';
import { EventReminders } from '@/components/calendar/event-reminders';
import { ChatViewContextBinder } from '@/components/chat/chat-view-context';
import { CollectionRow } from '@/components/collections/collection-row';
import { CollectionStatus } from '@/components/collections/collection-status';
import { CollectionToolbar } from '@/components/collections/collection-toolbar';
import { InfiniteScroll } from '@/components/collections/infinite-scroll';
import { VirtualList } from '@/components/collections/virtual-list';
import { EmptyState } from '@/components/empty-state';
import { PinButton } from '@/components/pins/pin-button';
import { PinOverflowMenu } from '@/components/pins/pin-overflow-menu';
import { useAppDialog } from '@/components/ui/app-dialog';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ItemActionGroup } from '@/components/ui/item-actions';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { useRegionalFormat } from '@/components/workspace-timezone-context';
import { chatViewLabel } from '@/lib/chat-view';
import { formatDisplayDateParts } from '@/lib/display-dates';
import { notifyAction } from '@/lib/notify';
import { formatDisplayNumber } from '@/lib/regional-format';
import { statusLabel } from '@/lib/status-labels';
import type { SaveState } from '@/lib/utils';

type CalendarViewMode = 'month' | 'week' | 'day';

interface CalendarViewProps {
  events: CalendarEvent[];
  eventListEvents?: CalendarEvent[];
  eventListTotal?: number;
  eventListNextOffset?: number | null;
  eventListQuery?: string;
  eventListScope?: 'future' | 'past' | 'all';
  timezone: string;
  defaultVisibility?: EventVisibility;
  defaultVisibilityUserIds?: string[] | null;
  members?: { id: string; label: string }[];
  focusEventId?: string | null;
}

const EMPTY_MEMBERS: NonNullable<CalendarViewProps['members']> = [];

interface Draft {
  title: string;
  description: string;
  location: string;
  visibility: EventVisibility;
  visibilityUserIds: string[];
  showAs: CalendarShowAs;
  rrule: string;
  recurrenceEditMode: CalendarRecurrenceEditMode;
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
  if (!rrule.trim()) return '';
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

const TITLE_REQUIRED_ERROR = 'Enter a title for this event.';
type EventListScope = 'future' | 'past' | 'all';
interface EventListParams {
  query: string;
  scope: EventListScope;
}

function sameEventListParams(a: EventListParams, b: EventListParams): boolean {
  return a.query === b.query && a.scope === b.scope;
}

function eventListParamsFromSearch(searchParams: {
  get(name: string): string | null;
}): EventListParams {
  const scope = searchParams.get('eventScope');
  return {
    query: searchParams.get('eventQ')?.trim() ?? '',
    scope: scope === 'past' || scope === 'all' ? scope : 'future',
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
  const range = localDateSpanToUtcRange(
    startDate,
    Temporal.PlainDate.from(endDate).add({ days: 1 }).toString(),
    timezone,
  );
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

function titleFor(mode: CalendarViewMode, anchor: Temporal.PlainDate, locale: string): string {
  if (mode === 'day') {
    return anchor.toLocaleString(locale, { month: 'long', day: 'numeric', year: 'numeric' });
  }
  if (mode === 'week')
    return `Week ${formatDisplayNumber(anchor.weekOfYear ?? 0, locale)}, ${String(isoWeekYear(anchor))}`;
  return anchor.toLocaleString(locale, { month: 'long', year: 'numeric' });
}

function formatEventRange(
  event: CalendarEvent,
  region: ReturnType<typeof useRegionalFormat>,
): string {
  const { locale } = region;
  if (event.allDay) {
    const start = Temporal.Instant.from(event.startAt)
      .toZonedDateTimeISO(assertValidTimezone(event.timezone))
      .toPlainDate();
    const end = Temporal.Instant.from(event.endAt)
      .toZonedDateTimeISO(assertValidTimezone(event.timezone))
      .toPlainDate()
      .subtract({ days: 1 });
    return Temporal.PlainDate.compare(start, end) === 0
      ? start.toLocaleString(locale, { month: 'short', day: 'numeric' })
      : `${start.toLocaleString(locale, { month: 'short', day: 'numeric' })} - ${end.toLocaleString(locale, { month: 'short', day: 'numeric' })}`;
  }
  const parts = { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' } as const;
  return `${formatDisplayDateParts(event.startAt, region, parts)} - ${formatDisplayDateParts(event.endAt, region, parts)}`;
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
    endDate: isoDate(anchor),
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
    endDate: (event.allDay
      ? end.toPlainDate().subtract({ days: 1 })
      : end.toPlainDate()
    ).toString(),
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
  eventListNextOffset = null,
  eventListQuery = '',
  eventListScope = 'future',
  timezone,
  defaultVisibility = 'team',
  defaultVisibilityUserIds = null,
  members = EMPTY_MEMBERS,
  focusEventId = null,
}: CalendarViewProps) {
  const router = useRouter();
  const dialog = useAppDialog();
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
    }),
    [eventListQuery, eventListScope],
  );
  const eventListUrlParams = useMemo(() => {
    if (
      eventListRawUrlParams.query === eventListServerParams.query &&
      eventListRawUrlParams.scope === eventListServerParams.scope
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
  useLayoutEffect(() => {
    eventListParamsRef.current = eventListDisplayParams;
  }, [eventListDisplayParams]);

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
    ({ query, scope }: { query?: string; scope?: 'future' | 'past' | 'all' }) => {
      const next = new URLSearchParams(searchParams.toString());
      const current = eventListParamsRef.current ?? eventListUrlParams;
      const nextQuery = query ?? current.query;
      const nextScope = scope ?? current.scope;
      const nextParams = { query: nextQuery.trim(), scope: nextScope };
      eventListParamsRef.current = nextParams;
      setOptimisticEventListParams({ params: nextParams, sourceSearchParamsKey: searchParamsKey });

      if (nextQuery.trim()) next.set('eventQ', nextQuery.trim());
      else next.delete('eventQ');
      if (nextScope === 'future') next.delete('eventScope');
      else next.set('eventScope', nextScope);
      next.delete('eventPage');

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
          ? 'Enter valid first and last days.'
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
          ? 'Last day must be on or after the start date.'
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
        linkedObjects: editing?.linkedObjects ?? [],
      };
      dispatchCalendarUi({ surfaceError: null });
      if (savedTimer.current) clearTimeout(savedTimer.current);
      dispatchCalendarUi({ saveState: 'saving', open: false });
      dispatchEventOverlay({ type: 'upsert', event: optimisticEvent });
      const result = await notifyAction({
        id: editing ? `calendar:${editing.id}` : 'calendar:create',
        loading: editing ? 'Updating event…' : 'Creating event…',
        success: editing ? 'Event updated' : 'Event created',
        error: editing ? 'Couldn’t update event' : 'Couldn’t create event',
        run: async () => {
          const saved = editing
            ? await updateCalendarEventAction({ id: editing.id, ...input })
            : await createCalendarEventAction(input);
          return saved.ok
            ? saved
            : {
                error: saved.error ?? (editing ? 'Couldn’t update event' : 'Couldn’t create event'),
              };
        },
        undo:
          editing && originalEvent
            ? {
                run: async () => {
                  dispatchEventOverlay({ type: 'restore', event: originalEvent });
                  const undoResult = await updateCalendarEventAction({
                    id: editing.id,
                    title: originalEvent.title,
                    description: originalEvent.description ?? undefined,
                    startAt: originalEvent.startAt,
                    endAt: originalEvent.endAt,
                    timezone: originalEvent.timezone,
                    allDay: originalEvent.allDay,
                    location: originalEvent.location ?? undefined,
                    visibility: originalEvent.visibility as EventVisibility,
                    showAs: originalEvent.showAs,
                    rrule: originalEvent.rrule,
                    recurrenceEditMode: draft.recurrenceEditMode,
                    ...(originalEvent.visibility === 'specific_users'
                      ? { visibilityUserIds: originalEvent.visibilityUserIds ?? [] }
                      : {}),
                  });
                  if (!undoResult.error && undoResult.ok) router.refresh();
                  return undoResult.ok ? undoResult : { error: undoResult.error };
                },
              }
            : undefined,
      });
      if (result.error) {
        if (editing && originalEvent) {
          dispatchEventOverlay({ type: 'restore', event: originalEvent });
        } else {
          dispatchEventOverlay({ type: 'discard', id: optimisticId });
        }
        dispatchCalendarUi({ saveState: 'idle' });
        if (dialogContextRef.current === saveDialogContext) {
          dispatchCalendarUi({ open: true });
        }
        router.refresh();
        return;
      }
      const savedId = 'id' in result ? result.id : undefined;
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
    });
  }

  async function remove() {
    if (!editing) return;
    const recurrenceEditMode = editing.recurringParentId ? draft.recurrenceEditMode : 'series';
    const scopeLabel =
      editing.rrule || editing.recurringParentId
        ? {
            single: 'Only this occurrence',
            this_and_future: 'This and all future occurrences',
            series: 'The entire series',
          }[recurrenceEditMode]
        : 'This event';
    const confirmed = await dialog.confirm({
      title: `Delete ${editing.title}?`,
      description: `${scopeLabel} will be permanently deleted. This cannot be undone.`,
      confirmLabel: 'Delete event',
      destructive: true,
    });
    if (!confirmed) return;
    startTransition(async () => {
      const result = await notifyAction({
        id: `calendar:${editing.id}:delete`,
        loading: 'Deleting event…',
        success: 'Event deleted',
        error: 'Couldn’t delete event',
        run: async () => {
          const deleted = await deleteCalendarEventAction(editing.id, {
            recurrenceEditMode,
          });
          return deleted.ok ? deleted : { error: deleted.error ?? 'Couldn’t delete event' };
        },
      });
      if (result.error) return;
      dispatchEventOverlay({ type: 'remove', id: editing.id });
      dispatchCalendarUi({ open: false });
      router.refresh();
    });
  }

  const gridCols =
    safeMode === 'day' ? 'grid-cols-1' : 'grid-cols-7 sm:grid-cols-[3rem_repeat(7,minmax(0,1fr))]';

  return {
    confirmation: dialog.node,
    anchor,
    currentToday,
    displayEventListEvents,
    draft,
    editing,
    error,
    eventListQuery: eventListDisplayParams.query,
    eventListScope: eventListDisplayParams.scope,
    eventListNextOffset,
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
    focusEventId,
    displayEvents,
    searchParamsKey,
  };
}

function CalendarViewLayout({ model }: { model: ReturnType<typeof useCalendarViewModel> }) {
  const { locale } = useRegionalFormat();
  const focusedEvent =
    model.open && model.editing && !model.editing.redacted
      ? model.editing
      : model.focusEventId
        ? (model.displayEvents.find((event) => event.id === model.focusEventId) ?? null)
        : null;
  const focusedHref = (() => {
    const params = new URLSearchParams(model.searchParamsKey);
    if (focusedEvent) params.set('event', focusedEvent.id);
    const query = params.toString();
    return query ? `/app/calendar?${query}` : '/app/calendar';
  })();

  return (
    <div className="space-y-4">
      {model.confirmation}
      {focusedEvent ? (
        <ChatViewContextBinder
          viewKey={`calendar-event:${focusedEvent.id}`}
          kind="calendar-event"
          href={focusedHref}
          label={chatViewLabel(focusedEvent.title, 'Calendar event')}
          calendarEventId={focusedEvent.id}
        />
      ) : null}
      <CalendarToolbar
        mode={model.safeMode}
        anchor={model.anchor}
        timezone={model.timezone}
        title={titleFor(model.safeMode, model.anchor, locale)}
        today={model.currentToday}
        onPush={model.push}
        onMove={model.move}
        onCreate={() => {
          model.openCreate();
        }}
      />
      <CalendarBody
        mode={model.safeMode}
        gridCols={model.gridCols}
        anchor={model.anchor}
        visibleDays={model.visibleDays}
        eventsByDay={model.eventsByDay}
        timezone={model.timezone}
        today={model.currentToday}
        editingId={model.editing?.id ?? null}
        onCreate={model.openCreate}
        onEdit={model.openEdit}
        onOpenDay={(day) => {
          model.push('day', day);
        }}
      />
      <CalendarEventList
        events={model.displayEventListEvents}
        total={model.eventListTotal}
        nextOffset={model.eventListNextOffset}
        query={model.eventListQuery}
        scope={model.eventListScope}
        onQueryChange={(query) => {
          model.updateEventListParams({ query });
        }}
        onScopeChange={(scope) => {
          model.updateEventListParams({ scope });
        }}
        onCreate={() => {
          model.openCreate(model.anchor);
        }}
        onClearFilters={() => {
          model.updateEventListParams({ query: '', scope: 'future' });
        }}
        onEdit={model.openEdit}
      />
      <CalendarEventDialog
        open={model.open}
        editing={model.editing}
        draft={model.draft}
        error={model.error}
        pending={model.pending}
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

interface CalendarEventListProps {
  events: CalendarEvent[];
  total: number;
  nextOffset: number | null;
  query: string;
  scope: 'future' | 'past' | 'all';
  onQueryChange: (query: string) => void;
  onScopeChange: (scope: 'future' | 'past' | 'all') => void;
  onCreate: () => void;
  onClearFilters: () => void;
  onEdit: (event: CalendarEvent) => void;
}

// react-doctor-disable-next-line react-doctor/no-multi-comp -- Search stays mounted while extra pages remount on filter changes.
function CalendarEventList({
  events,
  total,
  nextOffset,
  query,
  scope,
  onQueryChange,
  onScopeChange,
  onCreate,
  onClearFilters,
  onEdit,
}: CalendarEventListProps) {
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const committedSearchRef = useRef(query);
  const hasActiveFilters = Boolean(query) || scope !== 'future';
  const { locale } = useRegionalFormat();
  const eventCountLabel = formatDisplayNumber(total, locale);

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
        activeFilters={[
          ...(query
            ? [
                {
                  key: 'query',
                  label: 'Search',
                  value: query,
                  onRemove: () => {
                    onQueryChange('');
                  },
                },
              ]
            : []),
          ...(scope !== 'future'
            ? [
                {
                  key: 'scope',
                  label: 'Range',
                  value: scope,
                  onRemove: () => {
                    onScopeChange('future');
                  },
                },
              ]
            : []),
        ]}
      >
        <CollectionToolbar.Count>{eventCountLabel}</CollectionToolbar.Count>
        <CollectionToolbar.Search>
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
        </CollectionToolbar.Search>
        <CollectionToolbar.View>
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
        </CollectionToolbar.View>
      </CollectionToolbar>
      <CalendarEventListPages
        // A refreshed server page invalidates cached later pages after mutations.
        key={JSON.stringify([scope, query, total, nextOffset, events])}
        events={events}
        nextOffset={nextOffset}
        query={query}
        scope={scope}
        hasActiveFilters={hasActiveFilters}
        onCreate={onCreate}
        onClearFilters={onClearFilters}
        onEdit={onEdit}
      />
    </section>
  );
}

interface CalendarEventListPagesProps {
  events: CalendarEvent[];
  nextOffset: number | null;
  query: string;
  scope: 'future' | 'past' | 'all';
  hasActiveFilters: boolean;
  onCreate: () => void;
  onClearFilters: () => void;
  onEdit: (event: CalendarEvent) => void;
}

// react-doctor-disable-next-line react-doctor/no-multi-comp -- Extra pages remount with the filter key instead of syncing props in an effect.
function CalendarEventListPages({
  events,
  nextOffset,
  query,
  scope,
  hasActiveFilters,
  onCreate,
  onClearFilters,
  onEdit,
}: CalendarEventListPagesProps) {
  const region = useRegionalFormat();
  const [extraEvents, setExtraEvents] = useState<CalendarEvent[]>([]);
  const [extraOffset, setExtraOffset] = useState<number | null>(null);
  const [paged, setPaged] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();
  const offset = paged ? extraOffset : nextOffset;
  const loadedEvents = useMemo(() => {
    const seen = new Set(events.map((event) => event.id));
    return [...events, ...extraEvents.filter((event) => !seen.has(event.id))];
  }, [events, extraEvents]);

  return (
    <>
      <div>
        {loadedEvents.length > 0 ? (
          <VirtualList
            items={loadedEvents}
            getItemKey={(event) => event.id}
            estimateSize={56}
            renderItem={(event) => (
              <CollectionRow className="min-h-13">
                <CollectionRow.Title>
                  <button
                    type="button"
                    disabled={event.redacted}
                    className="block min-w-0 whitespace-normal [overflow-wrap:anywhere] rounded-sm text-left hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:opacity-100"
                    onClick={() => {
                      onEdit(event);
                    }}
                  >
                    {event.redacted ? 'Busy' : event.title}
                  </button>
                </CollectionRow.Title>
                <CollectionRow.Context>
                  {[event.location, event.description].filter(Boolean).join(' · ') ||
                    (event.allDay ? 'All day' : statusLabel(event.showAs))}
                </CollectionRow.Context>
                <CollectionRow.Metadata>
                  <>
                    <span className="text-xs text-fg-dim">{formatEventRange(event, region)}</span>
                    <CollectionStatus value={event.showAs} label={statusLabel(event.showAs)} />
                    <span className="text-xs text-fg-dim">{statusLabel(event.visibility)}</span>
                  </>
                </CollectionRow.Metadata>
                <CollectionRow.Actions>
                  {!event.redacted ? (
                    <ItemActionGroup label={`Actions for ${event.title}`}>
                      <PinOverflowMenu
                        target={{ kind: 'calendar_event', key: event.id }}
                        title={event.title}
                        initialPinned={event.pinned}
                      />
                    </ItemActionGroup>
                  ) : null}
                </CollectionRow.Actions>
              </CollectionRow>
            )}
          />
        ) : (
          <EmptyState
            icon={CalendarDays}
            size="inset"
            title={hasActiveFilters ? 'No events match these filters' : 'No upcoming events'}
            body={
              hasActiveFilters
                ? 'Clear the filters to review all upcoming events.'
                : 'Create an event to add it to the calendar.'
            }
          >
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={hasActiveFilters ? onClearFilters : onCreate}
            >
              {hasActiveFilters ? 'Clear filters' : 'Create event'}
            </Button>
          </EmptyState>
        )}
      </div>

      <InfiniteScroll
        hasMore={offset !== null}
        loading={loading}
        error={error}
        onLoadMore={() => {
          if (offset === null || loading) return;
          startLoading(async () => {
            const page = await loadCalendarEventListPageAction({
              offset,
              search: query,
              scope,
            });
            if (page.error) {
              setError(page.error);
              return;
            }
            setError(null);
            setPaged(true);
            setExtraEvents((current) => {
              const seen = new Set(current.map((event) => event.id));
              return [...current, ...page.events.filter((event) => !seen.has(event.id))];
            });
            setExtraOffset(page.nextOffset);
          });
        }}
        boundLabel="No more matching events"
        hideBound={loadedEvents.length === 0}
      />
    </>
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
      <div className="flex min-w-0 flex-wrap items-center gap-x-5 gap-y-2">
        <div>
          <h2 id="calendar-view-heading" className="text-lg font-semibold">
            {title}
          </h2>
          <p className="text-xs text-muted-foreground">{timezone}</p>
        </div>
        <fieldset className="flex items-center gap-1 border-0 p-0">
          <legend className="sr-only">Calendar navigation</legend>
          <Button
            type="button"
            variant="ghost"
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
            variant="ghost"
            size="sm"
            onClick={() => {
              onPush(mode, today);
            }}
          >
            Today
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              onMove(1);
            }}
            aria-label={`Next ${mode}`}
          >
            <ChevronRight className="size-4" />
          </Button>
        </fieldset>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <fieldset className="flex items-center gap-1 border-0 p-0">
          <legend className="sr-only">Calendar view</legend>
          {(['month', 'week', 'day'] as const).map((view) => (
            <Button
              key={view}
              type="button"
              variant={mode === view ? 'secondary' : 'ghost'}
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

        <Button type="button" size="sm" onClick={onCreate}>
          <Plus className="mr-1 size-4" aria-hidden="true" />
          New event
        </Button>
      </div>
    </section>
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
  editingId,
  onCreate,
  onEdit,
  onOpenDay,
}: {
  mode: CalendarViewMode;
  gridCols: string;
  anchor: Temporal.PlainDate;
  visibleDays: Temporal.PlainDate[];
  eventsByDay: Map<string, CalendarEvent[]>;
  timezone: string;
  today: Temporal.PlainDate;
  editingId: string | null;
  onCreate: (day: Temporal.PlainDate) => void;
  onEdit: (event: CalendarEvent) => void;
  onOpenDay: (day: Temporal.PlainDate) => void;
}) {
  const { locale } = useRegionalFormat();
  const calendarLabel = `Calendar for ${titleFor(mode, anchor, locale)}`;
  if (mode === 'day') {
    return (
      <section className="rounded-sm border bg-background" aria-label={calendarLabel}>
        <DayCell
          day={anchor}
          anchor={anchor}
          mode="day"
          events={eventsByDay.get(anchor.toString()) ?? []}
          timezone={timezone}
          today={today}
          editingId={editingId}
          onCreate={onCreate}
          onEdit={onEdit}
          onOpenDay={onOpenDay}
        />
      </section>
    );
  }
  return (
    <section
      className={`grid min-w-0 overflow-hidden ${mode === 'week' ? 'grid-cols-1 sm:grid-cols-[3rem_repeat(7,minmax(0,1fr))]' : gridCols} gap-px rounded-sm border bg-border`}
      aria-label={calendarLabel}
    >
      <div className="hidden bg-muted/40 p-2 text-center text-xs font-medium text-muted-foreground sm:block">
        <span aria-hidden="true">Wk</span>
        <span className="sr-only">Week number</span>
      </div>
      {visibleDays.slice(0, 7).map((day) => (
        <div
          key={day.toString()}
          className={`min-w-0 bg-muted/40 p-1 text-center text-xs font-medium text-muted-foreground sm:p-2 ${mode === 'week' ? 'hidden sm:block' : ''}`}
        >
          <abbr title={day.toLocaleString(locale, { weekday: 'long' })} className="no-underline">
            {day.toLocaleString(locale, { weekday: 'short' })}
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
              editingId={editingId}
              onCreate={onCreate}
              onEdit={onEdit}
              onOpenDay={onOpenDay}
            />
          )),
        ];
      })}
    </section>
  );
}

function linkedObjectContext(object: CalendarEvent['linkedObjects'][number]): string {
  const typeLabel = statusLabel(object.type);
  if (object.relationshipType === 'due_date') return `Due date · ${typeLabel}`;
  if (object.relationshipType === 'related') return typeLabel;
  return `${statusLabel(object.relationshipType)} · ${typeLabel}`;
}

function CalendarLinkedObjectList({ objects }: { objects: CalendarEvent['linkedObjects'] }) {
  if (objects.length === 0) return null;
  return (
    <div className="border-t border-border pt-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-fg-dim">Linked objects</p>
      <ul className="mt-2 space-y-1.5">
        {objects.map((object) => (
          <li key={object.id} className="flex min-w-0 items-baseline gap-2">
            <Link
              href={`/app/objects/${object.id}`}
              className="min-w-0 truncate text-sm font-medium text-fg hover:underline"
            >
              {object.title}
            </Link>
            <span className="shrink-0 text-[11px] text-fg-dim">{linkedObjectContext(object)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CalendarEventDialog({
  open,
  editing,
  draft,
  error,
  pending,
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
  titleInputRef: RefObject<HTMLInputElement | null>;
  members: NonNullable<CalendarViewProps['members']>;
  onOpenChange: (open: boolean) => void;
  onDraftChange: Dispatch<SetStateAction<Draft>>;
  onSave: () => void;
  onRemove: () => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  if (editing?.readOnly) {
    return (
      <ImportedCalendarEventDialog
        event={editing}
        draft={draft}
        open={open}
        onOpenChange={onOpenChange}
      />
    );
  }
  const titleError = error === TITLE_REQUIRED_ERROR ? error : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          headingRef.current?.focus({ preventScroll: true });
        }}
        className="flex max-h-[calc(100dvh-1rem)] max-w-[calc(100%-1rem)] flex-col gap-0 overflow-hidden p-0 sm:max-h-[calc(100dvh-3rem)] sm:max-w-xl sm:p-0"
      >
        <DialogHeader className="shrink-0 flex-row items-center gap-2 border-b border-border py-3 ps-4 pe-3 text-start sm:ps-6 sm:pe-4">
          <span className="grid size-9 shrink-0 place-items-center rounded-md bg-signal-soft text-signal">
            <CalendarDays aria-hidden="true" className="size-[18px]" />
          </span>
          <DialogTitle ref={headingRef} tabIndex={-1} className="flex-1 leading-tight outline-none">
            {editing ? 'Edit event' : 'New event'}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Set the title, schedule and event details.
          </DialogDescription>
          {editing && !editing.redacted && (
            <PinButton
              target={{ kind: 'calendar_event', key: editing.id }}
              initialPinned={editing.pinned}
            />
          )}
          <DialogClose asChild>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-11 shrink-0"
              aria-label="Close"
            >
              <X aria-hidden="true" className="size-4" />
            </Button>
          </DialogClose>
        </DialogHeader>
        <div className="min-h-0 space-y-5 overflow-y-auto overscroll-contain px-4 py-5 sm:px-6">
          <CalendarDraftFields
            draft={draft}
            members={members}
            editing={editing}
            titleError={titleError}
            titleInputRef={titleInputRef}
            onDraftChange={onDraftChange}
          />
        </div>
        <DialogFooter className="shrink-0 flex-row flex-wrap items-center justify-between gap-1.5 border-t border-border bg-background px-4 py-3 sm:justify-between sm:px-6">
          {error && !titleError && (
            <p role="alert" className="basis-full pb-1.5 text-sm text-destructive">
              {error}
            </p>
          )}
          {editing && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="-ms-2.5 min-h-11 text-destructive hover:text-destructive"
              onClick={onRemove}
              disabled={pending}
            >
              <Trash2 aria-hidden="true" className="size-4" />
              Delete
            </Button>
          )}
          <div className="ms-auto flex items-center gap-2">
            <DialogClose asChild>
              <Button size="sm" variant="outline" className="min-h-11" disabled={pending}>
                Cancel
              </Button>
            </DialogClose>
            <Button
              type="button"
              size="sm"
              className="min-h-11 min-w-20"
              onClick={onSave}
              disabled={pending}
            >
              {pending ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ImportedCalendarEventDialog({
  event,
  draft,
  open,
  onOpenChange,
}: {
  event: CalendarEvent;
  draft: Draft;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{event.title}</DialogTitle>
          <DialogDescription>Imported from Google Calendar</DialogDescription>
        </DialogHeader>
        <div className="space-y-2 text-sm">
          <p>
            {draft.allDay ? draft.startDate : draft.startDateTime} –{' '}
            {draft.allDay ? draft.endDate : draft.endDateTime} · {draft.timezone}
          </p>
          {event.location ? <p>{event.location}</p> : null}
          {event.description ? <p className="whitespace-pre-wrap">{event.description}</p> : null}
        </div>
        <div className="overflow-hidden rounded-lg border border-border">
          <EventReminders key={event.id} eventId={event.id} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CalendarDraftFields({
  draft,
  members,
  editing,
  titleError,
  titleInputRef,
  onDraftChange,
}: {
  draft: Draft;
  members: NonNullable<CalendarViewProps['members']>;
  editing: CalendarEvent | null;
  titleError: string | null;
  titleInputRef: RefObject<HTMLInputElement | null>;
  onDraftChange: Dispatch<SetStateAction<Draft>>;
}) {
  const titleErrorId = titleError ? 'calendar-title-error' : undefined;
  const editableEvent = editing?.redacted ? null : editing;

  return (
    <>
      <div className="space-y-1.5">
        <Label htmlFor="calendar-title">Title</Label>
        <Input
          id="calendar-title"
          ref={titleInputRef}
          className="h-11 font-medium md:text-base"
          placeholder="Event name"
          value={draft.title}
          aria-describedby={titleErrorId}
          aria-invalid={Boolean(titleErrorId)}
          onChange={(e) => {
            onDraftChange((d) => ({ ...d, title: e.target.value }));
          }}
          maxLength={200}
        />
        {titleError && (
          <p id={titleErrorId} role="alert" className="text-sm text-destructive">
            {titleError}
          </p>
        )}
      </div>
      <section aria-label="Schedule" className="space-y-3 rounded-lg bg-surface-2 p-3.5 sm:p-4">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <div>
            <h3 className="text-sm font-semibold text-fg">Schedule</h3>
            <p className="text-xs text-fg-muted">{draft.timezone.replaceAll('_', ' ')}</p>
          </div>
          <label className="flex min-h-10 cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={draft.allDay}
              onChange={(e) => {
                onDraftChange((d) => ({ ...d, allDay: e.target.checked }));
              }}
            />
            All day
          </label>
        </div>
        <CalendarDraftTimes draft={draft} onDraftChange={onDraftChange} />
        <CalendarDraftRecurrence
          draft={draft}
          key={editing?.id ?? 'new-event'}
          showEditScope={Boolean(editing?.recurringParentId)}
          onDraftChange={onDraftChange}
        />
      </section>
      <div className="divide-y divide-border overflow-hidden rounded-lg border border-border">
        <CalendarEventDisclosure
          icon={FileText}
          label="Location and description"
          value={draft.location}
        >
          <CalendarDraftNotes draft={draft} onDraftChange={onDraftChange} />
        </CalendarEventDisclosure>
        <CalendarEventDisclosure
          icon={SlidersHorizontal}
          label="Event settings"
          value={`${statusLabel(draft.visibility)} · ${statusLabel(draft.showAs)}`}
        >
          <CalendarDraftOptions draft={draft} members={members} onDraftChange={onDraftChange} />
        </CalendarEventDisclosure>
        {editableEvent && <EventReminders key={editableEvent.id} eventId={editableEvent.id} />}
      </div>
      {editableEvent && <CalendarLinkedObjectList objects={editableEvent.linkedObjects} />}
    </>
  );
}

function CalendarDraftNotes({
  draft,
  onDraftChange,
}: {
  draft: Draft;
  onDraftChange: Dispatch<SetStateAction<Draft>>;
}) {
  return (
    <>
      <div className="space-y-1.5">
        <Label htmlFor="calendar-location">Location</Label>
        <Input
          id="calendar-location"
          value={draft.location}
          placeholder="Place or meeting link"
          onChange={(e) => {
            onDraftChange((d) => ({ ...d, location: e.target.value }));
          }}
          maxLength={500}
        />
      </div>
      <div className="space-y-1.5">
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
  const selectedMemberIds = new Set(draft.visibilityUserIds);
  return (
    <>
      <div className="grid gap-3 min-[390px]:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="calendar-visibility">Visibility</Label>
          <NativeSelect
            id="calendar-visibility"
            value={draft.visibility}
            onChange={(e) => {
              onDraftChange((d) => ({ ...d, visibility: e.target.value as Draft['visibility'] }));
            }}
          >
            <option value="team">Team</option>
            <option value="private">Private</option>
            <option value="specific_users">Specific users</option>
          </NativeSelect>
        </div>
        <div className="space-y-1">
          <Label htmlFor="calendar-show-as">Show as</Label>
          <NativeSelect
            id="calendar-show-as"
            value={draft.showAs}
            onChange={(e) => {
              onDraftChange((d) => ({ ...d, showAs: e.target.value as Draft['showAs'] }));
            }}
          >
            <option value="busy">Busy</option>
            <option value="tentative">Tentative</option>
            <option value="free">Free</option>
          </NativeSelect>
        </div>
      </div>
      {draft.visibility === 'specific_users' ? (
        <div className="flex flex-wrap gap-3">
          {members.map((m) => (
            <label key={m.id} className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={selectedMemberIds.has(m.id)}
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
  showEditScope,
  onDraftChange,
}: {
  draft: Draft;
  showEditScope: boolean;
  onDraftChange: Dispatch<SetStateAction<Draft>>;
}) {
  const [customSelected, setCustomSelected] = useState(false);
  const repeat = customSelected ? 'custom' : recurrencePresetValue(draft.rrule);

  return (
    <div className="grid gap-3 min-[500px]:grid-cols-2">
      <div className={showEditScope ? 'space-y-1.5' : 'space-y-1.5 min-[500px]:col-span-2'}>
        <Label htmlFor="calendar-recurrence-preset">Repeats</Label>
        <NativeSelect
          id="calendar-recurrence-preset"
          value={repeat}
          onChange={(e) => {
            const custom = e.target.value === 'custom';
            setCustomSelected(custom);
            if (custom) return;
            const preset = RECURRENCE_PRESETS.find((item) => item.value === e.target.value);
            if (!preset) return;
            onDraftChange((d) => ({ ...d, rrule: preset.rrule }));
          }}
        >
          {RECURRENCE_PRESETS.map((preset) => (
            <option key={preset.value} value={preset.value}>
              {preset.label}
            </option>
          ))}
          <option value="custom">Custom rule</option>
        </NativeSelect>
      </div>
      {showEditScope && (
        <div className="space-y-1.5">
          <Label htmlFor="calendar-recurrence-edit">Edit scope</Label>
          <NativeSelect
            id="calendar-recurrence-edit"
            value={draft.recurrenceEditMode}
            onChange={(e) => {
              onDraftChange((d) => ({
                ...d,
                recurrenceEditMode: e.target.value as Draft['recurrenceEditMode'],
              }));
            }}
          >
            <option value="single">This event</option>
            <option value="this_and_future">This and future</option>
            <option value="series">Entire series</option>
          </NativeSelect>
        </div>
      )}
      {repeat === 'custom' && (
        <div className="space-y-1.5 min-[500px]:col-span-2">
          <Label htmlFor="calendar-rrule">Recurrence rule (RRULE)</Label>
          <Input
            id="calendar-rrule"
            className="font-mono md:text-xs"
            placeholder="FREQ=WEEKLY;BYDAY=MO,WE,FR"
            value={draft.rrule}
            onChange={(e) => {
              setCustomSelected(true);
              onDraftChange((d) => ({ ...d, rrule: e.target.value }));
            }}
            maxLength={2000}
          />
        </div>
      )}
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
      <div className="grid gap-3 min-[500px]:grid-cols-2">
        <div className="space-y-1.5">
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
        <div className="space-y-1.5">
          <Label htmlFor="calendar-end-date">Last day (included)</Label>
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
    <div className="grid gap-3 min-[500px]:grid-cols-2">
      <div className="space-y-1.5">
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
      <div className="space-y-1.5">
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
  editingId,
  onCreate,
  onEdit,
  onOpenDay,
}: {
  day: Temporal.PlainDate;
  anchor: Temporal.PlainDate;
  mode: CalendarViewMode;
  events: CalendarEvent[];
  timezone: string;
  today: Temporal.PlainDate;
  editingId: string | null;
  onCreate: (day: Temporal.PlainDate) => void;
  onEdit: (event: CalendarEvent) => void;
  onOpenDay: (day: Temporal.PlainDate) => void;
}) {
  const { locale } = useRegionalFormat();
  const muted = mode === 'month' && day.month !== anchor.month;
  const isToday = Temporal.PlainDate.compare(day, today) === 0;
  const dayLabel = day.toLocaleString(locale, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
  const monthCap = 3;
  const visibleEvents =
    mode === 'month' && events.length > monthCap ? events.slice(0, monthCap) : events;
  const overflow = mode === 'month' ? Math.max(0, events.length - monthCap) : 0;
  return (
    <div
      className={`min-w-0 p-2 sm:min-h-28 ${muted ? 'bg-surface-2 text-fg-dim' : 'bg-background'}`}
    >
      <div className="mb-1 flex items-center justify-between gap-1">
        <button
          type="button"
          aria-label={`Create event on ${dayLabel}`}
          onClick={() => {
            onCreate(day);
          }}
          data-mode={mode}
          className={`min-h-11 sm:min-h-6 data-[mode=month]:min-h-6 min-w-6 rounded-sm px-1 text-xs font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 ${muted ? 'text-muted-foreground' : ''} ${
            isToday ? 'bg-signal text-signal-fg hover:bg-signal' : ''
          }`}
        >
          <CalendarDateLabel day={day} mode={mode} />
        </button>
      </div>
      {mode === 'month' && events.length > 0 ? (
        <button
          type="button"
          aria-label={`${events.length} ${events.length === 1 ? 'event' : 'events'} on ${dayLabel}; open day`}
          onClick={() => {
            onOpenDay(day);
          }}
          className="flex min-h-11 w-full flex-col items-center justify-center rounded-sm bg-signal-soft text-signal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:hidden"
        >
          <span className="text-sm font-medium">{events.length}</span>
          <span className="text-[10px]">{events.length === 1 ? 'event' : 'events'}</span>
        </button>
      ) : null}
      <div className={mode === 'month' ? 'hidden space-y-0.5 sm:block' : 'space-y-0.5'}>
        {visibleEvents.map((event) => {
          const title = event.redacted ? 'Busy' : event.title;
          const selected = editingId === event.id;
          return (
            <button
              key={event.id}
              type="button"
              disabled={event.redacted || event.id.startsWith('optimistic-')}
              onClick={() => {
                onEdit(event);
              }}
              className={`block min-h-11 sm:min-h-6 w-full min-w-0 overflow-hidden rounded-sm px-1 py-0.5 text-left text-[11px] leading-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                event.redacted
                  ? 'bg-muted text-muted-foreground italic'
                  : event.showAs === 'tentative'
                    ? 'bg-warning/10 text-foreground hover:bg-warning/15'
                    : event.allDay
                      ? 'bg-signal/15 text-signal hover:bg-signal/25'
                      : 'bg-primary/10 text-foreground hover:bg-primary/15'
              } ${selected ? 'ring-1 ring-signal' : ''} disabled:opacity-70`}
            >
              <span className="flex min-w-0 flex-wrap items-center gap-x-1">
                {event.showAs === 'tentative' ? (
                  <span
                    className="size-1.5 shrink-0 rounded-full bg-warning"
                    aria-label={
                      event.rrule || event.recurringParentId ? 'Tentative recurring' : 'Tentative'
                    }
                  />
                ) : event.rrule || event.recurringParentId ? (
                  <span
                    className="size-1.5 shrink-0 rounded-full bg-current opacity-50"
                    aria-label="Recurring"
                  />
                ) : (
                  <span
                    className="size-1.5 shrink-0 rounded-full bg-current opacity-40"
                    aria-hidden="true"
                  />
                )}
                {event.allDay ? null : (
                  <span className="shrink-0 font-mono text-[10px] tabular-nums text-fg-dim">
                    {formatDisplayDateParts(
                      event.startAt,
                      { locale, timezone },
                      { hour: '2-digit', minute: '2-digit' },
                    )}
                  </span>
                )}
                <span className="order-first line-clamp-2 w-full min-w-0 font-medium">{title}</span>
              </span>
            </button>
          );
        })}
        {overflow > 0 ? (
          <button
            type="button"
            onClick={() => {
              onOpenDay(day);
            }}
            className="w-full truncate px-1 text-left text-[11px] text-fg-dim hover:text-fg"
          >
            +{overflow} more
          </button>
        ) : null}
      </div>
    </div>
  );
}

function CalendarDateLabel({ day, mode }: { day: Temporal.PlainDate; mode: CalendarViewMode }) {
  const { locale } = useRegionalFormat();
  const dayNumber = formatDisplayNumber(day.day, locale);
  if (mode !== 'week') return dayNumber;
  return (
    <>
      <span className="sm:hidden">
        {day.toLocaleString(locale, { weekday: 'short', month: 'short', day: 'numeric' })}
      </span>
      <span className="hidden sm:inline">{dayNumber}</span>
    </>
  );
}

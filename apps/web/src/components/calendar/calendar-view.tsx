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
  Trash2,
} from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useReducer, useRef, useTransition } from 'react';

import type { CalendarEvent } from '@/components/calendar/calendar-overlay';
import type { SaveState } from '@/lib/utils';
import type { Dispatch, SetStateAction } from 'react';

import {
  createCalendarEventAction,
  deleteCalendarEventAction,
  updateCalendarEventAction,
} from '@/app/actions/calendar';
import {
  EMPTY_CALENDAR_OVERLAY,
  calendarEventsSignature,
  calendarOverlayReducer,
  mergeCalendarEvents,
} from '@/components/calendar/calendar-overlay';
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
import { errorMessage } from '@/lib/utils';

type CalendarViewMode = 'month' | 'week' | 'day';

interface CalendarViewProps {
  events: CalendarEvent[];
  timezone: string;
  defaultVisibility?: 'team' | 'private' | 'specific_users';
  defaultVisibilityUserIds?: string[] | null;
  members?: { id: string; label: string }[];
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
  return RECURRENCE_PRESETS.find((preset) => preset.rrule === rrule.trim())?.value ?? 'custom';
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

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

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
    return anchor.toLocaleString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  }
  if (mode === 'week') return `Week ${String(anchor.weekOfYear)}, ${String(isoWeekYear(anchor))}`;
  return anchor.toLocaleString('en-US', { month: 'long', year: 'numeric' });
}

function formatTime(event: CalendarEvent, timezone: string): string {
  const start = Temporal.Instant.from(event.startAt).toZonedDateTimeISO(timezone);
  return start.toLocaleString('en-US', { hour: '2-digit', minute: '2-digit' });
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

function CalendarViewContent({
  events,
  timezone,
  defaultVisibility = 'team',
  defaultVisibilityUserIds = null,
  members = EMPTY_MEMBERS,
}: CalendarViewProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
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
  const dialogContextRef = useRef(0);
  const serverEventsSnapshotRef = useRef<{
    signature: string;
    ids: string[];
  } | null>(null);

  useEffect(() => {
    return () => {
      if (savedTimer.current) clearTimeout(savedTimer.current);
    };
  }, []);

  useEffect(() => {
    const signature = calendarEventsSignature(events);
    const ids = events.map((event) => event.id);
    const previous = serverEventsSnapshotRef.current;
    if (!previous) {
      serverEventsSnapshotRef.current = { signature, ids };
      return;
    }
    if (previous.signature === signature || pending) return;
    serverEventsSnapshotRef.current = { signature, ids };
    dispatchEventOverlay({
      type: 'reconcile-server-events',
      currentIds: ids,
      previousIds: previous.ids,
    });
  }, [events, pending]);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    const displayEvents = mergeCalendarEvents(events, eventOverlay);
    for (const day of visibleDays) {
      const matches = displayEvents
        .filter((event) => eventTouchesDate(event, day, timezone))
        .sort((a, b) => a.startAt.localeCompare(b.startAt));
      map.set(day.toString(), matches);
    }
    return map;
  }, [events, eventOverlay, timezone, visibleDays]);

  function push(nextMode: CalendarViewMode, nextDate: Temporal.PlainDate) {
    router.push(`/app/calendar?view=${nextMode}&date=${nextDate.toString()}`);
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
      dispatchCalendarUi({ error: 'Title is required.' });
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

  const gridCols = safeMode === 'day' ? 'grid-cols-1' : 'grid-cols-[3rem_repeat(7,minmax(0,1fr))]';

  return (
    <div className="space-y-4">
      <CalendarToolbar
        mode={safeMode}
        anchor={anchor}
        timezone={timezone}
        title={titleFor(safeMode, anchor)}
        today={currentToday}
        onPush={push}
        onMove={move}
        onCreate={() => {
          openCreate();
        }}
      />
      <CalendarSaveStatus saveState={saveState} surfaceError={surfaceError} />
      <CalendarBody
        mode={safeMode}
        gridCols={gridCols}
        anchor={anchor}
        visibleDays={visibleDays}
        eventsByDay={eventsByDay}
        timezone={timezone}
        today={currentToday}
        onCreate={openCreate}
        onEdit={openEdit}
      />
      <CalendarEventDialog
        open={open}
        editing={editing}
        draft={draft}
        error={error}
        pending={pending}
        timezone={timezone}
        members={members}
        onOpenChange={(nextOpen) => {
          dispatchCalendarUi({ open: nextOpen });
        }}
        onDraftChange={(action) => {
          dispatchCalendarUi((current) => ({
            ...current,
            draft: typeof action === 'function' ? action(current.draft) : action,
          }));
        }}
        onSave={save}
        onRemove={remove}
      />
    </div>
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
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <CalendarDays className="size-5 text-muted-foreground" />
        <div>
          <h2 className="text-lg font-semibold">{title}</h2>
          <p className="text-xs text-muted-foreground">{timezone} · ISO weeks</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        {(['month', 'week', 'day'] as const).map((view) => (
          <Button
            key={view}
            variant={mode === view ? 'default' : 'outline'}
            size="sm"
            onClick={() => {
              onPush(view, anchor);
            }}
          >
            {view}
          </Button>
        ))}
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            onMove(-1);
          }}
          aria-label="Previous"
        >
          <ChevronLeft className="size-4" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            onPush(mode, today);
          }}
        >
          Today
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            onMove(1);
          }}
          aria-label="Next"
        >
          <ChevronRight className="size-4" />
        </Button>
        <Button size="sm" onClick={onCreate}>
          <Plus className="mr-1 size-4" />
          New
        </Button>
      </div>
    </div>
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
      className={`font-mono text-[11px] uppercase tracking-[0.12em] ${
        surfaceError ? 'text-danger' : 'text-fg-dim'
      }`}
    >
      {surfaceError ?? (saveState === 'saving' ? 'Saving...' : 'Saved')}
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
  if (mode === 'day') {
    return (
      <div className="rounded-lg border bg-background">
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
      </div>
    );
  }
  return (
    <div className={`grid ${gridCols} gap-px rounded-lg border bg-border`}>
      <div className="bg-muted/40 p-2 text-center text-xs font-medium text-muted-foreground">
        Wk
      </div>
      {WEEKDAYS.map((day) => (
        <div
          key={day}
          className="bg-muted/40 p-2 text-center text-xs font-medium text-muted-foreground"
        >
          {day}
        </div>
      ))}
      {Array.from({ length: Math.ceil(visibleDays.length / 7) }, (_, weekIndex) => {
        const week = visibleDays.slice(weekIndex * 7, weekIndex * 7 + 7);
        return [
          <div
            key={`week-${week[0]?.toString() ?? weekIndex}`}
            className="min-h-28 bg-background p-2 text-center text-xs font-medium text-muted-foreground"
          >
            {week[0]?.weekOfYear}
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
    </div>
  );
}

function CalendarEventDialog({
  open,
  editing,
  draft,
  error,
  pending,
  timezone,
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
  members: NonNullable<CalendarViewProps['members']>;
  onOpenChange: (open: boolean) => void;
  onDraftChange: Dispatch<SetStateAction<Draft>>;
  onSave: () => void;
  onRemove: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit event' : 'New event'}</DialogTitle>
          <DialogDescription>
            Times are saved in {timezone}. All-day events use an exclusive end date.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <CalendarDraftFields draft={draft} members={members} onDraftChange={onDraftChange} />
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
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
            {pending ? 'Saving...' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CalendarDraftFields({
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
      <div className="space-y-2">
        <Label htmlFor="calendar-title">Title</Label>
        <Input
          id="calendar-title"
          value={draft.title}
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
  return (
    <div className={`min-h-28 bg-background p-2 ${isToday ? 'ring-2 ring-inset ring-signal' : ''}`}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => {
            onCreate(day);
          }}
          className={`rounded px-1 text-xs font-medium hover:bg-accent ${muted ? 'text-muted-foreground' : ''} ${
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
            disabled={event.id.startsWith('optimistic-')}
            onClick={() => {
              onEdit(event);
            }}
            className={`block w-full truncate rounded px-2 py-1 text-left text-xs ${
              event.redacted
                ? 'bg-muted text-muted-foreground italic'
                : event.showAs === 'tentative'
                  ? 'border border-warning/40 bg-warning/10 text-foreground hover:bg-warning/15'
                  : event.allDay
                    ? 'bg-signal/15 text-signal hover:bg-signal/25'
                    : 'bg-primary/10 text-foreground hover:bg-primary/15'
            } disabled:opacity-70`}
          >
            <span className="inline-flex items-center gap-1">
              {event.allDay ? null : <Clock className="size-3" />}
              {event.showAs === 'tentative' ? (
                <span className="font-mono text-[10px] uppercase">Tentative</span>
              ) : null}
              {event.rrule || event.recurringParentId ? (
                <span className="font-mono text-[10px]" aria-label="Recurring">
                  R
                </span>
              ) : null}
              {event.allDay ? event.title : `${formatTime(event, timezone)} ${event.title}`}
              {!event.redacted ? <Pencil className="size-3 opacity-50" /> : null}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

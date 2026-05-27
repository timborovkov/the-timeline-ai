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
import { useMemo, useState, useTransition } from 'react';

import {
  createCalendarEventAction,
  deleteCalendarEventAction,
  updateCalendarEventAction,
} from '@/app/actions/calendar';
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

type CalendarViewMode = 'month' | 'week' | 'day';

interface CalendarEvent {
  id: string;
  title: string;
  description: string | null;
  startAt: string;
  endAt: string;
  timezone: string;
  allDay: boolean;
  location: string | null;
  redacted: boolean;
  visibility: string;
}

interface CalendarViewProps {
  events: CalendarEvent[];
  timezone: string;
}

interface Draft {
  title: string;
  description: string;
  location: string;
  visibility: 'team' | 'private' | 'specific_users';
  allDay: boolean;
  timezone: string;
  startDate: string;
  endDate: string;
  startDateTime: string;
  endDateTime: string;
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

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
  const start = Temporal.Instant.from(event.startAt)
    .toZonedDateTimeISO(displayTimezone)
    .toPlainDate();
  const rawEnd = Temporal.Instant.from(event.endAt)
    .toZonedDateTimeISO(displayTimezone)
    .toPlainDate();
  const end = event.allDay ? rawEnd.subtract({ days: 1 }) : rawEnd;
  return Temporal.PlainDate.compare(start, date) <= 0 && Temporal.PlainDate.compare(end, date) >= 0;
}

function blankDraft(anchor: Temporal.PlainDate, timezone: string): Draft {
  const next = anchor.add({ days: 1 });
  return {
    title: '',
    description: '',
    location: '',
    visibility: 'team',
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
    allDay: event.allDay,
    timezone: displayTimezone,
    startDate: start.toPlainDate().toString(),
    endDate: end.toPlainDate().toString(),
    startDateTime: start.toString({ smallestUnit: 'minute' }),
    endDateTime: end.toString({ smallestUnit: 'minute' }),
  };
}

export function CalendarView({ events, timezone }: CalendarViewProps) {
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
  const [editing, setEditing] = useState<CalendarEvent | null>(null);
  const [draft, setDraft] = useState<Draft>(() => blankDraft(anchor, timezone));
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const day of visibleDays) {
      const matches = events
        .filter((event) => eventTouchesDate(event, day, timezone))
        .sort((a, b) => a.startAt.localeCompare(b.startAt));
      map.set(day.toString(), matches);
    }
    return map;
  }, [events, timezone, visibleDays]);

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
    setEditing(null);
    setDraft(blankDraft(day, timezone));
    setError(null);
    setOpen(true);
  }

  function openEdit(event: CalendarEvent) {
    if (event.redacted) return;
    setEditing(event);
    setDraft(draftFromEvent(event, timezone));
    setError(null);
    setOpen(true);
  }

  function save() {
    setError(null);
    const title = draft.title.trim();
    if (!title) {
      setError('Title is required.');
      return;
    }
    const times = draft.allDay
      ? dateSpan(draft.startDate, draft.endDate, draft.timezone)
      : {
          start: localDateTime(draft.startDateTime, draft.timezone),
          end: localDateTime(draft.endDateTime, draft.timezone),
        };
    if (
      Temporal.Instant.compare(
        Temporal.Instant.from(times.end),
        Temporal.Instant.from(times.start),
      ) <= 0
    ) {
      setError(
        draft.allDay ? 'Exclusive end date must be after start date.' : 'End must be after start.',
      );
      return;
    }
    startTransition(async () => {
      const input = {
        title,
        description: draft.description.trim() || undefined,
        startAt: times.start,
        endAt: times.end,
        timezone: draft.timezone,
        allDay: draft.allDay,
        location: draft.location.trim() || undefined,
        visibility: draft.visibility,
      };
      const result = editing
        ? await updateCalendarEventAction({ id: editing.id, ...input })
        : await createCalendarEventAction(input);
      if (!result.ok) {
        setError(result.error ?? 'Failed to save event.');
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  function remove() {
    if (!editing) return;
    startTransition(async () => {
      const result = await deleteCalendarEventAction(editing.id);
      if (!result.ok) {
        setError(result.error ?? 'Failed to delete event.');
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  const gridCols = safeMode === 'day' ? 'grid-cols-1' : 'grid-cols-[3rem_repeat(7,minmax(0,1fr))]';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-5 w-5 text-muted-foreground" />
          <div>
            <h2 className="text-lg font-semibold">{titleFor(safeMode, anchor)}</h2>
            <p className="text-xs text-muted-foreground">{timezone} · ISO weeks</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {(['month', 'week', 'day'] as const).map((view) => (
            <Button
              key={view}
              variant={safeMode === view ? 'default' : 'outline'}
              size="sm"
              onClick={() => {
                push(view, anchor);
              }}
            >
              {view}
            </Button>
          ))}
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              move(-1);
            }}
            aria-label="Previous"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              push(safeMode, currentToday);
            }}
          >
            Today
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              move(1);
            }}
            aria-label="Next"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button
            size="sm"
            onClick={() => {
              openCreate();
            }}
          >
            <Plus className="mr-1 h-4 w-4" />
            New
          </Button>
        </div>
      </div>

      {safeMode !== 'day' ? (
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
                  mode={safeMode}
                  events={eventsByDay.get(day.toString()) ?? []}
                  timezone={timezone}
                  today={currentToday}
                  onCreate={openCreate}
                  onEdit={openEdit}
                />
              )),
            ];
          })}
        </div>
      ) : (
        <div className="rounded-lg border bg-background">
          <DayCell
            day={anchor}
            anchor={anchor}
            mode="day"
            events={eventsByDay.get(anchor.toString()) ?? []}
            timezone={timezone}
            today={currentToday}
            onCreate={openCreate}
            onEdit={openEdit}
          />
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit event' : 'New event'}</DialogTitle>
            <DialogDescription>
              Times are saved in {timezone}. All-day events use an exclusive end date.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="space-y-2">
              <Label htmlFor="calendar-title">Title</Label>
              <Input
                id="calendar-title"
                value={draft.title}
                onChange={(e) => {
                  setDraft((d) => ({ ...d, title: e.target.value }));
                }}
                maxLength={200}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  checked={draft.allDay}
                  onChange={(e) => {
                    setDraft((d) => ({ ...d, allDay: e.target.checked }));
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
                    setDraft((d) => ({ ...d, visibility: e.target.value as Draft['visibility'] }));
                  }}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                >
                  <option value="team">Team</option>
                  <option value="private">Private</option>
                  {draft.visibility === 'specific_users' ? (
                    <option value="specific_users">Specific users</option>
                  ) : null}
                </select>
              </div>
            </div>
            {draft.allDay ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="calendar-start-date">Start date</Label>
                  <Input
                    id="calendar-start-date"
                    type="date"
                    value={draft.startDate}
                    onChange={(e) => {
                      setDraft((d) => ({ ...d, startDate: e.target.value }));
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
                      setDraft((d) => ({ ...d, endDate: e.target.value }));
                    }}
                  />
                </div>
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="calendar-start-time">Start</Label>
                  <Input
                    id="calendar-start-time"
                    type="datetime-local"
                    value={draft.startDateTime}
                    onChange={(e) => {
                      setDraft((d) => ({ ...d, startDateTime: e.target.value }));
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
                      setDraft((d) => ({ ...d, endDateTime: e.target.value }));
                    }}
                  />
                </div>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="calendar-location">Location</Label>
              <Input
                id="calendar-location"
                value={draft.location}
                onChange={(e) => {
                  setDraft((d) => ({ ...d, location: e.target.value }));
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
                  setDraft((d) => ({ ...d, description: e.target.value }));
                }}
                rows={3}
                maxLength={2000}
              />
            </div>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </div>
          <DialogFooter className="gap-2 sm:justify-between">
            <div>
              {editing ? (
                <Button type="button" variant="outline" onClick={remove} disabled={pending}>
                  <Trash2 className="mr-1 h-4 w-4" />
                  Delete
                </Button>
              ) : null}
            </div>
            <Button type="button" onClick={save} disabled={pending}>
              <Check className="mr-1 h-4 w-4" />
              {pending ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
            onClick={() => {
              onEdit(event);
            }}
            className={`block w-full truncate rounded px-2 py-1 text-left text-xs ${
              event.redacted
                ? 'bg-muted text-muted-foreground italic'
                : event.allDay
                  ? 'bg-signal/15 text-signal hover:bg-signal/25'
                  : 'bg-primary/10 text-foreground hover:bg-primary/15'
            }`}
          >
            <span className="inline-flex items-center gap-1">
              {event.allDay ? null : <Clock className="h-3 w-3" />}
              {event.allDay ? event.title : `${formatTime(event, timezone)} ${event.title}`}
              {!event.redacted ? <Pencil className="h-3 w-3 opacity-50" /> : null}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

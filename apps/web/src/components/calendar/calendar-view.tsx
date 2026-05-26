'use client';

import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMemo } from 'react';

import { Button } from '@/components/ui/button';

interface CalendarEvent {
  id: string;
  title: string;
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
}

function getDaysInMonth(year: number, month: number): Date[] {
  const days: Date[] = [];
  const date = new Date(Date.UTC(year, month, 1));
  while (date.getUTCMonth() === month) {
    days.push(new Date(date));
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return days;
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

function dayKey(date: Date): string {
  return `${String(date.getUTCFullYear())}-${String(date.getUTCMonth())}-${String(date.getUTCDate())}`;
}

function formatTime(dateStr: string, timezone: string): string {
  return new Date(dateStr).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: timezone,
  });
}

export function CalendarView({ events }: CalendarViewProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const yearParam = searchParams.get('year');
  const monthParam = searchParams.get('month');
  const now = new Date();
  const rawYear = yearParam ? parseInt(yearParam, 10) : NaN;
  const rawMonth = monthParam ? parseInt(monthParam, 10) : NaN;
  const year = Number.isFinite(rawYear) ? rawYear : now.getFullYear();
  const month =
    Number.isFinite(rawMonth) && rawMonth >= 0 && rawMonth <= 11 ? rawMonth : now.getMonth();

  const days = useMemo(() => getDaysInMonth(year, month), [year, month]);
  const firstDayOfWeek = new Date(Date.UTC(year, month, 1)).getUTCDay();

  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const ev of events) {
      const start = new Date(ev.startAt);
      const end = new Date(ev.endAt);
      for (const day of days) {
        const nextDay = new Date(day);
        nextDay.setUTCDate(nextDay.getUTCDate() + 1);
        if (start < nextDay && end > day) {
          const key = dayKey(day);
          const list = map.get(key) ?? [];
          list.push(ev);
          map.set(key, list);
        }
      }
    }
    for (const dayEvents of map.values()) {
      dayEvents.sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());
    }
    return map;
  }, [days, events]);

  function navigate(direction: -1 | 1) {
    let newMonth = month + direction;
    let newYear = year;
    if (newMonth < 0) {
      newMonth = 11;
      newYear -= 1;
    } else if (newMonth > 11) {
      newMonth = 0;
      newYear += 1;
    }
    router.push(`/app/calendar?year=${String(newYear)}&month=${String(newMonth)}`);
  }

  const monthName = new Date(Date.UTC(year, month, 1)).toLocaleString('default', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-lg font-semibold">{monthName}</h2>
        </div>
        <div className="flex gap-1">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              navigate(-1);
            }}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              router.push('/app/calendar');
            }}
          >
            Today
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              navigate(1);
            }}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-7 text-center text-xs font-medium text-muted-foreground">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
          <div key={d} className="py-2">
            {d}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-px rounded-lg border bg-border">
        {Array.from({ length: firstDayOfWeek }).map((_, i) => (
          <div key={`pad-${String(i)}`} className="min-h-24 bg-background p-1" />
        ))}
        {days.map((day) => {
          const key = dayKey(day);
          const dayEvents = eventsByDay.get(key) ?? [];
          const isToday = isSameDay(day, now);

          return (
            <div
              key={key}
              className={`min-h-24 bg-background p-1 ${isToday ? 'ring-2 ring-inset ring-signal' : ''}`}
            >
              <div
                className={`mb-1 text-xs ${isToday ? 'font-bold text-signal' : 'text-muted-foreground'}`}
              >
                {String(day.getUTCDate())}
              </div>
              <div className="space-y-0.5">
                {dayEvents.slice(0, 3).map((ev) => (
                  <Link
                    key={ev.id}
                    href={`/app/calendar/${ev.id}`}
                    className={`block truncate rounded px-1 text-xs ${
                      ev.redacted
                        ? 'bg-muted text-muted-foreground italic'
                        : 'bg-signal/10 text-signal hover:bg-signal/20'
                    }`}
                  >
                    {ev.allDay ? ev.title : `${formatTime(ev.startAt, ev.timezone)} ${ev.title}`}
                  </Link>
                ))}
                {dayEvents.length > 3 ? (
                  <span className="block text-xs text-muted-foreground">
                    +{String(dayEvents.length - 3)} more
                  </span>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

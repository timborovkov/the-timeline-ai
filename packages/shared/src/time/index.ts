import { Temporal } from '@js-temporal/polyfill';

const LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const UTC_MIDNIGHT_PATTERN = /^\d{4}-\d{2}-\d{2}T00:00:00(?:\.0+)?Z$/;

export const DEFAULT_DUE_SOON_DAYS = 14;

export type DueDateStatus = 'missing' | 'overdue' | 'today' | 'due_soon' | 'scheduled' | 'invalid';

export interface DueDatePresentation {
  status: DueDateStatus;
  dateKey: string | null;
  dateLabel: string | null;
  label: string;
  compactText: string;
  tone: 'danger' | 'signal' | 'neutral' | 'muted';
}

export interface PresentDueDateOptions {
  timezone: string;
  now?: Date;
  locale?: string;
  dueSoonDays?: number;
}

export interface DueDateRangeFilter {
  timezone: string;
  from?: string;
  to?: string;
}

export interface WorkspaceDueDateBoundaries {
  today: string;
  tomorrow: string;
  next7: string;
  dueSoonEnd: string;
}

const WEEKDAYS: Record<string, number> = {
  monday: 1,
  mon: 1,
  tuesday: 2,
  tue: 2,
  wednesday: 3,
  wed: 3,
  thursday: 4,
  thu: 4,
  friday: 5,
  fri: 5,
  saturday: 6,
  sat: 6,
  sunday: 7,
  sun: 7,
};

export interface WorkspaceTimeContext {
  timezone: string;
  now: string;
  today: string;
  isoWeek: number;
  isoWeekYear: number;
}

export interface ResolvedTimeRange {
  phrase: string;
  timezone: string;
  localStartDate: string;
  localEndDate: string;
  from: Date;
  to: Date;
  explanation: string;
}

export function assertValidTimezone(timezone: string): string {
  try {
    Temporal.Now.zonedDateTimeISO(timezone);
    return timezone;
  } catch {
    return 'UTC';
  }
}

export function instantFromDate(date: Date): Temporal.Instant {
  return Temporal.Instant.fromEpochMilliseconds(date.getTime());
}

export function dateFromInstant(instant: Temporal.Instant): Date {
  return new Date(instant.epochMilliseconds);
}

export function zonedDateTimeFromDate(date: Date, timezone: string): Temporal.ZonedDateTime {
  return instantFromDate(date).toZonedDateTimeISO(assertValidTimezone(timezone));
}

export function localDateFromInstant(isoInstant: string, timezone: string): string {
  return Temporal.Instant.from(isoInstant)
    .toZonedDateTimeISO(assertValidTimezone(timezone))
    .toPlainDate()
    .toString();
}

export function workspaceTimeContext(
  timezone: string,
  now: Date = new Date(),
): WorkspaceTimeContext {
  const tz = assertValidTimezone(timezone);
  const zdt = zonedDateTimeFromDate(now, tz);
  const date = zdt.toPlainDate();
  return {
    timezone: tz,
    now: zdt.toString(),
    today: date.toString(),
    isoWeek: date.weekOfYear ?? 1,
    isoWeekYear: isoWeekYear(date),
  };
}

function validPlainDate(value: string): Temporal.PlainDate | null {
  try {
    const date = Temporal.PlainDate.from(value);
    return date.toString() === value ? date : null;
  } catch {
    return null;
  }
}

function dueDateKey(value: Date | string, timezone: string): string | null {
  let source: string;
  try {
    source = value instanceof Date ? value.toISOString() : value.trim();
  } catch {
    return null;
  }
  if (LOCAL_DATE_PATTERN.test(source)) return validPlainDate(source)?.toString() ?? null;
  if (UTC_MIDNIGHT_PATTERN.test(source)) {
    const date = source.slice(0, 10);
    return validPlainDate(date)?.toString() ?? null;
  }
  try {
    return localDateFromInstant(new Date(source).toISOString(), timezone);
  } catch {
    return null;
  }
}

function localizedDueDate(dateKey: string, locale?: string): string {
  const value = new Date(`${dateKey}T12:00:00.000Z`);
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(value);
}

export function presentDueDate(
  value: Date | string | null | undefined,
  options: PresentDueDateOptions,
): DueDatePresentation {
  if (value === null || value === undefined || value === '') {
    return {
      status: 'missing',
      dateKey: null,
      dateLabel: null,
      label: 'No due date',
      compactText: 'No due date',
      tone: 'muted',
    };
  }

  const timezone = assertValidTimezone(options.timezone);
  const dateKey = dueDateKey(value, timezone);
  if (!dateKey) {
    const raw = value instanceof Date ? value.toString() : value;
    return {
      status: 'invalid',
      dateKey: null,
      dateLabel: raw,
      label: 'Due',
      compactText: `Due ${raw}`,
      tone: 'neutral',
    };
  }

  const dueDate = Temporal.PlainDate.from(dateKey);
  const today = zonedDateTimeFromDate(options.now ?? new Date(), timezone).toPlainDate();
  const dueSoonDays = Math.max(0, options.dueSoonDays ?? DEFAULT_DUE_SOON_DAYS);
  const comparison = Temporal.PlainDate.compare(dueDate, today);
  const status: DueDateStatus =
    comparison < 0
      ? 'overdue'
      : comparison === 0
        ? 'today'
        : Temporal.PlainDate.compare(dueDate, today.add({ days: dueSoonDays })) <= 0
          ? 'due_soon'
          : 'scheduled';
  const label =
    status === 'overdue'
      ? 'Overdue'
      : status === 'today'
        ? 'Due today'
        : status === 'due_soon'
          ? 'Due soon'
          : 'Due';
  const tone =
    status === 'overdue'
      ? 'danger'
      : status === 'today' || status === 'due_soon'
        ? 'signal'
        : 'neutral';
  const dateLabel = localizedDueDate(dateKey, options.locale);
  return {
    status,
    dateKey,
    dateLabel,
    label,
    compactText: `${label} ${dateLabel}`,
    tone,
  };
}

export function workspaceDueDateBoundaries(
  timezone: string,
  now: Date = new Date(),
): WorkspaceDueDateBoundaries {
  const today = zonedDateTimeFromDate(now, assertValidTimezone(timezone)).toPlainDate();
  return {
    today: today.toString(),
    tomorrow: today.add({ days: 1 }).toString(),
    next7: today.add({ days: 7 }).toString(),
    dueSoonEnd: today.add({ days: DEFAULT_DUE_SOON_DAYS + 1 }).toString(),
  };
}

export function localDateSpanToUtcRange(
  startDate: string,
  endDate: string,
  timezone: string,
): { from: Date; to: Date } {
  const tz = assertValidTimezone(timezone);
  const start = Temporal.PlainDate.from(startDate).toZonedDateTime({
    timeZone: tz,
    plainTime: Temporal.PlainTime.from('00:00'),
  });
  const end = Temporal.PlainDate.from(endDate).toZonedDateTime({
    timeZone: tz,
    plainTime: Temporal.PlainTime.from('00:00'),
  });
  return { from: dateFromInstant(start.toInstant()), to: dateFromInstant(end.toInstant()) };
}

export function dateOnlyEventRange(
  date: string,
  timezone: string,
): { startAt: Date; endAt: Date; timezone: string; allDay: true } {
  const start = Temporal.PlainDate.from(date);
  const end = start.add({ days: 1 });
  const range = localDateSpanToUtcRange(start.toString(), end.toString(), timezone);
  return {
    startAt: range.from,
    endAt: range.to,
    timezone: assertValidTimezone(timezone),
    allDay: true,
  };
}

export function startOfIsoWeek(date: Temporal.PlainDate): Temporal.PlainDate {
  return date.subtract({ days: date.dayOfWeek - 1 });
}

export function isoWeekYear(date: Temporal.PlainDate): number {
  return date.add({ days: 4 - date.dayOfWeek }).year;
}

function weekOneMonday(year: number): Temporal.PlainDate {
  const jan4 = Temporal.PlainDate.from({ year, month: 1, day: 4 });
  return startOfIsoWeek(jan4);
}

function resolveIsoWeek(week: number, year: number): Temporal.PlainDate {
  return weekOneMonday(year).add({ weeks: week - 1 });
}

function explainRange(
  phrase: string,
  start: Temporal.PlainDate,
  end: Temporal.PlainDate,
  timezone: string,
): ResolvedTimeRange {
  const range = localDateSpanToUtcRange(start.toString(), end.toString(), timezone);
  return {
    phrase,
    timezone: assertValidTimezone(timezone),
    localStartDate: start.toString(),
    localEndDate: end.toString(),
    from: range.from,
    to: range.to,
    explanation: `${phrase} is ${start.toString()} through ${end.toString()} (exclusive) in ${assertValidTimezone(timezone)}`,
  };
}

export function resolveTimePhrase(
  phrase: string,
  args: { timezone: string; referenceDate?: Date } = { timezone: 'UTC' },
): ResolvedTimeRange | null {
  const tz = assertValidTimezone(args.timezone);
  const reference = args.referenceDate ?? new Date();
  const today = zonedDateTimeFromDate(reference, tz).toPlainDate();
  const normalized = phrase.trim().toLowerCase();

  if (normalized === 'today') return explainRange(phrase, today, today.add({ days: 1 }), tz);
  if (normalized === 'yesterday') {
    const start = today.subtract({ days: 1 });
    return explainRange(phrase, start, today, tz);
  }
  if (normalized === 'tomorrow') {
    const start = today.add({ days: 1 });
    return explainRange(phrase, start, start.add({ days: 1 }), tz);
  }

  const currentWeekStart = startOfIsoWeek(today);
  if (normalized === 'this week') {
    return explainRange(phrase, currentWeekStart, currentWeekStart.add({ weeks: 1 }), tz);
  }
  if (normalized === 'last week') {
    const start = currentWeekStart.subtract({ weeks: 1 });
    return explainRange(phrase, start, currentWeekStart, tz);
  }
  if (normalized === 'next week') {
    const start = currentWeekStart.add({ weeks: 1 });
    return explainRange(phrase, start, start.add({ weeks: 1 }), tz);
  }

  const weekMatch = /^week\s+(\d{1,2})(?:\s+(?:of\s+)?(\d{4}))?$/.exec(normalized);
  if (weekMatch) {
    const week = Number(weekMatch[1] ?? '0');
    const year = weekMatch[2] ? Number(weekMatch[2]) : isoWeekYear(today);
    if (week >= 1 && week <= 53) {
      const start = resolveIsoWeek(week, year);
      return explainRange(`week ${week} of ${year}`, start, start.add({ weeks: 1 }), tz);
    }
  }

  const nextWeekday = /^next\s+([a-z]+)$/.exec(normalized);
  if (nextWeekday) {
    const target = WEEKDAYS[nextWeekday[1] ?? ''];
    if (target) {
      const delta = (target - today.dayOfWeek + 7) % 7 || 7;
      const start = today.add({ days: delta });
      return explainRange(phrase, start, start.add({ days: 1 }), tz);
    }
  }

  const dateMatch = /^(\d{4}-\d{2}-\d{2})$/.exec(normalized);
  if (dateMatch) {
    const start = Temporal.PlainDate.from(dateMatch[1] ?? '');
    return explainRange(phrase, start, start.add({ days: 1 }), tz);
  }

  return null;
}

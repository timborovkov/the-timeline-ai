import { assertValidTimezone, dateFromInstant, zonedDateTimeFromDate } from '#src/time/index.js';

export const DEFAULT_DIGEST_HOUR = 12;

export function scheduledUpdateWindow(
  now: Date,
  timezone: string,
  hour: number,
  cadence: 'daily' | 'weekly',
): { start: Date; end: Date } {
  const tz = assertValidTimezone(timezone);
  const current = zonedDateTimeFromDate(now, tz);
  const plainTime = {
    hour: Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : DEFAULT_DIGEST_HOUR,
  };
  let date = current.toPlainDate();
  if (cadence === 'weekly') date = date.subtract({ days: date.dayOfWeek - 1 });
  const days = cadence === 'weekly' ? 7 : 1;
  const boundary = (day: typeof date) =>
    dateFromInstant(day.toZonedDateTime({ timeZone: tz, plainTime }).toInstant());
  if (boundary(date) > now) date = date.subtract({ days });
  return { start: boundary(date.subtract({ days })), end: boundary(date) };
}

export function nextScheduledUpdateWindow(
  windowEnd: Date,
  timezone: string,
  hour: number,
  cadence: 'daily' | 'weekly',
): { start: Date; end: Date } {
  const tz = assertValidTimezone(timezone);
  const plainTime = {
    hour: Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : DEFAULT_DIGEST_HOUR,
  };
  const next = zonedDateTimeFromDate(windowEnd, tz)
    .toPlainDate()
    .add({ days: cadence === 'weekly' ? 7 : 1 })
    .toZonedDateTime({ timeZone: tz, plainTime });
  return { start: windowEnd, end: dateFromInstant(next.toInstant()) };
}

export function freshDigestCutoff(windowEnd: Date, timezone: string, hour: number): Date {
  const tz = assertValidTimezone(timezone);
  const digestHour = Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : DEFAULT_DIGEST_HOUR;
  const previousDate = zonedDateTimeFromDate(windowEnd, tz).toPlainDate().subtract({ days: 1 });
  return dateFromInstant(
    previousDate.toZonedDateTime({ timeZone: tz, plainTime: { hour: digestHour } }).toInstant(),
  );
}

export function defaultDigestWindow(
  now: Date = new Date(),
  timezone = 'UTC',
  hour = DEFAULT_DIGEST_HOUR,
): { start: Date; end: Date } {
  const tz = assertValidTimezone(timezone);
  const digestHour = Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : DEFAULT_DIGEST_HOUR;
  const current = zonedDateTimeFromDate(now, tz);
  let endInTimezone = current.toPlainDate().toZonedDateTime({
    timeZone: tz,
    plainTime: { hour: digestHour },
  });
  if (current.epochMilliseconds < endInTimezone.epochMilliseconds) {
    endInTimezone = endInTimezone.subtract({ days: 1 });
  }
  const end = dateFromInstant(endInTimezone.toInstant());
  const start = new Date(end.getTime() - 25 * 60 * 60 * 1000);
  return { start, end };
}

/**
 * A digest is expired once the recipient's next digest cycle has started.
 * Queued recipient/send jobs from earlier cycles must not email after that.
 */
export function isDigestWindowExpired(
  windowEnd: Date,
  now: Date = new Date(),
  timezone = 'UTC',
  hour = DEFAULT_DIGEST_HOUR,
): boolean {
  const current = defaultDigestWindow(now, timezone, hour);
  return windowEnd.getTime() < current.end.getTime();
}

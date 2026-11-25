import type { UpdateSettings } from '#src/messaging/update-settings.js';
import { dateFromInstant, zonedDateTimeFromDate } from '#src/time/index.js';

const HOUR_MS = 60 * 60 * 1000;

export const UPDATE_DISPATCH_GRACE_MS = 2 * HOUR_MS;

export function latestUpdateTime(settings: UpdateSettings, timezone: string, now: Date): Date {
  const current = zonedDateTimeFromDate(now, timezone);
  const [hour = 12, minute = 0] = settings.time.split(':').map(Number);
  const today = current.toPlainDate();
  const date =
    settings.cadence === 'weekly'
      ? today.subtract({ days: (today.dayOfWeek - settings.weekday + 7) % 7 })
      : today;
  const localTime = { timeZone: current.timeZoneId, plainTime: { hour, minute } };
  const slot = date.toZonedDateTime(localTime);
  if (slot.epochMilliseconds <= now.getTime()) return dateFromInstant(slot.toInstant());
  const previous = date.subtract({ days: settings.cadence === 'weekly' ? 7 : 1 });
  return dateFromInstant(previous.toZonedDateTime(localTime).toInstant());
}

export function updateWindowStart(end: Date, days: number): Date {
  return new Date(end.getTime() - days * 24 * HOUR_MS);
}

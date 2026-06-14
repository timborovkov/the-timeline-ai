import { Temporal } from '@js-temporal/polyfill';

export function calendarEventListWindow(
  timezone: string,
  rangeDays: number,
  today = Temporal.Now.zonedDateTimeISO(timezone).toPlainDate(),
): { today: Date; from: Date; to: Date } {
  const startOfLocalDay = (date: Temporal.PlainDate) =>
    new Date(date.toZonedDateTime({ timeZone: timezone }).toInstant().epochMilliseconds);

  return {
    today: startOfLocalDay(today),
    from: startOfLocalDay(today.subtract({ days: rangeDays })),
    to: startOfLocalDay(today.add({ days: rangeDays })),
  };
}

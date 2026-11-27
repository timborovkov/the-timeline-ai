import {
  DEFAULT_DISPLAY_LOCALE,
  validDisplayLocale,
  validDisplayTimezone,
} from '@/lib/regional-format';
import { DEFAULT_TIMEZONE } from '@/lib/timezones';

const ISO_INSTANT_PATTERN = /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z\b/g;
const MINUTE_SECONDS = 60;
const HOUR_SECONDS = 60 * MINUTE_SECONDS;
const DAY_SECONDS = 24 * HOUR_SECONDS;
const MONTH_SECONDS = 30 * DAY_SECONDS;
const YEAR_SECONDS = 365 * DAY_SECONDS;

interface DisplayDateOptions {
  timezone: string;
  locale?: string;
}

interface DisplayTextOptions {
  timezone?: string;
  locale?: string;
}

interface RelativeAgeOptions {
  now?: Date;
  locale?: string;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const OFFSET_INSTANT = /T.*(?:Z|[+-]\d{2}:?\d{2})$/i;

export function parseDisplayDate(value: Date | string): Date | undefined {
  if (typeof value === 'string' && !DATE_ONLY.test(value) && !OFFSET_INSTANT.test(value)) {
    return undefined;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  if (typeof value === 'string' && DATE_ONLY.test(value) && !date.toISOString().startsWith(value)) {
    return undefined;
  }
  return date;
}

export function formatDisplayDateParts(
  value: Date | string,
  options: DisplayDateOptions,
  parts: Intl.DateTimeFormatOptions,
): string {
  const date = parseDisplayDate(value);
  if (!date) return String(value);
  const dateOnly = typeof value === 'string' && DATE_ONLY.test(value);
  return new Intl.DateTimeFormat(validDisplayLocale(options.locale) ?? DEFAULT_DISPLAY_LOCALE, {
    ...parts,
    timeZone: dateOnly ? 'UTC' : (validDisplayTimezone(options.timezone) ?? DEFAULT_TIMEZONE),
  }).format(date);
}

export function formatDisplayDateTime(value: Date | string, options: DisplayDateOptions): string {
  if (typeof value === 'string' && DATE_ONLY.test(value)) return formatDisplayDate(value, options);
  return formatDisplayDateParts(value, options, { dateStyle: 'medium', timeStyle: 'short' });
}

export function formatDisplayDate(value: Date | string, options: DisplayDateOptions): string {
  return formatDisplayDateParts(value, options, { dateStyle: 'medium' });
}

export function formatAllDayCalendarDate(
  value: string,
  options: DisplayDateOptions,
  exclusiveEnd = false,
): string {
  if (!exclusiveEnd) return formatDisplayDate(value, options);
  const boundary = parseDisplayDate(value);
  if (!boundary) return value;
  const lastDay = new Date(boundary.getTime() - 1);
  return formatDisplayDate(
    DATE_ONLY.test(value) ? lastDay.toISOString().slice(0, 10) : lastDay,
    options,
  );
}

export function formatDisplayTime(value: Date | string, options: DisplayDateOptions): string {
  return formatDisplayDateParts(value, options, { timeStyle: 'short' });
}

export function formatRelativeAge(value: Date | string, options: RelativeAgeOptions = {}): string {
  const date = parseDisplayDate(value);
  if (!date) return String(value);
  const formatter = new Intl.RelativeTimeFormat(
    validDisplayLocale(options.locale) ?? DEFAULT_DISPLAY_LOCALE,
    { numeric: 'auto' },
  );
  const now = options.now ?? new Date();
  const diffSeconds = Math.round((date.getTime() - now.getTime()) / 1000);
  const absSeconds = Math.abs(diffSeconds);
  if (absSeconds < 45) return formatter.format(0, 'second');
  if (absSeconds < HOUR_SECONDS) {
    return formatter.format(Math.round(diffSeconds / MINUTE_SECONDS), 'minute');
  }
  if (absSeconds < DAY_SECONDS) {
    return formatter.format(Math.round(diffSeconds / HOUR_SECONDS), 'hour');
  }
  // Keep day units through the first month so "7 days ago" stays literal instead
  // of collapsing to "last week".
  if (absSeconds < MONTH_SECONDS) {
    return formatter.format(Math.round(diffSeconds / DAY_SECONDS), 'day');
  }
  if (absSeconds < YEAR_SECONDS) {
    return formatter.format(Math.round(diffSeconds / MONTH_SECONDS), 'month');
  }
  return formatter.format(Math.round(diffSeconds / YEAR_SECONDS), 'year');
}

function formatEmbeddedIsoInstants(text: string, options: DisplayDateOptions): string {
  return text.replace(ISO_INSTANT_PATTERN, (match) => formatDisplayDateTime(match, options));
}

export function displayText(value: string, options: DisplayTextOptions = {}): string {
  if (!options.timezone) return value;
  return formatEmbeddedIsoInstants(value, { timezone: options.timezone, locale: options.locale });
}

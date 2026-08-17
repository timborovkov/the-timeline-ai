const ISO_INSTANT_PATTERN = /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z\b/g;
const MINUTE_SECONDS = 60;
const HOUR_SECONDS = 60 * MINUTE_SECONDS;
const DAY_SECONDS = 24 * HOUR_SECONDS;
const MONTH_SECONDS = 30 * DAY_SECONDS;
const YEAR_SECONDS = 365 * DAY_SECONDS;

interface DisplayDateOptions {
  timezone: string;
}

interface DisplayTextOptions {
  timezone?: string;
}

interface RelativeAgeOptions {
  now?: Date;
}

const RELATIVE_AGE_FORMATTER = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

export function formatDisplayDateTime(value: Date | string, options: DisplayDateOptions): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: options.timezone,
  });
}

export function formatDisplayDate(value: Date | string, options: DisplayDateOptions): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString(undefined, {
    dateStyle: 'medium',
    timeZone: options.timezone,
  });
}

export function formatRelativeAge(value: Date | string, options: RelativeAgeOptions = {}): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const now = options.now ?? new Date();
  const diffSeconds = Math.round((date.getTime() - now.getTime()) / 1000);
  const absSeconds = Math.abs(diffSeconds);
  if (absSeconds < 45) return RELATIVE_AGE_FORMATTER.format(0, 'second');
  if (absSeconds < HOUR_SECONDS) {
    return RELATIVE_AGE_FORMATTER.format(Math.round(diffSeconds / MINUTE_SECONDS), 'minute');
  }
  if (absSeconds < DAY_SECONDS) {
    return RELATIVE_AGE_FORMATTER.format(Math.round(diffSeconds / HOUR_SECONDS), 'hour');
  }
  // Keep day units through the first month so "7 days ago" stays literal instead
  // of collapsing to "last week".
  if (absSeconds < MONTH_SECONDS) {
    return RELATIVE_AGE_FORMATTER.format(Math.round(diffSeconds / DAY_SECONDS), 'day');
  }
  if (absSeconds < YEAR_SECONDS) {
    return RELATIVE_AGE_FORMATTER.format(Math.round(diffSeconds / MONTH_SECONDS), 'month');
  }
  return RELATIVE_AGE_FORMATTER.format(Math.round(diffSeconds / YEAR_SECONDS), 'year');
}

function formatEmbeddedIsoInstants(text: string, options: DisplayDateOptions): string {
  return text.replace(ISO_INSTANT_PATTERN, (match) => formatDisplayDateTime(match, options));
}

export function displayText(value: string, options: DisplayTextOptions = {}): string {
  if (!options.timezone) return value;
  return formatEmbeddedIsoInstants(value, { timezone: options.timezone });
}

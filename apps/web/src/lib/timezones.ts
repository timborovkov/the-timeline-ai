export const DEFAULT_TIMEZONE = 'UTC';

const COMMON_TIMEZONES = [
  DEFAULT_TIMEZONE,
  'Europe/Helsinki',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Australia/Sydney',
] as const;

function supportedTimezones(): string[] {
  const intlWithTimezones = Intl as typeof Intl & {
    supportedValuesOf?: (key: 'timeZone') => string[];
  };
  return typeof intlWithTimezones.supportedValuesOf === 'function'
    ? intlWithTimezones.supportedValuesOf('timeZone')
    : [];
}

function isValidTimezone(timezone: string): boolean {
  if (!timezone) return false;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

export function normalizeTimezone(value: FormDataEntryValue | string | null | undefined): string {
  const timezone = typeof value === 'string' ? value.trim() : '';
  return timezone && isValidTimezone(timezone) ? timezone : DEFAULT_TIMEZONE;
}

export function timezoneOptions(selectedTimezone: string): string[] {
  const browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const options = new Set([...COMMON_TIMEZONES, ...supportedTimezones()]);
  if (isValidTimezone(selectedTimezone)) options.add(selectedTimezone);
  if (isValidTimezone(browserTimezone)) options.add(browserTimezone);
  return Array.from(options).sort((a, b) =>
    a === DEFAULT_TIMEZONE ? -1 : b === DEFAULT_TIMEZONE ? 1 : a.localeCompare(b),
  );
}

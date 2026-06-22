export const DEFAULT_TIMEZONE = 'UTC';

const SUPPORTED_TIMEZONES = new Set([DEFAULT_TIMEZONE, ...Intl.supportedValuesOf('timeZone')]);

function isValidTimezone(timezone: string): boolean {
  return SUPPORTED_TIMEZONES.has(timezone);
}

export function normalizeTimezone(value: FormDataEntryValue | string | null | undefined): string {
  const timezone = typeof value === 'string' ? value.trim() : '';
  return timezone && isValidTimezone(timezone) ? timezone : DEFAULT_TIMEZONE;
}

export function timezoneOptions(selectedTimezone: string): string[] {
  const options = new Set(SUPPORTED_TIMEZONES);
  if (isValidTimezone(selectedTimezone)) options.add(selectedTimezone);
  return Array.from(options).sort((a, b) => a.localeCompare(b));
}

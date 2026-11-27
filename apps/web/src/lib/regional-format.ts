import { DEFAULT_TIMEZONE, isValidTimezone } from '@/lib/timezones';

export const DEFAULT_DISPLAY_LOCALE = 'en-US';

export interface RegionalFormat {
  locale: string;
  timezone: string;
}

export function validDisplayLocale(value?: string): string | undefined {
  if (!value || value.length > 80) return undefined;
  try {
    return Intl.DateTimeFormat.supportedLocalesOf(value)[0];
  } catch {
    return undefined;
  }
}

export function validDisplayTimezone(value?: string): string | undefined {
  return value && value.length <= 80 && !/^[+-]/.test(value) && isValidTimezone(value)
    ? value
    : undefined;
}

export function resolveRegionalFormat(
  preference: Partial<RegionalFormat> = {},
  browser: Partial<RegionalFormat> = {},
  workspaceTimezone?: string,
): RegionalFormat {
  return {
    locale:
      validDisplayLocale(preference.locale) ??
      validDisplayLocale(browser.locale) ??
      DEFAULT_DISPLAY_LOCALE,
    timezone:
      validDisplayTimezone(preference.timezone) ??
      validDisplayTimezone(browser.timezone) ??
      validDisplayTimezone(workspaceTimezone) ??
      DEFAULT_TIMEZONE,
  };
}

export function formatDisplayNumber(
  value: number,
  locale?: string,
  options?: Intl.NumberFormatOptions,
): string {
  return new Intl.NumberFormat(
    validDisplayLocale(locale) ?? DEFAULT_DISPLAY_LOCALE,
    options,
  ).format(value);
}

export function formatDisplayCurrency(
  cents: number,
  currency: 'USD' | 'EUR',
  locale?: string,
  compact = false,
): string {
  return formatDisplayNumber(cents / 100, locale, {
    style: 'currency',
    currency,
    maximumFractionDigits: compact && cents % 100 === 0 ? 0 : 2,
  });
}

export function formatDisplayPercent(ratio: number, locale?: string): string {
  return formatDisplayNumber(ratio, locale, { style: 'percent' });
}

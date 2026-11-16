import { Temporal } from '@js-temporal/polyfill';

import { getEnv } from '#src/env.js';
import { validateMcpUrl } from '#src/mcp/auth.js';
import { parsePublicWebsiteUrl } from '#src/onboarding/first-run.js';

export {
  WEBSITE_SOURCE_UNITS_PER_PAGE,
  WEBSITE_PAGE_LIMIT,
  websiteSourceUnits,
} from '#src/websites/usage.js';
export const WEBSITE_BILLING_POLICY = 'website-v1';
export function websiteLimits() {
  const env = getEnv();
  return {
    sources: env.WEBSITE_MAX_SOURCES,
    dailyPages: env.WEBSITE_MAX_DAILY_PAGES,
    cooldownMs: env.WEBSITE_COOLDOWN_MS,
    globalConcurrency: env.WEBSITE_GLOBAL_CONCURRENCY,
    hostDelayMs: env.WEBSITE_HOST_DELAY_MS,
  };
}
export interface WebsiteSchedule {
  frequency: 'manual' | 'daily' | 'weekly';
  time: string;
  weekday: number;
  timezone: string;
}
export const DEFAULT_WEBSITE_SCHEDULE: WebsiteSchedule = {
  frequency: 'manual',
  time: '09:00',
  weekday: 1,
  timezone: 'UTC',
};

export function normalizeWebsiteUrl(input: string): string {
  const parsed = parsePublicWebsiteUrl(input);
  if ('error' in parsed) throw new Error(parsed.error);
  const url = new URL(parsed.href);
  url.hash = '';
  if (validateMcpUrl(url.href)) throw new Error('Only public website URLs are allowed');
  return url.href;
}

export function validateWebsiteSchedule(schedule: WebsiteSchedule): void {
  if (
    !['manual', 'daily', 'weekly'].includes(schedule.frequency) ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(schedule.time) ||
    !Number.isInteger(schedule.weekday) ||
    schedule.weekday < 1 ||
    schedule.weekday > 7
  )
    throw new Error('Invalid website schedule');
  Temporal.Now.zonedDateTimeISO(schedule.timezone);
}

/** Calendar arithmetic retains local wall time across DST. Skipped times move forward. */
export function nextWebsiteScan(schedule: WebsiteSchedule, after: Date): Date | null {
  validateWebsiteSchedule(schedule);
  if (schedule.frequency === 'manual') return null;
  const local = Temporal.Instant.from(after.toISOString()).toZonedDateTimeISO(schedule.timezone);
  const [hour = 9, minute = 0] = schedule.time.split(':').map(Number);
  for (let days = 0; days <= 7; days++) {
    const date = local.toPlainDate().add({ days });
    if (schedule.frequency === 'weekly' && date.dayOfWeek !== schedule.weekday) continue;
    const candidate = date.toZonedDateTime({
      timeZone: schedule.timezone,
      plainTime: { hour, minute },
    });
    if (candidate.epochMilliseconds > after.getTime()) return new Date(candidate.epochMilliseconds);
  }
  throw new Error('Could not calculate next website scan');
}

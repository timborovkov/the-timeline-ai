import { Temporal } from '@js-temporal/polyfill';
import * as rrule from 'rrule';

type RRuleModule = typeof rrule & { default?: typeof rrule };

const rrulestr = rrule.rrulestr ?? (rrule as RRuleModule).default?.rrulestr;
if (typeof rrulestr !== 'function') throw new Error('rrule parser export not found');

const RECURRENCE_WINDOW_MONTHS = 3;

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function localStamp(date: Date, timezone: string): string {
  const local = Temporal.Instant.from(date.toISOString()).toZonedDateTimeISO(timezone);
  return `${local.year}${pad(local.month)}${pad(local.day)}T${pad(local.hour)}${pad(local.minute)}${pad(local.second)}`;
}

function utcStamp(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
}

function normalizeRRuleText(rrule: string): string {
  const trimmed = rrule.trim();
  if (!trimmed) throw new Error('RRULE is required');
  if (/^(BEGIN:VCALENDAR|DTSTART|RRULE|RDATE|EXDATE|EXRULE)/im.test(trimmed)) return trimmed;
  return `RRULE:${trimmed.replace(/^RRULE:/i, '')}`;
}

function buildRRuleSource(args: { rrule: string; startAt: Date; timezone: string }): string {
  const normalized = normalizeRRuleText(args.rrule);
  if (/^DTSTART/im.test(normalized)) return normalized;
  return `DTSTART;TZID=${args.timezone}:${localStamp(args.startAt, args.timezone)}\n${normalized}`;
}

export function validateRRule(args: { rrule: string; startAt: Date; timezone: string }): string {
  const normalized = normalizeRRuleText(args.rrule);
  rrulestr(buildRRuleSource({ ...args, rrule: normalized }), {
    forceset: true,
    compatible: true,
    tzid: args.timezone,
  });
  return normalized;
}

export function expandRRuleBetween(args: {
  rrule: string;
  startAt: Date;
  timezone: string;
  from: Date;
  to: Date;
}): Date[] {
  const parsed = rrulestr(buildRRuleSource(args), {
    forceset: true,
    compatible: true,
    tzid: args.timezone,
  });
  return parsed.between(args.from, args.to, true);
}

export function recurrenceWindowFrom(startAt: Date, now = new Date()): { from: Date; to: Date } {
  const lookback = new Date(now);
  lookback.setUTCMonth(lookback.getUTCMonth() - RECURRENCE_WINDOW_MONTHS);
  const from = startAt > lookback ? startAt : lookback;
  const to = new Date(now);
  to.setUTCMonth(to.getUTCMonth() + RECURRENCE_WINDOW_MONTHS);
  return { from, to };
}

export function rruleUntil(rrule: string, untilBefore: Date): string {
  const normalized = normalizeRRuleText(rrule);
  const until = utcStamp(new Date(untilBefore.getTime() - 1000));
  const lines = normalized.split(/\r?\n/);
  const next = lines.map((line) => {
    if (!/^RRULE:/i.test(line)) return line;
    const [prefix, body = ''] = line.split(':', 2);
    const parts = body
      .split(';')
      .filter((part) => part.length > 0 && !/^UNTIL=/i.test(part) && !/^COUNT=/i.test(part));
    parts.push(`UNTIL=${until}`);
    return `${prefix}:${parts.join(';')}`;
  });
  return next.join('\n');
}

export function rruleForSplit(args: {
  rrule: string;
  startAt: Date;
  timezone: string;
  splitAt: Date;
}): string {
  const normalized = normalizeRRuleText(args.rrule);
  const countMatch = /^RRULE:.*(?::|;)COUNT=(\d+)(?:;|$)/im.exec(normalized);
  if (!countMatch?.[1]) return normalized;

  const originalCount = Number.parseInt(countMatch[1], 10);
  if (!Number.isFinite(originalCount) || originalCount <= 0) return normalized;

  const parsed = rrulestr(buildRRuleSource({ ...args, rrule: normalized }), {
    forceset: true,
    compatible: true,
    tzid: args.timezone,
  });
  const occurrencesBeforeSplit = parsed
    .between(args.startAt, args.splitAt, true)
    .filter((date) => date < args.splitAt).length;
  const remainingCount = Math.max(1, originalCount - occurrencesBeforeSplit);

  return normalized
    .split(/\r?\n/)
    .map((line) => {
      if (!/^RRULE:/i.test(line)) return line;
      return line.replace(/(^RRULE:.*(?::|;))COUNT=\d+((?:;.*)?)$/i, `$1COUNT=${remainingCount}$2`);
    })
    .join('\n');
}

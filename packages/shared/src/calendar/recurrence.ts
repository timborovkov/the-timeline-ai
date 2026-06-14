import { Temporal } from '@js-temporal/polyfill';
import { rrulestr } from 'rrule';

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
  const from = startAt < now ? startAt : now;
  const to = new Date(from);
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

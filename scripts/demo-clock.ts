/**
 * Demo seed clock. Fixture times are day offsets from "now" plus a clock time
 * in the Acme Labs team timezone, resolved when the seed runs so the workspace
 * always looks recent while relative order stays the same.
 *
 * The historical fixture was authored against 14 August 2026 18:00 UTC. Tests
 * keep that anchor so cadence floors stay deterministic; the first `dev:seed`
 * swaps in the real current instant and persists it as `demo_seed_now`. Later
 * reruns reuse that stamp so `demo:verify` and onConflictDoNothing Northstar
 * events stay aligned with meetings, facts, and document bytes.
 */
import { dateFromInstant, zonedDateTimeFromDate } from '@timeline/shared/time';

export const DEMO_CLOCK_ANCHOR = new Date('2026-08-14T18:00:00.000Z');
export const DEMO_CADENCE_SPAN_DAYS = 31;
export const DEMO_TOKEN_EXPIRY_DAYS = 180;
export const DEMO_TEAM_TIMEZONE = 'Europe/Helsinki';
export const DEMO_DIGEST_HOUR = 7;
export const DEMO_SEED_NOW_METADATA_KEY = 'demo_seed_now';

/** Story beats as local-day offsets from seed "today" in the team timezone. */
export const DEMO_DATES = {
  exportDue: -37,
  firstStandup: -31,
  incidentReview: -30,
  fieldMappingBlockedStandup: -24,
  invoicePastDue: -21,
  dpaSigned: -17,
  designerInterviews: -15,
  partnerWeek: -10,
  northwindMeeting: -8,
  brightlineScoping: -7,
  dataRoom: -1,
  today: 0,
  mayaFinal: 1,
  dryRun: 4,
  elenaConfirm: 5,
  polarDemo: 5,
  webinar: 6,
  helioValidation: 7,
  offerTarget: 8,
  pilotReview: 12,
  orchardBudget: 25,
  overdueVendor: -3,
  overdueNorthstar: -2,
} as const;

export type TeamDateKind = 'md' | 'dm' | 'dmy' | 'iso' | 'month';

export interface DemoTimeOffset {
  /** Whole local days relative to the seed clock's team-timezone date. Negative is the past. */
  days: number;
  /** Team-timezone clock time `HH:MM` or `HH:MM:SS`. */
  time: string;
}

let seedNow = DEMO_CLOCK_ANCHOR;

export function getDemoSeedNow(): Date {
  return seedNow;
}

export function setDemoSeedNow(now: Date): void {
  if (Number.isNaN(now.getTime())) throw new Error('Demo seed clock requires a valid Date');
  seedNow = now;
}

export function demoSeedNowIso(now = getDemoSeedNow()): string {
  return now.toISOString();
}

export function demoSeedNowMetadata(now = getDemoSeedNow()): { demo_seed_now: string } {
  return { [DEMO_SEED_NOW_METADATA_KEY]: demoSeedNowIso(now) };
}

export function parseDemoSeedNow(value: unknown): Date {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('Demo seed is missing persisted clock demo_seed_now');
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid persisted demo seed clock ${value}`);
  }
  return date;
}

export function readDemoSeedNowFromMetadata(
  metadata: Record<string, unknown> | null | undefined,
): Date | null {
  if (!metadata || !(DEMO_SEED_NOW_METADATA_KEY in metadata)) return null;
  return parseDemoSeedNow(metadata[DEMO_SEED_NOW_METADATA_KEY]);
}

/** Shift a stored instant from one story offset to another in the team timezone. */
export function resolveDemoOffsetFromReference(
  referenceIso: string,
  referenceOffset: DemoTimeOffset,
  targetOffset: DemoTimeOffset,
  timezone = DEMO_TEAM_TIMEZONE,
): Date {
  const reference = new Date(referenceIso);
  if (Number.isNaN(reference.getTime())) {
    throw new Error(`Invalid demo reference timestamp ${referenceIso}`);
  }
  const { hours, minutes, seconds } = parseUtcTime(targetOffset.time);
  const zoned = zonedDateTimeFromDate(reference, timezone)
    .add({ days: targetOffset.days - referenceOffset.days })
    .with({ hour: hours, minute: minutes, second: seconds, millisecond: 0, microsecond: 0 });
  return dateFromInstant(zoned.toInstant());
}

export function parseUtcTime(time: string): { hours: number; minutes: number; seconds: number } {
  const match = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(time);
  if (!match) throw new Error(`Invalid demo clock time ${time}`);
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3] ?? '0');
  if (hours > 23 || minutes > 59 || seconds > 59) {
    throw new Error(`Invalid demo clock time ${time}`);
  }
  return { hours, minutes, seconds };
}

export function resolveDemoTime(
  now: Date,
  offset: DemoTimeOffset,
  timezone = DEMO_TEAM_TIMEZONE,
): Date {
  const { hours, minutes, seconds } = parseUtcTime(offset.time);
  const zoned = zonedDateTimeFromDate(now, timezone)
    .add({ days: offset.days })
    .with({ hour: hours, minute: minutes, second: seconds, millisecond: 0, microsecond: 0 });
  return dateFromInstant(zoned.toInstant());
}

export function isoAt(days: number, time: string, now = getDemoSeedNow()): string {
  return resolveDemoTime(now, { days, time }).toISOString();
}

export function dateAt(days: number, time: string, now = getDemoSeedNow()): Date {
  return resolveDemoTime(now, { days, time });
}

export function localDay(days: number, now = getDemoSeedNow()): string {
  return teamDate(days, 'iso', now);
}

export function cadenceRange(now = getDemoSeedNow()): { start: string; end: string } {
  return { start: localDay(-DEMO_CADENCE_SPAN_DAYS, now), end: localDay(0, now) };
}

export function isoOnLocalDay(
  day: string,
  hours: number,
  minutes: number,
  seconds = 0,
  now = getDemoSeedNow(),
): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error(`Invalid local day ${day}`);
  const [year, month, date] = day.split('-').map(Number);
  const zoned = zonedDateTimeFromDate(now, DEMO_TEAM_TIMEZONE).with({
    year,
    month,
    day: date,
    hour: hours,
    minute: minutes,
    second: seconds,
    millisecond: 0,
    microsecond: 0,
  });
  return dateFromInstant(zoned.toInstant()).toISOString();
}

export function latestDigestDayOffset(now = getDemoSeedNow()): number {
  return dateAt(0, `${String(DEMO_DIGEST_HOUR).padStart(2, '0')}:00:00`, now).getTime() <=
    now.getTime()
    ? 0
    : -1;
}

export function teamDate(days: number, kind: TeamDateKind = 'dm', now = getDemoSeedNow()): string {
  const instant = dateAt(days, '12:00:00', now);
  if (kind === 'iso') {
    return zonedDateTimeFromDate(instant, DEMO_TEAM_TIMEZONE).toPlainDate().toString();
  }
  if (kind === 'month') {
    return new Intl.DateTimeFormat('en-GB', {
      month: 'long',
      timeZone: DEMO_TEAM_TIMEZONE,
    }).format(instant);
  }
  if (kind === 'md') {
    return new Intl.DateTimeFormat('en-US', {
      month: 'long',
      day: 'numeric',
      timeZone: DEMO_TEAM_TIMEZONE,
    }).format(instant);
  }
  if (kind === 'dmy') {
    return new Intl.DateTimeFormat('en-GB', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: DEMO_TEAM_TIMEZONE,
    }).format(instant);
  }
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    timeZone: DEMO_TEAM_TIMEZONE,
  }).format(instant);
}

export function teamClock(
  days: number,
  time: string,
  timezone = DEMO_TEAM_TIMEZONE,
  now = getDemoSeedNow(),
): string {
  const instant = dateAt(days, time, now);
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: timezone,
  }).format(instant);
}

export const DEMO_TIME_OFFSETS = {
  kickoff: { days: -58, time: '09:00:00' },
  vendorEmail: { days: -58, time: '11:15:00' },
  slackOnboarding: { days: -58, time: '14:20:00' },
  meetingBots: { days: -57, time: '07:30:00' },
  githubWorkflowRetry: { days: -57, time: '08:31:00' },
  githubWorkflowSuccess: { days: -57, time: '08:37:00' },
  githubReview: { days: -57, time: '08:39:00' },
  githubPr: { days: -57, time: '08:40:00' },
  linearIssue: { days: -57, time: '08:45:00' },
  seedNowLegacy: { days: -57, time: '09:00:00' },
  vendorDue: { days: DEMO_DATES.overdueVendor, time: '17:00:00' },
  note: { days: -39, time: '09:00:00' },
  email: { days: -38, time: '10:30:00' },
  meeting: { days: -37, time: '15:00:00' },
  meetingEnd: { days: -37, time: '15:30:00' },
  provider: { days: -36, time: '16:15:00' },
  tokenExpiry: { days: DEMO_TOKEN_EXPIRY_DAYS, time: '23:59:59' },
} as const;

export function demoTimes(now = getDemoSeedNow()): {
  kickoff: Date;
  vendorEmail: Date;
  slackOnboarding: Date;
  meetingBots: Date;
  githubWorkflowRetry: Date;
  githubWorkflowSuccess: Date;
  githubReview: Date;
  githubPr: Date;
  linearIssue: Date;
  seedNowLegacy: Date;
  vendorDue: Date;
  note: Date;
  email: Date;
  meeting: Date;
  meetingEnd: Date;
  provider: Date;
  tokenExpiry: Date;
  now: Date;
} {
  return {
    kickoff: dateAt(DEMO_TIME_OFFSETS.kickoff.days, DEMO_TIME_OFFSETS.kickoff.time, now),
    vendorEmail: dateAt(
      DEMO_TIME_OFFSETS.vendorEmail.days,
      DEMO_TIME_OFFSETS.vendorEmail.time,
      now,
    ),
    slackOnboarding: dateAt(
      DEMO_TIME_OFFSETS.slackOnboarding.days,
      DEMO_TIME_OFFSETS.slackOnboarding.time,
      now,
    ),
    meetingBots: dateAt(
      DEMO_TIME_OFFSETS.meetingBots.days,
      DEMO_TIME_OFFSETS.meetingBots.time,
      now,
    ),
    githubWorkflowRetry: dateAt(
      DEMO_TIME_OFFSETS.githubWorkflowRetry.days,
      DEMO_TIME_OFFSETS.githubWorkflowRetry.time,
      now,
    ),
    githubWorkflowSuccess: dateAt(
      DEMO_TIME_OFFSETS.githubWorkflowSuccess.days,
      DEMO_TIME_OFFSETS.githubWorkflowSuccess.time,
      now,
    ),
    githubReview: dateAt(
      DEMO_TIME_OFFSETS.githubReview.days,
      DEMO_TIME_OFFSETS.githubReview.time,
      now,
    ),
    githubPr: dateAt(DEMO_TIME_OFFSETS.githubPr.days, DEMO_TIME_OFFSETS.githubPr.time, now),
    linearIssue: dateAt(
      DEMO_TIME_OFFSETS.linearIssue.days,
      DEMO_TIME_OFFSETS.linearIssue.time,
      now,
    ),
    seedNowLegacy: dateAt(
      DEMO_TIME_OFFSETS.seedNowLegacy.days,
      DEMO_TIME_OFFSETS.seedNowLegacy.time,
      now,
    ),
    vendorDue: dateAt(DEMO_TIME_OFFSETS.vendorDue.days, DEMO_TIME_OFFSETS.vendorDue.time, now),
    note: dateAt(DEMO_TIME_OFFSETS.note.days, DEMO_TIME_OFFSETS.note.time, now),
    email: dateAt(DEMO_TIME_OFFSETS.email.days, DEMO_TIME_OFFSETS.email.time, now),
    meeting: dateAt(DEMO_TIME_OFFSETS.meeting.days, DEMO_TIME_OFFSETS.meeting.time, now),
    meetingEnd: dateAt(DEMO_TIME_OFFSETS.meetingEnd.days, DEMO_TIME_OFFSETS.meetingEnd.time, now),
    provider: dateAt(DEMO_TIME_OFFSETS.provider.days, DEMO_TIME_OFFSETS.provider.time, now),
    tokenExpiry: dateAt(
      DEMO_TIME_OFFSETS.tokenExpiry.days,
      DEMO_TIME_OFFSETS.tokenExpiry.time,
      now,
    ),
    now,
  };
}

/**
 * Demo seed clock. Fixture times are stored as day offsets from "now" plus a
 * UTC clock time, then resolved when the seed runs so the workspace always
 * looks recent while relative order stays the same.
 *
 * The historical fixture was authored against 14 August 2026 18:00 UTC. Tests
 * keep that anchor so cadence floors stay deterministic; `dev:seed` swaps in
 * the real current instant.
 */
export const DEMO_CLOCK_ANCHOR = new Date('2026-08-14T18:00:00.000Z');
export const DEMO_CADENCE_SPAN_DAYS = 31;
export const DEMO_TOKEN_EXPIRY_DAYS = 180;

export interface DemoTimeOffset {
  /** Whole UTC days relative to the seed clock's UTC date. Negative is the past. */
  days: number;
  /** UTC clock time `HH:MM` or `HH:MM:SS`. */
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

export function parseUtcTime(time: string): { hours: number; minutes: number; seconds: number } {
  const match = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(time);
  if (!match) throw new Error(`Invalid demo UTC time ${time}`);
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3] ?? '0');
  if (hours > 23 || minutes > 59 || seconds > 59) {
    throw new Error(`Invalid demo UTC time ${time}`);
  }
  return { hours, minutes, seconds };
}

export function resolveDemoTime(now: Date, offset: DemoTimeOffset): Date {
  const { hours, minutes, seconds } = parseUtcTime(offset.time);
  return new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + offset.days,
      hours,
      minutes,
      seconds,
      0,
    ),
  );
}

export function isoAt(days: number, time: string, now = getDemoSeedNow()): string {
  return resolveDemoTime(now, { days, time }).toISOString();
}

export function dateAt(days: number, time: string, now = getDemoSeedNow()): Date {
  return resolveDemoTime(now, { days, time });
}

export function utcDay(days: number, now = getDemoSeedNow()): string {
  return isoAt(days, '00:00:00', now).slice(0, 10);
}

export function cadenceRange(now = getDemoSeedNow()): { start: string; end: string } {
  return { start: utcDay(-DEMO_CADENCE_SPAN_DAYS, now), end: utcDay(0, now) };
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
  vendorDue: { days: -56, time: '17:00:00' },
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

import { randomUUID } from 'node:crypto';

import { PGlite } from '@electric-sql/pglite';
import { meetings, savedMeetings, teamMeetingSettings } from '@timeline/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as SharedModule from '@timeline/shared';

import { applyDbMigrations } from '#src/test/pglite.js';
import { processMeetingSchedulerTick } from '#src/workers/meetingScheduler.js';

/**
 * Scheduler tests use a real pglite database and a mocked meeting provider.
 * The product contract is persisted state: due Saved Meetings should start a
 * bot once, duplicates should not, and repeated scheduled failures should pause
 * future auto-join.
 */

const joinMeetingMock = vi.hoisted(() => vi.fn());

vi.mock('@timeline/shared', async () => {
  const actual = await vi.importActual<typeof SharedModule>('@timeline/shared');
  return {
    ...actual,
    childLogger: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
    meetingBots: {
      ...actual.meetingBots,
      getMeetingBotProvider: vi.fn(() => ({ name: 'recall', joinMeeting: joinMeetingMock })),
      resolveTranscriptWebhookUrl: vi.fn(
        () => 'https://timeline.test/api/webhooks/recall/transcript',
      ),
    },
  };
});

const TEAM_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

async function seed(pg: PGlite): Promise<void> {
  await pg.exec(`
    INSERT INTO teams (id, slug, name) VALUES ('${TEAM_ID}', 'team-a', 'Team A');
    INSERT INTO users (id, email) VALUES ('${USER_ID}', 'a@example.com');
    INSERT INTO team_members (team_id, user_id, role)
    VALUES ('${TEAM_ID}', '${USER_ID}', 'owner');
  `);
}

async function insertSavedAndScheduled(
  db: ReturnType<typeof drizzle>,
  input: {
    url?: string;
    consecutiveFailureCount?: number;
    autoJoinEnabled?: boolean;
    autoJoinPausedAt?: Date | null;
    archivedAt?: Date | null;
    joinOffsetMinutes?: number;
    noShowRetry?: boolean;
    scheduledStartAt?: Date;
  } = {},
) {
  const [saved] = await db
    .insert(savedMeetings)
    .values({
      teamId: TEAM_ID,
      createdByUserId: USER_ID,
      title: 'Daily',
      platform: 'meet',
      meetingUrl: input.url ?? 'https://meet.google.com/due-now-test',
      permissionConfirmedAt: new Date(),
      permissionConfirmedByUserId: USER_ID,
      scheduleConfig: {
        weekdays: [1],
        times: ['10:00'],
        timezone: 'UTC',
        joinOffsetMinutes: input.joinOffsetMinutes ?? 2,
      },
      durationMinutes: 30,
      autoJoinEnabled: input.autoJoinEnabled ?? true,
      autoJoinPausedAt: input.autoJoinPausedAt ?? null,
      archivedAt: input.archivedAt ?? null,
      consecutiveFailureCount: input.consecutiveFailureCount ?? 0,
    })
    .returning();
  if (!saved) throw new Error('missing saved meeting');

  const [meeting] = await db
    .insert(meetings)
    .values({
      teamId: TEAM_ID,
      createdByUserId: USER_ID,
      savedMeetingId: saved.id,
      provider: 'recall',
      platform: 'meet',
      meetingUrl: saved.meetingUrl,
      title: saved.title,
      status: 'scheduled',
      scheduledStartAt: input.scheduledStartAt ?? new Date(Date.now() + 30_000),
      scheduledEndAt: new Date((input.scheduledStartAt?.getTime() ?? Date.now()) + 30 * 60_000),
      defaultVisibility: 'team',
      metadata: {
        source: 'test',
        ...(input.noShowRetry ? { no_show_retry_count: 1 } : {}),
      },
    })
    .returning();
  if (!meeting) throw new Error('missing scheduled meeting');
  return { saved, meeting };
}

describe('processMeetingSchedulerTick', () => {
  let pg: PGlite;
  let db: ReturnType<typeof drizzle>;

  beforeEach(async () => {
    joinMeetingMock.mockReset();
    joinMeetingMock.mockResolvedValue({ botId: 'bot-1', raw: { id: 'bot-1' } });
    pg = new PGlite();
    await applyDbMigrations(pg);
    await seed(pg);
    db = drizzle(pg);
  });

  afterEach(async () => {
    await pg.close();
  });

  it('starts due scheduled Saved Meeting captures and stores provider bot id', async () => {
    const { meeting } = await insertSavedAndScheduled(db);

    const result = await processMeetingSchedulerTick({ db: db as never });

    expect(result.joined).toBe(1);
    expect(joinMeetingMock).toHaveBeenCalledWith(
      expect.objectContaining({
        meetingId: meeting.id,
        teamId: TEAM_ID,
        meetingUrl: 'https://meet.google.com/due-now-test',
        botName: "Team A's thetimeline.cc bot",
      }),
    );
    const row = (await db.select().from(meetings).where(eq(meetings.id, meeting.id)))[0];
    expect(row?.status).toBe('joining');
    expect(row?.providerBotId).toBe('bot-1');
  });

  it('still starts captures when the repeatable scheduler tick is more than a minute late', async () => {
    const { meeting } = await insertSavedAndScheduled(db, {
      scheduledStartAt: new Date(Date.now() - 90_000),
    });

    const result = await processMeetingSchedulerTick({ db: db as never });

    expect(result.joined).toBe(1);
    expect(joinMeetingMock).toHaveBeenCalledWith(
      expect.objectContaining({ meetingId: meeting.id }),
    );
    const row = (await db.select().from(meetings).where(eq(meetings.id, meeting.id)))[0];
    expect(row?.status).toBe('joining');
  });

  it('starts an in-window no-show retry even after the normal lookback closes', async () => {
    const { meeting } = await insertSavedAndScheduled(db, {
      noShowRetry: true,
      scheduledStartAt: new Date(Date.now() - 10 * 60_000),
    });

    const result = await processMeetingSchedulerTick({ db: db as never });

    expect(result.joined).toBe(1);
    expect(joinMeetingMock).toHaveBeenCalledWith(
      expect.objectContaining({ meetingId: meeting.id }),
    );
  });

  it('claims scheduled captures before calling the provider so concurrent ticks do not duplicate bots', async () => {
    const { meeting } = await insertSavedAndScheduled(db);
    let releaseJoin!: () => void;
    const joinReleased = new Promise<void>((resolve) => {
      releaseJoin = resolve;
    });
    joinMeetingMock.mockImplementation(async () => {
      await joinReleased;
      return { botId: 'bot-1', raw: { id: 'bot-1' } };
    });

    const firstTick = processMeetingSchedulerTick({ db: db as never });
    await vi.waitFor(async () => {
      const row = (await db.select().from(meetings).where(eq(meetings.id, meeting.id)))[0];
      expect(row?.status).toBe('joining');
    });

    const secondTick = await processMeetingSchedulerTick({ db: db as never });
    releaseJoin();
    const firstResult = await firstTick;

    expect(firstResult.joined).toBe(1);
    expect(secondTick.joined).toBe(0);
    expect(joinMeetingMock).toHaveBeenCalledTimes(1);
  });

  it('does not create a duplicate bot when the same meeting URL is already active', async () => {
    const { meeting } = await insertSavedAndScheduled(db);
    await db.insert(meetings).values({
      teamId: TEAM_ID,
      createdByUserId: USER_ID,
      provider: 'recall',
      platform: 'meet',
      meetingUrl: meeting.meetingUrl,
      title: 'Already active',
      status: 'active',
      defaultVisibility: 'team',
      metadata: {},
    });

    const result = await processMeetingSchedulerTick({ db: db as never });

    expect(result.joined).toBe(0);
    expect(joinMeetingMock).not.toHaveBeenCalled();
    const row = (await db.select().from(meetings).where(eq(meetings.id, meeting.id)))[0];
    expect(row?.status).toBe('scheduled');
  });

  it('does not start pre-materialized rows after auto-join is disabled, paused, or archived', async () => {
    for (const input of [
      { autoJoinEnabled: false },
      { autoJoinPausedAt: new Date() },
      { archivedAt: new Date() },
    ]) {
      joinMeetingMock.mockClear();
      const { meeting } = await insertSavedAndScheduled(db, {
        ...input,
        url: `https://meet.google.com/${randomUUID().slice(0, 11)}`,
      });

      const result = await processMeetingSchedulerTick({ db: db as never });

      expect(result.joined).toBe(0);
      expect(joinMeetingMock).not.toHaveBeenCalled();
      const row = (await db.select().from(meetings).where(eq(meetings.id, meeting.id)))[0];
      expect(row?.status).toBe('scheduled');
    }
  });

  it('honors the saved meeting join offset before starting scheduled captures', async () => {
    const { meeting } = await insertSavedAndScheduled(db, {
      joinOffsetMinutes: 0,
      scheduledStartAt: new Date(Date.now() + 30_000),
    });

    const result = await processMeetingSchedulerTick({ db: db as never });

    expect(result.joined).toBe(0);
    expect(joinMeetingMock).not.toHaveBeenCalled();
    const row = (await db.select().from(meetings).where(eq(meetings.id, meeting.id)))[0];
    expect(row?.status).toBe('scheduled');
  });

  it('marks due captures failed and pauses auto-join after the third scheduled failure', async () => {
    const { saved, meeting } = await insertSavedAndScheduled(db, { consecutiveFailureCount: 2 });
    await db.insert(teamMeetingSettings).values({
      teamId: TEAM_ID,
      meetingMinutesCap: 0,
      requireHostConsent: true,
      meetingMinutesAdminOverride: false,
    });

    const result = await processMeetingSchedulerTick({ db: db as never });

    expect(result.failed).toBe(1);
    expect(joinMeetingMock).not.toHaveBeenCalled();
    const meetingRow = (await db.select().from(meetings).where(eq(meetings.id, meeting.id)))[0];
    expect(meetingRow?.status).toBe('failed');
    const savedRow = (
      await db.select().from(savedMeetings).where(eq(savedMeetings.id, saved.id))
    )[0];
    expect(savedRow?.consecutiveFailureCount).toBe(3);
    expect(savedRow?.autoJoinEnabled).toBe(false);
    expect(savedRow?.autoJoinPausedAt).toBeInstanceOf(Date);
  });
});

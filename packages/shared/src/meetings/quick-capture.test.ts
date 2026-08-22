import { PGlite } from '@electric-sql/pglite';
import { meetingCaptureConfirmations, meetings, teamMeetingSettings } from '@timeline/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as MeetingBotsModule from '#src/meeting-bots/index.js';

import {
  confirmRawUrlQuickJoin,
  createRawUrlQuickJoinConfirmation,
} from '#src/meetings/quick-capture.js';
import { withTeam } from '#src/team-scope.js';
import { applyDbMigrations } from '#src/test/pglite.js';

const joinMeetingMock = vi.hoisted(() => vi.fn());

vi.mock('#src/meeting-bots/index.js', async () => {
  const actual = await vi.importActual<typeof MeetingBotsModule>('#src/meeting-bots/index.js');
  return {
    ...actual,
    isMeetingBotConfigured: vi.fn(() => true),
    getMeetingBotProvider: vi.fn(() => ({ name: 'recall', joinMeeting: joinMeetingMock })),
    resolveTranscriptWebhookUrl: vi.fn(
      () => 'https://timeline.test/api/webhooks/recall/transcript',
    ),
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

describe('quick meeting capture', () => {
  let pg: PGlite;
  let db: ReturnType<typeof drizzle>;

  beforeEach(async () => {
    joinMeetingMock.mockReset();
    pg = new PGlite();
    await applyDbMigrations(pg);
    await seed(pg);
    db = drizzle(pg);
  });

  afterEach(async () => {
    await pg.close();
  });

  it('claims raw-url confirmations before joining so prompt retries cannot create duplicate bots', async () => {
    let releaseJoin!: () => void;
    const joinReleased = new Promise<void>((resolve) => {
      releaseJoin = resolve;
    });
    joinMeetingMock.mockImplementation(async () => {
      await joinReleased;
      return { botId: 'bot-1', raw: { id: 'bot-1' } };
    });

    const prompt = await createRawUrlQuickJoinConfirmation({
      db: db as never,
      teamId: TEAM_ID,
      userId: USER_ID,
      source: 'telegram',
      meetingUrl: 'https://meet.google.com/raw-url-now',
    });
    const confirmationId = prompt.confirmationId;
    if (!confirmationId) throw new Error('expected confirmation id');

    const first = confirmRawUrlQuickJoin({
      db: db as never,
      teamId: TEAM_ID,
      userId: USER_ID,
      confirmationId,
    });
    await vi.waitFor(() => {
      expect(joinMeetingMock).toHaveBeenCalledTimes(1);
    });

    const second = await confirmRawUrlQuickJoin({
      db: db as never,
      teamId: TEAM_ID,
      userId: USER_ID,
      confirmationId,
    });

    releaseJoin();
    const joined = await first;

    expect(joined.ok).toBe(true);
    expect(second).toMatchObject({ ok: false, error: 'Confirmation is no longer pending.' });
    expect(joinMeetingMock).toHaveBeenCalledTimes(1);
    const rows = await db.select().from(meetings).where(eq(meetings.teamId, TEAM_ID));
    expect(rows).toHaveLength(1);
  });

  it('leaves raw-url confirmations pending when capacity blocks the join', async () => {
    await db.insert(teamMeetingSettings).values({
      teamId: TEAM_ID,
      meetingMinutesCap: 0,
      meetingMinutesAdminOverride: false,
      requireHostConsent: true,
    });
    const prompt = await createRawUrlQuickJoinConfirmation({
      db: db as never,
      teamId: TEAM_ID,
      userId: USER_ID,
      source: 'slack',
      meetingUrl: 'https://meet.google.com/cap-blk-now',
    });
    const confirmationId = prompt.confirmationId;
    if (!confirmationId) throw new Error('expected confirmation id');

    const result = await confirmRawUrlQuickJoin({
      db: db as never,
      teamId: TEAM_ID,
      userId: USER_ID,
      confirmationId,
    });

    expect(result).toMatchObject({
      ok: false,
      error: 'Meeting notetakers are disabled for this team.',
    });
    expect(joinMeetingMock).not.toHaveBeenCalled();
    const [confirmation] = await db
      .select()
      .from(meetingCaptureConfirmations)
      .where(eq(meetingCaptureConfirmations.id, confirmationId));
    expect(confirmation?.status).toBe('pending');
    expect(confirmation?.meetingId).toBeNull();
  });

  it('rejects a new join when another Recall bot is already live on Free', async () => {
    await pg.exec(`
      INSERT INTO meetings (team_id, platform, meeting_url, status)
      VALUES ('${TEAM_ID}', 'meet', 'https://meet.google.com/already-live', 'active');
    `);

    const prompt = await createRawUrlQuickJoinConfirmation({
      db: db as never,
      teamId: TEAM_ID,
      userId: USER_ID,
      source: 'slack',
      meetingUrl: 'https://meet.google.com/second-bot',
    });
    const confirmationId = prompt.confirmationId;
    if (!confirmationId) throw new Error('expected confirmation id');

    const result = await confirmRawUrlQuickJoin({
      db: db as never,
      teamId: TEAM_ID,
      userId: USER_ID,
      confirmationId,
    });

    expect(result).toMatchObject({
      ok: false,
      error: 'Concurrent meeting notetaker limit reached for this plan',
    });
    expect(joinMeetingMock).not.toHaveBeenCalled();
  });

  it('marks the capture failed and links the confirmation when the provider join fails', async () => {
    joinMeetingMock.mockRejectedValue(new Error('provider unavailable'));
    const prompt = await createRawUrlQuickJoinConfirmation({
      db: db as never,
      teamId: TEAM_ID,
      userId: USER_ID,
      source: 'telegram',
      meetingUrl: 'https://meet.google.com/fail-now-url',
    });
    const confirmationId = prompt.confirmationId;
    if (!confirmationId) throw new Error('expected confirmation id');

    const result = await confirmRawUrlQuickJoin({
      db: db as never,
      teamId: TEAM_ID,
      userId: USER_ID,
      confirmationId,
    });

    expect(result).toMatchObject({ ok: false, error: 'Failed to invite notetaker' });
    const [meeting] = await db.select().from(meetings).where(eq(meetings.teamId, TEAM_ID));
    expect(meeting?.status).toBe('failed');
    expect(meeting?.metadata).toMatchObject({
      join_error: 'provider unavailable',
      source: 'quick_join',
    });
    const [confirmation] = await db
      .select()
      .from(meetingCaptureConfirmations)
      .where(eq(meetingCaptureConfirmations.id, confirmationId));
    expect(confirmation?.status).toBe('confirmed');
    expect(confirmation?.meetingId).toBe(meeting?.id);
  });

  it('reuses a due saved scheduled occurrence when confirming the same raw URL', async () => {
    joinMeetingMock.mockResolvedValue({ botId: 'bot-1', raw: { id: 'bot-1' } });
    const scope = withTeam(db as never, TEAM_ID, USER_ID).meetings;
    const saved = await scope.createSavedMeeting({
      title: 'Raw URL daily',
      meetingUrl: 'https://meet.google.com/raw-url-due',
      permissionConfirmed: true,
      defaultVisibility: 'team',
    });
    const scheduled = await scope.createMeeting({
      platform: saved.platform,
      meetingUrl: saved.meetingUrl,
      title: saved.title,
      savedMeetingId: saved.id,
      status: 'scheduled',
      scheduledStartAt: new Date(),
      defaultVisibility: 'team',
      metadata: { source: 'test_scheduled_occurrence' },
    });
    const prompt = await createRawUrlQuickJoinConfirmation({
      db: db as never,
      teamId: TEAM_ID,
      userId: USER_ID,
      source: 'telegram',
      meetingUrl: saved.meetingUrl,
    });
    const confirmationId = prompt.confirmationId;
    if (!confirmationId) throw new Error('expected confirmation id');

    const result = await confirmRawUrlQuickJoin({
      db: db as never,
      teamId: TEAM_ID,
      userId: USER_ID,
      confirmationId,
    });

    expect(result).toMatchObject({ ok: true, meetingId: scheduled.id });
    expect(joinMeetingMock).toHaveBeenCalledTimes(1);
    const rows = await db.select().from(meetings).where(eq(meetings.teamId, TEAM_ID));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(scheduled.id);
    expect(rows[0]?.status).toBe('joining');
  });

  it('does not call the provider again when the due saved occurrence is already joining', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID).meetings;
    const saved = await scope.createSavedMeeting({
      title: 'Already joining daily',
      meetingUrl: 'https://meet.google.com/raw-url-joining',
      permissionConfirmed: true,
      defaultVisibility: 'team',
    });
    const joining = await scope.createMeeting({
      platform: saved.platform,
      meetingUrl: saved.meetingUrl,
      title: saved.title,
      savedMeetingId: saved.id,
      status: 'joining',
      scheduledStartAt: new Date(),
      defaultVisibility: 'team',
      metadata: { source: 'already_joining' },
    });
    const prompt = await createRawUrlQuickJoinConfirmation({
      db: db as never,
      teamId: TEAM_ID,
      userId: USER_ID,
      source: 'telegram',
      meetingUrl: saved.meetingUrl,
    });
    const confirmationId = prompt.confirmationId;
    if (!confirmationId) throw new Error('expected confirmation id');

    const result = await confirmRawUrlQuickJoin({
      db: db as never,
      teamId: TEAM_ID,
      userId: USER_ID,
      confirmationId,
    });

    expect(result).toMatchObject({ ok: true, meetingId: joining.id });
    expect(joinMeetingMock).not.toHaveBeenCalled();
    const rows = await db.select().from(meetings).where(eq(meetings.teamId, TEAM_ID));
    expect(rows).toHaveLength(1);
  });
});

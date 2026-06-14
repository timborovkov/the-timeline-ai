import { PGlite } from '@electric-sql/pglite';
import { meetings } from '@timeline/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as MeetingBotsModule from '#src/meeting-bots/index.js';

import {
  confirmRawUrlQuickJoin,
  createRawUrlQuickJoinConfirmation,
} from '#src/meetings/quick-capture.js';
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
});

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import { meetings, meetingTranscriptChunks, rawEvents } from '@timeline/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';

import { withTeam } from '../team-scope.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '../../../db/drizzle');

const TEAM_ID = '11111111-1111-1111-1111-111111111111';
const USER_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

async function applyMigrations(pg: PGlite): Promise<void> {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');
    const statements = sql
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && s !== 'SELECT 1;');
    for (const stmt of statements) {
      await pg.exec(stmt);
    }
  }
}

async function seed(pg: PGlite): Promise<void> {
  await pg.exec(`INSERT INTO teams (id, slug, name) VALUES ('${TEAM_ID}', 't', 'Test');`);
  await pg.exec(`INSERT INTO users (id, email) VALUES ('${USER_A}', 'a@x');`);
  await pg.exec(
    `INSERT INTO team_members (team_id, user_id, role) VALUES ('${TEAM_ID}', '${USER_A}', 'owner');`,
  );
}

describe('meetings scope', () => {
  let pg: PGlite;
  // drizzle pglite db (loosely typed because of the runtime client)
  let db: ReturnType<typeof drizzle>;

  beforeEach(async () => {
    pg = new PGlite();
    await applyMigrations(pg);
    await seed(pg);
    db = drizzle(pg);
  });

  it('createMeeting persists row with defaults and team scoping', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_A);
    const m = await scope.createMeeting({
      platform: 'meet',
      meetingUrl: 'https://meet.google.com/abc',
    });
    expect(m.teamId).toBe(TEAM_ID);
    expect(m.status).toBe('pending');
    expect(m.defaultVisibility).toBe('team');
    expect(m.provider).toBe('recall');
  });

  it('appendMeetingChunk writes raw_event + chunk in one transaction with idempotency', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_A);
    const m = await scope.createMeeting({
      platform: 'zoom',
      meetingUrl: 'https://zoom.us/j/1',
    });
    const r1 = await scope.appendMeetingChunk({
      meetingId: m.id,
      speaker: 'Alice',
      text: 'hello world',
      startMs: 0,
      endMs: 1500,
      providerChunkId: 'utt-1',
    });
    expect(r1).not.toBeNull();
    expect(r1?.deduplicated).toBe(false);
    expect(r1?.chunkId).toBeDefined();
    expect(r1?.rawEventId).toBeDefined();

    // Idempotent second call with the same providerChunkId returns dedup=true.
    const r2 = await scope.appendMeetingChunk({
      meetingId: m.id,
      speaker: 'Alice',
      text: 'hello world',
      startMs: 0,
      endMs: 1500,
      providerChunkId: 'utt-1',
    });
    expect(r2?.deduplicated).toBe(true);
    expect(r2?.chunkId).toBe(r1?.chunkId);

    // Underlying row counts confirm no duplicates.
    const chunkRows = await db
      .select()
      .from(meetingTranscriptChunks)
      .where(eq(meetingTranscriptChunks.meetingId, m.id));
    expect(chunkRows).toHaveLength(1);
    const eventRows = await db.select().from(rawEvents).where(eq(rawEvents.teamId, TEAM_ID));
    // includes the chunk audit only — no other rows seeded.
    expect(eventRows).toHaveLength(1);
    expect(eventRows[0]?.source).toBe('meeting');
  });

  it('updateMeetingStatus flips status and merges metadata', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_A);
    const m = await scope.createMeeting({
      platform: 'meet',
      meetingUrl: 'https://meet.google.com/x',
    });
    await scope.updateMeetingStatus(m.id, 'active', {
      providerBotId: 'bot-1',
      startedAt: new Date('2026-05-25T10:00:00Z'),
      metadata: { last_status: 'in_call_recording' },
    });
    const rows = await db.select().from(meetings).where(eq(meetings.id, m.id));
    const row = rows[0];
    expect(row?.status).toBe('active');
    expect(row?.providerBotId).toBe('bot-1');
    expect((row?.metadata as Record<string, unknown>).last_status).toBe('in_call_recording');
  });

  it('records and sums meeting minutes per month', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_A);
    const m = await scope.createMeeting({
      platform: 'meet',
      meetingUrl: 'https://meet.google.com/x',
    });
    await scope.recordMeetingMinutes(m.id, 30);
    // Idempotent: second call must not double-count.
    await scope.recordMeetingMinutes(m.id, 99);
    const total = await scope.getCurrentMonthMinutes();
    expect(total).toBe(30);
  });
});

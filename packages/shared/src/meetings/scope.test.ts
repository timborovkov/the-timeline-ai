import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import { calendarEvents, meetings, meetingTranscriptChunks, rawEvents } from '@timeline/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';

import { withTeam } from '#src/team-scope.js';

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
    const scope = withTeam(db as never, TEAM_ID, USER_A).meetings;
    const m = await scope.createMeeting({
      platform: 'meet',
      meetingUrl: 'https://meet.google.com/abc',
    });
    expect(m.teamId).toBe(TEAM_ID);
    expect(m.status).toBe('pending');
    expect(m.defaultVisibility).toBe('team');
    expect(m.provider).toBe('recall');
  });

  it('appendMeetingChunk writes chunk with idempotency (no per-chunk raw_event)', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_A).meetings;
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
  });

  it('appendMeetingChunk links late chunks to an existing finalized meeting event', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_A).meetings;
    const m = await scope.createMeeting({
      platform: 'zoom',
      meetingUrl: 'https://zoom.us/j/1',
      metadata: {
        summary: 'Old summary',
        summary_model: 'test-model',
        action_items: [{ text: 'Old action', owner: null }],
      },
    });
    await db
      .update(meetings)
      .set({ participants: [{ name: 'Alice' }, { name: 'Bob', email: 'bob@example.com' }] })
      .where(eq(meetings.id, m.id));
    await scope.updateMeetingStatus(m.id, 'completed');
    const eventRows = await db
      .insert(rawEvents)
      .values({
        teamId: TEAM_ID,
        authorUserId: USER_A,
        source: 'meeting',
        contentText: 'Meeting (no transcript)',
        occurredAt: new Date('2026-05-25T10:00:00Z'),
        visibility: 'team',
        sourceMetadata: {
          meeting_id: m.id,
          meeting_chunk_provider_id: `meeting-finalized:${m.id}`,
          chunk_count: 0,
          summary: 'Old summary',
          action_items: [{ text: 'Old action', owner: null }],
        },
      })
      .returning({ id: rawEvents.id });
    const rawEventId = eventRows[0]?.id;
    if (!rawEventId) throw new Error('missing raw event');
    const calendarRows = await db
      .insert(calendarEvents)
      .values({
        teamId: TEAM_ID,
        createdByUserId: USER_A,
        title: 'Zoom with Meeting Bot: Planning',
        description:
          'Meeting: /app/meetings/test\n\nSummary: Old summary\n\nAction items: Old action',
        startAt: new Date('2026-05-25T10:00:00Z'),
        endAt: new Date('2026-05-25T10:30:00Z'),
        timezone: 'UTC',
        location: 'https://zoom.us/j/1',
        visibility: 'team',
        metadata: {
          source: 'meeting_bot',
          meeting_id: m.id,
          summary: 'Old summary',
          action_items: [{ text: 'Old action', owner: null }],
        },
      })
      .returning({ id: calendarEvents.id });
    const calendarEventId = calendarRows[0]?.id;
    if (!calendarEventId) throw new Error('missing calendar event');
    const calendarRawRows = await db
      .insert(rawEvents)
      .values([
        {
          teamId: TEAM_ID,
          authorUserId: USER_A,
          source: 'calendar',
          contentText: 'Scheduled: Zoom with Meeting Bot: Planning',
          occurredAt: new Date('2026-05-25T09:55:00Z'),
          visibility: 'team',
          sourceMetadata: {
            calendar_event_id: calendarEventId,
            action: 'scheduled',
            meeting_id: m.id,
            source: 'meeting_bot',
            summary: 'Old summary',
            action_items: [{ text: 'Old action', owner: null }],
          },
        },
        {
          teamId: TEAM_ID,
          authorUserId: USER_A,
          source: 'calendar',
          contentText:
            'Zoom with Meeting Bot: Planning | Summary: Old summary | Action items: Old action',
          occurredAt: new Date('2026-05-25T10:00:00Z'),
          visibility: 'team',
          sourceMetadata: {
            calendar_event_id: calendarEventId,
            action: 'event',
            meeting_id: m.id,
            source: 'meeting_bot',
            summary: 'Old summary',
            action_items: [{ text: 'Old action', owner: null }],
          },
        },
      ])
      .returning({ id: rawEvents.id });
    await db
      .update(calendarEvents)
      .set({
        scheduledRawEventId: calendarRawRows[0]?.id,
        startAtRawEventId: calendarRawRows[1]?.id,
      })
      .where(eq(calendarEvents.id, calendarEventId));

    const result = await scope.appendMeetingChunk({
      meetingId: m.id,
      speaker: 'Alice',
      text: 'late utterance',
      startMs: 1000,
      endMs: 2000,
      providerChunkId: 'utt-late',
    });
    expect(result?.refreshedCalendarEventId).toBe(calendarEventId);

    const chunkRows = await db
      .select()
      .from(meetingTranscriptChunks)
      .where(
        eq(meetingTranscriptChunks.id, result?.chunkId ?? '00000000-0000-0000-0000-000000000000'),
      );
    expect(chunkRows[0]?.rawEventId).toBe(rawEventId);

    const event = (await db.select().from(rawEvents).where(eq(rawEvents.id, rawEventId)))[0];
    expect(event?.contentText).toBe('[1s] Alice: late utterance');
    const eventMeta = event?.sourceMetadata as Record<string, unknown>;
    expect(eventMeta.chunk_count).toBe(1);
    expect(eventMeta.speakers).toEqual(['Alice']);
    expect(eventMeta.summary).toBeUndefined();
    expect(eventMeta.action_items).toBeUndefined();
    expect(eventMeta.summary_stale_at).toBeTypeOf('string');

    const meeting = (await db.select().from(meetings).where(eq(meetings.id, m.id)))[0];
    const meetingMeta = meeting?.metadata as Record<string, unknown>;
    expect(meetingMeta.summary).toBeUndefined();
    expect(meetingMeta.summary_model).toBeUndefined();
    expect(meetingMeta.action_items).toBeUndefined();
    expect(meetingMeta.summary_stale_at).toBeTypeOf('string');

    const calendar = (
      await db.select().from(calendarEvents).where(eq(calendarEvents.id, calendarEventId))
    )[0];
    expect(calendar?.description).toContain(
      'Summary stale: transcript changed after finalization.',
    );
    expect(calendar?.description).not.toContain('Old summary');
    expect(calendar?.description).not.toContain('Old action');
    const calendarMeta = calendar?.metadata as Record<string, unknown>;
    expect(calendarMeta.summary).toBeUndefined();
    expect(calendarMeta.action_items).toBeUndefined();
    expect(calendarMeta.summary_stale_at).toBeTypeOf('string');

    const linkedCalendarRawRows = await db
      .select()
      .from(rawEvents)
      .where(eq(rawEvents.source, 'calendar'));
    for (const row of linkedCalendarRawRows) {
      const meta = row.sourceMetadata as Record<string, unknown>;
      expect(meta.summary).toBeUndefined();
      expect(meta.action_items).toBeUndefined();
      expect(meta.extracted_at).toBeTypeOf('string');
      expect(meta.extraction_skipped_at).toBeTypeOf('string');
      expect(meta.extraction_skipped_reason).toBe('generated_from_meeting_bot');
      expect(meta.extraction_model_version).toBeTypeOf('string');
      expect(meta.summary_stale_at).toBeTypeOf('string');
    }
    const startRaw = linkedCalendarRawRows.find(
      (row) => (row.sourceMetadata as Record<string, unknown>).action === 'event',
    );
    expect(startRaw?.contentText).toContain(
      'Summary stale: transcript changed after finalization.',
    );
    expect(startRaw?.contentText).toContain('Participants: Alice, Bob');
    expect(startRaw?.contentText).not.toContain('\n\n');
    expect(startRaw?.contentText?.match(/https:\/\/zoom\.us\/j\/1/g)).toHaveLength(1);
    expect(startRaw?.contentText).not.toContain('Old summary');
    expect(startRaw?.contentText).not.toContain('Old action');
  });

  it('appendMeetingChunk replay after finalize preserves existing summary metadata', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_A).meetings;
    const m = await scope.createMeeting({
      platform: 'zoom',
      meetingUrl: 'https://zoom.us/j/1',
      metadata: {
        summary: 'Final summary',
        summary_model: 'test-model',
        action_items: [{ text: 'Final action', owner: null }],
      },
    });
    const first = await scope.appendMeetingChunk({
      meetingId: m.id,
      speaker: 'Alice',
      text: 'already captured',
      startMs: 1000,
      endMs: 2000,
      providerChunkId: 'utt-replay',
    });
    expect(first?.deduplicated).toBe(false);
    await scope.updateMeetingStatus(m.id, 'completed');
    const eventRows = await db
      .insert(rawEvents)
      .values({
        teamId: TEAM_ID,
        authorUserId: USER_A,
        source: 'meeting',
        contentText: '[1s] Alice: already captured',
        occurredAt: new Date('2026-05-25T10:00:00Z'),
        visibility: 'team',
        sourceMetadata: {
          meeting_id: m.id,
          meeting_chunk_provider_id: `meeting-finalized:${m.id}`,
          chunk_count: 1,
          summary: 'Final summary',
          action_items: [{ text: 'Final action', owner: null }],
        },
      })
      .returning({ id: rawEvents.id });
    const rawEventId = eventRows[0]?.id;
    if (!rawEventId) throw new Error('missing raw event');

    const replay = await scope.appendMeetingChunk({
      meetingId: m.id,
      speaker: 'Alice',
      text: 'already captured',
      startMs: 1000,
      endMs: 2000,
      providerChunkId: 'utt-replay',
    });

    expect(replay?.deduplicated).toBe(true);
    const chunk = (
      await db
        .select()
        .from(meetingTranscriptChunks)
        .where(eq(meetingTranscriptChunks.id, replay?.chunkId ?? ''))
    )[0];
    expect(chunk?.rawEventId).toBe(rawEventId);

    const event = (await db.select().from(rawEvents).where(eq(rawEvents.id, rawEventId)))[0];
    expect(event?.contentText).toBe('[1s] Alice: already captured');
    const eventMeta = event?.sourceMetadata as Record<string, unknown>;
    expect(eventMeta.summary).toBe('Final summary');
    expect(eventMeta.action_items).toEqual([{ text: 'Final action', owner: null }]);
    expect(eventMeta.summary_stale_at).toBeUndefined();

    const meeting = (await db.select().from(meetings).where(eq(meetings.id, m.id)))[0];
    const meetingMeta = meeting?.metadata as Record<string, unknown>;
    expect(meetingMeta.summary).toBe('Final summary');
    expect(meetingMeta.summary_model).toBe('test-model');
    expect(meetingMeta.action_items).toEqual([{ text: 'Final action', owner: null }]);
    expect(meetingMeta.summary_stale_at).toBeUndefined();
  });

  it('updateMeetingStatus flips status and merges metadata', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_A).meetings;
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
    const scope = withTeam(db as never, TEAM_ID, USER_A).meetings;
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

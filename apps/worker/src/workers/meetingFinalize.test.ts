import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import {
  calendarEvents,
  type Db,
  meetings as meetingsTable,
  meetingTranscriptChunks,
  meetingUsage,
  rawEvents,
} from '@timeline/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { processMeetingFinalizeJob } from '#src/workers/meetingFinalize.js';

/**
 * Integration tests for the meeting-finalize worker handler. Uses pglite
 * for Postgres + an injected LLM stub so no OpenRouter / Redis is required.
 *
 * What these prove that mocks-only tests cannot:
 *   - Real status flips ('processing' → 'completed') land in actual rows.
 *   - meeting_usage row is written exactly once (unique index on meeting_id)
 *     even when the worker is re-run.
 *   - Empty-transcript meetings still complete without calling the LLM.
 *   - Re-running on an already-completed meeting is a clean no-op.
 *   - Metadata merge: existing keys are preserved; summary + action_items
 *     are appended; finalized_at is set.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '../../../../packages/db/drizzle');

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

const TEAM_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const MEETING_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const MEETING_CREATED_AT = new Date('2026-05-25T09:55:00Z');

async function seed(pg: PGlite): Promise<void> {
  await pg.exec(`INSERT INTO teams (id, slug, name) VALUES ('${TEAM_ID}', 't', 'Test');`);
  await pg.exec(`INSERT INTO users (id, email) VALUES ('${USER_ID}', 'a@x');`);
  await pg.exec(
    `INSERT INTO team_members (team_id, user_id, role) VALUES ('${TEAM_ID}', '${USER_ID}', 'owner');`,
  );
}

async function seedMeeting(
  db: Db,
  opts: {
    status?: 'pending' | 'joining' | 'active' | 'processing' | 'completed' | 'failed';
    startedAt?: Date | null;
    endedAt?: Date | null;
    metadata?: Record<string, unknown>;
  } = {},
): Promise<void> {
  await db.insert(meetingsTable).values({
    id: MEETING_ID,
    teamId: TEAM_ID,
    createdByUserId: USER_ID,
    provider: 'recall',
    platform: 'meet',
    meetingUrl: 'https://meet.google.com/test',
    title: 'Weekly planning',
    status: opts.status ?? 'processing',
    defaultVisibility: 'team',
    participants: [{ name: 'Alice' }, { name: 'Bob', email: 'bob@example.com' }],
    startedAt: 'startedAt' in opts ? opts.startedAt : new Date('2026-05-25T10:00:00Z'),
    endedAt: 'endedAt' in opts ? opts.endedAt : new Date('2026-05-25T10:30:00Z'),
    metadata: opts.metadata ?? {},
    createdAt: MEETING_CREATED_AT,
  });
}

async function seedChunk(db: Db, i: number, text: string, speaker: string | null): Promise<void> {
  await db.insert(meetingTranscriptChunks).values({
    meetingId: MEETING_ID,
    teamId: TEAM_ID,
    speaker,
    text,
    startMs: i * 5000,
    endMs: (i + 1) * 5000,
    providerChunkId: `utt-${String(i)}`,
  });
}

function makeChatStub(
  summary = 'Three-sentence summary.',
  actionItems: { text: string; owner?: string | null }[] = [],
) {
  return vi.fn().mockResolvedValue({
    object: { summary, action_items: actionItems },
    model: 'test-model@1.0',
  });
}

let pg: PGlite;
let db: ReturnType<typeof drizzle>;

beforeEach(async () => {
  pg = new PGlite();
  await applyMigrations(pg);
  await seed(pg);
  db = drizzle(pg);
});

describe('processMeetingFinalizeJob', () => {
  it('flips status to completed, writes summary + action items, records minutes', async () => {
    await seedMeeting(db as never);
    await seedChunk(db as never, 0, 'Hello, this is Alice.', 'Alice');
    await seedChunk(db as never, 1, 'Bob will own the migration.', 'Bob');

    const chat = makeChatStub('Meeting summary here.', [
      { text: 'Bob owns the migration', owner: 'Bob' },
      { text: 'Schedule design review' },
    ]);
    const enqueueExtractJob = vi.fn().mockResolvedValue(undefined);
    const enqueueEmbedJob = vi.fn().mockResolvedValue(undefined);

    const result = await processMeetingFinalizeJob(
      { db: db as never },
      { meetingId: MEETING_ID, teamId: TEAM_ID },
      {
        chatStructured: chat as never,
        enqueueExtractJob: enqueueExtractJob as never,
        enqueueEmbedJob: enqueueEmbedJob as never,
      },
    );

    expect(chat).toHaveBeenCalledOnce();
    expect(result.actionItems).toBe(2);
    expect(result.minutes).toBe(30);

    const rows = await db.select().from(meetingsTable).where(eq(meetingsTable.id, MEETING_ID));
    const row = rows[0];
    expect(row?.status).toBe('completed');
    const meta = row?.metadata as Record<string, unknown>;
    expect(meta.summary).toBe('Meeting summary here.');
    expect(meta.summary_model).toBe('test-model@1.0');
    expect(
      (meta.action_items as { text: string; owner: string | null }[]).map((a) => a.owner),
    ).toEqual(['Bob', null]);
    expect(meta.finalized_at).toBeTypeOf('string');

    const usage = await db
      .select()
      .from(meetingUsage)
      .where(eq(meetingUsage.meetingId, MEETING_ID));
    expect(usage).toHaveLength(1);
    expect(usage[0]?.minutes).toBe(30);

    // Consolidated raw_event: full transcript as contentText, summary in metadata
    const events = await db.select().from(rawEvents).where(eq(rawEvents.source, 'meeting'));
    expect(events).toHaveLength(1);
    expect(events[0]?.contentText).toContain('[0s] Alice: Hello, this is Alice.');
    expect(events[0]?.contentText).toContain('[5s] Bob: Bob will own the migration.');
    const eventMeta = events[0]?.sourceMetadata as Record<string, unknown>;
    expect(eventMeta.meeting_id).toBe(MEETING_ID);
    expect(eventMeta.summary).toBe('Meeting summary here.');
    expect(eventMeta.speakers).toEqual(['Alice', 'Bob']);
    expect(eventMeta.duration_minutes).toBe(30);
    expect(enqueueExtractJob).toHaveBeenCalledWith({ rawEventId: events[0]?.id, teamId: TEAM_ID });

    const calendarRows = await db
      .select()
      .from(calendarEvents)
      .where(eq(calendarEvents.teamId, TEAM_ID));
    expect(calendarRows).toHaveLength(1);
    const calendarRow = calendarRows[0];
    expect(calendarRow?.title).toBe('Google Meet with Meeting Bot: Weekly planning');
    expect(calendarRow?.startAt.toISOString()).toBe('2026-05-25T10:00:00.000Z');
    expect(calendarRow?.endAt.toISOString()).toBe('2026-05-25T10:30:00.000Z');
    expect(calendarRow?.location).toBe('https://meet.google.com/test');
    expect(calendarRow?.visibility).toBe('team');
    expect(calendarRow?.description).toContain(`/app/meetings/${MEETING_ID}`);
    expect(calendarRow?.description).toContain('Participants: Alice, Bob');
    expect(calendarRow?.description).toContain('Summary: Meeting summary here.');
    expect(calendarRow?.description).toContain('Bob owns the migration (Bob)');
    expect(calendarRow?.metadata).toMatchObject({
      source: 'meeting_bot',
      meeting_id: MEETING_ID,
      meeting_href: `/app/meetings/${MEETING_ID}`,
    });

    const calendarTimelineRows = await db
      .select()
      .from(rawEvents)
      .where(eq(rawEvents.source, 'calendar'));
    expect(calendarTimelineRows).toHaveLength(2);
    expect(calendarTimelineRows.map((event) => event.sourceMetadata)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          calendar_event_id: calendarRow?.id,
          action: 'scheduled',
          meeting_id: MEETING_ID,
        }),
        expect.objectContaining({
          calendar_event_id: calendarRow?.id,
          action: 'event',
          meeting_id: MEETING_ID,
        }),
      ]),
    );
    const scheduledEvent = calendarTimelineRows.find(
      (event) => (event.sourceMetadata as Record<string, unknown>).action === 'scheduled',
    );
    const startEvent = calendarTimelineRows.find(
      (event) => (event.sourceMetadata as Record<string, unknown>).action === 'event',
    );
    expect(scheduledEvent?.occurredAt.toISOString()).toBe(MEETING_CREATED_AT.toISOString());
    for (const event of calendarTimelineRows) {
      const meta = event.sourceMetadata as Record<string, unknown>;
      expect(meta.extracted_at).toBeTypeOf('string');
      expect(meta.extraction_skipped_at).toBeTypeOf('string');
      expect(meta.extraction_skipped_reason).toBe('generated_from_meeting_bot');
      expect(meta.extraction_model_version).toBeTypeOf('string');
    }
    expect(startEvent?.contentText).toContain('Participants: Alice, Bob');
    expect(startEvent?.contentText).not.toContain('Summary: Meeting summary here.');
    expect(startEvent?.contentText).not.toContain('Bob owns the migration');

    const chunks = await db
      .select()
      .from(meetingTranscriptChunks)
      .where(eq(meetingTranscriptChunks.meetingId, MEETING_ID));
    for (const chunk of chunks) {
      expect(enqueueEmbedJob).toHaveBeenCalledWith({
        scope: 'meeting_chunk',
        meetingChunkId: chunk.id,
        teamId: TEAM_ID,
      });
    }
    expect(enqueueEmbedJob).toHaveBeenCalledWith({
      scope: 'raw_event',
      rawEventId: events[0]?.id,
      teamId: TEAM_ID,
    });
    expect(enqueueEmbedJob).toHaveBeenCalledWith({
      scope: 'calendar_event',
      calendarEventId: calendarRow?.id,
      teamId: TEAM_ID,
    });
  });

  it('empty transcript: completes without calling the LLM', async () => {
    await seedMeeting(db as never);
    const chat = makeChatStub();
    const result = await processMeetingFinalizeJob(
      { db: db as never },
      { meetingId: MEETING_ID, teamId: TEAM_ID },
      { chatStructured: chat as never },
    );
    expect(chat).not.toHaveBeenCalled();
    expect(result.actionItems).toBe(0);
    const row = (await db.select().from(meetingsTable).where(eq(meetingsTable.id, MEETING_ID)))[0];
    expect(row?.status).toBe('completed');
    const meta = row?.metadata as Record<string, unknown>;
    expect(meta.summary).toBeUndefined();
    expect(meta.finalized_at).toBeTypeOf('string');
  });

  it('includes chunks appended while the LLM summary is in flight', async () => {
    await seedMeeting(db as never, { endedAt: null });
    await seedChunk(db as never, 0, 'Opening remarks.', 'Alice');
    let appended = false;
    const chat = vi.fn().mockImplementation(async ({ prompt }: { prompt: string }) => {
      if (!appended) {
        appended = true;
        await seedChunk(db as never, 1, 'Trailing decision.', 'Bob');
      }
      return {
        object: {
          summary: prompt.includes('Trailing decision.')
            ? 'Summary from final transcript.'
            : 'Summary from initial transcript.',
          action_items: [],
        },
        model: 'test-model@1.0',
      };
    });

    const result = await processMeetingFinalizeJob(
      { db: db as never },
      { meetingId: MEETING_ID, teamId: TEAM_ID },
      { chatStructured: chat as never },
    );

    expect(chat).toHaveBeenCalledTimes(2);
    const secondPrompt = (chat.mock.calls[1]?.[0] as { prompt: string } | undefined)?.prompt;
    expect(secondPrompt).toContain('Trailing decision.');
    expect(result.minutes).toBe(1);
    const events = await db.select().from(rawEvents).where(eq(rawEvents.source, 'meeting'));
    expect(events).toHaveLength(1);
    expect(events[0]?.contentText).toContain('[0s] Alice: Opening remarks.');
    expect(events[0]?.contentText).toContain('[5s] Bob: Trailing decision.');
    const eventMeta = events[0]?.sourceMetadata as Record<string, unknown>;
    expect(eventMeta.chunk_count).toBe(2);
    expect(eventMeta.summary).toBe('Summary from final transcript.');
  });

  it('re-enqueues extract and embed when retrying an already-completed meeting', async () => {
    await seedMeeting(db as never);
    await seedChunk(db as never, 0, 'Hello.', 'Alice');
    const chat = makeChatStub();

    await processMeetingFinalizeJob(
      { db: db as never },
      { meetingId: MEETING_ID, teamId: TEAM_ID },
      { chatStructured: chat as never },
    );

    const event = (await db.select().from(rawEvents).where(eq(rawEvents.source, 'meeting')))[0];
    const calendarRow = (
      await db.select().from(calendarEvents).where(eq(calendarEvents.teamId, TEAM_ID))
    )[0];
    const enqueueExtractJob = vi.fn().mockResolvedValue(undefined);
    const enqueueEmbedJob = vi.fn().mockResolvedValue(undefined);
    const result = await processMeetingFinalizeJob(
      { db: db as never },
      { meetingId: MEETING_ID, teamId: TEAM_ID },
      {
        chatStructured: chat as never,
        enqueueExtractJob: enqueueExtractJob as never,
        enqueueEmbedJob: enqueueEmbedJob as never,
      },
    );

    expect(result.skipped).toBe('already_completed');
    expect(enqueueExtractJob).toHaveBeenCalledWith({ rawEventId: event?.id, teamId: TEAM_ID });
    expect(enqueueEmbedJob).toHaveBeenCalledWith({
      scope: 'raw_event',
      rawEventId: event?.id,
      teamId: TEAM_ID,
    });
    expect(enqueueEmbedJob).toHaveBeenCalledWith({
      scope: 'calendar_event',
      calendarEventId: calendarRow?.id,
      teamId: TEAM_ID,
    });
    const chunk = (
      await db
        .select()
        .from(meetingTranscriptChunks)
        .where(eq(meetingTranscriptChunks.meetingId, MEETING_ID))
    )[0];
    expect(enqueueEmbedJob).toHaveBeenCalledWith({
      scope: 'meeting_chunk',
      meetingChunkId: chunk?.id,
      teamId: TEAM_ID,
    });
  });

  it('idempotent: re-running on a completed meeting is a no-op', async () => {
    await seedMeeting(db as never, {
      status: 'completed',
      metadata: { summary: 'original summary', finalized_at: '2026-05-25T10:35:00Z' },
    });
    await seedChunk(db as never, 0, 'late chunk', 'Charlie');
    const chat = makeChatStub('SHOULD NOT BE WRITTEN');

    const result = await processMeetingFinalizeJob(
      { db: db as never },
      { meetingId: MEETING_ID, teamId: TEAM_ID },
      { chatStructured: chat as never },
    );

    expect(result.skipped).toBe('already_completed');
    expect(chat).not.toHaveBeenCalled();
    const row = (await db.select().from(meetingsTable).where(eq(meetingsTable.id, MEETING_ID)))[0];
    expect((row?.metadata as Record<string, unknown>).summary).toBe('original summary');
  });

  it('does not finalize or overwrite a failed meeting', async () => {
    await seedMeeting(db as never, {
      status: 'failed',
      metadata: { failure_code: 'recording_permission_denied' },
    });
    await seedChunk(db as never, 0, 'This should not become a timeline event.', 'Alice');
    const chat = makeChatStub('SHOULD NOT BE WRITTEN');

    const result = await processMeetingFinalizeJob(
      { db: db as never },
      { meetingId: MEETING_ID, teamId: TEAM_ID },
      { chatStructured: chat as never },
    );

    expect(result.skipped).toBe('failed');
    expect(chat).not.toHaveBeenCalled();
    const row = (await db.select().from(meetingsTable).where(eq(meetingsTable.id, MEETING_ID)))[0];
    expect(row?.status).toBe('failed');
    expect((row?.metadata as Record<string, unknown>).failure_code).toBe(
      'recording_permission_denied',
    );
    const events = await db.select().from(rawEvents).where(eq(rawEvents.source, 'meeting'));
    expect(events).toHaveLength(0);
  });

  it('usage row is unique per meeting (re-insert is no-op)', async () => {
    await seedMeeting(db as never);
    await seedChunk(db as never, 0, 'Hello.', 'Alice');
    const chat = makeChatStub();

    await processMeetingFinalizeJob(
      { db: db as never },
      { meetingId: MEETING_ID, teamId: TEAM_ID },
      { chatStructured: chat as never },
    );

    // Force a re-run by manually flipping status back to processing.
    await db
      .update(meetingsTable)
      .set({ status: 'processing' })
      .where(eq(meetingsTable.id, MEETING_ID));

    await processMeetingFinalizeJob(
      { db: db as never },
      { meetingId: MEETING_ID, teamId: TEAM_ID },
      { chatStructured: chat as never },
    );

    const usage = await db
      .select()
      .from(meetingUsage)
      .where(eq(meetingUsage.meetingId, MEETING_ID));
    expect(usage).toHaveLength(1);

    const calendarRows = await db
      .select()
      .from(calendarEvents)
      .where(eq(calendarEvents.teamId, TEAM_ID));
    expect(calendarRows).toHaveLength(1);
  });

  it('team mismatch throws UnrecoverableError', async () => {
    await seedMeeting(db as never);
    await expect(
      processMeetingFinalizeJob(
        { db: db as never },
        { meetingId: MEETING_ID, teamId: '99999999-9999-9999-9999-999999999999' },
        { chatStructured: makeChatStub() as never },
      ),
    ).rejects.toThrow(/team mismatch/);
  });
});

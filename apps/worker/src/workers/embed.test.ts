import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import { calendarEvents, rawEvents } from '@timeline/db';
import { llm, qdrant } from '@timeline/shared';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildPlanForTests,
  embedWorkerInternals,
  processEmbedJobForTests,
} from '#src/workers/embed.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '../../../../packages/db/drizzle');

const TEAM_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const CALENDAR_EVENT_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const SCHEDULED_RAW_EVENT_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const START_RAW_EVENT_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

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
  await pg.exec(`INSERT INTO users (id, email) VALUES ('${USER_ID}', 'a@x');`);
  await pg.exec(
    `INSERT INTO team_members (team_id, user_id, role) VALUES ('${TEAM_ID}', '${USER_ID}', 'owner');`,
  );
}

describe('embed worker calendar plan', () => {
  let pg: PGlite;
  let db: ReturnType<typeof drizzle>;

  beforeEach(async () => {
    pg = new PGlite();
    await applyMigrations(pg);
    await seed(pg);
    db = drizzle(pg);
  });

  it('anchors calendar_event embeddings to the occurrence raw event', async () => {
    await db.insert(rawEvents).values([
      {
        id: SCHEDULED_RAW_EVENT_ID,
        teamId: TEAM_ID,
        authorUserId: USER_ID,
        source: 'calendar',
        contentText: 'Scheduled: Launch review',
        occurredAt: new Date('2026-05-26T09:00:00Z'),
        visibility: 'team',
        sourceMetadata: { calendar_event_id: CALENDAR_EVENT_ID, action: 'scheduled' },
      },
      {
        id: START_RAW_EVENT_ID,
        teamId: TEAM_ID,
        authorUserId: USER_ID,
        source: 'calendar',
        contentText: 'Launch review',
        occurredAt: new Date('2026-05-27T09:00:00Z'),
        visibility: 'team',
        sourceMetadata: { calendar_event_id: CALENDAR_EVENT_ID, action: 'event' },
      },
    ]);
    await db.insert(calendarEvents).values({
      id: CALENDAR_EVENT_ID,
      teamId: TEAM_ID,
      createdByUserId: USER_ID,
      title: 'Launch review',
      description: 'Final launch readiness pass',
      startAt: new Date('2026-05-27T09:00:00Z'),
      endAt: new Date('2026-05-27T10:00:00Z'),
      timezone: 'UTC',
      location: 'Room 3',
      visibility: 'team',
      metadata: {},
      scheduledRawEventId: SCHEDULED_RAW_EVENT_ID,
      startAtRawEventId: START_RAW_EVENT_ID,
    });

    const plan = await buildPlanForTests(
      db as never,
      { scope: 'calendar_event', teamId: TEAM_ID, calendarEventId: CALENDAR_EVENT_ID },
      'calendar_event',
    );

    expect(plan?.payloadOverrides.event_id).toBe(START_RAW_EVENT_ID);
    expect(plan?.occurredAt.toISOString()).toBe('2026-05-27T09:00:00.000Z');
    expect(plan?.text).toContain('Final launch readiness pass');
    expect(plan?.text).toContain('Room 3');
  });
});

describe('processEmbedJobForTests', () => {
  let pg: PGlite;
  let db: ReturnType<typeof drizzle>;

  beforeEach(async () => {
    pg = new PGlite();
    await applyMigrations(pg);
    await seed(pg);
    db = drizzle(pg);
  });

  it('builds failure tags defensively for malformed job payloads', () => {
    expect(
      embedWorkerInternals.embedFailureTags({
        data: null as never,
      }),
    ).toEqual({});
    expect(
      embedWorkerInternals.embedFailureTags({
        data: { scope: 'fact', rawEventId: 'raw-1', factId: 'fact-1', teamId: TEAM_ID },
      }),
    ).toEqual({ scope: 'fact', rawEventId: 'raw-1', factId: 'fact-1', teamId: TEAM_ID });
  });

  it('embeds rendered raw event text and upserts a stable Qdrant payload', async () => {
    const rawEventId = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
    await db.insert(rawEvents).values({
      id: rawEventId,
      teamId: TEAM_ID,
      authorUserId: USER_ID,
      source: 'slack',
      contentText: 'Acme needs the proposal by Friday',
      occurredAt: new Date('2026-05-27T12:00:00Z'),
      visibility: 'team',
      visibilityOwnerUserId: USER_ID,
      sourceMetadata: {
        slack_channel_type: 'channel',
        slack_channel_name: 'sales',
        slack_sender_name: 'Ada',
      },
    });
    const embed = vi.fn<(input: { text: string }) => Promise<{ vector: number[]; model: string }>>(
      () =>
        Promise.resolve({
          vector: [0.1, 0.2, 0.3, 0.4],
          model: 'test-embed-model',
        }),
    );
    const upsertVector = vi.fn().mockResolvedValue(undefined);

    const result = await processEmbedJobForTests(
      { db: db as never },
      { scope: 'raw_event', teamId: TEAM_ID, rawEventId },
      {
        getEnv: () =>
          ({ OPENROUTER_API_KEY: 'test-key', QDRANT_URL: 'http://qdrant.test' }) as never,
        embed,
        getQdrantClient: vi.fn(() => ({ upsertVector }) as never),
      },
    );

    const embedText = embed.mock.calls[0]?.[0].text;
    expect(embedText).toContain(
      'Source context: Slack | channel | sender Ada | conversation sales',
    );
    expect(embedText).toContain('Message:\nAcme needs the proposal by Friday');
    const expectedPointId = qdrant.buildPointId('event', rawEventId, 'test-embed-model');
    expect(result).toEqual({
      scope: 'event',
      sourceId: rawEventId,
      model: 'test-embed-model',
      pointId: expectedPointId,
      pointIds: [expectedPointId],
    });
    expect(upsertVector).toHaveBeenCalledWith(
      expectedPointId,
      [0.1, 0.2, 0.3, 0.4],
      expect.objectContaining({
        team_id: TEAM_ID,
        event_id: rawEventId,
        source_kind: 'raw_event',
        occurred_at: '2026-05-27T12:00:00.000Z',
        author_user_id: USER_ID,
        visibility_owner_user_id: USER_ID,
        source: 'slack',
        visibility: 'team',
        embedding_model: 'test-embed-model',
      }),
    );
    const row = (await db.select().from(rawEvents).where(eq(rawEvents.id, rawEventId)))[0];
    expect(row?.sourceMetadata).toMatchObject({ embedding_model: 'test-embed-model' });
    expect(row?.sourceMetadata).toHaveProperty('embedded_at');
    expect(row?.sourceMetadata).toMatchObject({ embedding_chunks: 1 });
  });

  it('splits oversized source text and upserts one vector per chunk', async () => {
    const rawEventId = '11111111-2222-4333-8444-555555555555';
    const longText = Array.from(
      { length: 2400 },
      (_, i) => `Long meeting note sentence ${String(i)} with a useful detail.`,
    ).join(' ');
    await db.insert(rawEvents).values({
      id: rawEventId,
      teamId: TEAM_ID,
      authorUserId: USER_ID,
      source: 'web',
      contentText: longText,
      occurredAt: new Date('2026-05-27T12:00:00Z'),
      visibility: 'team',
      visibilityOwnerUserId: USER_ID,
      sourceMetadata: {},
    });
    const embed = vi.fn<(input: { text: string }) => Promise<{ vector: number[]; model: string }>>(
      () =>
        Promise.resolve({
          vector: [0.1, 0.2, 0.3, 0.4],
          model: 'test-embed-model',
        }),
    );
    const upsertVector = vi.fn().mockResolvedValue(undefined);

    const result = await processEmbedJobForTests(
      { db: db as never },
      { scope: 'raw_event', teamId: TEAM_ID, rawEventId },
      {
        getEnv: () =>
          ({ OPENROUTER_API_KEY: 'test-key', QDRANT_URL: 'http://qdrant.test' }) as never,
        embed,
        getQdrantClient: vi.fn(() => ({ upsertVector }) as never),
      },
    );

    expect(embed.mock.calls.length).toBeGreaterThan(1);
    expect(upsertVector).toHaveBeenCalledTimes(embed.mock.calls.length);
    const sentText = embed.mock.calls.map((call) => call[0].text);
    expect(sentText.join(' ')).toContain('Long meeting note sentence 2399');
    for (const text of sentText) {
      expect(text.length).toBeLessThanOrEqual(
        Math.floor(llm.TIMELINE_MODELS.embedding.contextWindowTokens * 0.8) * 4,
      );
    }
    const expectedPointIds = qdrant.buildChunkedPointIds(
      'event',
      rawEventId,
      'test-embed-model',
      embed.mock.calls.length,
    );
    expect(result).toMatchObject({
      scope: 'event',
      sourceId: rawEventId,
      model: 'test-embed-model',
      pointId: expectedPointIds[0],
      pointIds: expectedPointIds,
    });
    for (const pointId of expectedPointIds) {
      expect(upsertVector).toHaveBeenCalledWith(pointId, [0.1, 0.2, 0.3, 0.4], expect.any(Object));
    }
    const row = (await db.select().from(rawEvents).where(eq(rawEvents.id, rawEventId)))[0];
    expect(row?.sourceMetadata).toMatchObject({
      embedding_model: 'test-embed-model',
      embedding_chunks: embed.mock.calls.length,
    });
  });

  it('skips non-team raw events without embedding or Qdrant writes', async () => {
    const rawEventId = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
    await db.insert(rawEvents).values({
      id: rawEventId,
      teamId: TEAM_ID,
      authorUserId: USER_ID,
      source: 'web',
      contentText: 'Private thing',
      occurredAt: new Date('2026-05-27T12:00:00Z'),
      visibility: 'private',
      visibilityOwnerUserId: USER_ID,
      sourceMetadata: {},
    });
    const embed = vi.fn();
    const upsertVector = vi.fn();

    await expect(
      processEmbedJobForTests(
        { db: db as never },
        { scope: 'raw_event', teamId: TEAM_ID, rawEventId },
        {
          getEnv: () =>
            ({ OPENROUTER_API_KEY: 'test-key', QDRANT_URL: 'http://qdrant.test' }) as never,
          embed,
          getQdrantClient: vi.fn(() => ({ upsertVector }) as never),
        },
      ),
    ).resolves.toEqual({ skipped: true });

    expect(embed).not.toHaveBeenCalled();
    expect(upsertVector).not.toHaveBeenCalled();
    const row = (await db.select().from(rawEvents).where(eq(rawEvents.id, rawEventId)))[0];
    expect(row?.sourceMetadata).toMatchObject({
      embedding_skipped_reason: 'visibility=private',
    });
  });
});

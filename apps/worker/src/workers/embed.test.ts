import { createHash } from 'node:crypto';

import { PGlite } from '@electric-sql/pglite';
import { calendarEvents, rawEvents } from '@timeline/db';
import { llm, qdrant, type queue } from '@timeline/shared';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { applyDbMigrations } from '#src/test/pglite.js';
import {
  buildPlanForTests,
  embedWorkerInternals,
  processEmbedJobForTests,
} from '#src/workers/embed.js';

const TEAM_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const CALENDAR_EVENT_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const SCHEDULED_RAW_EVENT_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const START_RAW_EVENT_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
type EnqueueEmbed = (data: queue.EmbedJobData) => Promise<void>;
type DeletePointsForSourceFromChunk = qdrant.QdrantClient['deletePointsForSourceFromChunk'];

function currentEmbeddingContinuationIdentity(text: string) {
  return {
    embeddingSourceHash: createHash('sha256').update(text).digest('hex'),
    embeddingChunkingVersion: embedWorkerInternals.embeddingChunkingVersion,
  };
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
    await applyDbMigrations(pg);
    await seed(pg);
    db = drizzle(pg);
  });

  afterEach(async () => {
    await pg.close();
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
    await applyDbMigrations(pg);
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
    expect(
      embedWorkerInternals.embedFailureMessage(
        Object.assign(new Error('llm.embed failed'), {
          causeMessage: 'OpenRouter 503 temporarily unavailable',
        }),
      ),
    ).toBe('OpenRouter 503 temporarily unavailable');
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
    const deletePointsForSource = vi.fn().mockResolvedValue(undefined);
    const deletePointsForSourceFromChunk = vi
      .fn<DeletePointsForSourceFromChunk>()
      .mockResolvedValue(undefined);

    const result = await processEmbedJobForTests(
      { db: db as never },
      { scope: 'raw_event', teamId: TEAM_ID, rawEventId },
      {
        getEnv: () =>
          ({ OPENROUTER_API_KEY: 'test-key', QDRANT_URL: 'http://qdrant.test' }) as never,
        embed,
        getQdrantClient: vi.fn(
          () => ({ deletePointsForSource, deletePointsForSourceFromChunk, upsertVector }) as never,
        ),
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
        source_scope: 'event',
        source_id: rawEventId,
        chunk_index: 0,
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
    expect(deletePointsForSource).not.toHaveBeenCalled();
    expect(deletePointsForSourceFromChunk).toHaveBeenCalledWith({
      teamId: TEAM_ID,
      scope: 'event',
      sourceId: rawEventId,
      model: 'test-embed-model',
      minChunkIndex: 1,
    });
    const row = (await db.select().from(rawEvents).where(eq(rawEvents.id, rawEventId)))[0];
    expect(row?.sourceMetadata).toMatchObject({ embedding_model: 'test-embed-model' });
    expect(row?.sourceMetadata).toHaveProperty('embedded_at');
    expect(row?.sourceMetadata).toMatchObject({ embedding_chunks: 1 });
  });

  it('sends rendered email and integration context to the embedding provider', async () => {
    const emailRawEventId = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee1';
    const integrationRawEventId = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee2';
    await db.insert(rawEvents).values([
      {
        id: emailRawEventId,
        teamId: TEAM_ID,
        authorUserId: USER_ID,
        source: 'email',
        contentText: 'The customer approved the launch checklist.',
        occurredAt: new Date('2026-05-27T12:00:00Z'),
        visibility: 'team',
        sourceMetadata: {
          subject: 'Fwd: Launch checklist',
          from: { email: 'ops@example.net', name: 'Ops Vendor' },
          forwarded_from: { from: { email: 'ada@acme.example', name: 'Ada Lovelace' } },
          attachments: [{ filename: 'rollout-plan.pdf' }],
        },
      },
      {
        id: integrationRawEventId,
        teamId: TEAM_ID,
        authorUserId: USER_ID,
        source: 'integration',
        contentText: 'Monday item Acme rollout moved to Shipped.',
        occurredAt: new Date('2026-05-27T12:05:00Z'),
        visibility: 'team',
        sourceMetadata: {
          provider: 'monday',
          event_type: 'item.updated',
          external_object_id: 'item-456',
          external_event_id: 'update-99',
          actor: { externalId: 'user-1' },
          external_url: 'https://monday.example/boards/board-1/pulses/item-456',
          monday_board_name: 'Customer Projects',
          monday_item_name: 'Acme rollout',
        },
      },
    ]);
    const embed = vi.fn<(input: { text: string }) => Promise<{ vector: number[]; model: string }>>(
      () =>
        Promise.resolve({
          vector: [0.1, 0.2, 0.3, 0.4],
          model: 'test-embed-model',
        }),
    );
    const upsertVector = vi.fn().mockResolvedValue(undefined);
    const deletePointsForSourceFromChunk = vi
      .fn<DeletePointsForSourceFromChunk>()
      .mockResolvedValue(undefined);
    const io = {
      getEnv: () => ({ OPENROUTER_API_KEY: 'test-key', QDRANT_URL: 'http://qdrant.test' }) as never,
      embed,
      getQdrantClient: vi.fn(
        () =>
          ({
            deletePointsForSource: vi.fn(),
            deletePointsForSourceFromChunk,
            upsertVector,
          }) as never,
      ),
    };

    await processEmbedJobForTests(
      { db: db as never },
      { scope: 'raw_event', teamId: TEAM_ID, rawEventId: emailRawEventId },
      io,
    );
    await processEmbedJobForTests(
      { db: db as never },
      { scope: 'raw_event', teamId: TEAM_ID, rawEventId: integrationRawEventId },
      io,
    );

    const texts = embed.mock.calls.map((call) => call[0].text);
    expect(texts[0]).toContain(
      'Source context: Email | subject Fwd: Launch checklist | from Ops Vendor <ops@example.net>',
    );
    expect(texts[0]).toContain('forwarded from Ada Lovelace <ada@acme.example>');
    expect(texts[0]).toContain('attachments rollout-plan.pdf');
    expect(texts[1]).toContain(
      'Source context: Monday.com | event item.updated | external object item-456',
    );
    expect(texts[1]).toContain('external event update-99');
    expect(texts[1]).toContain('url https://monday.example/boards/board-1/pulses/item-456');
    expect(texts[1]).toContain('Monday board Customer Projects');
    expect(texts[1]).toContain('Monday item Acme rollout');
    expect(upsertVector).toHaveBeenCalledTimes(2);
    expect(deletePointsForSourceFromChunk).toHaveBeenCalledTimes(2);
  });

  it('splits oversized source text into bounded continuation jobs', async () => {
    const rawEventId = '11111111-2222-4333-8444-555555555555';
    const longText = Array.from(
      { length: 10_000 },
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
    const deletePointsForSource = vi.fn().mockResolvedValue(undefined);
    const deletePointsForSourceFromChunk = vi
      .fn<DeletePointsForSourceFromChunk>()
      .mockResolvedValue(undefined);
    const enqueueEmbedJob = vi.fn<EnqueueEmbed>().mockResolvedValue(undefined);

    const result = await processEmbedJobForTests(
      { db: db as never },
      { scope: 'raw_event', teamId: TEAM_ID, rawEventId },
      {
        getEnv: () =>
          ({ OPENROUTER_API_KEY: 'test-key', QDRANT_URL: 'http://qdrant.test' }) as never,
        embed,
        enqueueEmbedJob,
        getQdrantClient: vi.fn(
          () => ({ deletePointsForSource, deletePointsForSourceFromChunk, upsertVector }) as never,
        ),
      },
    );

    expect(embed.mock.calls.length).toBe(embedWorkerInternals.embeddingChunksPerJob);
    expect(upsertVector).toHaveBeenCalledTimes(embed.mock.calls.length);
    const sentText = embed.mock.calls.map((call) => call[0].text);
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
    expect(deletePointsForSource).not.toHaveBeenCalled();
    expect(deletePointsForSourceFromChunk).not.toHaveBeenCalled();
    expect(enqueueEmbedJob).toHaveBeenCalledTimes(1);
    const continuation = enqueueEmbedJob.mock.calls[0]?.[0];
    expect(continuation).toMatchObject({
      scope: 'raw_event',
      teamId: TEAM_ID,
      rawEventId,
      embeddingStartChunk: embedWorkerInternals.embeddingChunksPerJob,
      embeddingChunkingVersion: embedWorkerInternals.embeddingChunkingVersion,
      embeddingModel: 'test-embed-model',
    });
    expect(continuation?.embeddingSourceHash).toMatch(/^[0-9a-f]{64}$/);
    const row = (await db.select().from(rawEvents).where(eq(rawEvents.id, rawEventId)))[0];
    expect(row?.sourceMetadata).not.toHaveProperty('embedded_at');
  });

  it('splits token-dense source text before calling the embedding provider', async () => {
    const rawEventId = '13131313-2222-4333-8444-555555555555';
    await db.insert(rawEvents).values({
      id: rawEventId,
      teamId: TEAM_ID,
      authorUserId: USER_ID,
      source: 'web',
      contentText: '😀'.repeat(20_000),
      occurredAt: new Date('2026-05-27T12:00:00Z'),
      visibility: 'team',
      visibilityOwnerUserId: USER_ID,
      sourceMetadata: {},
    });
    const tokenBudget = Math.floor(llm.TIMELINE_MODELS.embedding.contextWindowTokens * 0.8);
    const embedMany = vi.fn<
      (input: { texts: string[] }) => Promise<{ vectors: number[][]; model: string }>
    >(({ texts }) => {
      for (const text of texts) {
        expect(llm.countEmbeddingTokens(text)).toBeLessThanOrEqual(tokenBudget);
      }
      return Promise.resolve({
        vectors: texts.map(() => [0.1, 0.2, 0.3, 0.4]),
        model: 'test-embed-model',
      });
    });
    const upsertVector = vi.fn().mockResolvedValue(undefined);
    const deletePointsForSource = vi.fn().mockResolvedValue(undefined);
    const deletePointsForSourceFromChunk = vi
      .fn<DeletePointsForSourceFromChunk>()
      .mockResolvedValue(undefined);

    await processEmbedJobForTests(
      { db: db as never },
      { scope: 'raw_event', teamId: TEAM_ID, rawEventId },
      {
        getEnv: () =>
          ({ OPENROUTER_API_KEY: 'test-key', QDRANT_URL: 'http://qdrant.test' }) as never,
        embedMany,
        getQdrantClient: vi.fn(
          () => ({ deletePointsForSource, deletePointsForSourceFromChunk, upsertVector }) as never,
        ),
      },
    );

    const batchTexts = embedMany.mock.calls[0]?.[0].texts ?? [];
    expect(batchTexts.length).toBeGreaterThan(1);
    expect(upsertVector).toHaveBeenCalledTimes(batchTexts.length);
  });

  it('keeps exact-token chunk overlap and avoids tiny tail vectors', () => {
    const tokenBudget = Math.floor(llm.TIMELINE_MODELS.embedding.contextWindowTokens * 0.8);
    const input = Array.from({ length: 5_001 }, (_, index) =>
      String.fromCodePoint(0x10_000 + index),
    ).join('');

    const chunks = embedWorkerInternals.splitEmbeddingChunk(input, tokenBudget);

    expect(chunks.length).toBeGreaterThan(1);
    for (const [index, chunk] of chunks.entries()) {
      expect(llm.countEmbeddingTokens(chunk)).toBeLessThanOrEqual(tokenBudget);
      if (index === 0) continue;
      const previous = chunks[index - 1] ?? '';
      const previousStart = input.indexOf(previous);
      const currentStart = input.indexOf(chunk);
      expect(currentStart).toBeLessThan(previousStart + previous.length);
    }
    expect(llm.countEmbeddingTokens(chunks.at(-1) ?? '')).toBeGreaterThanOrEqual(
      embedWorkerInternals.embeddingOverlapTokens,
    );
  });

  it('embeds each oversized chunk batch with one provider request', async () => {
    const rawEventId = '12121212-2222-4333-8444-555555555555';
    const longText = Array.from(
      { length: 10_000 },
      (_, i) => `Batched embedding sentence ${String(i)} with a useful detail.`,
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
    const embedMany = vi.fn<
      (input: { texts: string[] }) => Promise<{ vectors: number[][]; model: string }>
    >(({ texts }) =>
      Promise.resolve({
        vectors: texts.map(() => [0.1, 0.2, 0.3, 0.4]),
        model: 'test-embed-model',
      }),
    );
    const upsertVector = vi.fn().mockResolvedValue(undefined);
    const deletePointsForSource = vi.fn().mockResolvedValue(undefined);
    const deletePointsForSourceFromChunk = vi
      .fn<DeletePointsForSourceFromChunk>()
      .mockResolvedValue(undefined);
    const enqueueEmbedJob = vi.fn<EnqueueEmbed>().mockResolvedValue(undefined);

    const result = await processEmbedJobForTests(
      { db: db as never },
      { scope: 'raw_event', teamId: TEAM_ID, rawEventId },
      {
        getEnv: () =>
          ({ OPENROUTER_API_KEY: 'test-key', QDRANT_URL: 'http://qdrant.test' }) as never,
        embedMany,
        enqueueEmbedJob,
        getQdrantClient: vi.fn(
          () => ({ deletePointsForSource, deletePointsForSourceFromChunk, upsertVector }) as never,
        ),
      },
    );

    expect(embedMany).toHaveBeenCalledOnce();
    const batchTexts = embedMany.mock.calls[0]?.[0].texts ?? [];
    expect(batchTexts).toHaveLength(embedWorkerInternals.embeddingChunksPerJob);
    expect(upsertVector).toHaveBeenCalledTimes(embedWorkerInternals.embeddingChunksPerJob);
    expect(result).toMatchObject({
      scope: 'event',
      sourceId: rawEventId,
      model: 'test-embed-model',
    });
    expect(enqueueEmbedJob).toHaveBeenCalledWith(
      expect.objectContaining({
        embeddingStartChunk: embedWorkerInternals.embeddingChunksPerJob,
        embeddingChunkingVersion: embedWorkerInternals.embeddingChunkingVersion,
        embeddingModel: 'test-embed-model',
      }),
    );
  });

  it('splits oversized provider batches when the provider rejects request size', async () => {
    const rawEventId = '15151515-2222-4333-8444-555555555555';
    const longText = Array.from(
      { length: 10_000 },
      (_, i) => `Adaptive batch split sentence ${String(i)} with detail.`,
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
    const embedMany = vi.fn<
      (input: { texts: string[] }) => Promise<{ vectors: number[][]; model: string }>
    >(({ texts }) => {
      if (texts.length === embedWorkerInternals.embeddingChunksPerJob) {
        return Promise.reject(new Error('payload too large'));
      }
      return Promise.resolve({
        vectors: texts.map(() => [0.1, 0.2, 0.3, 0.4]),
        model: 'test-embed-model',
      });
    });
    const upsertVector = vi.fn().mockResolvedValue(undefined);
    const deletePointsForSource = vi.fn().mockResolvedValue(undefined);
    const deletePointsForSourceFromChunk = vi
      .fn<DeletePointsForSourceFromChunk>()
      .mockResolvedValue(undefined);
    const enqueueEmbedJob = vi.fn<EnqueueEmbed>().mockResolvedValue(undefined);

    await processEmbedJobForTests(
      { db: db as never },
      { scope: 'raw_event', teamId: TEAM_ID, rawEventId },
      {
        getEnv: () =>
          ({ OPENROUTER_API_KEY: 'test-key', QDRANT_URL: 'http://qdrant.test' }) as never,
        embedMany,
        enqueueEmbedJob,
        getQdrantClient: vi.fn(
          () => ({ deletePointsForSource, deletePointsForSourceFromChunk, upsertVector }) as never,
        ),
      },
    );

    expect(embedMany.mock.calls.map((call) => call[0].texts.length)).toEqual([
      embedWorkerInternals.embeddingChunksPerJob,
      embedWorkerInternals.embeddingChunksPerJob / 2,
      embedWorkerInternals.embeddingChunksPerJob / 2,
    ]);
    expect(upsertVector).toHaveBeenCalledTimes(embedWorkerInternals.embeddingChunksPerJob);
  });

  it('splits provider API batch failures on the final queue attempt', async () => {
    const rawEventId = '17171717-2222-4333-8444-555555555555';
    const longText = Array.from(
      { length: 10_000 },
      (_, i) => `Final attempt batch sentence ${String(i)} with detail.`,
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
    const batchError = Object.assign(new Error('llm.embedMany failed'), {
      timelineAi: true,
      causeName: 'AI_APICallError',
      causeMessage: 'OpenRouter returned an invalid embedding batch response',
    });
    const embedMany = vi.fn<
      (input: { texts: string[] }) => Promise<{ vectors: number[][]; model: string }>
    >(({ texts }) => {
      if (texts.length === embedWorkerInternals.embeddingChunksPerJob) {
        return Promise.reject(batchError);
      }
      return Promise.resolve({
        vectors: texts.map(() => [0.1, 0.2, 0.3, 0.4]),
        model: 'test-embed-model',
      });
    });
    const upsertVector = vi.fn().mockResolvedValue(undefined);
    const deletePointsForSource = vi.fn().mockResolvedValue(undefined);
    const deletePointsForSourceFromChunk = vi
      .fn<DeletePointsForSourceFromChunk>()
      .mockResolvedValue(undefined);
    const enqueueEmbedJob = vi.fn<EnqueueEmbed>().mockResolvedValue(undefined);

    await processEmbedJobForTests(
      { db: db as never },
      { scope: 'raw_event', teamId: TEAM_ID, rawEventId },
      {
        getEnv: () =>
          ({ OPENROUTER_API_KEY: 'test-key', QDRANT_URL: 'http://qdrant.test' }) as never,
        embedMany,
        enqueueEmbedJob,
        getQdrantClient: vi.fn(
          () => ({ deletePointsForSource, deletePointsForSourceFromChunk, upsertVector }) as never,
        ),
      },
      { attemptsMade: 5, maxAttempts: 6 },
    );

    expect(embedMany.mock.calls.map((call) => call[0].texts.length)).toEqual([
      embedWorkerInternals.embeddingChunksPerJob,
      embedWorkerInternals.embeddingChunksPerJob / 2,
      embedWorkerInternals.embeddingChunksPerJob / 2,
    ]);
    expect(upsertVector).toHaveBeenCalledTimes(embedWorkerInternals.embeddingChunksPerJob);
  });

  it('does not treat nested provider body text as an outage when final-attempt splitting', async () => {
    const rawEventId = '17171717-4444-4333-8444-555555555555';
    const longText = Array.from(
      { length: 10_000 },
      (_, i) => `Nested provider body sentence ${String(i)} with detail.`,
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
    const batchError = Object.assign(new Error('llm.embedMany failed'), {
      timelineAi: true,
      causeName: 'AI_APICallError',
      causeMessage: 'OpenRouter returned an invalid embedding batch response',
      cause: Object.assign(new Error('response body: upstream unavailable'), {
        name: 'AI_APICallError',
      }),
    });
    const embedMany = vi.fn<
      (input: { texts: string[] }) => Promise<{ vectors: number[][]; model: string }>
    >(({ texts }) => {
      if (texts.length === embedWorkerInternals.embeddingChunksPerJob) {
        return Promise.reject(batchError);
      }
      return Promise.resolve({
        vectors: texts.map(() => [0.1, 0.2, 0.3, 0.4]),
        model: 'test-embed-model',
      });
    });
    const upsertVector = vi.fn().mockResolvedValue(undefined);
    const deletePointsForSource = vi.fn().mockResolvedValue(undefined);
    const deletePointsForSourceFromChunk = vi
      .fn<DeletePointsForSourceFromChunk>()
      .mockResolvedValue(undefined);
    const enqueueEmbedJob = vi.fn<EnqueueEmbed>().mockResolvedValue(undefined);

    await processEmbedJobForTests(
      { db: db as never },
      { scope: 'raw_event', teamId: TEAM_ID, rawEventId },
      {
        getEnv: () =>
          ({ OPENROUTER_API_KEY: 'test-key', QDRANT_URL: 'http://qdrant.test' }) as never,
        embedMany,
        enqueueEmbedJob,
        getQdrantClient: vi.fn(
          () => ({ deletePointsForSource, deletePointsForSourceFromChunk, upsertVector }) as never,
        ),
      },
      { attemptsMade: 5, maxAttempts: 6 },
    );

    expect(embedMany.mock.calls.map((call) => call[0].texts.length)).toEqual([
      embedWorkerInternals.embeddingChunksPerJob,
      embedWorkerInternals.embeddingChunksPerJob / 2,
      embedWorkerInternals.embeddingChunksPerJob / 2,
    ]);
    expect(upsertVector).toHaveBeenCalledTimes(embedWorkerInternals.embeddingChunksPerJob);
  });

  it('does not split provider API batch failures before the final queue attempt', async () => {
    const rawEventId = '17171717-3333-4333-8444-555555555555';
    const longText = Array.from(
      { length: 10_000 },
      (_, i) => `Early attempt batch sentence ${String(i)} with detail.`,
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
    const batchError = Object.assign(new Error('llm.embedMany failed'), {
      timelineAi: true,
      causeName: 'AI_APICallError',
      causeMessage: 'OpenRouter returned an invalid embedding batch response',
    });
    const embedMany = vi
      .fn<(input: { texts: string[] }) => Promise<{ vectors: number[][]; model: string }>>()
      .mockRejectedValue(batchError);
    const upsertVector = vi.fn().mockResolvedValue(undefined);
    const deletePointsForSource = vi.fn().mockResolvedValue(undefined);
    const deletePointsForSourceFromChunk = vi
      .fn<DeletePointsForSourceFromChunk>()
      .mockResolvedValue(undefined);
    const enqueueEmbedJob = vi.fn<EnqueueEmbed>().mockResolvedValue(undefined);

    await expect(
      processEmbedJobForTests(
        { db: db as never },
        { scope: 'raw_event', teamId: TEAM_ID, rawEventId },
        {
          getEnv: () =>
            ({ OPENROUTER_API_KEY: 'test-key', QDRANT_URL: 'http://qdrant.test' }) as never,
          embedMany,
          enqueueEmbedJob,
          getQdrantClient: vi.fn(
            () =>
              ({ deletePointsForSource, deletePointsForSourceFromChunk, upsertVector }) as never,
          ),
        },
        { attemptsMade: 4, maxAttempts: 6 },
      ),
    ).rejects.toThrow('llm.embedMany failed');

    expect(embedMany).toHaveBeenCalledOnce();
    expect(upsertVector).not.toHaveBeenCalled();
    expect(enqueueEmbedJob).not.toHaveBeenCalled();
  });

  it('does not split retryable provider outages inside the job', async () => {
    const rawEventId = '16161616-2222-4333-8444-555555555555';
    const longText = Array.from(
      { length: 10_000 },
      (_, i) => `Provider outage sentence ${String(i)} with detail.`,
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
    const embedMany = vi
      .fn<(input: { texts: string[] }) => Promise<{ vectors: number[][]; model: string }>>()
      .mockRejectedValue(new Error('OpenRouter unavailable'));
    const upsertVector = vi.fn().mockResolvedValue(undefined);
    const deletePointsForSource = vi.fn().mockResolvedValue(undefined);
    const deletePointsForSourceFromChunk = vi
      .fn<DeletePointsForSourceFromChunk>()
      .mockResolvedValue(undefined);
    const enqueueEmbedJob = vi.fn<EnqueueEmbed>().mockResolvedValue(undefined);

    await expect(
      processEmbedJobForTests(
        { db: db as never },
        { scope: 'raw_event', teamId: TEAM_ID, rawEventId },
        {
          getEnv: () =>
            ({ OPENROUTER_API_KEY: 'test-key', QDRANT_URL: 'http://qdrant.test' }) as never,
          embedMany,
          enqueueEmbedJob,
          getQdrantClient: vi.fn(
            () =>
              ({ deletePointsForSource, deletePointsForSourceFromChunk, upsertVector }) as never,
          ),
        },
      ),
    ).rejects.toThrow('OpenRouter unavailable');

    expect(embedMany).toHaveBeenCalledOnce();
    expect(upsertVector).not.toHaveBeenCalled();
    expect(enqueueEmbedJob).not.toHaveBeenCalled();
  });

  it('does not split retryable provider API outages on the final queue attempt', async () => {
    const rawEventId = '18181818-2222-4333-8444-555555555555';
    const longText = Array.from(
      { length: 10_000 },
      (_, i) => `Final outage sentence ${String(i)} with detail.`,
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
    const providerOutage = Object.assign(new Error('llm.embedMany failed'), {
      timelineAi: true,
      causeName: 'AI_APICallError',
      causeMessage: 'OpenRouter 503 temporarily unavailable',
    });
    const embedMany = vi
      .fn<(input: { texts: string[] }) => Promise<{ vectors: number[][]; model: string }>>()
      .mockRejectedValue(providerOutage);
    const upsertVector = vi.fn().mockResolvedValue(undefined);
    const deletePointsForSource = vi.fn().mockResolvedValue(undefined);
    const deletePointsForSourceFromChunk = vi
      .fn<DeletePointsForSourceFromChunk>()
      .mockResolvedValue(undefined);
    const enqueueEmbedJob = vi.fn<EnqueueEmbed>().mockResolvedValue(undefined);

    await expect(
      processEmbedJobForTests(
        { db: db as never },
        { scope: 'raw_event', teamId: TEAM_ID, rawEventId },
        {
          getEnv: () =>
            ({ OPENROUTER_API_KEY: 'test-key', QDRANT_URL: 'http://qdrant.test' }) as never,
          embedMany,
          enqueueEmbedJob,
          getQdrantClient: vi.fn(
            () =>
              ({ deletePointsForSource, deletePointsForSourceFromChunk, upsertVector }) as never,
          ),
        },
        { attemptsMade: 5, maxAttempts: 6 },
      ),
    ).rejects.toThrow('llm.embedMany failed');

    expect(embedMany).toHaveBeenCalledOnce();
    expect(upsertVector).not.toHaveBeenCalled();
    expect(enqueueEmbedJob).not.toHaveBeenCalled();
  });

  it('does not split retryable provider status failures on the final queue attempt', async () => {
    const rawEventId = '18181818-3333-4333-8444-555555555555';
    const longText = Array.from(
      { length: 10_000 },
      (_, i) => `Final rate limit sentence ${String(i)} with detail.`,
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
    const providerOutage = Object.assign(new Error('llm.embedMany failed'), {
      timelineAi: true,
      causeName: 'AI_APICallError',
      causeMessage: 'upstream failed',
      cause: Object.assign(new Error('upstream failed'), {
        name: 'AI_APICallError',
        isRetryable: true,
        statusCode: 429,
      }),
    });
    const embedMany = vi
      .fn<(input: { texts: string[] }) => Promise<{ vectors: number[][]; model: string }>>()
      .mockRejectedValue(providerOutage);
    const upsertVector = vi.fn().mockResolvedValue(undefined);
    const deletePointsForSource = vi.fn().mockResolvedValue(undefined);
    const deletePointsForSourceFromChunk = vi
      .fn<DeletePointsForSourceFromChunk>()
      .mockResolvedValue(undefined);
    const enqueueEmbedJob = vi.fn<EnqueueEmbed>().mockResolvedValue(undefined);

    await expect(
      processEmbedJobForTests(
        { db: db as never },
        { scope: 'raw_event', teamId: TEAM_ID, rawEventId },
        {
          getEnv: () =>
            ({ OPENROUTER_API_KEY: 'test-key', QDRANT_URL: 'http://qdrant.test' }) as never,
          embedMany,
          enqueueEmbedJob,
          getQdrantClient: vi.fn(
            () =>
              ({ deletePointsForSource, deletePointsForSourceFromChunk, upsertVector }) as never,
          ),
        },
        { attemptsMade: 5, maxAttempts: 6 },
      ),
    ).rejects.toThrow('llm.embedMany failed');

    expect(embedMany).toHaveBeenCalledOnce();
    expect(upsertVector).not.toHaveBeenCalled();
    expect(enqueueEmbedJob).not.toHaveBeenCalled();
  });

  it('does not split non-batch provider client errors on the final queue attempt', async () => {
    const rawEventId = '19191919-2222-4333-8444-555555555555';
    const longText = Array.from(
      { length: 10_000 },
      (_, i) => `Final auth error sentence ${String(i)} with detail.`,
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
    const authError = Object.assign(new Error('llm.embedMany failed'), {
      timelineAi: true,
      causeName: 'AI_APICallError',
      causeMessage: 'OpenRouter 401 invalid API key',
      cause: Object.assign(new Error('unauthorized'), {
        name: 'AI_APICallError',
        statusCode: 401,
      }),
    });
    const embedMany = vi
      .fn<(input: { texts: string[] }) => Promise<{ vectors: number[][]; model: string }>>()
      .mockRejectedValue(authError);
    const upsertVector = vi.fn().mockResolvedValue(undefined);
    const deletePointsForSource = vi.fn().mockResolvedValue(undefined);
    const deletePointsForSourceFromChunk = vi
      .fn<DeletePointsForSourceFromChunk>()
      .mockResolvedValue(undefined);
    const enqueueEmbedJob = vi.fn<EnqueueEmbed>().mockResolvedValue(undefined);

    await expect(
      processEmbedJobForTests(
        { db: db as never },
        { scope: 'raw_event', teamId: TEAM_ID, rawEventId },
        {
          getEnv: () =>
            ({ OPENROUTER_API_KEY: 'test-key', QDRANT_URL: 'http://qdrant.test' }) as never,
          embedMany,
          enqueueEmbedJob,
          getQdrantClient: vi.fn(
            () =>
              ({ deletePointsForSource, deletePointsForSourceFromChunk, upsertVector }) as never,
          ),
        },
        { attemptsMade: 5, maxAttempts: 6 },
      ),
    ).rejects.toThrow('llm.embedMany failed');

    expect(embedMany).toHaveBeenCalledOnce();
    expect(upsertVector).not.toHaveBeenCalled();
    expect(enqueueEmbedJob).not.toHaveBeenCalled();
  });

  it('fails without writing vectors when a batch response omits an embedding', async () => {
    const rawEventId = '13131313-2222-4333-8444-555555555555';
    const longText = Array.from(
      { length: 10_000 },
      (_, i) => `Short batch response sentence ${String(i)} with detail.`,
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
    const embedMany = vi
      .fn<(input: { texts: string[] }) => Promise<{ vectors: number[][]; model: string }>>()
      .mockResolvedValue({
        vectors: [[0.1, 0.2, 0.3, 0.4]],
        model: 'test-embed-model',
      });
    const upsertVector = vi.fn().mockResolvedValue(undefined);
    const deletePointsForSource = vi.fn().mockResolvedValue(undefined);
    const deletePointsForSourceFromChunk = vi
      .fn<DeletePointsForSourceFromChunk>()
      .mockResolvedValue(undefined);
    const enqueueEmbedJob = vi.fn<EnqueueEmbed>().mockResolvedValue(undefined);

    await expect(
      processEmbedJobForTests(
        { db: db as never },
        { scope: 'raw_event', teamId: TEAM_ID, rawEventId },
        {
          getEnv: () =>
            ({ OPENROUTER_API_KEY: 'test-key', QDRANT_URL: 'http://qdrant.test' }) as never,
          embedMany,
          enqueueEmbedJob,
          getQdrantClient: vi.fn(
            () =>
              ({ deletePointsForSource, deletePointsForSourceFromChunk, upsertVector }) as never,
          ),
        },
      ),
    ).rejects.toThrow(
      `embedMany returned 1 vectors for ${String(embedWorkerInternals.embeddingChunksPerJob)} chunks`,
    );

    expect(upsertVector).not.toHaveBeenCalled();
    expect(enqueueEmbedJob).not.toHaveBeenCalled();
  });

  it('fails without partial writes when a later batch vector is malformed', async () => {
    const rawEventId = '14141414-2222-4333-8444-555555555555';
    const longText = Array.from(
      { length: 10_000 },
      (_, i) => `Malformed batch vector sentence ${String(i)} with detail.`,
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
    const vectors = Array.from({ length: embedWorkerInternals.embeddingChunksPerJob }, () => [
      0.1, 0.2, 0.3, 0.4,
    ]);
    vectors[4] = [0.1, Number.NaN, 0.3, 0.4];
    const embedMany = vi
      .fn<(input: { texts: string[] }) => Promise<{ vectors: number[][]; model: string }>>()
      .mockResolvedValue({ vectors, model: 'test-embed-model' });
    const upsertVector = vi.fn().mockResolvedValue(undefined);
    const deletePointsForSource = vi.fn().mockResolvedValue(undefined);
    const deletePointsForSourceFromChunk = vi
      .fn<DeletePointsForSourceFromChunk>()
      .mockResolvedValue(undefined);
    const enqueueEmbedJob = vi.fn<EnqueueEmbed>().mockResolvedValue(undefined);

    await expect(
      processEmbedJobForTests(
        { db: db as never },
        { scope: 'raw_event', teamId: TEAM_ID, rawEventId },
        {
          getEnv: () =>
            ({ OPENROUTER_API_KEY: 'test-key', QDRANT_URL: 'http://qdrant.test' }) as never,
          embedMany,
          enqueueEmbedJob,
          getQdrantClient: vi.fn(
            () =>
              ({ deletePointsForSource, deletePointsForSourceFromChunk, upsertVector }) as never,
          ),
        },
      ),
    ).rejects.toThrow('embedMany returned non-finite value at vector 4, dimension 1');

    expect(upsertVector).not.toHaveBeenCalled();
    expect(enqueueEmbedJob).not.toHaveBeenCalled();
  });

  it('continues oversized source text without deleting earlier chunk batches', async () => {
    const rawEventId = '11111111-2222-4333-8444-555555555555';
    const longText = Array.from(
      { length: 10_000 },
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
    const deletePointsForSource = vi.fn().mockResolvedValue(undefined);
    const deletePointsForSourceFromChunk = vi
      .fn<DeletePointsForSourceFromChunk>()
      .mockResolvedValue(undefined);
    const enqueueEmbedJob = vi.fn<EnqueueEmbed>().mockResolvedValue(undefined);

    const result = await processEmbedJobForTests(
      { db: db as never },
      {
        scope: 'raw_event',
        teamId: TEAM_ID,
        rawEventId,
        embeddingStartChunk: embedWorkerInternals.embeddingChunksPerJob,
        ...currentEmbeddingContinuationIdentity(longText),
      },
      {
        getEnv: () =>
          ({ OPENROUTER_API_KEY: 'test-key', QDRANT_URL: 'http://qdrant.test' }) as never,
        embed,
        enqueueEmbedJob,
        getQdrantClient: vi.fn(
          () => ({ deletePointsForSource, deletePointsForSourceFromChunk, upsertVector }) as never,
        ),
      },
    );

    expect(deletePointsForSource).not.toHaveBeenCalled();
    expect(deletePointsForSourceFromChunk).toHaveBeenCalledTimes(1);
    const cleanup = deletePointsForSourceFromChunk.mock.calls[0]?.[0];
    expect(cleanup).toMatchObject({
      teamId: TEAM_ID,
      scope: 'event',
      sourceId: rawEventId,
      model: 'test-embed-model',
    });
    expect(cleanup?.minChunkIndex).toBeGreaterThan(embedWorkerInternals.embeddingChunksPerJob);
    expect(enqueueEmbedJob).not.toHaveBeenCalled();
    expect(result).toMatchObject({ scope: 'event', sourceId: rawEventId });
    const sentText = embed.mock.calls.map((call) => call[0].text).join(' ');
    expect(sentText).toContain('Long meeting note sentence 9999');
    const row = (await db.select().from(rawEvents).where(eq(rawEvents.id, rawEventId)))[0];
    expect(row?.sourceMetadata).toMatchObject({
      embedding_model: 'test-embed-model',
    });
    expect(row?.sourceMetadata).toHaveProperty('embedded_at');
  });

  it('finalizes orphan continuations that start beyond the current chunk count', async () => {
    const rawEventId = '44444444-5555-4666-8777-888888888888';
    await db.insert(rawEvents).values({
      id: rawEventId,
      teamId: TEAM_ID,
      authorUserId: USER_ID,
      source: 'web',
      contentText: 'Shorter replacement text',
      occurredAt: new Date('2026-05-27T12:00:00Z'),
      visibility: 'team',
      visibilityOwnerUserId: USER_ID,
      sourceMetadata: {},
    });
    const embed = vi.fn();
    const upsertVector = vi.fn().mockResolvedValue(undefined);
    const deletePointsForSource = vi.fn().mockResolvedValue(undefined);
    const deletePointsForSourceFromChunk = vi
      .fn<DeletePointsForSourceFromChunk>()
      .mockResolvedValue(undefined);
    const enqueueEmbedJob = vi.fn<EnqueueEmbed>().mockResolvedValue(undefined);

    const result = await processEmbedJobForTests(
      { db: db as never },
      {
        scope: 'raw_event',
        teamId: TEAM_ID,
        rawEventId,
        embeddingStartChunk: embedWorkerInternals.embeddingChunksPerJob,
        ...currentEmbeddingContinuationIdentity('Shorter replacement text'),
        embeddingModel: 'test-embed-model',
      },
      {
        getEnv: () =>
          ({ OPENROUTER_API_KEY: 'test-key', QDRANT_URL: 'http://qdrant.test' }) as never,
        embed,
        enqueueEmbedJob,
        getQdrantClient: vi.fn(
          () => ({ deletePointsForSource, deletePointsForSourceFromChunk, upsertVector }) as never,
        ),
      },
    );

    expect(result).toMatchObject({
      skipped: true,
      reason: 'empty_continuation_finalized',
      scope: 'event',
      sourceId: rawEventId,
      model: 'test-embed-model',
    });
    expect(embed).not.toHaveBeenCalled();
    expect(upsertVector).not.toHaveBeenCalled();
    expect(deletePointsForSource).not.toHaveBeenCalled();
    expect(deletePointsForSourceFromChunk).toHaveBeenCalledWith({
      teamId: TEAM_ID,
      scope: 'event',
      sourceId: rawEventId,
      model: 'test-embed-model',
      minChunkIndex: 1,
    });
    expect(enqueueEmbedJob).not.toHaveBeenCalled();
    const row = (await db.select().from(rawEvents).where(eq(rawEvents.id, rawEventId)))[0];
    expect(row?.sourceMetadata).toMatchObject({
      embedding_model: 'test-embed-model',
      embedding_chunks: 1,
    });
    expect(row?.sourceMetadata).toHaveProperty('embedded_at');
  });

  it('does not prune stale chunks when an upsert fails partway through replacement', async () => {
    const rawEventId = '22222222-3333-4444-8555-666666666666';
    const longText = Array.from(
      { length: 10_000 },
      (_, i) => `Replacement sentence ${String(i)} with a useful detail.`,
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
    const upsertVector = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('qdrant temporarily down'));
    const deletePointsForSource = vi.fn().mockResolvedValue(undefined);
    const deletePointsForSourceFromChunk = vi
      .fn<DeletePointsForSourceFromChunk>()
      .mockResolvedValue(undefined);
    const enqueueEmbedJob = vi.fn<EnqueueEmbed>().mockResolvedValue(undefined);

    await expect(
      processEmbedJobForTests(
        { db: db as never },
        { scope: 'raw_event', teamId: TEAM_ID, rawEventId },
        {
          getEnv: () =>
            ({ OPENROUTER_API_KEY: 'test-key', QDRANT_URL: 'http://qdrant.test' }) as never,
          embed,
          enqueueEmbedJob,
          getQdrantClient: vi.fn(
            () =>
              ({ deletePointsForSource, deletePointsForSourceFromChunk, upsertVector }) as never,
          ),
        },
      ),
    ).rejects.toThrow('qdrant temporarily down');

    expect(deletePointsForSource).not.toHaveBeenCalled();
    expect(deletePointsForSourceFromChunk).not.toHaveBeenCalled();
    expect(enqueueEmbedJob).not.toHaveBeenCalled();
    const row = (await db.select().from(rawEvents).where(eq(rawEvents.id, rawEventId)))[0];
    expect(row?.sourceMetadata).not.toHaveProperty('embedded_at');
  });

  it('restarts continuation jobs when the source text changed between batches', async () => {
    const rawEventId = '33333333-4444-4555-8666-777777777777';
    const longText = Array.from(
      { length: 10_000 },
      (_, i) => `Changed continuation sentence ${String(i)} with a useful detail.`,
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
    const embed = vi.fn();
    const upsertVector = vi.fn();
    const deletePointsForSource = vi.fn().mockResolvedValue(undefined);
    const deletePointsForSourceFromChunk = vi
      .fn<DeletePointsForSourceFromChunk>()
      .mockResolvedValue(undefined);
    const enqueueEmbedJob = vi.fn<EnqueueEmbed>().mockResolvedValue(undefined);

    const result = await processEmbedJobForTests(
      { db: db as never },
      {
        scope: 'raw_event',
        teamId: TEAM_ID,
        rawEventId,
        embeddingStartChunk: embedWorkerInternals.embeddingChunksPerJob,
        embeddingSourceHash: 'stale-hash',
        embeddingChunkingVersion: embedWorkerInternals.embeddingChunkingVersion,
      },
      {
        getEnv: () =>
          ({ OPENROUTER_API_KEY: 'test-key', QDRANT_URL: 'http://qdrant.test' }) as never,
        embed,
        enqueueEmbedJob,
        getQdrantClient: vi.fn(
          () => ({ deletePointsForSource, deletePointsForSourceFromChunk, upsertVector }) as never,
        ),
      },
    );

    expect(result).toMatchObject({
      skipped: true,
      reason: 'stale_continuation',
      scope: 'event',
      sourceId: rawEventId,
    });
    expect(embed).not.toHaveBeenCalled();
    expect(upsertVector).not.toHaveBeenCalled();
    expect(deletePointsForSource).not.toHaveBeenCalled();
    expect(deletePointsForSourceFromChunk).not.toHaveBeenCalled();
    expect(enqueueEmbedJob).toHaveBeenCalledWith({
      scope: 'raw_event',
      teamId: TEAM_ID,
      rawEventId,
    });
  });

  it('restarts continuations created by a previous chunking algorithm', async () => {
    const rawEventId = '55555555-6666-4777-8888-999999999999';
    const longText = Array.from(
      { length: 10_000 },
      (_, i) => `Legacy continuation sentence ${String(i)} with a useful detail.`,
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
    const embed = vi.fn(() =>
      Promise.resolve({ vector: [0.1, 0.2, 0.3, 0.4], model: 'test-embed-model' }),
    );
    const upsertVector = vi.fn().mockResolvedValue(undefined);
    const deletePointsForSource = vi.fn().mockResolvedValue(undefined);
    const deletePointsForSourceFromChunk = vi
      .fn<DeletePointsForSourceFromChunk>()
      .mockResolvedValue(undefined);
    const enqueueEmbedJob = vi.fn<EnqueueEmbed>().mockResolvedValue(undefined);

    const result = await processEmbedJobForTests(
      { db: db as never },
      {
        scope: 'raw_event',
        teamId: TEAM_ID,
        rawEventId,
        embeddingStartChunk: embedWorkerInternals.embeddingChunksPerJob,
        embeddingSourceHash: createHash('sha256').update(longText).digest('hex'),
      },
      {
        getEnv: () =>
          ({ OPENROUTER_API_KEY: 'test-key', QDRANT_URL: 'http://qdrant.test' }) as never,
        embed,
        enqueueEmbedJob,
        getQdrantClient: vi.fn(
          () => ({ deletePointsForSource, deletePointsForSourceFromChunk, upsertVector }) as never,
        ),
      },
    );

    expect(result).toMatchObject({
      skipped: true,
      reason: 'stale_continuation',
      scope: 'event',
      sourceId: rawEventId,
    });
    expect(embed).not.toHaveBeenCalled();
    expect(upsertVector).not.toHaveBeenCalled();
    expect(deletePointsForSource).not.toHaveBeenCalled();
    expect(deletePointsForSourceFromChunk).not.toHaveBeenCalled();
    expect(enqueueEmbedJob).toHaveBeenCalledWith({
      scope: 'raw_event',
      teamId: TEAM_ID,
      rawEventId,
    });
  });

  it('skips stale object_change jobs when the change row is gone', async () => {
    const embed = vi.fn();
    const upsertVector = vi.fn();
    const deletePointsForSource = vi.fn();
    const deletePointsForSourceFromChunk = vi.fn();

    const result = await processEmbedJobForTests(
      { db: db as never },
      {
        scope: 'object_change',
        teamId: TEAM_ID,
        changeId: '7684315e-c736-4708-b7b0-502f1d77cc10',
      },
      {
        getEnv: () =>
          ({ OPENROUTER_API_KEY: 'test-key', QDRANT_URL: 'http://qdrant.test' }) as never,
        embed,
        getQdrantClient: vi.fn(
          () => ({ deletePointsForSource, deletePointsForSourceFromChunk, upsertVector }) as never,
        ),
      },
    );

    expect(result).toEqual({ skipped: true });
    expect(embed).not.toHaveBeenCalled();
    expect(upsertVector).not.toHaveBeenCalled();
    expect(deletePointsForSource).not.toHaveBeenCalled();
    expect(deletePointsForSourceFromChunk).not.toHaveBeenCalled();
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
          getQdrantClient: vi.fn(
            () =>
              ({
                deletePointsForSource: vi.fn(),
                deletePointsForSourceFromChunk: vi.fn(),
                upsertVector,
              }) as never,
          ),
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

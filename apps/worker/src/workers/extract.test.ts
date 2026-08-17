import { PGlite } from '@electric-sql/pglite';
import {
  artifactClusters,
  artifactEvidenceAssociations,
  entities,
  facts,
  factEntities,
  objectSummaries,
  rawEvents,
  type Db,
} from '@timeline/db';
import { type queue } from '@timeline/shared';
import {
  currentExtractionModelVersions,
  makeExtractionModelVersion,
} from '@timeline/shared/extraction-model-version';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { applyDbMigrations } from '#src/test/pglite.js';
import { processEmbedJobForTests } from '#src/workers/embed.js';
import { extractWorkerInternals, processExtractJobForTests } from '#src/workers/extract.js';

/**
 * Extract worker contract tests. These run the processor against a migrated
 * PGlite database with deterministic LLM and queue boundaries, proving raw
 * event text becomes facts/entities safely without live OpenRouter or Redis.
 */

const TEAM_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_TEAM_ID = '22222222-2222-4222-8222-222222222222';
const OWNER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const MODEL_ID = 'test-extract-model';
const MODEL_VERSION = makeExtractionModelVersion(MODEL_ID);

async function seed(pg: PGlite): Promise<void> {
  await pg.exec(`
    INSERT INTO teams (id, slug, name)
    VALUES
      ('${TEAM_ID}', 'extract', 'Extract'),
      ('${OTHER_TEAM_ID}', 'other-extract', 'Other Extract');
    INSERT INTO users (id, email)
    VALUES ('${OWNER_ID}', 'owner@example.test');
    INSERT INTO team_members (team_id, user_id, role)
    VALUES ('${TEAM_ID}', '${OWNER_ID}', 'owner');
  `);
}

async function seedEvent(
  db: Db,
  input: {
    id: string;
    text: string | null;
    teamId?: string;
    source?: (typeof rawEvents.$inferInsert)['source'];
    visibility?: 'team' | 'private' | 'specific_users';
    occurredAt?: Date;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await db.insert(rawEvents).values({
    id: input.id,
    teamId: input.teamId ?? TEAM_ID,
    authorUserId: OWNER_ID,
    source: input.source ?? 'web',
    contentText: input.text,
    occurredAt: input.occurredAt ?? new Date('2026-06-01T10:00:00.000Z'),
    visibility: input.visibility ?? 'team',
    visibilityOwnerUserId: input.visibility === 'private' ? OWNER_ID : null,
    visibilityUserIds: input.visibility === 'specific_users' ? [OWNER_ID] : null,
    sourceMetadata: input.metadata ?? {},
  });
}

function modelWithFacts(factsOutput: unknown[]) {
  return vi.fn().mockResolvedValue({ object: { facts: factsOutput }, model: MODEL_ID });
}

function io(overrides: Partial<Parameters<typeof processExtractJobForTests>[2]> = {}) {
  return {
    getEnv: () => ({ OPENROUTER_API_KEY: 'test-key' }) as never,
    modelId: MODEL_ID,
    chatStructured: modelWithFacts([]),
    enqueueSuggestionJob: vi.fn().mockResolvedValue(undefined),
    enqueueEmbedJob: vi.fn().mockResolvedValue(undefined),
    enqueueObjectSummaryRefresh: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

let pg: PGlite;
let db: Db;

beforeEach(async () => {
  pg = new PGlite();
  await applyDbMigrations(pg);
  await seed(pg);
  db = drizzle(pg) as unknown as Db;
});

afterEach(async () => {
  await pg.close();
});

describe('processExtractJobForTests', () => {
  it('builds failure tags defensively for malformed job payloads', () => {
    expect(
      extractWorkerInternals.extractFailureTags({
        data: null as never,
      }),
    ).toEqual({});
    expect(
      extractWorkerInternals.extractFailureTags({
        data: { rawEventId: 'raw-1', teamId: 'team-1' },
      }),
    ).toEqual({ rawEventId: 'raw-1', teamId: 'team-1' });
  });

  it('recognizes BullMQ stall UnrecoverableErrors so extract does not stamp content failure', () => {
    expect(
      extractWorkerInternals.isBullMqStallFailure(
        new Error('job stalled more than allowable limit'),
      ),
    ).toBe(true);
    expect(
      extractWorkerInternals.isBullMqStallFailure(new Error('OPENROUTER_API_KEY missing')),
    ).toBe(false);
  });

  it('extracts team-visible raw events into facts, entities, suggestion work, and embed fanout', async () => {
    const rawEventId = '33333333-3333-4333-8333-333333333333';
    await seedEvent(db, { id: rawEventId, text: 'Acme is evaluating Timeline for Q4.' });
    await db.insert(entities).values([
      { teamId: TEAM_ID, type: 'company', canonicalName: 'Acme' },
      { teamId: TEAM_ID, type: 'project', canonicalName: 'Timeline' },
    ]);
    const testIO = io({
      chatStructured: modelWithFacts([
        {
          statement: 'Acme is evaluating Timeline for Q4.',
          confidence: 0.92,
          mentions: [
            { name: 'Acme', type: 'company', role: 'subject' },
            { name: 'Timeline', type: 'project', role: 'object' },
          ],
        },
      ]),
    });

    await expect(
      processExtractJobForTests({ db }, { rawEventId, teamId: TEAM_ID }, testIO),
    ).resolves.toMatchObject({ rawEventId, factsInserted: 1, modelVersion: MODEL_VERSION });

    const factRows = await db.select().from(facts).where(eq(facts.rawEventId, rawEventId));
    expect(factRows).toHaveLength(1);
    const factId = factRows[0]?.id;
    expect(factId).toBeTypeOf('string');
    if (!factId) throw new Error('expected extracted fact id');
    await expect(
      db.select().from(factEntities).where(eq(factEntities.factId, factId)),
    ).resolves.toHaveLength(2);
    const linkedEntities = await db.select().from(entities);
    expect(testIO.enqueueSuggestionJob).toHaveBeenCalledWith({ rawEventId, teamId: TEAM_ID });
    expect(testIO.enqueueEmbedJob).toHaveBeenCalledWith({ rawEventId, teamId: TEAM_ID });
    expect(testIO.enqueueEmbedJob).toHaveBeenCalledWith({
      rawEventId,
      teamId: TEAM_ID,
      factId,
    });
    for (const entity of linkedEntities) {
      expect(testIO.enqueueObjectSummaryRefresh).toHaveBeenCalledWith(entity.id);
    }
  });

  it('reconciles link artifacts for any extracted raw event text', async () => {
    const rawEventId = '33333333-3333-4333-8333-333333333336';
    await seedEvent(db, {
      id: rawEventId,
      text: 'Captured from a future source: https://example.com/future?utm_source=test&id=7',
    });

    await expect(
      processExtractJobForTests({ db }, { rawEventId, teamId: TEAM_ID }, io()),
    ).resolves.toMatchObject({ rawEventId, factsInserted: 0, modelVersion: MODEL_VERSION });

    const clusters = await db.select().from(artifactClusters);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]).toMatchObject({
      teamId: TEAM_ID,
      artifactType: 'link',
      canonicalName: 'example.com/future',
    });
    await expect(db.select().from(artifactEvidenceAssociations)).resolves.toEqual([
      expect.objectContaining({
        rawEventId,
        role: 'related_context',
        strength: 'hard',
        visibilityFloor: 'team',
      }),
    ]);
  });

  it('creates pending object summary rows for automatic refreshes after extraction', async () => {
    const rawEventId = '33333333-3333-4333-8333-333333333335';
    await seedEvent(db, { id: rawEventId, text: 'Acme is evaluating Timeline for Q4.' });
    const [seededEntity] = await db
      .insert(entities)
      .values({ teamId: TEAM_ID, type: 'company', canonicalName: 'Acme' })
      .returning({ id: entities.id });
    if (!seededEntity) throw new Error('failed to seed Acme object');
    const testIO = io({
      chatStructured: modelWithFacts([
        {
          statement: 'Acme is evaluating Timeline for Q4.',
          confidence: 0.92,
          mentions: [{ name: 'Acme', type: 'company', role: 'subject' }],
        },
      ]),
      enqueueObjectSummaryRefresh: undefined,
    });

    await expect(
      processExtractJobForTests({ db }, { rawEventId, teamId: TEAM_ID }, testIO),
    ).resolves.toMatchObject({ rawEventId, factsInserted: 1, modelVersion: MODEL_VERSION });

    const rows = await db
      .select()
      .from(objectSummaries)
      .where(eq(objectSummaries.entityId, seededEntity.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      teamId: TEAM_ID,
      entityId: seededEntity.id,
      status: 'pending',
    });
  });

  it('does not create workspace objects for unmatched extracted mentions', async () => {
    const rawEventId = '33333333-3333-4333-8333-333333333334';
    await seedEvent(db, { id: rawEventId, text: 'Tecci is evaluating Timeline for Q4.' });
    const testIO = io({
      chatStructured: modelWithFacts([
        {
          statement: 'Tecci is evaluating Timeline for Q4.',
          confidence: 0.92,
          mentions: [
            { name: 'Tecci', type: 'company', role: 'subject' },
            { name: 'Timeline', type: 'project', role: 'object' },
          ],
        },
      ]),
    });

    await expect(
      processExtractJobForTests({ db }, { rawEventId, teamId: TEAM_ID }, testIO),
    ).resolves.toMatchObject({ rawEventId, factsInserted: 1, modelVersion: MODEL_VERSION });

    const [fact] = await db.select().from(facts).where(eq(facts.rawEventId, rawEventId));
    if (!fact) throw new Error('expected extracted fact');
    await expect(
      db.select().from(factEntities).where(eq(factEntities.factId, fact.id)),
    ).resolves.toEqual([]);
    await expect(db.select().from(entities).where(eq(entities.teamId, TEAM_ID))).resolves.toEqual(
      [],
    );
  });

  it('does not attach facts to generic topics or tools even when matching objects exist', async () => {
    const rawEventId = '33333333-3333-4333-8333-333333333336';
    await seedEvent(db, {
      id: rawEventId,
      text: 'Otto asked if the various financial data sets could be combined.',
    });
    await db.insert(entities).values([
      { teamId: TEAM_ID, type: 'topic', canonicalName: 'financial data' },
      { teamId: TEAM_ID, type: 'topic', canonicalName: 'PE firms' },
      { teamId: TEAM_ID, type: 'company', canonicalName: 'GitHub' },
      { teamId: TEAM_ID, type: 'topic', canonicalName: 'Q3 roadmap' },
    ]);
    const testIO = io({
      chatStructured: modelWithFacts([
        {
          statement: 'Otto asked if the various financial data sets could be combined.',
          confidence: 0.9,
          mentions: [{ name: 'financial data', type: 'topic', role: 'topic' }],
        },
        {
          statement: 'The Q3 roadmap should include finance import planning.',
          confidence: 0.9,
          mentions: [{ name: 'Q3 roadmap', type: 'topic', role: 'topic' }],
        },
        {
          statement: 'The team mentioned PE firms and GitHub in passing.',
          confidence: 0.8,
          mentions: [
            { name: 'PE firms', type: 'topic', role: 'topic' },
            { name: 'GitHub', type: 'company', role: 'topic' },
          ],
        },
      ]),
    });

    await expect(
      processExtractJobForTests({ db }, { rawEventId, teamId: TEAM_ID }, testIO),
    ).resolves.toMatchObject({ rawEventId, factsInserted: 3, modelVersion: MODEL_VERSION });

    const factRows = await db.select().from(facts).where(eq(facts.rawEventId, rawEventId));
    const links = await db.select().from(factEntities);
    expect(factRows).toHaveLength(3);
    expect(links).toHaveLength(1);
    const [roadmap] = await db
      .select({ id: entities.id })
      .from(entities)
      .where(eq(entities.canonicalName, 'Q3 roadmap'));
    expect(links[0]?.entityId).toBe(roadmap?.id);
  });

  it('anchors data-source facts to products instead of public registry objects', async () => {
    const rawEventId = '33333333-3333-4333-8333-333333333337';
    await seedEvent(db, {
      id: rawEventId,
      text: 'Mika Malen uses Altus for system integrations at about 50 EUR per run and uses Taxxa.ai for reliable access to KILA statements, Finlex, and Tax Administration data.',
    });
    await db.insert(entities).values([
      { teamId: TEAM_ID, type: 'company', canonicalName: 'Altus' },
      { teamId: TEAM_ID, type: 'company', canonicalName: 'Taxxa.ai' },
      {
        teamId: TEAM_ID,
        type: 'company',
        canonicalName: 'Verottaja',
        aliases: ['Tax Administration'],
      },
      { teamId: TEAM_ID, type: 'company', canonicalName: 'KILA' },
      { teamId: TEAM_ID, type: 'company', canonicalName: 'Finlex' },
    ]);
    const testIO = io({
      chatStructured: modelWithFacts([
        {
          statement:
            'Mika Malen uses Altus for system integrations at about 50 EUR per run and uses Taxxa.ai for reliable access to KILA statements, Finlex, and Tax Administration data.',
          confidence: 1,
          mentions: [
            { name: 'Altus', type: 'company', role: 'object' },
            { name: 'Taxxa.ai', type: 'company', role: 'object' },
            { name: 'Verottaja', type: 'company', role: 'topic', aliases: ['Tax Administration'] },
            { name: 'KILA', type: 'company', role: 'topic' },
            { name: 'Finlex', type: 'company', role: 'topic' },
          ],
        },
      ]),
    });

    await expect(
      processExtractJobForTests({ db }, { rawEventId, teamId: TEAM_ID }, testIO),
    ).resolves.toMatchObject({ rawEventId, factsInserted: 1, modelVersion: MODEL_VERSION });

    const [fact] = await db.select().from(facts).where(eq(facts.rawEventId, rawEventId));
    if (!fact) throw new Error('expected extracted fact');
    const links = await db
      .select({ entityId: factEntities.entityId, name: entities.canonicalName })
      .from(factEntities)
      .innerJoin(entities, eq(entities.id, factEntities.entityId))
      .where(eq(factEntities.factId, fact.id));
    expect(links.map((link) => link.name).sort()).toEqual(['Altus', 'Taxxa.ai']);
  });

  it('drops noisy message-mechanics facts before persistence', async () => {
    const rawEventId = '33333333-3333-4333-8333-333333333335';
    await seedEvent(db, {
      id: rawEventId,
      text: 'Otto shared a link to an X post by asaadmahmood5.',
    });
    const testIO = io({
      chatStructured: modelWithFacts([
        {
          statement: 'Otto shared a link to an X post by asaadmahmood5.',
          confidence: 1,
          mentions: [
            { name: 'Otto', type: 'person', role: 'subject' },
            { name: 'X', type: 'company', role: 'object', aliases: ['Twitter'] },
            { name: 'asaadmahmood5', type: 'person', role: 'object' },
          ],
        },
      ]),
    });

    await expect(
      processExtractJobForTests({ db }, { rawEventId, teamId: TEAM_ID }, testIO),
    ).resolves.toMatchObject({ rawEventId, factsInserted: 0, modelVersion: MODEL_VERSION });

    await expect(db.select().from(facts).where(eq(facts.rawEventId, rawEventId))).resolves.toEqual(
      [],
    );
    await expect(db.select().from(entities).where(eq(entities.teamId, TEAM_ID))).resolves.toEqual(
      [],
    );
  });

  it('normalizes legacy text/entities model output before writing facts', async () => {
    const rawEventId = '34343434-3434-4434-8434-343434343434';
    await seedEvent(db, {
      id: rawEventId,
      text: 'The AuditAI team has a meeting scheduled for Monday.',
    });
    const testIO = io({
      chatStructured: modelWithFacts([
        {
          text: 'The AuditAI team has a meeting scheduled for Monday.',
          confidence: 0.7,
          entities: [
            { name: 'AuditAI', type: 'project', role: 'subject' },
            { name: 'Monday meeting', type: 'topic', role: 'topic' },
          ],
        },
      ]),
    });

    await expect(
      processExtractJobForTests({ db }, { rawEventId, teamId: TEAM_ID }, testIO),
    ).resolves.toMatchObject({ rawEventId, factsInserted: 1, modelVersion: MODEL_VERSION });

    const factRows = await db.select().from(facts).where(eq(facts.rawEventId, rawEventId));
    expect(factRows[0]?.statement).toBe('The AuditAI team has a meeting scheduled for Monday.');
  });

  it('carries a retried legacy extraction through embed jobs into Qdrant upserts', async () => {
    const rawEventId = '35353535-3535-4535-8535-353535353535';
    await seedEvent(db, {
      id: rawEventId,
      text: 'The AuditAI team has a meeting scheduled for Monday.',
    });
    const embedJobs: { rawEventId: string; teamId: string; factId?: string }[] = [];
    const enqueueEmbedJob = vi.fn((job: queue.EmbedJobData): Promise<void> => {
      if (!('rawEventId' in job)) throw new Error(`unexpected embed job scope: ${job.scope}`);
      embedJobs.push({
        rawEventId: job.rawEventId,
        teamId: job.teamId,
        ...('factId' in job && job.factId ? { factId: job.factId } : {}),
      });
      return Promise.resolve();
    });
    const testIO = io({
      chatStructured: modelWithFacts([
        {
          text: 'The AuditAI team has a meeting scheduled for Monday.',
          confidence: 0.7,
          entities: [
            { name: 'AuditAI', type: 'project', role: 'subject' },
            { name: 'Monday meeting', type: 'topic', role: 'topic' },
          ],
        },
      ]),
      enqueueEmbedJob,
    });

    await expect(
      processExtractJobForTests({ db }, { rawEventId, teamId: TEAM_ID }, testIO),
    ).resolves.toMatchObject({ rawEventId, factsInserted: 1, modelVersion: MODEL_VERSION });

    const factRows = await db.select().from(facts).where(eq(facts.rawEventId, rawEventId));
    const factId = factRows[0]?.id;
    expect(factId).toBeTypeOf('string');
    expect(embedJobs).toEqual([
      { rawEventId, teamId: TEAM_ID },
      { rawEventId, teamId: TEAM_ID, factId },
    ]);

    const upsertVector = vi.fn().mockResolvedValue(undefined);
    const deletePointsForSource = vi.fn().mockResolvedValue(undefined);
    const deletePointsForSourceFromChunk = vi.fn().mockResolvedValue(undefined);
    for (const job of embedJobs) {
      const embedJob = job.factId
        ? {
            scope: 'fact' as const,
            rawEventId: job.rawEventId,
            teamId: job.teamId,
            factId: job.factId,
          }
        : { scope: 'raw_event' as const, rawEventId: job.rawEventId, teamId: job.teamId };
      await processEmbedJobForTests({ db }, embedJob, {
        getEnv: () =>
          ({ OPENROUTER_API_KEY: 'test-key', QDRANT_URL: 'http://qdrant.test' }) as never,
        embed: vi.fn().mockResolvedValue({ vector: [0.1, 0.2, 0.3, 0.4], model: 'test-embed' }),
        getQdrantClient: vi.fn(
          () => ({ deletePointsForSource, deletePointsForSourceFromChunk, upsertVector }) as never,
        ),
      });
    }

    expect(upsertVector).toHaveBeenCalledTimes(2);
    expect(deletePointsForSource).not.toHaveBeenCalled();
    expect(deletePointsForSourceFromChunk).toHaveBeenCalledTimes(2);
    expect(upsertVector).toHaveBeenCalledWith(
      expect.any(String),
      [0.1, 0.2, 0.3, 0.4],
      expect.objectContaining({
        team_id: TEAM_ID,
        event_id: rawEventId,
        source_kind: 'raw_event',
      }),
    );
    expect(upsertVector).toHaveBeenCalledWith(
      expect.any(String),
      [0.1, 0.2, 0.3, 0.4],
      expect.objectContaining({
        team_id: TEAM_ID,
        event_id: rawEventId,
        fact_id: factId,
        source_kind: 'fact',
      }),
    );
    const [row] = await db
      .select({ sourceMetadata: rawEvents.sourceMetadata })
      .from(rawEvents)
      .where(eq(rawEvents.id, rawEventId));
    expect(row?.sourceMetadata).toMatchObject({
      extraction_model_version: MODEL_VERSION,
      embedding_model: 'test-embed',
    });
    expect(row?.sourceMetadata).toHaveProperty('extracted_at');
    expect(row?.sourceMetadata).toHaveProperty('embedded_at');
  });

  it('stamps zero-fact extraction and skips idempotent reruns without calling the model again', async () => {
    const rawEventId = '44444444-4444-4444-8444-444444444444';
    await seedEvent(db, { id: rawEventId, text: 'Heading out for lunch.' });
    const chatStructured = modelWithFacts([]);
    const testIO = io({ chatStructured });

    await processExtractJobForTests({ db }, { rawEventId, teamId: TEAM_ID }, testIO);
    await processExtractJobForTests({ db }, { rawEventId, teamId: TEAM_ID }, testIO);

    expect(chatStructured).toHaveBeenCalledTimes(1);
    await expect(db.select().from(facts).where(eq(facts.rawEventId, rawEventId))).resolves.toEqual(
      [],
    );
    const [row] = await db
      .select({ sourceMetadata: rawEvents.sourceMetadata })
      .from(rawEvents)
      .where(eq(rawEvents.id, rawEventId));
    expect(row?.sourceMetadata).toMatchObject({ extraction_model_version: MODEL_VERSION });
    expect(row?.sourceMetadata).toHaveProperty('extracted_at');
  });

  it('stamps the actual model returned by a structured fallback', async () => {
    const rawEventId = '45454545-4545-4545-8545-454545454545';
    const fallbackModelId = 'fallback-structured-model';
    const fallbackModelVersion = makeExtractionModelVersion(fallbackModelId);
    await seedEvent(db, { id: rawEventId, text: 'Acme is evaluating Timeline for Q4.' });
    const chatStructured = vi.fn().mockResolvedValue({
      object: {
        facts: [
          {
            statement: 'Acme is evaluating Timeline for Q4.',
            confidence: 0.92,
            mentions: [{ name: 'Acme', type: 'company', role: 'subject' }],
          },
        ],
      },
      model: fallbackModelId,
    });

    await expect(
      processExtractJobForTests({ db }, { rawEventId, teamId: TEAM_ID }, io({ chatStructured })),
    ).resolves.toMatchObject({
      rawEventId,
      factsInserted: 1,
      modelVersion: fallbackModelVersion,
    });

    const [fact] = await db.select().from(facts).where(eq(facts.rawEventId, rawEventId));
    expect(fact?.modelVersion).toBe(fallbackModelVersion);
    const [row] = await db
      .select({ sourceMetadata: rawEvents.sourceMetadata })
      .from(rawEvents)
      .where(eq(rawEvents.id, rawEventId));
    expect(row?.sourceMetadata).toMatchObject({
      extraction_model_version: fallbackModelVersion,
    });
  });

  it('skips reruns already stamped by the current structured fallback model', async () => {
    const rawEventId = '46464646-4646-4646-8646-464646464646';
    const fallbackModelVersion = currentExtractionModelVersions().find((version) =>
      version.includes('deepseek/deepseek-v4-pro'),
    );
    if (!fallbackModelVersion) throw new Error('expected fallback extraction model version');
    await seedEvent(db, {
      id: rawEventId,
      text: 'Acme is evaluating Timeline for Q4.',
      metadata: { extraction_model_version: fallbackModelVersion },
    });
    const chatStructured = modelWithFacts([
      {
        statement: 'Acme is evaluating Timeline for Q4.',
        confidence: 0.92,
        mentions: [{ name: 'Acme', type: 'company', role: 'subject' }],
      },
    ]);
    const testIO = io({ chatStructured });
    delete (testIO as Partial<typeof testIO>).modelId;

    await expect(
      processExtractJobForTests({ db }, { rawEventId, teamId: TEAM_ID }, testIO),
    ).resolves.toMatchObject({
      rawEventId,
      skipped: true,
      modelVersion: fallbackModelVersion,
    });

    expect(chatStructured).not.toHaveBeenCalled();
    await expect(db.select().from(facts).where(eq(facts.rawEventId, rawEventId))).resolves.toEqual(
      [],
    );
  });

  it('does not send private or specific-user event bodies to the LLM', async () => {
    const privateId = '55555555-5555-4555-8555-555555555555';
    const specificId = '66666666-6666-4666-8666-666666666666';
    await seedEvent(db, { id: privateId, text: 'Private acquisition note', visibility: 'private' });
    await seedEvent(db, {
      id: specificId,
      text: 'Specific-user only note',
      visibility: 'specific_users',
    });
    const chatStructured = modelWithFacts([]);
    const testIO = io({ chatStructured });

    await expect(
      processExtractJobForTests({ db }, { rawEventId: privateId, teamId: TEAM_ID }, testIO),
    ).resolves.toMatchObject({ skipped: true, reason: 'visibility=private' });
    await expect(
      processExtractJobForTests({ db }, { rawEventId: specificId, teamId: TEAM_ID }, testIO),
    ).resolves.toMatchObject({ skipped: true, reason: 'visibility=specific_users' });

    expect(chatStructured).not.toHaveBeenCalled();
    const rows = await db
      .select({ id: rawEvents.id, sourceMetadata: rawEvents.sourceMetadata })
      .from(rawEvents);
    expect(rows.find((row) => row.id === privateId)?.sourceMetadata).toMatchObject({
      extraction_skipped_reason: 'visibility=private',
    });
    expect(rows.find((row) => row.id === specificId)?.sourceMetadata).toMatchObject({
      extraction_skipped_reason: 'visibility=specific_users',
    });
  });

  it('skips GitHub integration events without calling the LLM or requiring OPENROUTER_API_KEY', async () => {
    const rawEventId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
    await seedEvent(db, {
      id: rawEventId,
      source: 'integration',
      text: 'GitHub PR timborovkov/audit-ai#88 — Fix command palette Engagements route 404',
      metadata: {
        provider: 'github',
        integration_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        event_type: 'pr.merged',
      },
    });
    const chatStructured = modelWithFacts([]);
    const testIO = io({
      getEnv: () => ({ OPENROUTER_API_KEY: undefined }) as never,
      chatStructured,
    });

    await expect(
      processExtractJobForTests({ db }, { rawEventId, teamId: TEAM_ID }, testIO),
    ).resolves.toMatchObject({
      skipped: true,
      reason: 'integration_structured_source',
    });
    expect(chatStructured).not.toHaveBeenCalled();
    expect(testIO.enqueueSuggestionJob).not.toHaveBeenCalled();
    const [row] = await db
      .select({ sourceMetadata: rawEvents.sourceMetadata })
      .from(rawEvents)
      .where(eq(rawEvents.id, rawEventId));
    expect(row?.sourceMetadata).toMatchObject({
      extraction_skipped_reason: 'integration_structured_source',
    });
  });

  it('skips document lifecycle events and Drive file-change pulses without calling the LLM', async () => {
    const documentEventId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3';
    const driveEventId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4';
    await seedEvent(db, {
      id: documentEventId,
      source: 'document',
      text: 'Uploaded Acme MSA.pdf',
      metadata: { action: 'upload', document_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' },
    });
    await seedEvent(db, {
      id: driveEventId,
      source: 'integration',
      text: 'Drive file "Acme MSA.pdf" (application/pdf) was modified',
      metadata: {
        provider: 'google_drive',
        integration_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        event_type: 'file.changed',
      },
    });
    const chatStructured = modelWithFacts([]);
    const testIO = io({
      getEnv: () => ({ OPENROUTER_API_KEY: undefined }) as never,
      chatStructured,
    });

    await expect(
      processExtractJobForTests({ db }, { rawEventId: documentEventId, teamId: TEAM_ID }, testIO),
    ).resolves.toMatchObject({ skipped: true, reason: 'document_lifecycle_event' });
    await expect(
      processExtractJobForTests({ db }, { rawEventId: driveEventId, teamId: TEAM_ID }, testIO),
    ).resolves.toMatchObject({ skipped: true, reason: 'integration_pulse_source' });
    expect(chatStructured).not.toHaveBeenCalled();
    expect(testIO.enqueueSuggestionJob).not.toHaveBeenCalled();
  });

  it('delays remaining integration extract jobs when the connection budget is exhausted', async () => {
    const rawEventId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
    await seedEvent(db, {
      id: rawEventId,
      source: 'integration',
      text: 'Slack note: ship the pricing page tomorrow',
      metadata: {
        provider: 'slack',
        integration_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      },
    });
    const chatStructured = modelWithFacts([]);
    const testIO = io({
      chatStructured,
      takeIngestProcessingSlot: vi.fn().mockResolvedValue({ allowed: false, retryAfterMs: 2_000 }),
    });

    await expect(
      processExtractJobForTests({ db }, { rawEventId, teamId: TEAM_ID }, testIO),
    ).resolves.toMatchObject({ delayed: true, retryAfterMs: 2_000 });
    expect(chatStructured).not.toHaveBeenCalled();
  });

  it('delays remaining integration embed jobs when the connection budget is exhausted', async () => {
    const rawEventId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3';
    await seedEvent(db, {
      id: rawEventId,
      source: 'integration',
      text: 'GitHub PR timborovkov/audit-ai#91 updated',
      metadata: {
        provider: 'github',
        integration_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      },
    });

    await expect(
      processEmbedJobForTests(
        { db },
        { scope: 'raw_event', rawEventId, teamId: TEAM_ID },
        {
          getEnv: () =>
            ({ OPENROUTER_API_KEY: 'test-key', QDRANT_URL: 'http://qdrant.test' }) as never,
          takeIngestProcessingSlot: vi
            .fn()
            .mockResolvedValue({ allowed: false, retryAfterMs: 3_000 }),
        },
      ),
    ).resolves.toMatchObject({ delayed: true, retryAfterMs: 3_000 });
  });

  it('filters private recent context from the extraction prompt', async () => {
    const currentId = '77777777-7777-4777-8777-777777777777';
    await seedEvent(db, {
      id: '88888888-8888-4888-8888-888888888888',
      text: 'Private context must not leak',
      visibility: 'private',
      occurredAt: new Date('2026-06-01T09:00:00.000Z'),
    });
    await seedEvent(db, {
      id: '99999999-9999-4999-8999-999999999999',
      text: 'Team context may be included',
      occurredAt: new Date('2026-06-01T09:30:00.000Z'),
    });
    await seedEvent(db, {
      id: currentId,
      text: 'Extract this current note',
      occurredAt: new Date('2026-06-01T10:00:00.000Z'),
    });
    const chatStructured = modelWithFacts([]);

    await processExtractJobForTests(
      { db },
      { rawEventId: currentId, teamId: TEAM_ID },
      io({ chatStructured }),
    );

    const prompt = (chatStructured.mock.calls[0]?.[0] as { prompt: string }).prompt;
    expect(prompt).toContain('Team context may be included');
    expect(prompt).not.toContain('Private context must not leak');
  });

  it('throws unrecoverable failures for missing rows, team mismatch, and missing text', async () => {
    const noTextId = 'aaaaaaaa-0000-4000-8000-000000000000';
    await seedEvent(db, { id: noTextId, text: null });
    const testIO = io();

    await expect(
      processExtractJobForTests(
        { db },
        { rawEventId: 'bbbbbbbb-0000-4000-8000-000000000000', teamId: TEAM_ID },
        testIO,
      ),
    ).rejects.toThrow('not found');
    await expect(
      processExtractJobForTests({ db }, { rawEventId: noTextId, teamId: OTHER_TEAM_ID }, testIO),
    ).rejects.toThrow('team mismatch');
    await expect(
      processExtractJobForTests({ db }, { rawEventId: noTextId, teamId: TEAM_ID }, testIO),
    ).rejects.toThrow('has no content_text');
  });

  it('marks bounded embed enqueue failures while preserving extracted facts', async () => {
    const rawEventId = 'cccccccc-0000-4000-8000-000000000000';
    await seedEvent(db, { id: rawEventId, text: 'Acme signed the pilot.' });
    const testIO = io({
      chatStructured: modelWithFacts([
        {
          statement: 'Acme signed the pilot.',
          confidence: 0.9,
          mentions: [{ name: 'Acme', type: 'company', role: 'subject' }],
        },
      ]),
      enqueueEmbedJob: vi.fn().mockRejectedValue(new Error('redis embed down')),
    });

    await processExtractJobForTests({ db }, { rawEventId, teamId: TEAM_ID }, testIO);

    await expect(
      db.select().from(facts).where(eq(facts.rawEventId, rawEventId)),
    ).resolves.toHaveLength(1);
    const [row] = await db
      .select({ sourceMetadata: rawEvents.sourceMetadata })
      .from(rawEvents)
      .where(eq(rawEvents.id, rawEventId));
    expect(row?.sourceMetadata).toMatchObject({
      embedding_error: 'enqueue failed (2 job(s)): redis embed down',
    });
    expect(row?.sourceMetadata).toHaveProperty('embedding_failed_at');
  });
});

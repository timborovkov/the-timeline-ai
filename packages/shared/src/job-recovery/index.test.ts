import { PGlite } from '@electric-sql/pglite';
import { type Db, documents, documentVersions, meetings, rawEvents } from '@timeline/db';
import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createJobRecoveryScope } from '#src/job-recovery/index.js';
import { applyDbMigrations } from '#src/test/pglite.js';

const TEAM_ID = '11111111-1111-1111-1111-111111111111';
const OTHER_TEAM_ID = '99999999-9999-9999-9999-999999999999';
const ADMIN_ID = '22222222-2222-2222-2222-222222222222';
const ADMIN_2_ID = '33333333-3333-3333-3333-333333333333';
const MEMBER_ID = '44444444-4444-4444-4444-444444444444';
const OTHER_USER_ID = '55555555-5555-5555-5555-555555555555';
const RAW_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const PRIVATE_RAW_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const SOURCE_OWNED_RAW_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbc';
const OTHER_TEAM_RAW_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const INTEGRATION_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const OBJECT_ID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
const ZERO_FACT_RAW_ID = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
const FAILED_EXTRACTION_RAW_ID = '12121212-1212-1212-1212-121212121212';
const DOCUMENT_ID = '13131313-1313-1313-1313-131313131313';
const DOCUMENT_VERSION_ID = '14141414-1414-1414-1414-141414141414';

function hoursAgoIso(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

function extractionFailedMeta(at = hoursAgoIso(1)): string {
  return JSON.stringify({
    extraction_failed_at: at,
    extraction_error: 'model failed',
    embedded_at: at,
  });
}

let pg: PGlite;
let db: ReturnType<typeof drizzle>;

beforeEach(async () => {
  pg = new PGlite();
  await applyDbMigrations(pg);
  db = drizzle(pg);
  await seed(pg);
});

afterEach(async () => {
  await pg.close();
});

describe('job recovery scope', () => {
  it('shows only active-team visible candidates to admins', async () => {
    await seedRawEventFailure(pg, RAW_ID, TEAM_ID, ADMIN_ID, 'team');
    await seedRawEventFailure(pg, PRIVATE_RAW_ID, TEAM_ID, OTHER_USER_ID, 'private');
    await seedRawEventFailure(pg, SOURCE_OWNED_RAW_ID, TEAM_ID, OTHER_USER_ID, 'private', ADMIN_ID);
    await seedRawEventFailure(pg, OTHER_TEAM_RAW_ID, OTHER_TEAM_ID, OTHER_USER_ID, 'team');

    const scope = scopeFor(ADMIN_ID, 'admin');
    const items = await scope.listRecoverableJobs();

    expect(items.map((item) => item.artifactId).sort()).toEqual([RAW_ID, SOURCE_OWNED_RAW_ID]);
    expect(items.every((item) => item.kind === 'transcription')).toBe(true);
    expect(items[0]?.label).toContain('Transcription');
    expect(items[0]?.label).not.toContain('transcribe');
  });

  it('hides jobs older than 7 days from the default attention list', async () => {
    await seedRawEventFailure(pg, RAW_ID, TEAM_ID, ADMIN_ID, 'team');
    await seedOldStuckExtraction(pg, ZERO_FACT_RAW_ID);

    const scope = scopeFor(ADMIN_ID, 'admin');
    const recent = await scope.listRecoverableJobs();
    const queue = await scope.getRecoverableJobQueue();
    const older = await scope.listRecoverableJobs({ window: 'older' });

    expect(recent.map((item) => item.artifactId)).toEqual([RAW_ID]);
    expect(queue.items.map((item) => item.artifactId)).toEqual([RAW_ID]);
    expect(queue.olderCount).toBeGreaterThanOrEqual(1);
    expect(older.some((item) => item.artifactId === ZERO_FACT_RAW_ID)).toBe(true);
  });

  it('dismisses older jobs without hiding recent failures', async () => {
    await seedRawEventFailure(pg, RAW_ID, TEAM_ID, ADMIN_ID, 'team');
    await seedOldStuckExtraction(pg, ZERO_FACT_RAW_ID);
    const scope = scopeFor(ADMIN_ID, 'admin');

    const result = await scope.dismissMatchingRecoverableJobs({
      window: 'older',
      reason: 'dismiss older jobs',
    });

    expect(result.dismissed).toBeGreaterThanOrEqual(1);
    expect(result.remaining).toBe(0);
    const queue = await scope.getRecoverableJobQueue();
    expect(queue.items.map((item) => item.artifactId)).toEqual([RAW_ID]);
    expect(queue.olderCount).toBe(0);
  });

  it('dismisses recent failed and stuck jobs together', async () => {
    await seedRawEventFailure(pg, RAW_ID, TEAM_ID, ADMIN_ID, 'team');
    await seedTextRawEvent(pg, ZERO_FACT_RAW_ID, { sourceMetadata: '{}' });
    const scope = scopeFor(ADMIN_ID, 'admin');
    const before = await scope.listRecoverableJobs();
    expect(before.length).toBeGreaterThanOrEqual(2);

    const result = await scope.dismissMatchingRecoverableJobs({
      window: 'recent',
      reason: 'dismiss recent jobs',
    });

    expect(result).toEqual({ dismissed: before.length, remaining: 0 });
    await expect(scope.listRecoverableJobs()).resolves.toEqual([]);
  });

  it('requires admin role for list, retry, and dismiss', async () => {
    await seedRawEventFailure(pg, RAW_ID, TEAM_ID, ADMIN_ID, 'team');
    const scope = scopeFor(MEMBER_ID, 'member');

    await expect(scope.listRecoverableJobs()).rejects.toThrow('Requires admin role');
    await expect(scope.dismissRecoverableJob('bad')).rejects.toThrow('Requires admin role');
    await expect(
      scope.dismissFailedRecoverableJobs({
        items: [{ id: 'bad', detectedAt: new Date('2026-05-27T10:00:00.000Z') }],
        expectedCount: 1,
      }),
    ).rejects.toThrow('Requires admin role');
    await expect(scope.retryRecoverableJob('bad')).rejects.toThrow('Requires admin role');
  });

  it('hides a team-wide dismissal for another admin', async () => {
    await seedRawEventFailure(pg, RAW_ID, TEAM_ID, ADMIN_ID, 'team');
    const adminOne = scopeFor(ADMIN_ID, 'admin');
    const [item] = await adminOne.listRecoverableJobs();
    if (!item) throw new Error('expected recovery item');

    await adminOne.dismissRecoverableJob(item.id, 'bad source file');

    const adminTwo = scopeFor(ADMIN_2_ID, 'admin');
    await expect(adminTwo.listRecoverableJobs()).resolves.toEqual([]);
  });

  it('does not let an old dismissal hide a newer failure for the same artifact', async () => {
    await seedTextRawEvent(pg, FAILED_EXTRACTION_RAW_ID, {
      sourceMetadata: extractionFailedMeta(),
    });
    const scope = scopeFor(ADMIN_ID, 'admin');
    const [item] = await scope.listRecoverableJobs();
    if (!item) throw new Error('expected recovery item');

    await scope.dismissRecoverableJob(item.id, 'old failure');
    await pg.exec(`
      UPDATE raw_events
      SET source_metadata = '{
        "extraction_failed_at":"2099-05-27T10:00:00.000Z",
        "extraction_error":"model failed again",
        "embedded_at":"2099-05-27T10:00:00.000Z"
      }'::jsonb
      WHERE id = '${FAILED_EXTRACTION_RAW_ID}';
    `);

    const nextItems = await scope.listRecoverableJobs();
    expect(nextItems).toHaveLength(1);
    expect(nextItems[0]).toMatchObject({
      artifactId: FAILED_EXTRACTION_RAW_ID,
      error: 'model failed again',
      kind: 'extraction',
      status: 'failed',
    });
  });

  it('rejects bulk dismiss when the same artifact failed again after the user snapshot', async () => {
    await seedTextRawEvent(pg, FAILED_EXTRACTION_RAW_ID, {
      sourceMetadata: extractionFailedMeta(),
    });
    const scope = scopeFor(ADMIN_ID, 'admin');
    const [staleItem] = await scope.listRecoverableJobs();
    if (!staleItem) throw new Error('expected recovery item');
    await pg.exec(`
      UPDATE raw_events
      SET source_metadata = '{
        "extraction_failed_at":"2099-05-27T10:00:00.000Z",
        "extraction_error":"model failed again",
        "embedded_at":"2099-05-27T10:00:00.000Z"
      }'::jsonb
      WHERE id = '${FAILED_EXTRACTION_RAW_ID}';
    `);

    await expect(
      scope.dismissFailedRecoverableJobs({
        items: [{ id: staleItem.id, detectedAt: staleItem.detectedAt }],
        expectedCount: 1,
      }),
    ).rejects.toThrow('stale_recovery_set');
  });

  it('bulk dismisses a visible re-failure that already has an older dismissal row', async () => {
    const firstFailedAt = hoursAgoIso(2);
    const dismissalAt = hoursAgoIso(1.5);
    const secondFailedAt = hoursAgoIso(1);
    await seedTextRawEvent(pg, FAILED_EXTRACTION_RAW_ID, {
      sourceMetadata: extractionFailedMeta(firstFailedAt),
    });
    const scope = scopeFor(ADMIN_ID, 'admin');
    const [oldItem] = await scope.listRecoverableJobs();
    if (!oldItem) throw new Error('expected recovery item');
    await scope.dismissRecoverableJob(oldItem.id, 'old failure');
    await pg.exec(`
      UPDATE job_recovery_dismissals
      SET created_at = '${dismissalAt}'
      WHERE team_id = '${TEAM_ID}'
        AND job_kind = 'extraction'
        AND artifact_kind = 'raw_event'
        AND artifact_id = '${FAILED_EXTRACTION_RAW_ID}';
      UPDATE raw_events
      SET source_metadata = '{
        "extraction_failed_at":"${secondFailedAt}",
        "extraction_error":"model failed again",
        "embedded_at":"${secondFailedAt}"
      }'::jsonb
      WHERE id = '${FAILED_EXTRACTION_RAW_ID}';
    `);
    const [newItem] = await scope.listRecoverableJobs();
    if (!newItem) throw new Error('expected visible re-failure');

    const result = await scope.dismissFailedRecoverableJobs({
      items: [{ id: newItem.id, detectedAt: newItem.detectedAt }],
      expectedCount: 1,
    });

    expect(result).toEqual({ dismissed: 1 });
    await expect(scope.listRecoverableJobs()).resolves.toEqual([]);
  });

  it('bulk dismisses failed jobs without hiding stuck jobs', async () => {
    await seedRawEventFailure(pg, RAW_ID, TEAM_ID, ADMIN_ID, 'team');
    await seedTextRawEvent(pg, FAILED_EXTRACTION_RAW_ID, {
      sourceMetadata: extractionFailedMeta(),
    });
    await seedTextRawEvent(pg, ZERO_FACT_RAW_ID, {
      sourceMetadata: '{"embedded_at":"2026-05-27T10:00:00.000Z"}',
    });
    const scope = scopeFor(ADMIN_ID, 'admin');

    const before = await scope.listRecoverableJobs();
    const failed = before.filter((item) => item.status === 'failed');

    const result = await scope.dismissFailedRecoverableJobs({
      items: failed.map((item) => ({ id: item.id, detectedAt: item.detectedAt })),
      expectedCount: failed.length,
    });

    expect(result).toEqual({ dismissed: 2 });
    const remaining = await scope.listRecoverableJobs();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]).toMatchObject({
      artifactId: ZERO_FACT_RAW_ID,
      kind: 'extraction',
      status: 'stuck',
    });
  });

  it('bulk dismisses failed jobs by kind', async () => {
    await seedRawEventFailure(pg, RAW_ID, TEAM_ID, ADMIN_ID, 'team');
    await seedTextRawEvent(pg, FAILED_EXTRACTION_RAW_ID, {
      sourceMetadata: extractionFailedMeta(),
    });
    const scope = scopeFor(ADMIN_ID, 'admin');

    const before = await scope.listRecoverableJobs();
    const failedExtractions = before.filter(
      (item) => item.kind === 'extraction' && item.status === 'failed',
    );

    const result = await scope.dismissFailedRecoverableJobs({
      kind: 'extraction',
      items: failedExtractions.map((item) => ({ id: item.id, detectedAt: item.detectedAt })),
      expectedCount: failedExtractions.length,
    });

    expect(result).toEqual({ dismissed: 1 });
    const remaining = await scope.listRecoverableJobs();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.kind).toBe('transcription');
  });

  it('rejects stale bulk dismiss snapshots', async () => {
    await seedRawEventFailure(pg, RAW_ID, TEAM_ID, ADMIN_ID, 'team');
    await seedTextRawEvent(pg, FAILED_EXTRACTION_RAW_ID, {
      sourceMetadata: extractionFailedMeta(),
    });
    const scope = scopeFor(ADMIN_ID, 'admin');
    const failed = (await scope.listRecoverableJobs()).filter((item) => item.status === 'failed');

    await expect(
      scope.dismissFailedRecoverableJobs({
        items: [
          {
            id: failed[0]?.id ?? 'missing',
            detectedAt: failed[0]?.detectedAt ?? new Date('2026-05-27T10:00:00.000Z'),
          },
        ],
        expectedCount: 1,
      }),
    ).rejects.toThrow('stale_recovery_set');
  });

  it('retry clears dismissal and failure markers after enqueueing', async () => {
    await seedRawEventFailure(pg, RAW_ID, TEAM_ID, ADMIN_ID, 'team');
    const enqueueTranscribeJob = vi.fn().mockResolvedValue(undefined);
    const scope = scopeFor(ADMIN_ID, 'admin', { enqueueTranscribeJob });
    const [item] = await scope.listRecoverableJobs();
    if (!item) throw new Error('expected recovery item');
    await scope.dismissRecoverableJob(item.id);

    await scope.retryRecoverableJob(item.id);

    expect(enqueueTranscribeJob).toHaveBeenCalledWith({
      rawEventId: RAW_ID,
      teamId: TEAM_ID,
      audioKey: 'audio/raw.ogg',
    });
    const rows = await (db as never as Db)
      .select({ meta: rawEvents.sourceMetadata })
      .from(rawEvents)
      .where(eq(rawEvents.id, RAW_ID));
    expect(rows[0]?.meta).not.toHaveProperty('transcription_failed_at');
    expect(rows[0]?.meta).not.toHaveProperty('transcription_error');
  });

  it('bulk retries failed jobs by kind', async () => {
    await seedRawEventFailure(pg, RAW_ID, TEAM_ID, ADMIN_ID, 'team');
    await seedTextRawEvent(pg, FAILED_EXTRACTION_RAW_ID, {
      sourceMetadata: extractionFailedMeta(),
    });
    const enqueueExtractJob = vi.fn().mockResolvedValue(undefined);
    const enqueueTranscribeJob = vi.fn().mockResolvedValue(undefined);
    const scope = scopeFor(ADMIN_ID, 'admin', { enqueueExtractJob, enqueueTranscribeJob });

    const before = await scope.listRecoverableJobs();
    const failedExtractions = before.filter(
      (item) => item.kind === 'extraction' && item.status === 'failed',
    );
    const result = await scope.retryFailedRecoverableJobs({
      kind: 'extraction',
      items: failedExtractions.map((item) => ({ id: item.id, detectedAt: item.detectedAt })),
      expectedCount: failedExtractions.length,
    });

    expect(result).toEqual({ retried: 1, failed: 0, failedIds: [] });
    expect(enqueueExtractJob).toHaveBeenCalledWith({
      rawEventId: FAILED_EXTRACTION_RAW_ID,
      teamId: TEAM_ID,
    });
    expect(enqueueTranscribeJob).not.toHaveBeenCalled();
  });

  it('bulk retry reports partial enqueue failures without hiding successful retries', async () => {
    await seedRawEventFailure(pg, RAW_ID, TEAM_ID, ADMIN_ID, 'team');
    await seedTextRawEvent(pg, FAILED_EXTRACTION_RAW_ID, {
      sourceMetadata: extractionFailedMeta(),
    });
    const enqueueTranscribeJob = vi.fn().mockResolvedValue(undefined);
    const enqueueExtractJob = vi.fn().mockRejectedValue(new Error('redis down'));
    const scope = scopeFor(ADMIN_ID, 'admin', { enqueueExtractJob, enqueueTranscribeJob });

    const failed = (await scope.listRecoverableJobs()).filter((item) => item.status === 'failed');
    const extraction = failed.find((item) => item.artifactId === FAILED_EXTRACTION_RAW_ID);
    if (!extraction) throw new Error('expected failed extraction');
    const result = await scope.retryFailedRecoverableJobs({
      items: failed.map((item) => ({ id: item.id, detectedAt: item.detectedAt })),
      expectedCount: failed.length,
    });

    expect(result).toEqual({ retried: 1, failed: 1, failedIds: [extraction.id] });
    expect(enqueueTranscribeJob).toHaveBeenCalledWith({
      rawEventId: RAW_ID,
      teamId: TEAM_ID,
      audioKey: 'audio/raw.ogg',
    });
    expect(enqueueExtractJob).toHaveBeenCalledWith({
      rawEventId: FAILED_EXTRACTION_RAW_ID,
      teamId: TEAM_ID,
    });
    const rows = await (db as never as Db)
      .select({ id: rawEvents.id, meta: rawEvents.sourceMetadata })
      .from(rawEvents)
      .where(inArray(rawEvents.id, [RAW_ID, FAILED_EXTRACTION_RAW_ID]));
    const transcriptionMeta = rows.find((row) => row.id === RAW_ID)?.meta as Record<
      string,
      unknown
    >;
    const extractionMeta = rows.find((row) => row.id === FAILED_EXTRACTION_RAW_ID)?.meta as Record<
      string,
      unknown
    >;
    expect(transcriptionMeta).not.toHaveProperty('transcription_failed_at');
    expect(extractionMeta).toHaveProperty('extraction_failed_at');
    expect(extractionMeta).toHaveProperty('extraction_error');
  });

  it('restores document failure state when pre-clear retry enqueue fails', async () => {
    await seedDocumentVersionFailure(db as never);
    const enqueueDocumentExtractJob = vi.fn().mockRejectedValue(new Error('redis down'));
    const scope = scopeFor(ADMIN_ID, 'admin', { enqueueDocumentExtractJob });

    const [item] = (await scope.listRecoverableJobs()).filter(
      (candidate) => candidate.artifactId === DOCUMENT_VERSION_ID,
    );
    if (!item) throw new Error('expected failed document version');
    const result = await scope.retryFailedRecoverableJobs({
      items: [{ id: item.id, detectedAt: item.detectedAt }],
      expectedCount: 1,
    });

    expect(result).toEqual({ retried: 0, failed: 1, failedIds: [item.id] });
    expect(enqueueDocumentExtractJob).toHaveBeenCalledWith({
      documentVersionId: DOCUMENT_VERSION_ID,
      teamId: TEAM_ID,
    });
    const [version] = await (db as never as Db)
      .select({
        processingStatus: documentVersions.processingStatus,
        processingError: documentVersions.processingError,
      })
      .from(documentVersions)
      .where(eq(documentVersions.id, DOCUMENT_VERSION_ID));
    expect(version).toMatchObject({
      processingStatus: 'failed',
      processingError: 'parser failed',
    });
  });

  it('rejects stale bulk retry snapshots', async () => {
    await seedTextRawEvent(pg, FAILED_EXTRACTION_RAW_ID, {
      sourceMetadata: extractionFailedMeta(),
    });
    const scope = scopeFor(ADMIN_ID, 'admin');
    const [staleItem] = await scope.listRecoverableJobs();
    if (!staleItem) throw new Error('expected recovery item');
    await pg.exec(`
      UPDATE raw_events
      SET source_metadata = '{
        "extraction_failed_at":"2099-05-27T10:00:00.000Z",
        "extraction_error":"model failed again",
        "embedded_at":"2099-05-27T10:00:00.000Z"
      }'::jsonb
      WHERE id = '${FAILED_EXTRACTION_RAW_ID}';
    `);

    await expect(
      scope.retryFailedRecoverableJobs({
        items: [{ id: staleItem.id, detectedAt: staleItem.detectedAt }],
        expectedCount: 1,
      }),
    ).rejects.toThrow('stale_recovery_set');
  });

  it('does not flag successful zero-fact extraction as stuck', async () => {
    await seedTextRawEvent(pg, RAW_ID, {
      sourceMetadata: '{}',
    });
    await seedTextRawEvent(pg, ZERO_FACT_RAW_ID, {
      sourceMetadata:
        '{"extracted_at":"2026-05-27T10:00:00.000Z","extraction_model_version":"test-model"}',
    });

    const scope = scopeFor(ADMIN_ID, 'admin');
    const items = await scope.listRecoverableJobs();
    const extractionItems = items.filter((item) => item.kind === 'extraction');

    expect(extractionItems.map((item) => item.artifactId)).toEqual([RAW_ID]);
  });

  it('keeps failed zero-fact extraction out of stuck extraction results', async () => {
    await seedTextRawEvent(pg, RAW_ID, {
      sourceMetadata: '{}',
    });
    await seedTextRawEvent(pg, FAILED_EXTRACTION_RAW_ID, {
      sourceMetadata: JSON.stringify({
        extraction_failed_at: hoursAgoIso(1),
        extraction_error: 'model failed',
      }),
    });

    const scope = scopeFor(ADMIN_ID, 'admin');
    const items = await scope.listRecoverableJobs();
    const failedItem = items.find(
      (item) => item.kind === 'extraction' && item.artifactId === FAILED_EXTRACTION_RAW_ID,
    );
    const stuckIds = items
      .filter((item) => item.kind === 'extraction' && item.status === 'stuck')
      .map((item) => item.artifactId);

    expect(failedItem).toMatchObject({ kind: 'extraction', status: 'failed' });
    expect(stuckIds).toEqual([RAW_ID]);
  });

  it('retries object embedding with the original queue scope', async () => {
    await pg.exec(`
      INSERT INTO entities (id, team_id, type, canonical_name)
      VALUES ('${OBJECT_ID}', '${TEAM_ID}', 'project', 'Apollo');
    `);
    const enqueueEmbedJob = vi.fn().mockResolvedValue(undefined);
    const scope = scopeFor(ADMIN_ID, 'admin', {
      enqueueEmbedJob,
      getEmbedQueue: () =>
        fakeQueue([
          {
            data: { scope: 'object', objectId: OBJECT_ID, teamId: TEAM_ID },
            failedReason: 'embed failed',
            finishedOn: Date.now(),
          },
        ]),
    });
    const [item] = await scope.listRecoverableJobs();
    if (!item) throw new Error('expected recovery item');

    await scope.retryRecoverableJob(item.id);

    expect(item.artifactKind).toBe('object');
    expect(enqueueEmbedJob).toHaveBeenCalledWith({
      scope: 'object',
      objectId: OBJECT_ID,
      teamId: TEAM_ID,
    });
  });

  it('excludes repeatable ticks and unsupported low-level failed jobs', async () => {
    await pg.exec(`
      INSERT INTO integrations (id, team_id, provider, display_name, external_account_id)
      VALUES ('${INTEGRATION_ID}', '${TEAM_ID}', 'github', 'GitHub', 'gh-1');
    `);
    const scope = scopeFor(ADMIN_ID, 'admin', {
      getEmbedQueue: () => fakeQueue([{ data: { scope: 'meeting_chunk', teamId: TEAM_ID } }]),
      getMeetingFinalizeQueue: () => fakeQueue([]),
      getIntegrationSyncQueue: () =>
        fakeQueue([
          { data: { kind: 'incremental', integrationId: '__tick__', teamId: '__tick__' } },
          { data: { kind: 'incremental', integrationId: INTEGRATION_ID, teamId: TEAM_ID } },
        ]),
    });

    const items = await scope.listRecoverableJobs();

    expect(items).toHaveLength(1);
    expect(items[0]?.kind).toBe('integration_sync');
    expect(items[0]?.artifactId).toBe(INTEGRATION_ID);
  });

  it('preserves failed integration backfill kind when DB and queue candidates overlap', async () => {
    await pg.exec(`
      INSERT INTO integrations (
        id,
        team_id,
        provider,
        display_name,
        external_account_id,
        last_error,
        updated_at
      )
      VALUES (
        '${INTEGRATION_ID}',
        '${TEAM_ID}',
        'github',
        'GitHub',
        'gh-1',
        'state failed after job',
        now()
      );
    `);
    const enqueueIntegrationSyncJob = vi.fn().mockResolvedValue(undefined);
    const scope = scopeFor(ADMIN_ID, 'admin', {
      enqueueIntegrationSyncJob,
      getIntegrationSyncQueue: () =>
        fakeQueue([
          {
            data: { kind: 'backfill', integrationId: INTEGRATION_ID, teamId: TEAM_ID },
            failedReason: 'backfill failed',
            finishedOn: Date.now() - 60_000,
          },
        ]),
    });
    const [item] = await scope.listRecoverableJobs();
    if (!item) throw new Error('expected recovery item');

    await scope.retryRecoverableJob(item.id);

    expect(item.kind).toBe('integration_sync');
    expect(enqueueIntegrationSyncJob).toHaveBeenCalledWith({
      kind: 'backfill',
      integrationId: INTEGRATION_ID,
      teamId: TEAM_ID,
    });
  });

  it('hides retained failed meeting jobs superseded by a newer completed retry', async () => {
    const meetingId = '15151515-1515-1515-1515-151515151515';
    const oldFailure = Date.now() - 60_000;
    const newCompletion = Date.now() - 10_000;
    await (db as never as Db).insert(meetings).values({
      id: meetingId,
      teamId: TEAM_ID,
      createdByUserId: ADMIN_ID,
      platform: 'meet',
      meetingUrl: 'https://meet.google.com/abc-defg-hij',
      title: 'Internal daily call',
      status: 'completed',
      defaultVisibility: 'team',
      participants: [],
      metadata: {},
    });
    const scope = scopeFor(ADMIN_ID, 'admin', {
      getMeetingFinalizeQueue: () =>
        fakeStateQueue({
          failed: [
            {
              id: 'old-failure',
              name: 'meeting-finalize',
              data: { meetingId, teamId: TEAM_ID },
              failedReason: 'llm.chatStructured failed',
              finishedOn: oldFailure,
            },
          ],
          completed: [
            {
              id: 'new-completion',
              name: 'meeting-finalize',
              data: { meetingId, teamId: TEAM_ID },
              attemptsMade: 1,
              finishedOn: newCompletion,
            },
          ],
        }),
    });

    const items = await scope.listRecoverableJobs();

    expect(items.filter((item) => item.kind === 'meeting_finalization')).toEqual([]);
  });

  it('keeps retained failed meeting jobs when a later retry also failed', async () => {
    const meetingId = '16161616-1616-1616-1616-161616161616';
    await (db as never as Db).insert(meetings).values({
      id: meetingId,
      teamId: TEAM_ID,
      createdByUserId: ADMIN_ID,
      platform: 'meet',
      meetingUrl: 'https://meet.google.com/def-ghij-klm',
      title: 'Internal daily call',
      status: 'processing',
      defaultVisibility: 'team',
      participants: [],
      metadata: {},
    });
    const scope = scopeFor(ADMIN_ID, 'admin', {
      getMeetingFinalizeQueue: () =>
        fakeQueue([
          {
            id: 'latest-failure',
            name: 'meeting-finalize',
            data: { meetingId, teamId: TEAM_ID },
            failedReason: '402 insufficient credits',
            finishedOn: Date.now() - 10_000,
          },
        ]),
    });

    const items = await scope.listRecoverableJobs();

    expect(items).toEqual([
      expect.objectContaining({
        artifactId: meetingId,
        error: '402 insufficient credits',
        kind: 'meeting_finalization',
      }),
    ]);
  });

  it('retry clears integration sync-state errors after enqueueing', async () => {
    await pg.exec(`
      INSERT INTO integrations (id, team_id, provider, display_name, external_account_id)
      VALUES ('${INTEGRATION_ID}', '${TEAM_ID}', 'github', 'GitHub', 'gh-1');
      INSERT INTO integration_sync_state (
        integration_id,
        resource_type,
        last_status,
        last_error,
        updated_at
      )
      VALUES (
        '${INTEGRATION_ID}',
        'github.prs',
        'failed',
        'cursor failed',
        now()
      );
    `);
    const enqueueIntegrationSyncJob = vi.fn().mockResolvedValue(undefined);
    const scope = scopeFor(ADMIN_ID, 'admin', { enqueueIntegrationSyncJob });
    const [item] = await scope.listRecoverableJobs();
    if (!item) throw new Error('expected recovery item');

    await scope.retryRecoverableJob(item.id);

    expect(enqueueIntegrationSyncJob).toHaveBeenCalledWith({
      kind: 'incremental',
      integrationId: INTEGRATION_ID,
      teamId: TEAM_ID,
    });
    await expect(scope.listRecoverableJobs()).resolves.toEqual([]);
  });

  it('does not surface provider cooldowns as recoverable integration failures', async () => {
    await pg.exec(`
      INSERT INTO integrations (
        id,
        team_id,
        provider,
        display_name,
        external_account_id,
        last_error,
        updated_at
      )
      VALUES (
        '${INTEGRATION_ID}',
        '${TEAM_ID}',
        'monday',
        'Monday.com',
        'monday-account-1',
        'monday_rate_limited: Monday API DAILY_LIMIT_EXCEEDED; retry after 2026-06-28T12:00:00.000Z',
        now()
      );
      INSERT INTO integration_sync_state (
        integration_id,
        resource_type,
        last_status,
        last_error,
        updated_at
      )
      VALUES (
        '${INTEGRATION_ID}',
        'integration.run',
        'rate_limited',
        'monday_rate_limited: Monday API DAILY_LIMIT_EXCEEDED; retry after 2026-06-28T12:00:00.000Z',
        now()
      );
    `);
    const scope = scopeFor(ADMIN_ID, 'admin');

    await expect(scope.listRecoverableJobs()).resolves.toEqual([]);
  });

  it('lists retained finished jobs for the active team with offset pagination', async () => {
    const now = Date.now();
    const scope = scopeFor(ADMIN_ID, 'admin', {
      getTranscribeQueue: () =>
        fakeQueue(
          [
            {
              id: 'transcribe-1',
              name: 'transcribe',
              data: { rawEventId: RAW_ID, teamId: TEAM_ID },
              attemptsMade: 1,
              processedOn: now - 5_000,
              finishedOn: now - 4_000,
            },
            {
              id: 'transcribe-other-team',
              name: 'transcribe',
              data: { rawEventId: OTHER_TEAM_RAW_ID, teamId: OTHER_TEAM_ID },
              attemptsMade: 1,
              finishedOn: now - 1_000,
            },
          ],
          'transcribe',
        ),
      getExtractQueue: () =>
        fakeQueue(
          [
            {
              id: 'extract-1',
              name: 'extract',
              data: { rawEventId: FAILED_EXTRACTION_RAW_ID, teamId: TEAM_ID },
              attemptsMade: 3,
              failedReason: 'model failed',
              finishedOn: now - 2_000,
            },
          ],
          'extract',
        ),
    });

    const firstPage = await scope.listFinishedJobs({ offset: 0, limit: 1 });
    const secondPage = await scope.listFinishedJobs({ offset: 1, limit: 1 });

    expect(firstPage).toMatchObject({
      nextOffset: 1,
      items: [
        {
          artifactId: FAILED_EXTRACTION_RAW_ID,
          artifactKind: 'raw_event',
          kind: 'extraction',
          queue: 'extract',
          status: 'failed',
          error: 'model failed',
        },
      ],
    });
    expect(secondPage).toMatchObject({
      nextOffset: null,
      items: [
        {
          artifactId: RAW_ID,
          artifactKind: 'raw_event',
          kind: 'transcription',
          queue: 'transcribe',
          status: 'completed',
          error: null,
        },
      ],
    });
  });

  it('scans past cross-team retained jobs when listing finished jobs', async () => {
    const now = Date.now();
    const otherTeamJobs = Array.from({ length: 100 }, (_, index) => ({
      id: `other-${String(index)}`,
      name: 'transcribe',
      data: { rawEventId: OTHER_TEAM_RAW_ID, teamId: OTHER_TEAM_ID },
      attemptsMade: 1,
      finishedOn: now - index,
    }));
    const getJobs = vi.fn().mockImplementation((_types: unknown, start?: number, end?: number) => {
      const startIndex = start ?? 0;
      const endIndex = end ?? otherTeamJobs.length + 2;
      return Promise.resolve(
        [
          ...otherTeamJobs,
          {
            id: 'transcribe-1',
            name: 'transcribe',
            data: { rawEventId: RAW_ID, teamId: TEAM_ID },
            attemptsMade: 1,
            finishedOn: now - 10_000,
          },
          {
            id: 'transcribe-2',
            name: 'transcribe',
            data: { rawEventId: FAILED_EXTRACTION_RAW_ID, teamId: TEAM_ID },
            attemptsMade: 1,
            finishedOn: now - 11_000,
          },
        ].slice(startIndex, endIndex + 1),
      );
    });
    const scope = scopeFor(ADMIN_ID, 'admin', {
      getTranscribeQueue: () => ({ name: 'transcribe', getJobs }),
    });

    const page = await scope.listFinishedJobs({ offset: 0, limit: 1 });

    expect(page).toMatchObject({
      nextOffset: 1,
      items: [{ id: 'transcribe:transcribe-1', artifactId: RAW_ID }],
    });
    expect(getJobs).toHaveBeenCalledWith(['completed', 'failed'], 0, 99);
    expect(getJobs).toHaveBeenCalledWith(['completed', 'failed'], 100, 199);
  });

  it('keeps integration sync kind on finished archive rows', async () => {
    const now = Date.now();
    const scope = scopeFor(ADMIN_ID, 'admin', {
      getIntegrationSyncQueue: () =>
        fakeQueue(
          [
            {
              id: 'backfill-1',
              name: 'sync',
              data: { kind: 'backfill', integrationId: INTEGRATION_ID, teamId: TEAM_ID },
              attemptsMade: 1,
              finishedOn: now - 1_000,
            },
            {
              id: 'incremental-1',
              name: 'sync',
              data: { kind: 'incremental', integrationId: INTEGRATION_ID, teamId: TEAM_ID },
              attemptsMade: 1,
              finishedOn: now - 2_000,
            },
          ],
          'integration-sync',
        ),
    });

    const page = await scope.listFinishedJobs({ offset: 0, limit: 2 });

    expect(page.items).toMatchObject([
      { artifactId: INTEGRATION_ID, kind: 'integration_sync', syncKind: 'backfill' },
      { artifactId: INTEGRATION_ID, kind: 'integration_sync', syncKind: 'incremental' },
    ]);
  });
});

function scopeFor(
  userId: string,
  role: 'admin' | 'member',
  queues: Parameters<typeof createJobRecoveryScope>[0]['queues'] = {},
) {
  return createJobRecoveryScope({
    db: db as never,
    teamId: TEAM_ID,
    userId,
    ensureMember: (minRole = 'member') => {
      if (minRole === 'admin' && role !== 'admin') throw new Error('Requires admin role');
      return Promise.resolve(role);
    },
    queues: {
      enqueueTranscribeJob: vi.fn().mockResolvedValue(undefined),
      enqueueExtractJob: vi.fn().mockResolvedValue(undefined),
      enqueueEmbedJob: vi.fn().mockResolvedValue(undefined),
      enqueueDocumentExtractJob: vi.fn().mockResolvedValue(undefined),
      enqueueMeetingFinalizeJob: vi.fn().mockResolvedValue(undefined),
      enqueueIntegrationSyncJob: vi.fn().mockResolvedValue(undefined),
      getTranscribeQueue: () => fakeQueue([], 'transcribe'),
      getExtractQueue: () => fakeQueue([], 'extract'),
      getEmbedQueue: () => fakeQueue([]),
      getDocumentExtractQueue: () => fakeQueue([], 'document-extract'),
      getMeetingFinalizeQueue: () => fakeQueue([]),
      getIntegrationSyncQueue: () => fakeQueue([]),
      getOverdueScanQueue: () => fakeQueue([], 'overdue-scan'),
      getJanitorQueue: () => fakeQueue([], 'janitor'),
      getMcpHealthQueue: () => fakeQueue([], 'mcp-health'),
      getTeamExportQueue: () => fakeQueue([], 'team-export'),
      getSuggestionQueue: () => fakeQueue([], 'suggestions'),
      ...queues,
    },
  });
}

function fakeQueue(jobs: unknown[], name = 'queue') {
  return {
    name,
    getJobs: vi.fn().mockImplementation((_types: unknown, start?: number, end?: number) => {
      const startIndex = start ?? 0;
      const endIndex = end ?? jobs.length - 1;
      return Promise.resolve(jobs.slice(startIndex, endIndex + 1));
    }),
  };
}

function fakeStateQueue(states: { failed?: unknown[]; completed?: unknown[] }, name = 'queue') {
  return {
    name,
    getJobs: vi.fn().mockImplementation((types?: unknown, start?: number, end?: number) => {
      const requested = Array.isArray(types) ? types : typeof types === 'string' ? [types] : [];
      const jobs = [
        ...(requested.includes('failed') ? (states.failed ?? []) : []),
        ...(requested.includes('completed') ? (states.completed ?? []) : []),
      ];
      const startIndex = start ?? 0;
      const endIndex = end ?? jobs.length - 1;
      return Promise.resolve(jobs.slice(startIndex, endIndex + 1));
    }),
  };
}

async function seed(pg: PGlite): Promise<void> {
  await pg.exec(`
    INSERT INTO teams (id, slug, name) VALUES
      ('${TEAM_ID}', 'team', 'Team'),
      ('${OTHER_TEAM_ID}', 'other', 'Other');
    INSERT INTO users (id, email) VALUES
      ('${ADMIN_ID}', 'admin@test.local'),
      ('${ADMIN_2_ID}', 'admin2@test.local'),
      ('${MEMBER_ID}', 'member@test.local'),
      ('${OTHER_USER_ID}', 'other@test.local');
    INSERT INTO team_members (team_id, user_id, role) VALUES
      ('${TEAM_ID}', '${ADMIN_ID}', 'admin'),
      ('${TEAM_ID}', '${ADMIN_2_ID}', 'admin'),
      ('${TEAM_ID}', '${MEMBER_ID}', 'member'),
      ('${TEAM_ID}', '${OTHER_USER_ID}', 'member'),
      ('${OTHER_TEAM_ID}', '${OTHER_USER_ID}', 'admin');
  `);
}

async function seedRawEventFailure(
  pg: PGlite,
  id: string,
  teamId: string,
  authorUserId: string,
  visibility: 'private' | 'team',
  visibilityOwnerUserId = authorUserId,
): Promise<void> {
  const failedAt = hoursAgoIso(1);
  await pg.exec(`
    INSERT INTO raw_events (
      id,
      team_id,
      author_user_id,
      visibility_owner_user_id,
      source,
      content_audio_url,
      occurred_at,
      created_at,
      visibility,
      source_metadata
    )
    VALUES (
      '${id}',
      '${teamId}',
      '${authorUserId}',
      '${visibilityOwnerUserId}',
      'web',
      'audio/raw.ogg',
      now() - interval '1 hour',
      now() - interval '1 hour',
      '${visibility}',
      '{"transcription_failed_at":"${failedAt}","transcription_error":"codec failed"}'::jsonb
    );
  `);
}

async function seedOldStuckExtraction(pg: PGlite, id: string): Promise<void> {
  await pg.exec(`
    INSERT INTO raw_events (
      id,
      team_id,
      author_user_id,
      source,
      content_text,
      occurred_at,
      created_at,
      visibility,
      source_metadata
    )
    VALUES (
      '${id}',
      '${TEAM_ID}',
      '${ADMIN_ID}',
      'web',
      'Old backlog',
      now() - interval '10 days',
      now() - interval '10 days',
      'team',
      '{}'::jsonb
    );
  `);
}

async function seedTextRawEvent(
  pg: PGlite,
  id: string,
  opts: { sourceMetadata: string },
): Promise<void> {
  await pg.exec(`
    INSERT INTO raw_events (
      id,
      team_id,
      author_user_id,
      source,
      content_text,
      occurred_at,
      created_at,
      visibility,
      source_metadata
    )
    VALUES (
      '${id}',
      '${TEAM_ID}',
      '${ADMIN_ID}',
      'web',
      'Headed out',
      now() - interval '1 hour',
      now() - interval '1 hour',
      'team',
      '${opts.sourceMetadata}'::jsonb
    );
  `);
}

async function seedDocumentVersionFailure(db: Db): Promise<void> {
  await db.insert(documents).values({
    id: DOCUMENT_ID,
    teamId: TEAM_ID,
    name: 'Failure report.pdf',
    ownerUserId: ADMIN_ID,
    visibility: 'team',
  });
  await db.insert(documentVersions).values({
    id: DOCUMENT_VERSION_ID,
    teamId: TEAM_ID,
    documentId: DOCUMENT_ID,
    version: 1,
    objectKey: 'documents/failure-report.pdf',
    byteSize: 128,
    contentType: 'application/pdf',
    uploadedByUserId: ADMIN_ID,
    processingStatus: 'failed',
    processingError: 'parser failed',
  });
}

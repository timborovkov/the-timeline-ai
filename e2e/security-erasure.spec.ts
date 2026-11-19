import { randomUUID } from 'node:crypto';

import {
  DeleteObjectCommand,
  ListObjectVersionsCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { expect, test } from '@playwright/test';
import { getDb } from '@timeline/db';
import { TIMELINE_MODELS } from '@timeline/shared/llm';
import { getQdrantClient } from '@timeline/shared/qdrant';
import { getTeamExportQueue } from '@timeline/shared/queue';
import { getRedisConnection } from '@timeline/shared/redis';
import { getExportsBucket, getS3Client } from '@timeline/shared/s3/client';
import { processTeamLifecycle } from '@timeline/shared/team-lifecycle/processor';

import { withE2eDataTransaction } from './cleanup.js';
import { E2E_PREFIX, e2eUsers } from './test-data.js';

// Exercise the real active-store purgers with disposable, team-scoped fixtures.
test('synthetic erasure removes SQL, versioned export objects, vectors, cache and queue jobs', async () => {
  test.skip(
    process.env.E2E_REAL_ERASURE !== '1',
    'Requires the disposable PostgreSQL, RustFS, Qdrant, and Redis services',
  );
  const teamId = randomUUID();
  const exportId = randomUUID();
  const pointId = randomUUID();
  const key = `team-exports/${teamId}/${exportId}.zip`;
  const cacheKey = `e2e:erasable:${teamId}`;
  const s3 = getS3Client();
  const bucket = getExportsBucket();
  const queue = getTeamExportQueue();
  const redis = getRedisConnection();
  const qdrant = getQdrantClient();
  const model = TIMELINE_MODELS.embedding;
  const vector = Array.from({ length: model.embeddingDimensions ?? 0 }, (_, index) =>
    index === 0 ? 1 : 0,
  );
  const versions = () => s3.send(new ListObjectVersionsCommand({ Bucket: bucket, Prefix: key }));

  try {
    await withE2eDataTransaction(async (sql) => {
      await sql`INSERT INTO teams (id, name, slug) VALUES (${teamId}, 'Disposable security rehearsal', ${`${E2E_PREFIX}-${teamId}`})`;
      await sql`
        INSERT INTO team_exports (id, team_id, requested_by_user_id, status, object_key)
        VALUES (${exportId}, ${teamId}, ${e2eUsers.owner.id}, 'ready', ${key})
      `;
    });
    for (const body of ['synthetic export v1', 'synthetic export v2']) {
      await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body }));
    }
    await qdrant.upsertVector(pointId, vector, {
      team_id: teamId,
      source_kind: 'raw_event',
      event_id: pointId,
      fact_id: null,
      object_id: null,
      note_id: null,
      change_id: null,
      entity_id: null,
      entity_ids: [],
      occurred_at: new Date().toISOString(),
      author_user_id: e2eUsers.owner.id,
      visibility_owner_user_id: e2eUsers.owner.id,
      source: 'web',
      visibility: 'team',
      visibility_user_ids: null,
      embedding_model: model.id,
      source_scope: 'event',
      source_id: pointId,
      chunk_index: 0,
      document_id: null,
      document_version_id: null,
      document_chunk_id: null,
      folder_id: null,
      owner_user_id: null,
      updated_at: null,
      meeting_id: null,
      meeting_chunk_id: null,
      speaker: null,
    });
    await redis.set(cacheKey, 'synthetic cached data');
    await queue.add(
      'team-export',
      { teamId, teamExportId: exportId, requestedByUserId: e2eUsers.owner.id },
      { jobId: exportId, delay: 60_000 },
    );
    expect((await versions()).Versions).toHaveLength(2);
    expect(await qdrant.pointsExist([pointId])).toEqual(new Set([pointId]));
    expect(await redis.exists(cacheKey)).toBe(1);
    expect(await queue.getJob(exportId)).toBeTruthy();

    await withE2eDataTransaction(async (sql) => {
      await sql`UPDATE teams SET disabled_at = now(), deletion_started_at = now(), lifecycle_work = jsonb_build_object('stage', 'inventory', 'deletionActorUserId', ${e2eUsers.nonMember.id}::text) WHERE id = ${teamId}`;
    });
    for (let tick = 0; tick < 8; tick++) {
      await processTeamLifecycle(getDb());
      let complete = false;
      await withE2eDataTransaction(async (sql) => {
        const [team] = await sql`SELECT deleted_at, lifecycle_work FROM teams WHERE id = ${teamId}`;
        expect(team?.lifecycle_work?.error).toBeUndefined();
        complete = Boolean(team?.deleted_at);
        if (team?.lifecycle_work?.stage === 'verify') {
          // Advance the synthetic fixture to the end of the late-producer window.
          await sql`UPDATE teams SET lifecycle_work = lifecycle_work - 'retryAt' WHERE id = ${teamId}`;
        }
      });
      if (complete) break;
    }

    await withE2eDataTransaction(async (sql) => {
      const [team] = await sql`SELECT deleted_at, lifecycle_work FROM teams WHERE id = ${teamId}`;
      expect(team?.deleted_at).toBeTruthy();
      expect(team?.lifecycle_work?.stage).toBe('complete');
      expect(await sql`SELECT 1 FROM team_exports WHERE id = ${exportId}`).toHaveLength(0);
    });
    const remaining = await versions();
    expect(remaining.Versions ?? []).toHaveLength(0);
    expect(remaining.DeleteMarkers ?? []).toHaveLength(0);
    expect(await qdrant.pointsExist([pointId])).toEqual(new Set());
    expect(await redis.exists(cacheKey)).toBe(0);
    expect(await queue.getJob(exportId)).toBeUndefined();
  } finally {
    await queue.remove(exportId);
    await redis.del(cacheKey);
    await qdrant.deleteTeamPoints(teamId);
    const remaining = await versions();
    for (const version of [...(remaining.Versions ?? []), ...(remaining.DeleteMarkers ?? [])]) {
      await s3.send(
        new DeleteObjectCommand({ Bucket: bucket, Key: key, VersionId: version.VersionId }),
      );
    }
    await withE2eDataTransaction(async (sql) => {
      await sql`SELECT set_config('timeline.lifecycle_cleanup', 'on', true)`;
      await sql`UPDATE teams SET deletion_started_at = COALESCE(deletion_started_at, now()) WHERE id = ${teamId}`;
      await sql`DELETE FROM teams WHERE id = ${teamId}`;
    });
  }
});

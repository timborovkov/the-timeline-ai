/** Disposable local-service rehearsal. Refuses remote databases and never uses the app database. */
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';

import {
  CreateBucketCommand,
  DeleteBucketCommand,
  PutBucketVersioningCommand,
  PutObjectCommand,
  ListObjectVersionsCommand,
  DeleteObjectsCommand,
} from '@aws-sdk/client-s3';
import {
  getDb,
  closeDb,
  migrateDatabase,
  teams,
  users,
  teamMembers,
  rawEvents,
  integrations,
  providerConnections,
} from '@timeline/db';
import { resetEnvForTests } from '@timeline/shared/env';
import { beginTeamDeletion } from '@timeline/shared/team-lifecycle';
import { processTeamLifecycle } from '@timeline/shared/team-lifecycle/processor';
import { getS3Client } from '@timeline/shared/s3';
import { getQdrantClient } from '@timeline/shared/qdrant';
import { queue } from '@timeline/shared';
import { closeAllRedisConnections } from '@timeline/shared/redis';
import { eq } from 'drizzle-orm';

const url = new URL(process.env.DATABASE_URL ?? '');
if (
  !['localhost', '127.0.0.1'].includes(url.hostname) ||
  !/^\/timeline_deletion_test_[a-z0-9_]+$/.test(url.pathname)
)
  throw new Error('Dedicated local deletion-test database required');
const suffix = randomUUID().replaceAll('-', '');
const bucket = `deletion-test-${suffix}`;
const collection = `deletion_test_${suffix}`;
Object.assign(process.env, {
  AUTH_SECRET: 'disposable-local-deletion-rehearsal-secret',
  NODE_ENV: 'test',
  REDIS_URL: 'redis://127.0.0.1:6379/15',
  S3_ENDPOINT: 'http://127.0.0.1:9000',
  S3_REGION: 'us-east-1',
  S3_ACCESS_KEY_ID: 'timeline',
  S3_SECRET_ACCESS_KEY: 'timeline_dev_secret',
  S3_FORCE_PATH_STYLE: 'true',
  S3_BUCKET_AUDIO: bucket,
  S3_BUCKET_ATTACHMENTS: bucket,
  S3_BUCKET_DOCUMENTS: bucket,
  S3_BUCKET_EXPORTS: bucket,
  QDRANT_URL: 'http://127.0.0.1:6333',
  QDRANT_API_KEY: 'dev_qdrant_key',
  QDRANT_COLLECTION: collection,
  PLATFORM_ADMIN_EMAILS: `deletion-admin-${suffix}@example.test`,
  POLAR_ACCESS_TOKEN: '',
});
resetEnvForTests();
const team = randomUUID(),
  control = randomUUID(),
  admin = randomUUID();
const s3 = getS3Client();
const headers = { 'api-key': 'dev_qdrant_key', 'content-type': 'application/json' };
const vectorUrl = `http://127.0.0.1:6333/collections/${collection}`;
let queued: Awaited<ReturnType<ReturnType<typeof queue.getTranscribeQueue>['add']>> | undefined;
try {
  await migrateDatabase({ url: url.toString() });
  const db = getDb();
  await db.insert(users).values({
    id: admin,
    email: `deletion-admin-${suffix}@example.test`,
    emailVerified: new Date(),
  });
  await db.insert(teams).values([
    { id: team, name: 'Erase me', slug: `erase-${suffix}` },
    { id: control, name: 'Keep me', slug: `keep-${suffix}` },
  ]);
  await db.insert(teamMembers).values([
    { teamId: team, userId: admin, role: 'owner' },
    { teamId: control, userId: admin, role: 'owner' },
  ]);
  const sharedConnection = randomUUID(),
    unusedConnection = randomUUID();
  await db.insert(providerConnections).values(
    [sharedConnection, unusedConnection].map((id) => ({
      id,
      ownerUserId: admin,
      provider: 'mcp' as const,
      displayName: 'Synthetic connection',
      externalAccountId: id,
      authSecretCiphertext: Buffer.from('synthetic'),
      authSecretIv: Buffer.alloc(12),
      authSecretTag: Buffer.alloc(16),
    })),
  );
  await db.insert(integrations).values([
    {
      teamId: team,
      provider: 'mcp',
      displayName: 'Shared target',
      providerConnectionId: sharedConnection,
    },
    {
      teamId: control,
      provider: 'mcp',
      displayName: 'Shared control',
      providerConnectionId: sharedConnection,
    },
    {
      teamId: team,
      provider: 'mcp',
      displayName: 'Unused connection',
      providerConnectionId: unusedConnection,
    },
  ]);
  await db.insert(rawEvents).values([
    {
      teamId: team,
      source: 'web',
      rawText: 'Erase private fixture',
      visibility: 'private',
      authorUserId: admin,
    },
    {
      teamId: control,
      source: 'web',
      rawText: 'Keep control fixture',
      visibility: 'team',
      authorUserId: admin,
    },
  ]);
  await db.insert(integrations).values({
    teamId: team,
    provider: 'mcp',
    displayName: 'Disposable connection',
    connectedByUserId: admin,
  });
  await s3.send(new CreateBucketCommand({ Bucket: bucket }));
  await s3.send(
    new PutBucketVersioningCommand({
      Bucket: bucket,
      VersioningConfiguration: { Status: 'Enabled' },
    }),
  );
  for (const id of [team, control])
    for (const Body of ['version one', 'version two'])
      await s3.send(new PutObjectCommand({ Bucket: bucket, Key: `teams/${id}/audio.txt`, Body }));
  let response = await fetch(vectorUrl, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ vectors: { size: 1536, distance: 'Cosine' } }),
  });
  assert(response.ok, await response.text());
  response = await fetch(`${vectorUrl}/points?wait=true`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      points: [team, control].map((id) => ({
        id,
        vector: [1, ...Array(1535).fill(0)],
        payload: { team_id: id, visibility: 'team' },
      })),
    }),
  });
  assert(response.ok, await response.text());
  queued = await queue.getTranscribeQueue().add('fixture', {
    teamId: team,
    rawEventId: randomUUID(),
    audioKey: `teams/${team}/audio.txt`,
  });
  await beginTeamDeletion(
    db,
    { userId: admin, email: `deletion-admin-${suffix}@example.test` },
    { teamId: team, confirmation: 'Erase me', reason: 'Disposable integration rehearsal' },
  );
  for (let tick = 0; tick < 8; tick++) {
    await processTeamLifecycle(db);
    const [row] = await db.select().from(teams).where(eq(teams.id, team));
    assert(!row?.lifecycleWork.error, JSON.stringify(row?.lifecycleWork));
    if (row?.lifecycleWork.stage === 'verify') {
      // The test advances only its own verification clock; production waits for late uploads.
      await db
        .update(teams)
        .set({ lifecycleWork: { ...row.lifecycleWork, retryAt: new Date(0).toISOString() } })
        .where(eq(teams.id, team));
    }
    if (row?.deletedAt) break;
  }
  const [deleted] = await db.select().from(teams).where(eq(teams.id, team));
  assert(deleted?.deletedAt, 'Deletion must complete');
  assert.equal((await db.select().from(rawEvents).where(eq(rawEvents.teamId, team))).length, 0);
  assert.equal((await db.select().from(rawEvents).where(eq(rawEvents.teamId, control))).length, 1);
  const versions = await s3.send(new ListObjectVersionsCommand({ Bucket: bucket }));
  assert(!(versions.Versions ?? []).some((object) => object.Key?.includes(team)));
  assert.equal(
    (versions.Versions ?? []).filter((object) => object.Key?.includes(control)).length,
    2,
  );
  const vectors = getQdrantClient({ vectorSize: 1536, requireExisting: true });
  assert.equal(await vectors.countPoints(team), 0);
  assert.equal(await vectors.countPoints(control), 1);
  assert.equal(await queue.getTranscribeQueue().getJob(queued.id!), undefined);
  assert.equal(
    (
      await db
        .select()
        .from(providerConnections)
        .where(eq(providerConnections.id, sharedConnection))
    ).length,
    1,
  );
  assert.equal(
    (
      await db
        .select()
        .from(providerConnections)
        .where(eq(providerConnections.id, unusedConnection))
    ).length,
    0,
  );
  assert.equal((await db.select().from(users).where(eq(users.id, admin))).length, 1);
  console.log(
    'PASS: PostgreSQL content, versioned objects, vectors and queue payloads removed; control team, shared connection and user account preserved; unused connection removed.',
  );
} finally {
  await queued?.remove().catch(() => undefined);
  await queue.closeTranscribeQueue();
  await closeAllRedisConnections();
  await closeDb();
  const page = await s3.send(new ListObjectVersionsCommand({ Bucket: bucket })).catch(() => null);
  const Objects = [...(page?.Versions ?? []), ...(page?.DeleteMarkers ?? [])].map((object) => ({
    Key: object.Key!,
    VersionId: object.VersionId!,
  }));
  if (Objects.length)
    await s3.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects } }));
  await s3.send(new DeleteBucketCommand({ Bucket: bucket })).catch(() => undefined);
  await fetch(vectorUrl, { method: 'DELETE', headers });
}

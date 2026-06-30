import { PGlite } from '@electric-sql/pglite';
import {
  type Db,
  artifactClusters,
  entities,
  rawEvents,
  reconciliationEvidence,
  reconciliationRuns,
} from '@timeline/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';

import { applyDbMigrations } from '#src/test/pglite.js';
import {
  processReconciliationJob,
  type ReconciliationWorkerResult,
} from '#src/workers/reconciliation.js';

const TEAM_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';

let pg: PGlite;
let db: ReturnType<typeof drizzle>;

beforeEach(async () => {
  pg = new PGlite();
  await applyDbMigrations(pg);
  db = drizzle(pg);
  await pg.exec(`
    INSERT INTO teams (id, slug, name) VALUES ('${TEAM_ID}', 'reconcile-worker', 'Reconcile Worker');
    INSERT INTO users (id, email) VALUES ('${USER_ID}', 'owner@example.com');
    INSERT INTO team_members (team_id, user_id, role) VALUES ('${TEAM_ID}', '${USER_ID}', 'owner');
  `);
});

async function seedEmailRawEvent(): Promise<string> {
  const [event] = await (db as never as Db)
    .insert(rawEvents)
    .values({
      teamId: TEAM_ID,
      authorUserId: USER_ID,
      source: 'email',
      contentText: 'Customer email: Acme asked to move launch risk review to Monday.',
      visibility: 'team',
      sourceMetadata: {
        message_id: 'email-reconciliation-worker-1',
        source_payload_ref: 's3://timeline-test/email/raw-message-1.eml',
        payload_digest: 'sha256:raw-message-1',
      },
    })
    .returning({ id: rawEvents.id });
  if (!event) throw new Error('raw event seed failed');
  return event.id;
}

async function seedObjectAndCluster(): Promise<{ objectId: string; clusterId: string }> {
  const [object] = await (db as never as Db)
    .insert(entities)
    .values({
      teamId: TEAM_ID,
      type: 'project',
      canonicalName: 'Acme rollout',
    })
    .returning({ id: entities.id });
  if (!object) throw new Error('object seed failed');

  const [cluster] = await (db as never as Db)
    .insert(artifactClusters)
    .values({
      teamId: TEAM_ID,
      artifactType: 'project',
      artifactClusterKind: 'customer_project',
      canonicalName: 'Acme rollout',
      canonicalEntityId: object.id,
    })
    .returning({ id: artifactClusters.id });
  if (!cluster) throw new Error('cluster seed failed');

  return { objectId: object.id, clusterId: cluster.id };
}

function expectScopedResult(
  result: ReconciliationWorkerResult,
): Extract<ReconciliationWorkerResult, { status: 'completed'; runId: string }> {
  expect(result).toMatchObject({ status: 'completed' });
  if (!('runId' in result)) throw new Error('expected scoped reconciliation result');
  return result;
}

describe('processReconciliationJob', () => {
  it('audits missing evidence without mutating raw events', async () => {
    await seedEmailRawEvent();

    const result = await processReconciliationJob(db as never, {
      kind: 'evidence_audit',
      teamId: TEAM_ID,
      source: 'email',
    });

    expect(result).toMatchObject({
      teamId: TEAM_ID,
      source: 'email',
      totalRawEvents: 1,
      normalizedRawEvents: 0,
      missingRawEvents: 1,
    });
    await expect(db.select().from(reconciliationEvidence)).resolves.toHaveLength(0);
  });

  it('supports dry-run and real evidence backfill jobs', async () => {
    const rawEventId = await seedEmailRawEvent();

    const dryRun = await processReconciliationJob(db as never, {
      kind: 'evidence_backfill',
      teamId: TEAM_ID,
      source: 'email',
      dryRun: true,
    });
    expect(dryRun).toMatchObject({
      dryRun: true,
      candidateRawEvents: 1,
      normalizedEvidence: 0,
    });
    await expect(db.select().from(reconciliationEvidence)).resolves.toHaveLength(0);

    const backfill = await processReconciliationJob(db as never, {
      kind: 'evidence_backfill',
      teamId: TEAM_ID,
      source: 'email',
      missingOnly: true,
    });
    expect(backfill).toMatchObject({
      dryRun: false,
      candidateRawEvents: 1,
      normalizedEvidence: 1,
    });
    const rows = await db
      .select()
      .from(reconciliationEvidence)
      .where(eq(reconciliationEvidence.rawEventId, rawEventId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      teamId: TEAM_ID,
      source: 'email',
      provider: 'email',
      replayState: 'full',
      sourcePayloadRef: 's3://timeline-test/email/raw-message-1.eml',
    });
  });

  it('rejects unknown evidence sources before scanning', async () => {
    await expect(
      processReconciliationJob(db as never, {
        kind: 'evidence_audit',
        teamId: TEAM_ID,
        source: 'not-a-source',
      }),
    ).rejects.toThrow('Unknown reconciliation evidence source');
  });

  it('records manual team, object, and cluster scoped reconciliation runs', async () => {
    const { objectId, clusterId } = await seedObjectAndCluster();

    const teamRun = expectScopedResult(
      await processReconciliationJob(db as never, {
        kind: 'scope_reconcile',
        teamId: TEAM_ID,
        scope: 'team',
        triggeredBy: USER_ID,
        reason: 'admin_dashboard',
      }),
    );
    const objectRun = expectScopedResult(
      await processReconciliationJob(db as never, {
        kind: 'scope_reconcile',
        teamId: TEAM_ID,
        scope: 'object',
        targetId: objectId,
        triggeredBy: USER_ID,
        reason: 'admin_dashboard',
      }),
    );
    const duplicateObjectRun = expectScopedResult(
      await processReconciliationJob(db as never, {
        kind: 'scope_reconcile',
        teamId: TEAM_ID,
        scope: 'object',
        targetId: objectId,
        triggeredBy: USER_ID,
        reason: 'admin_dashboard',
      }),
    );
    const clusterRun = expectScopedResult(
      await processReconciliationJob(db as never, {
        kind: 'scope_reconcile',
        teamId: TEAM_ID,
        scope: 'cluster',
        targetId: clusterId,
        triggeredBy: USER_ID,
        reason: 'admin_dashboard',
      }),
    );

    expect(teamRun).toMatchObject({
      teamId: TEAM_ID,
      scope: 'team',
      targetId: null,
      status: 'completed',
      clusterCount: 1,
    });
    expect(objectRun).toMatchObject({
      teamId: TEAM_ID,
      scope: 'object',
      targetId: objectId,
      status: 'completed',
      clusterCount: 1,
    });
    expect(duplicateObjectRun.runId).toBe(objectRun.runId);
    expect(clusterRun).toMatchObject({
      teamId: TEAM_ID,
      scope: 'cluster',
      targetId: clusterId,
      status: 'completed',
      clusterCount: 1,
    });

    const runs = await db.select().from(reconciliationRuns);
    expect(runs).toHaveLength(3);
    expect(runs.map((run) => run.scope).sort()).toEqual([
      `cluster:${clusterId}`,
      `object:${objectId}`,
      'team',
    ]);
    expect(runs.every((run) => run.trigger === 'manual_repair')).toBe(true);
    const objectRunRow = runs.find((run) => run.scope === `object:${objectId}`);
    expect(objectRunRow?.metrics).toMatchObject({
      output_count: 0,
      association_count: 0,
      cluster_count: 1,
      lock_key: `reconciliation:${TEAM_ID}:object:${objectId}`,
    });
  });

  it('rejects scoped reconciliation targets outside the team', async () => {
    await expect(
      processReconciliationJob(db as never, {
        kind: 'scope_reconcile',
        teamId: TEAM_ID,
        scope: 'object',
        targetId: '33333333-3333-4333-8333-333333333333',
      }),
    ).rejects.toThrow('Reconciliation object target was not found for this team');

    await expect(
      processReconciliationJob(db as never, {
        kind: 'scope_reconcile',
        teamId: TEAM_ID,
        scope: 'cluster',
        targetId: '44444444-4444-4444-8444-444444444444',
      }),
    ).rejects.toThrow('Reconciliation cluster target was not found for this team');
  });
});

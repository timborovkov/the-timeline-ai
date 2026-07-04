import { PGlite } from '@electric-sql/pglite';
import {
  type Db,
  agentSuggestionItems,
  agentSuggestions,
  artifactClusters,
  artifactEvidenceAssociations,
  entities,
  rawEvents,
  reconciliationEvidence,
  reconciliationOutputs,
  reconciliationRuns,
} from '@timeline/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { applyDbMigrations } from '#src/test/pglite.js';
import {
  processReconciliationJob,
  type ReconciliationWorkerResult,
} from '#src/workers/reconciliation.js';

const TEAM_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_USER_ID = '33333333-3333-4333-8333-333333333333';

let pg: PGlite;
let db: ReturnType<typeof drizzle>;

beforeEach(async () => {
  pg = new PGlite();
  await applyDbMigrations(pg);
  db = drizzle(pg);
  await pg.exec(`
    INSERT INTO teams (id, slug, name) VALUES ('${TEAM_ID}', 'reconcile-worker', 'Reconcile Worker');
    INSERT INTO users (id, email) VALUES ('${USER_ID}', 'owner@example.com');
    INSERT INTO users (id, email) VALUES ('${OTHER_USER_ID}', 'other@example.com');
    INSERT INTO team_members (team_id, user_id, role) VALUES ('${TEAM_ID}', '${USER_ID}', 'owner');
    INSERT INTO team_members (team_id, user_id, role) VALUES ('${TEAM_ID}', '${OTHER_USER_ID}', 'member');
  `);
});

afterEach(async () => {
  await pg.close();
});

async function seedEmailRawEvent(
  input: {
    entityId?: string;
    authorUserId?: string;
    visibility?: 'team' | 'private' | 'specific_users';
    visibilityOwnerUserId?: string | null;
    visibilityUserIds?: string[] | null;
    messageId?: string;
  } = {},
): Promise<string> {
  const [event] = await (db as never as Db)
    .insert(rawEvents)
    .values({
      teamId: TEAM_ID,
      authorUserId: input.authorUserId ?? USER_ID,
      source: 'email',
      contentText: 'Customer email: Acme asked to move launch risk review to Monday.',
      visibility: input.visibility ?? 'team',
      visibilityOwnerUserId: input.visibilityOwnerUserId,
      visibilityUserIds: input.visibilityUserIds,
      sourceMetadata: {
        message_id: input.messageId ?? 'email-reconciliation-worker-1',
        source_payload_ref: `s3://timeline-test/email/${input.messageId ?? 'raw-message-1'}.eml`,
        payload_digest: 'sha256:raw-message-1',
        ...(input.entityId ? { entity_id: input.entityId } : {}),
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

function jsonRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('expected JSON record');
  }
  return value as Record<string, unknown>;
}

describe('processReconciliationJob', () => {
  it('audits missing evidence without normalizing raw events and records release-gate metrics', async () => {
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
      releaseGate: {
        passed: false,
        failureCount: 1,
        failures: [
          {
            source: 'email',
            code: 'missing_evidence',
            rawEventCount: 1,
          },
        ],
      },
    });
    await expect(db.select().from(reconciliationEvidence)).resolves.toHaveLength(0);
    const runs = await db.select().from(reconciliationRuns);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      trigger: 'backfill',
      scope: 'evidence_audit:email',
      status: 'completed',
      engineVersion: 'reconciliation-evidence-audit-2026-07',
      metrics: {
        mode: 'audit',
        source: 'email',
        missing_raw_events: 1,
        release_gate_passed: false,
        release_gate_failure_count: 1,
        release_gate_failures: [
          {
            source: 'email',
            code: 'missing_evidence',
            rawEventCount: 1,
          },
        ],
      },
    });
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
    const runs = await db.select().from(reconciliationRuns);
    expect(runs).toHaveLength(2);
    const dryRunRow = runs.find((run) => jsonRecord(run.metrics).dry_run === true);
    expect(dryRunRow).toMatchObject({
      trigger: 'backfill',
      scope: 'evidence_backfill:email',
      engineVersion: 'reconciliation-evidence-backfill-2026-07',
    });
    expect(jsonRecord(dryRunRow?.metrics)).toMatchObject({
      mode: 'backfill',
      source: 'email',
      dry_run: true,
      candidate_raw_events: 1,
      normalized_evidence: 0,
    });
    const realBackfillRow = runs.find((run) => jsonRecord(run.metrics).dry_run === false);
    expect(realBackfillRow).toMatchObject({
      trigger: 'backfill',
      scope: 'evidence_backfill:email',
      engineVersion: 'reconciliation-evidence-backfill-2026-07',
    });
    expect(jsonRecord(realBackfillRow?.metrics)).toMatchObject({
      mode: 'backfill',
      source: 'email',
      dry_run: false,
      candidate_raw_events: 1,
      normalized_evidence: 1,
    });
  });

  it('uses triggeredBy as the viewer for queued audit and backfill jobs', async () => {
    const visibleRawEventId = await seedEmailRawEvent({ messageId: 'visible-message' });
    const hiddenRawEventId = await seedEmailRawEvent({
      authorUserId: OTHER_USER_ID,
      visibility: 'private',
      visibilityOwnerUserId: OTHER_USER_ID,
      messageId: 'hidden-private-message',
    });

    const audit = await processReconciliationJob(db as never, {
      kind: 'evidence_audit',
      teamId: TEAM_ID,
      source: 'email',
      triggeredBy: USER_ID,
    });
    expect(audit).toMatchObject({
      totalRawEvents: 1,
      missingRawEvents: 1,
    });

    const backfill = await processReconciliationJob(db as never, {
      kind: 'evidence_backfill',
      teamId: TEAM_ID,
      source: 'email',
      triggeredBy: USER_ID,
    });
    expect(backfill).toMatchObject({
      scannedRawEvents: 1,
      candidateRawEvents: 1,
      normalizedEvidence: 1,
    });

    await expect(
      db
        .select()
        .from(reconciliationEvidence)
        .where(eq(reconciliationEvidence.rawEventId, visibleRawEventId)),
    ).resolves.toHaveLength(1);
    await expect(
      db
        .select()
        .from(reconciliationEvidence)
        .where(eq(reconciliationEvidence.rawEventId, hiddenRawEventId)),
    ).resolves.toHaveLength(0);
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
      evidenceBackfilled: 0,
      associationRepairCount: 0,
      projectionRepairCount: 0,
    });
    expect(objectRun).toMatchObject({
      teamId: TEAM_ID,
      scope: 'object',
      targetId: objectId,
      status: 'completed',
      clusterCount: 1,
      evidenceBackfilled: 0,
      associationRepairCount: 0,
      projectionRepairCount: 0,
    });
    expect(duplicateObjectRun.runId).toBe(objectRun.runId);
    expect(clusterRun).toMatchObject({
      teamId: TEAM_ID,
      scope: 'cluster',
      targetId: clusterId,
      status: 'completed',
      clusterCount: 1,
      evidenceBackfilled: 0,
      associationRepairCount: 0,
      projectionRepairCount: 0,
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
      mode: 'manual_repair',
      output_count: 0,
      association_count: 0,
      cluster_count: 1,
      evidence_backfilled: 0,
      association_repair_count: 0,
      projection_repair_count: 0,
      lock_key: `reconciliation:${TEAM_ID}:object:${objectId}`,
    });
  });

  it('does not double-count object-scoped outputs that also belong to the object cluster', async () => {
    const { objectId, clusterId } = await seedObjectAndCluster();
    const [seedRun] = await (db as never as Db)
      .insert(reconciliationRuns)
      .values({
        teamId: TEAM_ID,
        trigger: 'manual_repair',
        scope: `object:${objectId}`,
        status: 'completed',
        inputFingerprint: 'object-output-metric-seed-run',
        engineVersion: 'metric-test',
        completedAt: new Date('2026-06-20T10:00:00Z'),
      })
      .returning();
    if (!seedRun) throw new Error('run seed failed');
    await (db as never as Db).insert(reconciliationOutputs).values({
      teamId: TEAM_ID,
      runId: seedRun.id,
      clusterId,
      outputKind: 'direct_write',
      targetKind: 'object',
      operation: 'update',
      targetId: objectId,
      payload: { changed_fields: ['stage'] },
      authorityDecision: {
        decision: 'applied',
        reason: 'metric_test',
        policy_version: 'timeline-owned-approval-2026-06',
      },
      requiresApproval: false,
      sourceRefs: [],
      sourcePayloadRefs: [],
      visibility: 'team',
      visibilityFloor: 'team',
      dedupeKey: 'object-output-metric-seed-output',
      status: 'applied',
    });

    const result = expectScopedResult(
      await processReconciliationJob(db as never, {
        kind: 'scope_reconcile',
        teamId: TEAM_ID,
        scope: 'object',
        targetId: objectId,
        triggeredBy: USER_ID,
        reason: 'admin_dashboard',
      }),
    );

    expect(result.outputCount).toBe(1);
    const runs = await db.select().from(reconciliationRuns);
    const repairRun = runs.find((run) => run.id === result.runId);
    expect(repairRun?.metrics).toMatchObject({ output_count: 1 });
  });

  it('backfills object-linked raw events without existing associations or outputs', async () => {
    const { objectId } = await seedObjectAndCluster();
    const rawEventId = await seedEmailRawEvent({ entityId: objectId });

    const result = expectScopedResult(
      await processReconciliationJob(db as never, {
        kind: 'scope_reconcile',
        teamId: TEAM_ID,
        scope: 'object',
        targetId: objectId,
        triggeredBy: USER_ID,
        reason: 'admin_dashboard',
      }),
    );

    expect(result).toMatchObject({
      evidenceBackfilled: 1,
      associationRepairCount: 1,
      projectionRepairCount: 0,
      outputCount: 1,
      associationCount: 1,
    });
    const evidenceRows = await db
      .select()
      .from(reconciliationEvidence)
      .where(eq(reconciliationEvidence.rawEventId, rawEventId));
    expect(evidenceRows).toHaveLength(1);
    const associationRows = await db.select().from(artifactEvidenceAssociations);
    expect(associationRows).toHaveLength(1);
    expect(associationRows[0]).toMatchObject({
      evidenceId: evidenceRows[0]?.id,
      rawEventId,
      role: 'evidence_only',
      strength: 'structured',
      associationSource: 'structured_anchor',
      visibility: 'team',
      visibilityFloor: 'team',
    });
    const outputRows = await db.select().from(reconciliationOutputs);
    expect(outputRows).toHaveLength(1);
    expect(outputRows[0]).toMatchObject({
      clusterId: associationRows[0]?.clusterId,
      outputKind: 'observed_association',
      targetKind: 'cluster_identity',
      operation: 'link',
      status: 'applied',
      visibility: 'team',
      visibilityFloor: 'team',
    });
  });

  it('does not backfill scoped raw events hidden from the triggering user', async () => {
    const { objectId } = await seedObjectAndCluster();
    const visibleRawEventId = await seedEmailRawEvent({
      entityId: objectId,
      messageId: 'visible-object-message',
    });
    const hiddenRawEventId = await seedEmailRawEvent({
      entityId: objectId,
      authorUserId: OTHER_USER_ID,
      visibility: 'private',
      visibilityOwnerUserId: OTHER_USER_ID,
      messageId: 'hidden-object-message',
    });

    const result = expectScopedResult(
      await processReconciliationJob(db as never, {
        kind: 'scope_reconcile',
        teamId: TEAM_ID,
        scope: 'object',
        targetId: objectId,
        triggeredBy: USER_ID,
        reason: 'admin_dashboard',
      }),
    );

    expect(result).toMatchObject({ evidenceBackfilled: 1 });
    await expect(
      db
        .select()
        .from(reconciliationEvidence)
        .where(eq(reconciliationEvidence.rawEventId, visibleRawEventId)),
    ).resolves.toHaveLength(1);
    await expect(
      db
        .select()
        .from(reconciliationEvidence)
        .where(eq(reconciliationEvidence.rawEventId, hiddenRawEventId)),
    ).resolves.toHaveLength(0);
  });

  it('backfills cluster-scoped raw events when association raw event ids are legacy-null', async () => {
    const rawEventId = await seedEmailRawEvent();
    const { clusterId } = await seedObjectAndCluster();
    const [legacyEvidence] = await (db as never as Db)
      .insert(reconciliationEvidence)
      .values({
        teamId: TEAM_ID,
        rawEventId,
        source: 'email',
        provider: 'email',
        externalObjectId: 'email-reconciliation-worker-1',
        eventType: 'email.received',
        occurredAt: new Date('2026-06-20T10:00:00Z'),
        visibility: 'team',
        actor: {},
        contentDigest: 'legacy-email-digest',
        normalizerVersion: 'legacy-normalizer',
        dedupeKey: 'legacy-null-association-evidence',
      })
      .returning({ id: reconciliationEvidence.id });
    if (!legacyEvidence) throw new Error('legacy evidence seed failed');
    await (db as never as Db).insert(artifactEvidenceAssociations).values({
      teamId: TEAM_ID,
      clusterId,
      evidenceId: legacyEvidence.id,
      rawEventId: null,
      role: 'evidence_only',
      strength: 'human',
      associationSource: 'human',
      sourceRefs: [],
      visibility: 'team',
      visibilityFloor: 'team',
      dedupeKey: 'legacy-null-association',
    });

    const result = expectScopedResult(
      await processReconciliationJob(db as never, {
        kind: 'scope_reconcile',
        teamId: TEAM_ID,
        scope: 'cluster',
        targetId: clusterId,
        triggeredBy: USER_ID,
        reason: 'admin_dashboard',
      }),
    );

    expect(result).toMatchObject({ evidenceBackfilled: 1 });
    const evidenceRows = await db
      .select()
      .from(reconciliationEvidence)
      .where(eq(reconciliationEvidence.rawEventId, rawEventId));
    expect(evidenceRows.map((row) => row.normalizerVersion).sort()).toEqual([
      'legacy-normalizer',
      'raw-event-normalize-2026-06',
    ]);
  });

  it('repairs scoped raw-event evidence and deleted approval projections', async () => {
    const rawEventId = await seedEmailRawEvent();
    const { objectId, clusterId } = await seedObjectAndCluster();
    const [run] = await (db as never as Db)
      .insert(reconciliationRuns)
      .values({
        teamId: TEAM_ID,
        trigger: 'manual_repair',
        scope: 'approval_projection',
        status: 'completed',
        inputFingerprint: 'scope-repair-approval-run',
        engineVersion: 'approval-projection-2026-06',
        completedAt: new Date('2026-06-20T10:00:00Z'),
      })
      .returning();
    if (!run) throw new Error('run seed failed');
    await (db as never as Db).insert(reconciliationOutputs).values({
      teamId: TEAM_ID,
      runId: run.id,
      clusterId,
      outputKind: 'approval_bundle',
      targetKind: 'task',
      operation: 'create',
      payload: {
        projection: 'agent_suggestions',
        suggestion_dedupe_key: 'scope-repair-approval',
        suggestion_source: 'background',
        suggestion_title: 'Create Acme rollout task',
        suggestion_summary: 'Recovered from scoped reconciliation.',
        item_dedupe_key: 'scope-repair-approval:item',
        title: 'Create Acme rollout task',
        proposed_payload: { canonicalName: 'Create Acme rollout task' },
      },
      authorityDecision: {
        decision: 'requires_approval',
        reason: 'test_scope_repair',
        policy_version: 'timeline-owned-approval-2026-06',
      },
      requiresApproval: true,
      sourceRefs: [{ source: 'email', rawEventId }],
      sourcePayloadRefs: ['s3://timeline-test/email/raw-message-1.eml'],
      visibility: 'team',
      visibilityFloor: 'team',
      dedupeKey: 'scope-repair-approval-output',
      status: 'pending',
    });

    const result = expectScopedResult(
      await processReconciliationJob(db as never, {
        kind: 'scope_reconcile',
        teamId: TEAM_ID,
        scope: 'object',
        targetId: objectId,
        triggeredBy: USER_ID,
        reason: 'admin_dashboard',
      }),
    );

    expect(result).toMatchObject({
      evidenceBackfilled: 1,
      projectionRepairCount: 1,
      outputCount: 1,
    });
    const evidenceRows = await db
      .select()
      .from(reconciliationEvidence)
      .where(eq(reconciliationEvidence.rawEventId, rawEventId));
    expect(evidenceRows).toHaveLength(1);
    expect(await db.select().from(agentSuggestions)).toHaveLength(1);
    expect(await db.select().from(agentSuggestionItems)).toHaveLength(1);
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

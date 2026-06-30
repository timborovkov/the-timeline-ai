import {
  type Db,
  artifactClusters,
  artifactEvidenceAssociations,
  entities,
  reconciliationOutputs,
  reconciliationRuns,
} from '@timeline/db';
import { childLogger, queue } from '@timeline/shared';
import { reconciliationDedupeKey } from '@timeline/shared/reconciliation';
import {
  auditReconciliationEvidenceCoverage,
  backfillReconciliationEvidence,
  isReconciliationEvidenceSource,
  type ReconciliationEvidenceSource,
} from '@timeline/shared/reconciliation/backfill';
import { Worker, type Job } from 'bullmq';
import { and, count, eq, or, sql } from 'drizzle-orm';

import { captureWorkerJobFailure } from '#src/monitoring.js';

const log = childLogger('worker:reconciliation');

type DbTx = Parameters<Parameters<Db['transaction']>[0]>[0];
type DbOrTx = Db | DbTx;

export type ReconciliationWorkerResult =
  | Awaited<ReturnType<typeof auditReconciliationEvidenceCoverage>>
  | Awaited<ReturnType<typeof backfillReconciliationEvidence>>
  | ScopeReconciliationResult;

interface ScopeReconciliationResult {
  teamId: string;
  scope: 'team' | 'object' | 'cluster';
  targetId: string | null;
  runId: string;
  status: 'completed';
  outputCount: number;
  associationCount: number;
  clusterCount: number;
}

const MANUAL_SCOPE_RECONCILIATION_VERSION = 'manual-scope-reconcile-2026-06';

export async function processReconciliationJob(
  db: Db,
  data: queue.ReconciliationJobData,
): Promise<ReconciliationWorkerResult> {
  if (data.kind === 'scope_reconcile') {
    return recordScopedReconciliationRun(db, data);
  }

  const source = sourceFromJob(data.source);
  if (data.kind === 'evidence_audit') {
    const input: Parameters<typeof auditReconciliationEvidenceCoverage>[0] = {
      db,
      teamId: data.teamId,
    };
    if (source) input.source = source;
    if (data.limit !== undefined) input.limit = data.limit;
    if (data.pageSize !== undefined) input.pageSize = data.pageSize;
    return auditReconciliationEvidenceCoverage(input);
  }

  const input: Parameters<typeof backfillReconciliationEvidence>[0] = {
    db,
    teamId: data.teamId,
    dryRun: data.dryRun ?? false,
    missingOnly: data.missingOnly ?? true,
  };
  if (source) input.source = source;
  if (data.limit !== undefined) input.limit = data.limit;
  if (data.pageSize !== undefined) input.pageSize = data.pageSize;
  return backfillReconciliationEvidence(input);
}

async function recordScopedReconciliationRun(
  db: Db,
  data: Extract<queue.ReconciliationJobData, { kind: 'scope_reconcile' }>,
): Promise<ScopeReconciliationResult> {
  const targetId = data.scope === 'team' ? null : requireTargetId(data);
  const inputFingerprint = reconciliationDedupeKey('manual-scope-reconcile-run', {
    teamId: data.teamId,
    scope: data.scope,
    targetId,
    triggeredBy: data.triggeredBy ?? 'manual',
    reason: data.reason ?? 'manual',
  });

  return db.transaction(async (tx) => {
    const lockKey = scopedReconciliationLockKey(data.teamId, data.scope, targetId);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);

    const metrics = await scopedReconciliationMetrics(tx, {
      teamId: data.teamId,
      scope: data.scope,
      targetId,
    });
    const now = new Date();
    const scope = targetId ? `${data.scope}:${targetId}` : 'team';
    const runMetrics = {
      ...metrics,
      target_id: targetId,
      triggered_by: data.triggeredBy ?? null,
      reason: data.reason ?? 'manual',
      output_count: metrics.outputCount,
      association_count: metrics.associationCount,
      cluster_count: metrics.clusterCount,
      lock_key: lockKey,
    };
    const [run] = await tx
      .insert(reconciliationRuns)
      .values({
        teamId: data.teamId,
        trigger: 'manual_repair',
        scope,
        status: 'completed',
        inputFingerprint,
        engineVersion: MANUAL_SCOPE_RECONCILIATION_VERSION,
        startedAt: now,
        completedAt: now,
        metrics: runMetrics,
      })
      .onConflictDoUpdate({
        target: [
          reconciliationRuns.teamId,
          reconciliationRuns.inputFingerprint,
          reconciliationRuns.engineVersion,
        ],
        set: {
          status: 'completed',
          startedAt: now,
          completedAt: now,
          errorCode: null,
          metrics: runMetrics,
        },
      })
      .returning({ id: reconciliationRuns.id });
    if (!run) throw new Error('Failed to record scoped reconciliation run');

    return {
      teamId: data.teamId,
      scope: data.scope,
      targetId,
      runId: run.id,
      status: 'completed',
      ...metrics,
    };
  });
}

function scopedReconciliationLockKey(
  teamId: string,
  scope: 'team' | 'object' | 'cluster',
  targetId: string | null,
): string {
  return `reconciliation:${teamId}:${scope}:${targetId ?? 'team'}`;
}

function requireTargetId(data: Extract<queue.ReconciliationJobData, { kind: 'scope_reconcile' }>) {
  if (data.targetId) return data.targetId;
  throw new Error(`Reconciliation ${data.scope} scope requires a target id`);
}

async function scopedReconciliationMetrics(
  db: DbOrTx,
  input: { teamId: string; scope: 'team' | 'object' | 'cluster'; targetId: string | null },
): Promise<Pick<ScopeReconciliationResult, 'outputCount' | 'associationCount' | 'clusterCount'>> {
  if (input.scope === 'team') {
    const [outputs, associations, clusters] = await Promise.all([
      countRows(
        db
          .select({ count: count() })
          .from(reconciliationOutputs)
          .where(eq(reconciliationOutputs.teamId, input.teamId)),
      ),
      countRows(
        db
          .select({ count: count() })
          .from(artifactEvidenceAssociations)
          .where(eq(artifactEvidenceAssociations.teamId, input.teamId)),
      ),
      countRows(
        db
          .select({ count: count() })
          .from(artifactClusters)
          .where(eq(artifactClusters.teamId, input.teamId)),
      ),
    ]);
    return { outputCount: outputs, associationCount: associations, clusterCount: clusters };
  }

  if (input.scope === 'cluster') {
    if (!input.targetId) throw new Error('Cluster scope requires a target id');
    await requireTeamCluster(db, input.teamId, input.targetId);
    const [outputs, associations] = await Promise.all([
      countRows(
        db
          .select({ count: count() })
          .from(reconciliationOutputs)
          .where(
            and(
              eq(reconciliationOutputs.teamId, input.teamId),
              eq(reconciliationOutputs.clusterId, input.targetId),
            ),
          ),
      ),
      countRows(
        db
          .select({ count: count() })
          .from(artifactEvidenceAssociations)
          .where(
            and(
              eq(artifactEvidenceAssociations.teamId, input.teamId),
              eq(artifactEvidenceAssociations.clusterId, input.targetId),
            ),
          ),
      ),
    ]);
    return { outputCount: outputs, associationCount: associations, clusterCount: 1 };
  }

  if (!input.targetId) throw new Error('Object scope requires a target id');
  await requireTeamObject(db, input.teamId, input.targetId);
  const clusterRows = await db
    .select({ id: artifactClusters.id })
    .from(artifactClusters)
    .where(
      and(
        eq(artifactClusters.teamId, input.teamId),
        eq(artifactClusters.canonicalEntityId, input.targetId),
      ),
    );
  const clusterIds = clusterRows.map((row) => row.id);
  const [targetOutputs, clusterOutputs, associations] = await Promise.all([
    countRows(
      db
        .select({ count: count() })
        .from(reconciliationOutputs)
        .where(
          and(
            eq(reconciliationOutputs.teamId, input.teamId),
            eq(reconciliationOutputs.targetId, input.targetId),
          ),
        ),
    ),
    clusterIds.length === 0
      ? Promise.resolve(0)
      : countRows(
          db
            .select({ count: count() })
            .from(reconciliationOutputs)
            .where(
              and(
                eq(reconciliationOutputs.teamId, input.teamId),
                or(...clusterIds.map((id) => eq(reconciliationOutputs.clusterId, id))),
              ),
            ),
        ),
    clusterIds.length === 0
      ? Promise.resolve(0)
      : countRows(
          db
            .select({ count: count() })
            .from(artifactEvidenceAssociations)
            .where(
              and(
                eq(artifactEvidenceAssociations.teamId, input.teamId),
                or(...clusterIds.map((id) => eq(artifactEvidenceAssociations.clusterId, id))),
              ),
            ),
        ),
  ]);
  return {
    outputCount: targetOutputs + clusterOutputs,
    associationCount: associations,
    clusterCount: clusterIds.length,
  };
}

async function requireTeamCluster(db: DbOrTx, teamId: string, clusterId: string): Promise<void> {
  const [cluster] = await db
    .select({ id: artifactClusters.id })
    .from(artifactClusters)
    .where(and(eq(artifactClusters.teamId, teamId), eq(artifactClusters.id, clusterId)))
    .limit(1);
  if (!cluster) throw new Error('Reconciliation cluster target was not found for this team');
}

async function requireTeamObject(db: DbOrTx, teamId: string, objectId: string): Promise<void> {
  const [object] = await db
    .select({ id: entities.id })
    .from(entities)
    .where(and(eq(entities.teamId, teamId), eq(entities.id, objectId)))
    .limit(1);
  if (!object) throw new Error('Reconciliation object target was not found for this team');
}

async function countRows(query: Promise<{ count: number }[]>): Promise<number> {
  const rows = await query;
  return rows[0]?.count ?? 0;
}

function sourceFromJob(source: string | undefined): ReconciliationEvidenceSource | undefined {
  if (source === undefined) return undefined;
  if (isReconciliationEvidenceSource(source)) return source;
  throw new Error(`Unknown reconciliation evidence source: ${source}`);
}

export function startReconciliationWorker(deps: { db: Db }): Worker<queue.ReconciliationJobData> {
  const worker = new Worker<queue.ReconciliationJobData>(
    queue.QUEUE_NAMES.reconciliation,
    async (job: Job<queue.ReconciliationJobData>) => {
      const startedAt = Date.now();
      const result = await processReconciliationJob(deps.db, job.data);
      const durationMs = Date.now() - startedAt;
      log.info(
        {
          jobId: job.id,
          kind: job.data.kind,
          teamId: job.data.teamId,
          scope: reconciliationJobLogScope(job.data),
          durationMs,
          result,
        },
        'reconciliation job completed',
      );
      return { ...result, durationMs };
    },
    { connection: queue.getRedisConnection(), concurrency: 1 },
  );

  worker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, err }, 'reconciliation job failed');
    captureWorkerJobFailure(err, job);
  });

  return worker;
}

function reconciliationJobLogScope(data: queue.ReconciliationJobData): string {
  if (data.kind === 'scope_reconcile') {
    return data.targetId ? `${data.scope}:${data.targetId}` : data.scope;
  }
  return data.source ?? 'all';
}

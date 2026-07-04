import {
  type Db,
  artifactClusterAnchors,
  artifactClusters,
  artifactEvidenceAssociations,
  entities,
  rawEvents,
  reconciliationEvidence,
  reconciliationOutputs,
  reconciliationRuns,
} from '@timeline/db';
import { childLogger, queue, withTeam } from '@timeline/shared';
import { reconciliationDedupeKey } from '@timeline/shared/reconciliation';
import {
  auditReconciliationEvidenceCoverage,
  backfillReconciliationEvidence,
  isReconciliationEvidenceSource,
  type ReconciliationEvidenceSource,
} from '@timeline/shared/reconciliation/backfill';
import { normalizeRawEventsToEvidence } from '@timeline/shared/reconciliation/normalization';
import { resolveEvidenceAssociations } from '@timeline/shared/reconciliation/resolver';
import { Worker, type Job } from 'bullmq';
import { and, count, eq, inArray, or, sql } from 'drizzle-orm';

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
  evidenceBackfilled: number;
  associationRepairCount: number;
  projectionRepairCount: number;
}

const MANUAL_SCOPE_RECONCILIATION_VERSION = 'manual-scope-reconcile-2026-06';
const EVIDENCE_AUDIT_RUN_VERSION = 'reconciliation-evidence-audit-2026-07';
const EVIDENCE_BACKFILL_RUN_VERSION = 'reconciliation-evidence-backfill-2026-07';

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
    if (data.triggeredBy !== undefined) input.viewerUserId = data.triggeredBy;
    if (source) input.source = source;
    if (data.limit !== undefined) input.limit = data.limit;
    if (data.pageSize !== undefined) input.pageSize = data.pageSize;
    const report = await auditReconciliationEvidenceCoverage(input);
    const runId = await recordEvidenceAuditRun(db, data, report);
    return { ...report, runId };
  }

  const input: Parameters<typeof backfillReconciliationEvidence>[0] = {
    db,
    teamId: data.teamId,
    dryRun: data.dryRun ?? false,
    missingOnly: data.missingOnly ?? true,
  };
  if (data.triggeredBy !== undefined) input.viewerUserId = data.triggeredBy;
  if (source) input.source = source;
  if (data.limit !== undefined) input.limit = data.limit;
  if (data.pageSize !== undefined) input.pageSize = data.pageSize;
  const result = await backfillReconciliationEvidence(input);
  const runId = await recordEvidenceBackfillRun(db, data, result);
  return { ...result, runId };
}

async function recordEvidenceAuditRun(
  db: Db,
  data: Extract<queue.ReconciliationJobData, { kind: 'evidence_audit' }>,
  report: Awaited<ReturnType<typeof auditReconciliationEvidenceCoverage>>,
): Promise<string> {
  const source = data.source ?? 'all';
  const inputFingerprint = reconciliationDedupeKey('evidence-audit-run', {
    teamId: data.teamId,
    source,
    limit: data.limit ?? 'all',
    pageSize: data.pageSize ?? 'default',
    triggeredBy: data.triggeredBy ?? 'manual',
  });
  const metrics = {
    mode: 'audit',
    source,
    triggered_by: data.triggeredBy ?? null,
    total_raw_events: report.totalRawEvents,
    normalized_raw_events: report.normalizedRawEvents,
    missing_raw_events: report.missingRawEvents,
    full_replay_evidence: report.fullReplayEvidence,
    degraded_replay_evidence: report.degradedReplayEvidence,
    release_gate_passed: report.releaseGate.passed,
    release_gate_failure_count: report.releaseGate.failureCount,
    release_gate_failures: report.releaseGate.failures,
  };
  return recordCompletedOperatorRun(db, {
    teamId: data.teamId,
    scope: `evidence_audit:${source}`,
    inputFingerprint,
    engineVersion: EVIDENCE_AUDIT_RUN_VERSION,
    metrics,
  });
}

async function recordEvidenceBackfillRun(
  db: Db,
  data: Extract<queue.ReconciliationJobData, { kind: 'evidence_backfill' }>,
  result: Awaited<ReturnType<typeof backfillReconciliationEvidence>>,
): Promise<string> {
  const source = data.source ?? 'all';
  const inputFingerprint = reconciliationDedupeKey('evidence-backfill-run', {
    teamId: data.teamId,
    source,
    limit: data.limit ?? 'all',
    pageSize: data.pageSize ?? 'default',
    dryRun: data.dryRun ?? false,
    missingOnly: data.missingOnly ?? true,
    triggeredBy: data.triggeredBy ?? 'manual',
  });
  const metrics = {
    mode: 'backfill',
    source,
    triggered_by: data.triggeredBy ?? null,
    dry_run: result.dryRun,
    missing_only: result.missingOnly,
    scanned_raw_events: result.scannedRawEvents,
    candidate_raw_events: result.candidateRawEvents,
    normalized_evidence: result.normalizedEvidence,
  };
  return recordCompletedOperatorRun(db, {
    teamId: data.teamId,
    scope: `evidence_backfill:${source}`,
    inputFingerprint,
    engineVersion: EVIDENCE_BACKFILL_RUN_VERSION,
    metrics,
  });
}

async function recordCompletedOperatorRun(
  db: Db,
  input: {
    teamId: string;
    scope: string;
    inputFingerprint: string;
    engineVersion: string;
    metrics: Record<string, unknown>;
  },
): Promise<string> {
  const now = new Date();
  const [run] = await db
    .insert(reconciliationRuns)
    .values({
      teamId: input.teamId,
      trigger: 'backfill',
      scope: input.scope,
      status: 'completed',
      inputFingerprint: input.inputFingerprint,
      engineVersion: input.engineVersion,
      startedAt: now,
      completedAt: now,
      metrics: input.metrics,
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
        metrics: input.metrics,
      },
    })
    .returning({ id: reconciliationRuns.id });
  if (!run) throw new Error('Failed to record reconciliation operator run');
  return run.id;
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

    const repair = await repairScopedReconciliation(tx, data, targetId);
    const metrics = await scopedReconciliationMetrics(tx, {
      teamId: data.teamId,
      scope: data.scope,
      targetId,
    });
    const now = new Date();
    const scope = targetId ? `${data.scope}:${targetId}` : 'team';
    const runMetrics = {
      mode: 'manual_repair',
      ...metrics,
      target_id: targetId,
      triggered_by: data.triggeredBy ?? null,
      reason: data.reason ?? 'manual',
      output_count: metrics.outputCount,
      association_count: metrics.associationCount,
      cluster_count: metrics.clusterCount,
      evidence_backfilled: repair.evidenceBackfilled,
      association_repair_count: repair.associationRepairCount,
      projection_repair_count: repair.projectionRepairCount,
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
      ...repair,
      ...metrics,
    };
  });
}

async function repairScopedReconciliation(
  db: DbOrTx,
  data: Extract<queue.ReconciliationJobData, { kind: 'scope_reconcile' }>,
  targetId: string | null,
): Promise<
  Pick<
    ScopeReconciliationResult,
    'evidenceBackfilled' | 'associationRepairCount' | 'projectionRepairCount'
  >
> {
  if (data.scope === 'team') {
    const result = await backfillReconciliationEvidence({
      db,
      teamId: data.teamId,
      missingOnly: true,
      ...(data.triggeredBy === undefined ? {} : { viewerUserId: data.triggeredBy }),
    });
    const associationRepairCount = await repairScopedEvidenceGraph(db, data, targetId);
    const projectionRepairCount = await repairScopedApprovalProjections(db, data, targetId);
    return {
      evidenceBackfilled: result.normalizedEvidence,
      associationRepairCount,
      projectionRepairCount,
    };
  }

  const rawEventIds = await scopedRawEventIds(db, {
    teamId: data.teamId,
    scope: data.scope,
    targetId,
    ...(data.triggeredBy === undefined ? {} : { viewerUserId: data.triggeredBy }),
  });
  const evidenceBackfilled =
    rawEventIds.length === 0
      ? 0
      : (
          await normalizeRawEventsToEvidence({
            db,
            teamId: data.teamId,
            rawEventIds,
          })
        ).length;
  const associationRepairCount = await repairScopedEvidenceGraph(db, data, targetId, rawEventIds);
  const projectionRepairCount = await repairScopedApprovalProjections(db, data, targetId);
  return { evidenceBackfilled, associationRepairCount, projectionRepairCount };
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

async function scopedClusterIds(
  db: DbOrTx,
  input: { teamId: string; scope: 'object' | 'cluster'; targetId: string | null },
): Promise<string[]> {
  if (input.scope === 'cluster') {
    if (!input.targetId) throw new Error('Cluster scope requires a target id');
    await requireTeamCluster(db, input.teamId, input.targetId);
    return [input.targetId];
  }

  if (!input.targetId) throw new Error('Object scope requires a target id');
  await requireTeamObject(db, input.teamId, input.targetId);
  const rows = await db
    .select({ id: artifactClusters.id })
    .from(artifactClusters)
    .where(
      and(
        eq(artifactClusters.teamId, input.teamId),
        eq(artifactClusters.canonicalEntityId, input.targetId),
      ),
    );
  return rows.map((row) => row.id);
}

async function teamClusterIds(db: DbOrTx, teamId: string): Promise<string[]> {
  const rows = await db
    .select({ id: artifactClusters.id })
    .from(artifactClusters)
    .where(eq(artifactClusters.teamId, teamId));
  return rows.map((row) => row.id);
}

async function scopedRawEventIds(
  db: DbOrTx,
  input: {
    teamId: string;
    scope: 'object' | 'cluster';
    targetId: string | null;
    viewerUserId?: string;
  },
): Promise<string[]> {
  const clusterIds = await scopedClusterIds(db, {
    teamId: input.teamId,
    scope: input.scope,
    targetId: input.targetId,
  });
  const entityIds = await scopedEntityIdsForRawEventLinks(db, {
    teamId: input.teamId,
    scope: input.scope,
    targetId: input.targetId,
    clusterIds,
  });

  const [associationRows, outputRows, entityRawEventRows] = await Promise.all([
    clusterIds.length === 0
      ? Promise.resolve([])
      : db
          .select({
            rawEventId: sql<string>`COALESCE(${artifactEvidenceAssociations.rawEventId}, ${reconciliationEvidence.rawEventId})`,
          })
          .from(artifactEvidenceAssociations)
          .innerJoin(
            reconciliationEvidence,
            and(
              eq(reconciliationEvidence.id, artifactEvidenceAssociations.evidenceId),
              eq(reconciliationEvidence.teamId, input.teamId),
            ),
          )
          .where(
            and(
              eq(artifactEvidenceAssociations.teamId, input.teamId),
              inArray(artifactEvidenceAssociations.clusterId, clusterIds),
            ),
          ),
    clusterIds.length === 0
      ? Promise.resolve([])
      : db
          .select({ sourceRefs: reconciliationOutputs.sourceRefs })
          .from(reconciliationOutputs)
          .where(
            and(
              eq(reconciliationOutputs.teamId, input.teamId),
              inArray(reconciliationOutputs.clusterId, clusterIds),
            ),
          ),
    entityIds.length === 0
      ? Promise.resolve([])
      : db
          .select({ rawEventId: rawEvents.id })
          .from(rawEvents)
          .where(
            and(
              eq(rawEvents.teamId, input.teamId),
              inArray(sql`${rawEvents.sourceMetadata} ->> 'entity_id'`, entityIds),
            ),
          ),
  ]);

  const rawEventIds = [
    ...new Set([
      ...associationRows
        .map((row) => row.rawEventId)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
      ...outputRows.flatMap((row) => rawEventIdsFromSourceRefs(row.sourceRefs)),
      ...entityRawEventRows.map((row) => row.rawEventId),
    ]),
  ].sort();
  return filterVisibleRawEventIds(db, {
    teamId: input.teamId,
    rawEventIds,
    ...(input.viewerUserId === undefined ? {} : { viewerUserId: input.viewerUserId }),
  });
}

async function filterVisibleRawEventIds(
  db: DbOrTx,
  input: { teamId: string; rawEventIds: string[]; viewerUserId?: string },
): Promise<string[]> {
  if (!input.viewerUserId || input.rawEventIds.length === 0) return input.rawEventIds;
  const rows = await db
    .select({ id: rawEvents.id })
    .from(rawEvents)
    .where(
      and(
        eq(rawEvents.teamId, input.teamId),
        inArray(rawEvents.id, input.rawEventIds),
        rawEventVisibleToUserPredicate(input.viewerUserId),
      ),
    );
  const visible = new Set(rows.map((row) => row.id));
  return input.rawEventIds.filter((id) => visible.has(id));
}

function rawEventVisibleToUserPredicate(userId: string) {
  return or(
    eq(rawEvents.visibility, 'team'),
    and(eq(rawEvents.visibility, 'private'), eq(rawEvents.visibilityOwnerUserId, userId)),
    and(
      eq(rawEvents.visibility, 'specific_users'),
      sql`${userId}::uuid = ANY(${rawEvents.visibilityUserIds})`,
    ),
  );
}

async function repairScopedEvidenceGraph(
  db: DbOrTx,
  data: Extract<queue.ReconciliationJobData, { kind: 'scope_reconcile' }>,
  targetId: string | null,
  rawEventIds?: string[],
): Promise<number> {
  await ensureScopedObjectAnchors(db, {
    teamId: data.teamId,
    scope: data.scope,
    targetId,
  });
  const evidenceIds = await scopedEvidenceIds(db, {
    teamId: data.teamId,
    scope: data.scope,
    targetId,
    ...(rawEventIds === undefined ? {} : { rawEventIds }),
  });
  if (evidenceIds.length === 0) return 0;

  const result = await resolveEvidenceAssociations({
    db,
    teamId: data.teamId,
    evidenceIds,
  });
  return result.associated.length;
}

async function ensureScopedObjectAnchors(
  db: DbOrTx,
  input: { teamId: string; scope: 'team' | 'object' | 'cluster'; targetId: string | null },
): Promise<void> {
  const clusterIds =
    input.scope === 'team'
      ? await teamClusterIds(db, input.teamId)
      : await scopedClusterIds(db, {
          teamId: input.teamId,
          scope: input.scope,
          targetId: input.targetId,
        });
  if (input.scope !== 'team' && clusterIds.length === 0) return;

  const rows = await db
    .select({
      clusterId: artifactClusters.id,
      canonicalEntityId: artifactClusters.canonicalEntityId,
    })
    .from(artifactClusters)
    .where(
      and(
        eq(artifactClusters.teamId, input.teamId),
        input.scope === 'team'
          ? sql`${artifactClusters.canonicalEntityId} IS NOT NULL`
          : inArray(artifactClusters.id, clusterIds),
      ),
    );
  const values = rows
    .filter((row): row is { clusterId: string; canonicalEntityId: string } =>
      Boolean(row.canonicalEntityId),
    )
    .map((row) => ({
      teamId: input.teamId,
      clusterId: row.clusterId,
      anchorType: 'object',
      anchorValue: row.canonicalEntityId,
      strength: 'structured' as const,
      metadata: {
        source: 'manual_scope_reconcile',
        reason: 'canonical_entity_id',
      },
    }));
  if (values.length === 0) return;

  await db.insert(artifactClusterAnchors).values(values).onConflictDoNothing();
}

async function scopedEvidenceIds(
  db: DbOrTx,
  input: {
    teamId: string;
    scope: 'team' | 'object' | 'cluster';
    targetId: string | null;
    rawEventIds?: string[];
  },
): Promise<string[]> {
  if (input.scope !== 'team' && (input.rawEventIds?.length ?? 0) === 0) return [];

  const rows = await db
    .select({ id: reconciliationEvidence.id })
    .from(reconciliationEvidence)
    .where(
      and(
        eq(reconciliationEvidence.teamId, input.teamId),
        input.scope === 'team'
          ? sql`TRUE`
          : inArray(reconciliationEvidence.rawEventId, input.rawEventIds ?? []),
      ),
    );
  return [...new Set(rows.map((row) => row.id))].sort();
}

async function scopedEntityIdsForRawEventLinks(
  db: DbOrTx,
  input: {
    teamId: string;
    scope: 'object' | 'cluster';
    targetId: string | null;
    clusterIds: string[];
  },
): Promise<string[]> {
  if (input.scope === 'object') {
    if (!input.targetId) throw new Error('Object scope requires a target id');
    return [input.targetId];
  }
  if (input.clusterIds.length === 0) return [];
  const rows = await db
    .select({ entityId: artifactClusters.canonicalEntityId })
    .from(artifactClusters)
    .where(
      and(
        eq(artifactClusters.teamId, input.teamId),
        inArray(artifactClusters.id, input.clusterIds),
        sql`${artifactClusters.canonicalEntityId} IS NOT NULL`,
      ),
    );
  return [
    ...new Set(
      rows
        .map((row) => row.entityId)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    ),
  ].sort();
}

async function repairScopedApprovalProjections(
  db: DbOrTx,
  data: Extract<queue.ReconciliationJobData, { kind: 'scope_reconcile' }>,
  targetId: string | null,
): Promise<number> {
  if (!data.triggeredBy) return 0;
  const outputIds = await scopedRepairableApprovalOutputIds(db, data, targetId);
  if (outputIds.length === 0) return 0;

  const scope = withTeam(db as never, data.teamId, data.triggeredBy);
  let repaired = 0;
  for (const outputId of outputIds) {
    const bundle = await scope.suggestions.repairApprovalProjectionForOutput(outputId);
    if (bundle) repaired += 1;
  }
  return repaired;
}

async function scopedRepairableApprovalOutputIds(
  db: DbOrTx,
  data: Extract<queue.ReconciliationJobData, { kind: 'scope_reconcile' }>,
  targetId: string | null,
): Promise<string[]> {
  const base = [
    eq(reconciliationOutputs.teamId, data.teamId),
    eq(reconciliationOutputs.outputKind, 'approval_bundle'),
    eq(reconciliationOutputs.requiresApproval, true),
    inArray(reconciliationOutputs.status, ['pending', 'approval_created', 'failed'] as const),
  ];

  if (data.scope === 'team') {
    const rows = await db
      .select({ id: reconciliationOutputs.id })
      .from(reconciliationOutputs)
      .where(and(...base));
    return rows.map((row) => row.id);
  }

  const clusterIds = await scopedClusterIds(db, {
    teamId: data.teamId,
    scope: data.scope,
    targetId,
  });
  const scopePredicates =
    data.scope === 'object' && targetId
      ? [
          eq(reconciliationOutputs.targetId, targetId),
          ...(clusterIds.length > 0 ? [inArray(reconciliationOutputs.clusterId, clusterIds)] : []),
        ]
      : clusterIds.length > 0
        ? [inArray(reconciliationOutputs.clusterId, clusterIds)]
        : [];
  if (scopePredicates.length === 0) return [];

  const rows = await db
    .select({ id: reconciliationOutputs.id })
    .from(reconciliationOutputs)
    .where(and(...base, or(...scopePredicates)));
  return rows.map((row) => row.id);
}

function rawEventIdsFromSourceRefs(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) =>
      entry && typeof entry === 'object' && !Array.isArray(entry)
        ? (entry as { rawEventId?: unknown }).rawEventId
        : null,
    )
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
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
  const [targetOutputRows, clusterOutputRows, associations] = await Promise.all([
    db
      .select({ id: reconciliationOutputs.id })
      .from(reconciliationOutputs)
      .where(
        and(
          eq(reconciliationOutputs.teamId, input.teamId),
          eq(reconciliationOutputs.targetId, input.targetId),
        ),
      ),
    clusterIds.length === 0
      ? Promise.resolve([])
      : db
          .select({ id: reconciliationOutputs.id })
          .from(reconciliationOutputs)
          .where(
            and(
              eq(reconciliationOutputs.teamId, input.teamId),
              or(...clusterIds.map((id) => eq(reconciliationOutputs.clusterId, id))),
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
  const outputIds = new Set([
    ...targetOutputRows.map((row) => row.id),
    ...clusterOutputRows.map((row) => row.id),
  ]);
  return {
    outputCount: outputIds.size,
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

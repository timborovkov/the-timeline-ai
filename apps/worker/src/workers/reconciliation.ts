import {
  type Db,
  artifactClusterAnchors,
  artifactClusters,
  artifactEvidenceAssociations,
  entities,
  rawEvents,
  reconciliationEvidence,
  reconciliationEvidenceAnchors,
  reconciliationOutputs,
  reconciliationRuns,
} from '@timeline/db';
import { childLogger, queue, withTeam } from '@timeline/shared';
import {
  buildAssociationDedupeKey,
  buildOutputDedupeKey,
  reconciliationDedupeKey,
  type SourceRef,
} from '@timeline/shared/reconciliation';
import {
  auditReconciliationEvidenceCoverage,
  backfillReconciliationEvidence,
  isReconciliationEvidenceSource,
  type ReconciliationEvidenceSource,
} from '@timeline/shared/reconciliation/backfill';
import { normalizeRawEventsToEvidence } from '@timeline/shared/reconciliation/normalization';
import { resolveEvidenceAssociations } from '@timeline/shared/reconciliation/resolver';
import { rawEventVisibleToUser } from '@timeline/shared/visibility';
import { Worker, type Job } from 'bullmq';
import { and, count, desc, eq, gte, inArray, lte, or, sql, type SQL } from 'drizzle-orm';

import { withWorkerAiBilling } from '#src/billing-context.js';
import { captureWorkerJobFailure } from '#src/monitoring.js';

const log = childLogger('worker:reconciliation');

type DbTx = Parameters<Parameters<Db['transaction']>[0]>[0];
type DbOrTx = Db | DbTx;

export type ReconciliationWorkerResult =
  | Awaited<ReturnType<typeof auditReconciliationEvidenceCoverage>>
  | Awaited<ReturnType<typeof backfillReconciliationEvidence>>
  | ScopeReconciliationResult;

export interface ReconciliationWorkerIO {
  enqueueSuggestionJob?: typeof queue.enqueueSuggestionJob;
}

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
  outputRepairCount: number;
  projectionRepairCount: number;
  plannerReplayEnqueued: number;
}

interface ScopeReconciliationRepairResult extends Pick<
  ScopeReconciliationResult,
  'evidenceBackfilled' | 'associationRepairCount' | 'projectionRepairCount' | 'outputRepairCount'
> {
  plannerReplayRawEventIds: string[];
}

type ScopedContextRepairCount = Pick<
  ScopeReconciliationResult,
  'associationRepairCount' | 'outputRepairCount'
>;

interface ScopedContextEvidence {
  id: string;
  rawEventId: string;
  sourcePayloadRef: string | null;
  source: string;
  provider: string | null;
  eventType: string;
  visibility: 'team' | 'private' | 'specific_users';
  visibilityOwnerUserId: string | null;
  visibilityUserIds: string[] | null;
}

const MANUAL_SCOPE_RECONCILIATION_VERSION = 'manual-scope-reconcile-2026-06';
const EVIDENCE_AUDIT_RUN_VERSION = 'reconciliation-evidence-audit-2026-07';
const EVIDENCE_BACKFILL_RUN_VERSION = 'reconciliation-evidence-backfill-2026-07';
const DEFAULT_TEAM_PLANNER_REPLAY_LIMIT = 100;
const SCOPED_RAW_EVENT_CANDIDATE_LIMIT = 500;
const SCOPED_CONTEXT_ASSOCIATION_POLICY_VERSION = 'manual-scope-context-2026-07';
const SCOPED_CONTEXT_PLANNER_VERSION = 'manual-scope-context-planner-2026-07';
const SCOPED_CONTEXT_RUN_VERSION = 'manual-scope-context-run-2026-07';
const EMPTY_SCOPED_CONTEXT_REPAIR: ScopedContextRepairCount = {
  associationRepairCount: 0,
  outputRepairCount: 0,
};

interface PlannerReplayFilters {
  limit?: number;
  mode?: 'missing' | 'all';
  source?: ReconciliationEvidenceSource;
  occurredAfter?: Date;
  occurredBefore?: Date;
}

export async function processReconciliationJob(
  db: Db,
  data: queue.ReconciliationJobData,
  io: ReconciliationWorkerIO = {},
): Promise<ReconciliationWorkerResult> {
  if (data.kind === 'scope_reconcile') {
    return recordScopedReconciliationRun(db, data, io);
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
  io: ReconciliationWorkerIO,
): Promise<ScopeReconciliationResult> {
  const targetId = data.scope === 'team' ? null : requireTargetId(data);
  const inputFingerprint = reconciliationDedupeKey('manual-scope-reconcile-run', {
    teamId: data.teamId,
    scope: data.scope,
    targetId,
    triggeredBy: data.triggeredBy ?? 'manual',
    reason: data.reason ?? 'manual',
  });

  const repaired = await db.transaction(async (tx) => {
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
      output_repair_count: repair.outputRepairCount,
      projection_repair_count: repair.projectionRepairCount,
      planner_replay_enqueued: 0,
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

    return { repair, metrics, runMetrics, runId: run.id };
  });

  const plannerReplayEnqueued = await enqueueScopedPlannerReplay(io, {
    teamId: data.teamId,
    scope: data.scope,
    targetId,
    rawEventIds: repaired.repair.plannerReplayRawEventIds,
    reason: data.reason ?? 'manual',
  });
  const runMetrics = { ...repaired.runMetrics, planner_replay_enqueued: plannerReplayEnqueued };
  await db
    .update(reconciliationRuns)
    .set({ metrics: runMetrics })
    .where(eq(reconciliationRuns.id, repaired.runId));

  return {
    teamId: data.teamId,
    scope: data.scope,
    targetId,
    runId: repaired.runId,
    status: 'completed',
    ...repaired.metrics,
    evidenceBackfilled: repaired.repair.evidenceBackfilled,
    associationRepairCount: repaired.repair.associationRepairCount,
    outputRepairCount: repaired.repair.outputRepairCount,
    projectionRepairCount: repaired.repair.projectionRepairCount,
    plannerReplayEnqueued,
  };
}

async function repairScopedReconciliation(
  db: DbOrTx,
  data: Extract<queue.ReconciliationJobData, { kind: 'scope_reconcile' }>,
  targetId: string | null,
): Promise<ScopeReconciliationRepairResult> {
  if (data.scope === 'team') {
    const result = await backfillReconciliationEvidence({
      db,
      teamId: data.teamId,
      missingOnly: true,
      ...(data.triggeredBy === undefined ? {} : { viewerUserId: data.triggeredBy }),
    });
    const evidenceGraphRepair = await repairScopedEvidenceGraph(db, data, targetId);
    const projectionRepairCount = await repairScopedApprovalProjections(db, data, targetId);
    const plannerReplayRawEventIds = await teamPlannerReplayRawEventIds(db, {
      teamId: data.teamId,
      ...plannerReplayFiltersFromJob(data),
      ...(data.triggeredBy === undefined ? {} : { viewerUserId: data.triggeredBy }),
    });
    return {
      evidenceBackfilled: result.normalizedEvidence,
      associationRepairCount: evidenceGraphRepair.associationRepairCount,
      outputRepairCount: evidenceGraphRepair.outputRepairCount,
      projectionRepairCount,
      plannerReplayRawEventIds,
    };
  }

  await ensureScopedObjectAnchors(db, {
    teamId: data.teamId,
    scope: data.scope,
    targetId,
  });
  const rawEventIds = await scopedRawEventIds(db, {
    teamId: data.teamId,
    scope: data.scope,
    targetId,
    ...(data.triggeredBy === undefined ? {} : { viewerUserId: data.triggeredBy }),
  });
  const evidenceBefore = await evidenceCountForRawEvents(db, data.teamId, rawEventIds);
  if (rawEventIds.length > 0) {
    await normalizeRawEventsToEvidence({
      db,
      teamId: data.teamId,
      rawEventIds,
    });
  }
  const evidenceAfter = await evidenceCountForRawEvents(db, data.teamId, rawEventIds);
  const evidenceBackfilled = Math.max(0, evidenceAfter - evidenceBefore);
  const evidenceGraphRepair = await repairScopedEvidenceGraph(db, data, targetId, rawEventIds);
  const projectionRepairCount = await repairScopedApprovalProjections(db, data, targetId);
  const plannerReplayRawEventIds = await filterPlannerReplayRawEventIds(db, {
    teamId: data.teamId,
    rawEventIds,
    ...plannerReplayFiltersFromJob(data),
  });
  return {
    evidenceBackfilled,
    associationRepairCount: evidenceGraphRepair.associationRepairCount,
    outputRepairCount: evidenceGraphRepair.outputRepairCount,
    projectionRepairCount,
    plannerReplayRawEventIds,
  };
}

async function teamPlannerReplayRawEventIds(
  db: DbOrTx,
  input: { teamId: string; viewerUserId?: string } & PlannerReplayFilters,
): Promise<string[]> {
  const limit = plannerReplayLimit(input.limit);
  if (limit === 0) return [];
  const rows = await db
    .select({ id: rawEvents.id })
    .from(rawEvents)
    .where(
      and(
        eq(rawEvents.teamId, input.teamId),
        sql`${rawEvents.contentText} IS NOT NULL`,
        sql`length(trim(${rawEvents.contentText})) > 0`,
        ...plannerReplayWhereFilters(input),
        ...(input.viewerUserId === undefined ? [] : [rawEventVisibleToUser(input.viewerUserId)]),
      ),
    )
    .orderBy(desc(rawEvents.occurredAt), desc(rawEvents.id))
    .limit(limit);
  return rows.map((row) => row.id);
}

async function filterPlannerReplayRawEventIds(
  db: DbOrTx,
  input: { teamId: string; rawEventIds: string[] } & PlannerReplayFilters,
): Promise<string[]> {
  const limit = plannerReplayLimit(input.limit);
  if (limit === 0 || input.rawEventIds.length === 0) return [];
  const rows = await db
    .select({ id: rawEvents.id })
    .from(rawEvents)
    .where(
      and(
        eq(rawEvents.teamId, input.teamId),
        inArray(rawEvents.id, input.rawEventIds),
        sql`${rawEvents.contentText} IS NOT NULL`,
        sql`length(trim(${rawEvents.contentText})) > 0`,
        ...plannerReplayWhereFilters(input),
      ),
    )
    .orderBy(desc(rawEvents.occurredAt), desc(rawEvents.id))
    .limit(limit);
  return rows.map((row) => row.id);
}

function plannerReplayWhereFilters(input: PlannerReplayFilters) {
  return [
    ...(input.mode === 'all'
      ? []
      : [
          sql`${rawEvents.sourceMetadata} ->> 'suggestion_model_version' IS NULL`,
          sql`${rawEvents.sourceMetadata} ->> 'suggestion_pre_extract_model_version' IS NULL`,
        ]),
    ...(input.source === undefined ? [] : [eq(rawEvents.source, input.source)]),
    ...(input.occurredAfter === undefined ? [] : [gte(rawEvents.occurredAt, input.occurredAfter)]),
    ...(input.occurredBefore === undefined
      ? []
      : [lte(rawEvents.occurredAt, input.occurredBefore)]),
  ];
}

function plannerReplayFiltersFromJob(
  data: Extract<queue.ReconciliationJobData, { kind: 'scope_reconcile' }>,
): PlannerReplayFilters {
  const filters: PlannerReplayFilters = {
    limit: data.plannerReplayLimit ?? DEFAULT_TEAM_PLANNER_REPLAY_LIMIT,
    mode: data.plannerReplayMode ?? 'missing',
  };
  if (data.plannerReplaySource !== undefined) {
    const source = sourceFromJob(data.plannerReplaySource);
    if (source !== undefined) filters.source = source;
  }
  if (data.plannerReplayOccurredAfter !== undefined) {
    filters.occurredAfter = plannerReplayDate(data.plannerReplayOccurredAfter);
  }
  if (data.plannerReplayOccurredBefore !== undefined) {
    filters.occurredBefore = plannerReplayDate(data.plannerReplayOccurredBefore);
  }
  return filters;
}

function plannerReplayLimit(limit: number | undefined): number {
  return Math.max(0, Math.min(limit ?? DEFAULT_TEAM_PLANNER_REPLAY_LIMIT, 1000));
}

function plannerReplayDate(value: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid planner replay date filter: ${value}`);
  return date;
}

async function enqueueScopedPlannerReplay(
  io: ReconciliationWorkerIO,
  input: {
    teamId: string;
    scope: 'team' | 'object' | 'cluster';
    targetId: string | null;
    rawEventIds: string[];
    reason: string;
  },
): Promise<number> {
  const enqueueSuggestionJob = io.enqueueSuggestionJob ?? queue.enqueueSuggestionJob;
  const jobIdSuffix = `manual-reconcile:${input.scope}:${input.targetId ?? 'team'}:${input.reason}`;
  let enqueued = 0;
  for (const rawEventId of input.rawEventIds) {
    const result = await enqueueSuggestionJob(
      {
        rawEventId,
        teamId: input.teamId,
      },
      { jobIdSuffix },
    );
    if (result.enqueued) enqueued += 1;
  }
  return enqueued;
}

async function evidenceCountForRawEvents(
  db: DbOrTx,
  teamId: string,
  rawEventIds: string[],
): Promise<number> {
  if (rawEventIds.length === 0) return 0;
  return countRows(
    db
      .select({ count: count() })
      .from(reconciliationEvidence)
      .where(
        and(
          eq(reconciliationEvidence.teamId, teamId),
          inArray(reconciliationEvidence.rawEventId, rawEventIds),
        ),
      ),
  );
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
  const mentionNames = await scopedRawEventMentionNames(db, {
    teamId: input.teamId,
    clusterIds,
    entityIds,
  });

  const [
    associationRows,
    outputRows,
    entityRawEventRows,
    anchorMatchedRawEventRows,
    mentionedRawEventRows,
  ] = await Promise.all([
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
    clusterIds.length === 0
      ? Promise.resolve([])
      : db
          .select({ rawEventId: reconciliationEvidence.rawEventId })
          .from(artifactClusterAnchors)
          .innerJoin(
            reconciliationEvidenceAnchors,
            and(
              eq(reconciliationEvidenceAnchors.teamId, input.teamId),
              eq(reconciliationEvidenceAnchors.anchorType, artifactClusterAnchors.anchorType),
              eq(reconciliationEvidenceAnchors.anchorValue, artifactClusterAnchors.anchorValue),
            ),
          )
          .innerJoin(
            reconciliationEvidence,
            and(
              eq(reconciliationEvidence.teamId, input.teamId),
              eq(reconciliationEvidence.id, reconciliationEvidenceAnchors.evidenceId),
            ),
          )
          .where(
            and(
              eq(artifactClusterAnchors.teamId, input.teamId),
              inArray(artifactClusterAnchors.clusterId, clusterIds),
            ),
          ),
    mentionNames.length === 0
      ? Promise.resolve([])
      : db
          .select({ rawEventId: rawEvents.id })
          .from(rawEvents)
          .where(
            and(eq(rawEvents.teamId, input.teamId), scopedRawEventMentionPredicate(mentionNames)),
          )
          .orderBy(desc(rawEvents.occurredAt), desc(rawEvents.id))
          .limit(SCOPED_RAW_EVENT_CANDIDATE_LIMIT),
  ]);

  const rawEventIds = [
    ...new Set([
      ...associationRows
        .map((row) => row.rawEventId)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
      ...outputRows.flatMap((row) => rawEventIdsFromSourceRefs(row.sourceRefs)),
      ...entityRawEventRows.map((row) => row.rawEventId),
      ...anchorMatchedRawEventRows.map((row) => row.rawEventId),
      ...mentionedRawEventRows.map((row) => row.rawEventId),
    ]),
  ].sort();
  return filterVisibleRawEventIds(db, {
    teamId: input.teamId,
    rawEventIds,
    ...(input.viewerUserId === undefined ? {} : { viewerUserId: input.viewerUserId }),
  });
}

async function scopedRawEventMentionNames(
  db: DbOrTx,
  input: {
    teamId: string;
    clusterIds: string[];
    entityIds: string[];
  },
): Promise<string[]> {
  const [entityRows, clusterRows] = await Promise.all([
    input.entityIds.length === 0
      ? Promise.resolve([])
      : db
          .select({ canonicalName: entities.canonicalName, aliases: entities.aliases })
          .from(entities)
          .where(and(eq(entities.teamId, input.teamId), inArray(entities.id, input.entityIds))),
    input.clusterIds.length === 0
      ? Promise.resolve([])
      : db
          .select({ canonicalName: artifactClusters.canonicalName })
          .from(artifactClusters)
          .where(
            and(
              eq(artifactClusters.teamId, input.teamId),
              inArray(artifactClusters.id, input.clusterIds),
            ),
          ),
  ]);

  return [
    ...new Set(
      [
        ...entityRows.flatMap((row) => [row.canonicalName, ...stringArrayFromUnknown(row.aliases)]),
        ...clusterRows.map((row) => row.canonicalName),
      ]
        .map((value) => value.trim())
        .filter((value): value is string => Boolean(value && value.length >= 3)),
    ),
  ].sort();
}

function scopedRawEventMentionPredicate(names: readonly string[]): SQL {
  const contentConditions = mentionConditions(sql`${rawEvents.contentText}`, names);
  const metadataConditions = mentionConditions(sql`${rawEvents.sourceMetadata}::text`, names);
  const conditions = [...contentConditions, ...metadataConditions];
  const [firstCondition, ...remainingConditions] = conditions;
  if (!firstCondition) return sql`FALSE`;
  return remainingConditions.reduce<SQL>(
    (predicate, condition) => or(predicate, condition) ?? predicate,
    firstCondition,
  );
}

function mentionConditions(column: SQL, names: readonly string[]): SQL[] {
  return names.map(
    (name) => sql`lower(${column}) LIKE ${likePattern(name.toLowerCase())} ESCAPE '\\'`,
  );
}

function likePattern(value: string): string {
  return `%${value.replace(/[\\%_]/g, (match) => `\\${match}`)}%`;
}

function stringArrayFromUnknown(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
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
        rawEventVisibleToUser(input.viewerUserId),
      ),
    );
  const visible = new Set(rows.map((row) => row.id));
  return input.rawEventIds.filter((id) => visible.has(id));
}

async function repairScopedEvidenceGraph(
  db: DbOrTx,
  data: Extract<queue.ReconciliationJobData, { kind: 'scope_reconcile' }>,
  targetId: string | null,
  rawEventIds?: string[],
): Promise<Pick<ScopeReconciliationResult, 'associationRepairCount' | 'outputRepairCount'>> {
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
  if (evidenceIds.length === 0) {
    return EMPTY_SCOPED_CONTEXT_REPAIR;
  }

  const result = await resolveEvidenceAssociations({
    db,
    teamId: data.teamId,
    evidenceIds,
  });
  const fallback =
    data.scope === 'team'
      ? EMPTY_SCOPED_CONTEXT_REPAIR
      : await repairScopedContextAssociations(db, {
          teamId: data.teamId,
          scope: data.scope,
          targetId,
          evidenceIds: result.skipped.map((skip) => skip.evidenceId),
        });
  return {
    associationRepairCount:
      result.associated.filter((write) => write.associationCreated).length +
      fallback.associationRepairCount,
    outputRepairCount: repairedOutputIds(result).length + fallback.outputRepairCount,
  };
}

async function repairScopedContextAssociations(
  db: DbOrTx,
  input: {
    teamId: string;
    scope: 'object' | 'cluster';
    targetId: string | null;
    evidenceIds: string[];
  },
): Promise<ScopedContextRepairCount> {
  const evidenceIds = [...new Set(input.evidenceIds)].filter((id) => id.length > 0);
  if (evidenceIds.length === 0) return EMPTY_SCOPED_CONTEXT_REPAIR;
  const clusterIds = await scopedClusterIds(db, {
    teamId: input.teamId,
    scope: input.scope,
    targetId: input.targetId,
  });
  const [clusterId] = clusterIds.sort();
  if (!clusterId) return EMPTY_SCOPED_CONTEXT_REPAIR;

  const evidenceRows = await db
    .select({
      id: reconciliationEvidence.id,
      rawEventId: reconciliationEvidence.rawEventId,
      sourcePayloadRef: reconciliationEvidence.sourcePayloadRef,
      source: reconciliationEvidence.source,
      provider: reconciliationEvidence.provider,
      eventType: reconciliationEvidence.eventType,
      visibility: reconciliationEvidence.visibility,
      visibilityOwnerUserId: reconciliationEvidence.visibilityOwnerUserId,
      visibilityUserIds: reconciliationEvidence.visibilityUserIds,
    })
    .from(reconciliationEvidence)
    .where(
      and(
        eq(reconciliationEvidence.teamId, input.teamId),
        inArray(reconciliationEvidence.id, evidenceIds),
      ),
    );
  const outputRows = await db
    .select({ sourceRefs: reconciliationOutputs.sourceRefs })
    .from(reconciliationOutputs)
    .where(
      and(
        eq(reconciliationOutputs.teamId, input.teamId),
        eq(reconciliationOutputs.clusterId, clusterId),
      ),
    );
  const outputRawEventIds = new Set(
    outputRows.flatMap((row) => rawEventIdsFromSourceRefs(row.sourceRefs)),
  );
  const fallbackEvidenceRows = evidenceRows.filter((row) => !outputRawEventIds.has(row.rawEventId));
  if (fallbackEvidenceRows.length === 0) return EMPTY_SCOPED_CONTEXT_REPAIR;

  const runId = await ensureScopedContextRun(db, {
    teamId: input.teamId,
    clusterId,
    evidenceIds: fallbackEvidenceRows.map((row) => row.id),
  });
  let associationRepairCount = 0;
  let outputRepairCount = 0;
  for (const evidence of fallbackEvidenceRows) {
    const role = 'related_context' as const;
    const associationSource = 'model_candidate' as const;
    const associationDedupeKey = buildAssociationDedupeKey({
      teamId: input.teamId,
      clusterId,
      evidenceId: evidence.id,
      role,
      associationSource,
      associationPolicyVersion: SCOPED_CONTEXT_ASSOCIATION_POLICY_VERSION,
    });
    const [insertedAssociation] = await db
      .insert(artifactEvidenceAssociations)
      .values({
        teamId: input.teamId,
        clusterId,
        evidenceId: evidence.id,
        rawEventId: evidence.rawEventId,
        role,
        strength: 'semantic',
        confidence: 'medium',
        associationSource,
        rationale: `${evidence.provider ?? evidence.source} ${evidence.eventType} mentioned scoped reconciliation target`,
        sourceRefs: scopedContextSourceRefs(evidence),
        visibility: evidence.visibility,
        visibilityOwnerUserId: evidence.visibilityOwnerUserId,
        visibilityUserIds: evidence.visibilityUserIds,
        visibilityFloor: evidence.visibility,
        visibilityFloorOwnerUserId: evidence.visibilityOwnerUserId,
        visibilityFloorUserIds: evidence.visibilityUserIds,
        metadata: {
          source: 'manual_scope_reconcile',
          policy_version: SCOPED_CONTEXT_ASSOCIATION_POLICY_VERSION,
        },
        dedupeKey: associationDedupeKey,
      })
      .onConflictDoNothing()
      .returning({ id: artifactEvidenceAssociations.id });
    if (insertedAssociation) associationRepairCount += 1;
    const association =
      insertedAssociation ??
      (
        await db
          .select({ id: artifactEvidenceAssociations.id })
          .from(artifactEvidenceAssociations)
          .where(
            and(
              eq(artifactEvidenceAssociations.teamId, input.teamId),
              eq(artifactEvidenceAssociations.dedupeKey, associationDedupeKey),
            ),
          )
          .limit(1)
      )[0];
    if (!association) continue;
    const repaired = await emitScopedContextOutput(db, {
      teamId: input.teamId,
      runId,
      clusterId,
      associationId: association.id,
      evidence,
      role,
      associationSource,
    });
    if (repaired) outputRepairCount += 1;
  }
  return { associationRepairCount, outputRepairCount };
}

async function ensureScopedContextRun(
  db: DbOrTx,
  input: { teamId: string; clusterId: string; evidenceIds: string[] },
): Promise<string> {
  const metrics = {
    cluster_id: input.clusterId,
    evidence_count: input.evidenceIds.length,
  };
  const inputFingerprint = reconciliationDedupeKey('manual-scope-context-run', {
    teamId: input.teamId,
    clusterId: input.clusterId,
    evidenceIds: [...input.evidenceIds].sort(),
    policyVersion: SCOPED_CONTEXT_ASSOCIATION_POLICY_VERSION,
  });
  const [run] = await db
    .insert(reconciliationRuns)
    .values({
      teamId: input.teamId,
      trigger: 'manual_repair',
      scope: 'manual_scope_context',
      status: 'completed',
      inputFingerprint,
      engineVersion: SCOPED_CONTEXT_RUN_VERSION,
      completedAt: new Date(),
      metrics,
    })
    .onConflictDoUpdate({
      target: [
        reconciliationRuns.teamId,
        reconciliationRuns.inputFingerprint,
        reconciliationRuns.engineVersion,
      ],
      set: {
        status: 'completed',
        completedAt: new Date(),
        metrics,
      },
    })
    .returning({ id: reconciliationRuns.id });
  if (!run) throw new Error('Failed to record scoped context reconciliation run');
  return run.id;
}

async function emitScopedContextOutput(
  db: DbOrTx,
  input: {
    teamId: string;
    runId: string;
    clusterId: string;
    associationId: string;
    evidence: ScopedContextEvidence;
    role: string;
    associationSource: string;
  },
): Promise<boolean> {
  const sourceRefs = scopedContextSourceRefs(input.evidence, input.associationId);
  const sourceEnvelope = scopedContextOutputEnvelope(input.evidence, sourceRefs);
  const dedupeKey = buildOutputDedupeKey({
    teamId: input.teamId,
    clusterId: input.clusterId,
    targetKind: 'cluster_identity',
    operation: 'link',
    targetId: null,
    targetIdentity: `${input.clusterId}:${input.evidence.rawEventId}:${input.role}:${input.associationSource}`,
    sourceRefs,
    authorityPolicyVersion: SCOPED_CONTEXT_ASSOCIATION_POLICY_VERSION,
    plannerVersion: SCOPED_CONTEXT_PLANNER_VERSION,
  });
  const [existing] = await db
    .select({ id: reconciliationOutputs.id, status: reconciliationOutputs.status })
    .from(reconciliationOutputs)
    .where(
      and(
        eq(reconciliationOutputs.teamId, input.teamId),
        eq(reconciliationOutputs.dedupeKey, dedupeKey),
      ),
    )
    .limit(1);
  await db
    .insert(reconciliationOutputs)
    .values({
      teamId: input.teamId,
      runId: input.runId,
      clusterId: input.clusterId,
      outputKind: 'observed_association',
      targetKind: 'cluster_identity',
      operation: 'link',
      payload: {
        resolver: 'manual_scope_context',
        evidence_id: input.evidence.id,
        association_id: input.associationId,
        association_role: input.role,
        association_source: input.associationSource,
      },
      authorityDecision: {
        decision: 'observed_association',
        reason: 'manual_scope_reconcile_context_match',
        policy_version: SCOPED_CONTEXT_ASSOCIATION_POLICY_VERSION,
      },
      confidence: 'medium',
      requiresApproval: false,
      ...sourceEnvelope,
      dedupeKey,
      status: 'applied',
    })
    .onConflictDoUpdate({
      target: [reconciliationOutputs.teamId, reconciliationOutputs.dedupeKey],
      set: {
        runId: input.runId,
        ...sourceEnvelope,
        status: 'applied',
        updatedAt: new Date(),
      },
    });
  return existing?.status !== 'applied';
}

function scopedContextSourceRefs(
  evidence: ScopedContextEvidence,
  associationId?: string,
): SourceRef[] {
  return [
    {
      source: evidence.provider ?? evidence.source,
      rawEventId: evidence.rawEventId,
      evidenceId: evidence.id,
      ...(associationId ? { associationId } : {}),
      sourcePayloadRef: evidence.sourcePayloadRef,
    },
  ];
}

function scopedContextOutputEnvelope(evidence: ScopedContextEvidence, sourceRefs: SourceRef[]) {
  return {
    sourceRefs,
    sourcePayloadRefs: sourcePayloadRefsForEvidence(evidence),
    visibility: evidence.visibility,
    visibilityOwnerUserId: evidence.visibilityOwnerUserId,
    visibilityUserIds: evidence.visibilityUserIds,
    visibilityFloor: evidence.visibility,
    visibilityFloorOwnerUserId: evidence.visibilityOwnerUserId,
    visibilityFloorUserIds: evidence.visibilityUserIds,
  };
}

function sourcePayloadRefsForEvidence(evidence: Pick<ScopedContextEvidence, 'sourcePayloadRef'>) {
  return evidence.sourcePayloadRef ? [evidence.sourcePayloadRef] : [];
}

function repairedOutputIds(
  result: Awaited<ReturnType<typeof resolveEvidenceAssociations>>,
): string[] {
  return [
    ...new Set([
      ...result.associated.map((write) => (write.outputRepaired ? write.outputId : null)),
      ...result.skipped.map((skip) => (skip.outputRepaired ? (skip.outputId ?? null) : null)),
    ]),
  ].filter((id): id is string => typeof id === 'string' && id.length > 0);
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
      const result = await withWorkerAiBilling(deps.db, job.data.teamId, 'reconciliation', () =>
        processReconciliationJob(deps.db, job.data),
      );
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

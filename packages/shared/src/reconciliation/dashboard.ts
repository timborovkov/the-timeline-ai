import {
  type Db,
  artifactClusters,
  artifactEvidenceAssociations,
  reconciliationRunStatus,
  reconciliationRunTrigger,
  reconciliationOutputs,
  reconciliationProjectionOutbox,
  reconciliationRuns,
} from '@timeline/db';
import { and, count, desc, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';

import { listArtifactClusterEvidence } from '#src/artifacts/index.js';
import {
  auditReconciliationEvidenceCoverage,
  type ReconciliationEvidenceCoverageReport,
} from '#src/reconciliation/backfill.js';

type DbTx = Parameters<Parameters<Db['transaction']>[0]>[0];
type DbOrTx = Db | DbTx;

export interface ReconciliationDashboardInput {
  db: DbOrTx;
  teamId: string;
  viewerUserId: string;
  rawEventLimit?: number;
  runHistory?: ReconciliationDashboardRunHistoryInput;
}

export interface ReconciliationDashboardCount {
  key: string;
  count: number;
}

export interface ReconciliationDashboardRun {
  id: string;
  trigger: string;
  scope: string;
  status: string;
  engineVersion: string;
  metrics: unknown;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  errorCode: string | null;
}

export interface ReconciliationDashboardRunHistoryInput {
  status?: string;
  trigger?: string;
  page?: number;
  pageSize?: number;
}

export interface ReconciliationDashboardRunHistory {
  status: string | null;
  trigger: string | null;
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasPreviousPage: boolean;
  hasNextPage: boolean;
}

export interface ReconciliationDashboardOutput {
  id: string;
  clusterId: string | null;
  outputKind: string;
  targetKind: string;
  operation: string;
  status: string;
  requiresApproval: boolean;
  confidence: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ReconciliationDashboardCluster {
  id: string;
  artifactClusterKind: string;
  artifactType: string;
  canonicalName: string;
  status: string;
  canonicalEntityId: string | null;
  updatedAt: Date;
}

export interface ReconciliationDashboardApprovalStats {
  accepted: number;
  rejected: number;
  open: number;
  totalDecided: number;
  acceptanceRate: number | null;
}

export interface ReconciliationDashboardSnapshot {
  generatedAt: Date;
  coverageLimit: number;
  evidenceCoverage: ReconciliationEvidenceCoverageReport;
  runs: {
    byStatus: ReconciliationDashboardCount[];
    byTrigger: ReconciliationDashboardCount[];
    recent: ReconciliationDashboardRun[];
    history: ReconciliationDashboardRunHistory;
  };
  outputs: {
    byStatus: ReconciliationDashboardCount[];
    byKind: ReconciliationDashboardCount[];
    recent: ReconciliationDashboardOutput[];
  };
  associations: {
    total: number;
    byRole: ReconciliationDashboardCount[];
  };
  clusters: {
    total: number;
    byKind: ReconciliationDashboardCount[];
    recent: ReconciliationDashboardCluster[];
  };
  projectionOutbox: {
    byStatus: ReconciliationDashboardCount[];
  };
  diagnostics: {
    openConflicts: number;
    directWritesBySource: ReconciliationDashboardCount[];
    approvalStats: ReconciliationDashboardApprovalStats;
    topNoActionReasons: ReconciliationDashboardCount[];
    ambiguityBySource: ReconciliationDashboardCount[];
  };
}

export interface ReconciliationClusterDetailEvidence {
  clusterId: string;
  artifactType: string;
  canonicalName: string;
  status: string;
  rawEventId: string | null;
  entityId: string | null;
  provider: string | null;
  externalObjectId: string | null;
  role: string;
  strength: string;
  authoritative: boolean;
  contentText: string | null;
  objectName: string | null;
}

export interface ReconciliationClusterDetailOutput extends ReconciliationDashboardOutput {
  targetId: string | null;
  sourceRefs: unknown;
  sourcePayloadRefs: unknown;
  payload: unknown;
}

export interface ReconciliationClusterDetail {
  cluster: ReconciliationDashboardCluster;
  evidence: ReconciliationClusterDetailEvidence[];
  outputs: ReconciliationClusterDetailOutput[];
}

const DEFAULT_COVERAGE_LIMIT = 5_000;
const RECENT_LIMIT = 12;
const MAX_RUN_HISTORY_PAGE_SIZE = 50;
type ReconciliationRunStatusValue = (typeof reconciliationRunStatus.enumValues)[number];
type ReconciliationRunTriggerValue = (typeof reconciliationRunTrigger.enumValues)[number];

export async function getReconciliationDashboardSnapshot(
  input: ReconciliationDashboardInput,
): Promise<ReconciliationDashboardSnapshot> {
  const coverageLimit = Math.max(1, input.rawEventLimit ?? DEFAULT_COVERAGE_LIMIT);
  const outputVisibility = reconciliationOutputVisibleToUser(input.viewerUserId);
  const visibleRunFilter = visibleReconciliationRunFilter(input.teamId, input.viewerUserId);
  const runHistory = normalizeRunHistoryInput(input.runHistory);
  const filteredRunFilter = and(
    eq(reconciliationRuns.teamId, input.teamId),
    visibleRunFilter,
    ...(runHistory.status ? [eq(reconciliationRuns.status, runHistory.status)] : []),
    ...(runHistory.trigger ? [eq(reconciliationRuns.trigger, runHistory.trigger)] : []),
  );
  const associationVisibility = associationVisibleToUser(input.viewerUserId);
  const visibleClusterIds = await loadVisibleReconciliationClusterIds(input);
  const visibleClusterFilter =
    visibleClusterIds.length > 0 ? inArray(artifactClusters.id, visibleClusterIds) : sql`false`;
  const [
    evidenceCoverage,
    runsByStatus,
    runsByTrigger,
    filteredRunCount,
    recentRuns,
    outputsByStatus,
    outputsByKind,
    recentOutputs,
    associationsByRole,
    associationTotal,
    clustersByKind,
    clusterTotal,
    recentClusters,
    projectionOutboxByStatus,
    diagnosticOutputs,
  ] = await Promise.all([
    auditReconciliationEvidenceCoverage({
      db: input.db,
      teamId: input.teamId,
      viewerUserId: input.viewerUserId,
      limit: coverageLimit,
    }),
    input.db
      .select({ key: reconciliationRuns.status, count: count() })
      .from(reconciliationRuns)
      .where(and(eq(reconciliationRuns.teamId, input.teamId), visibleRunFilter))
      .groupBy(reconciliationRuns.status),
    input.db
      .select({ key: reconciliationRuns.trigger, count: count() })
      .from(reconciliationRuns)
      .where(and(eq(reconciliationRuns.teamId, input.teamId), visibleRunFilter))
      .groupBy(reconciliationRuns.trigger),
    input.db.select({ count: count() }).from(reconciliationRuns).where(filteredRunFilter),
    input.db
      .select({
        id: reconciliationRuns.id,
        trigger: reconciliationRuns.trigger,
        scope: reconciliationRuns.scope,
        status: reconciliationRuns.status,
        engineVersion: reconciliationRuns.engineVersion,
        metrics: reconciliationRuns.metrics,
        createdAt: reconciliationRuns.createdAt,
        startedAt: reconciliationRuns.startedAt,
        completedAt: reconciliationRuns.completedAt,
        errorCode: reconciliationRuns.errorCode,
      })
      .from(reconciliationRuns)
      .where(filteredRunFilter)
      .orderBy(desc(reconciliationRuns.createdAt))
      .limit(runHistory.pageSize)
      .offset((runHistory.page - 1) * runHistory.pageSize),
    input.db
      .select({ key: reconciliationOutputs.status, count: count() })
      .from(reconciliationOutputs)
      .where(and(eq(reconciliationOutputs.teamId, input.teamId), outputVisibility))
      .groupBy(reconciliationOutputs.status),
    input.db
      .select({ key: reconciliationOutputs.outputKind, count: count() })
      .from(reconciliationOutputs)
      .where(and(eq(reconciliationOutputs.teamId, input.teamId), outputVisibility))
      .groupBy(reconciliationOutputs.outputKind),
    input.db
      .select({
        id: reconciliationOutputs.id,
        clusterId: reconciliationOutputs.clusterId,
        outputKind: reconciliationOutputs.outputKind,
        targetKind: reconciliationOutputs.targetKind,
        operation: reconciliationOutputs.operation,
        status: reconciliationOutputs.status,
        requiresApproval: reconciliationOutputs.requiresApproval,
        confidence: reconciliationOutputs.confidence,
        createdAt: reconciliationOutputs.createdAt,
        updatedAt: reconciliationOutputs.updatedAt,
      })
      .from(reconciliationOutputs)
      .where(and(eq(reconciliationOutputs.teamId, input.teamId), outputVisibility))
      .orderBy(desc(reconciliationOutputs.createdAt))
      .limit(RECENT_LIMIT),
    input.db
      .select({ key: artifactEvidenceAssociations.role, count: count() })
      .from(artifactEvidenceAssociations)
      .where(and(eq(artifactEvidenceAssociations.teamId, input.teamId), associationVisibility))
      .groupBy(artifactEvidenceAssociations.role),
    input.db
      .select({ count: count() })
      .from(artifactEvidenceAssociations)
      .where(and(eq(artifactEvidenceAssociations.teamId, input.teamId), associationVisibility)),
    input.db
      .select({ key: artifactClusters.artifactClusterKind, count: count() })
      .from(artifactClusters)
      .where(and(eq(artifactClusters.teamId, input.teamId), visibleClusterFilter))
      .groupBy(artifactClusters.artifactClusterKind),
    input.db
      .select({ count: count() })
      .from(artifactClusters)
      .where(and(eq(artifactClusters.teamId, input.teamId), visibleClusterFilter)),
    input.db
      .select({
        id: artifactClusters.id,
        artifactClusterKind: artifactClusters.artifactClusterKind,
        artifactType: artifactClusters.artifactType,
        canonicalName: artifactClusters.canonicalName,
        status: artifactClusters.status,
        canonicalEntityId: artifactClusters.canonicalEntityId,
        updatedAt: artifactClusters.updatedAt,
      })
      .from(artifactClusters)
      .where(
        and(
          eq(artifactClusters.teamId, input.teamId),
          isNull(artifactClusters.archivedAt),
          visibleClusterFilter,
        ),
      )
      .orderBy(desc(artifactClusters.updatedAt))
      .limit(RECENT_LIMIT),
    input.db
      .select({ key: reconciliationProjectionOutbox.status, count: count() })
      .from(reconciliationProjectionOutbox)
      .innerJoin(
        reconciliationOutputs,
        and(
          eq(reconciliationOutputs.id, reconciliationProjectionOutbox.outputId),
          eq(reconciliationOutputs.teamId, input.teamId),
        ),
      )
      .where(and(eq(reconciliationProjectionOutbox.teamId, input.teamId), outputVisibility))
      .groupBy(reconciliationProjectionOutbox.status),
    input.db
      .select({
        outputKind: reconciliationOutputs.outputKind,
        status: reconciliationOutputs.status,
        requiresApproval: reconciliationOutputs.requiresApproval,
        sourceRefs: reconciliationOutputs.sourceRefs,
        payload: reconciliationOutputs.payload,
      })
      .from(reconciliationOutputs)
      .where(and(eq(reconciliationOutputs.teamId, input.teamId), outputVisibility)),
  ]);
  const diagnostics = dashboardDiagnosticsFromOutputs(diagnosticOutputs);
  const runTotal = filteredRunCount[0]?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(runTotal / runHistory.pageSize));

  return {
    generatedAt: new Date(),
    coverageLimit,
    evidenceCoverage,
    runs: {
      byStatus: normalizeCountRows(runsByStatus),
      byTrigger: normalizeCountRows(runsByTrigger),
      recent: recentRuns,
      history: {
        status: runHistory.status,
        trigger: runHistory.trigger,
        page: runHistory.page,
        pageSize: runHistory.pageSize,
        total: runTotal,
        totalPages,
        hasPreviousPage: runHistory.page > 1,
        hasNextPage: runHistory.page < totalPages,
      },
    },
    outputs: {
      byStatus: normalizeCountRows(outputsByStatus),
      byKind: normalizeCountRows(outputsByKind),
      recent: recentOutputs,
    },
    associations: {
      total: associationTotal[0]?.count ?? 0,
      byRole: normalizeCountRows(associationsByRole),
    },
    clusters: {
      total: clusterTotal[0]?.count ?? 0,
      byKind: normalizeCountRows(clustersByKind),
      recent: recentClusters,
    },
    projectionOutbox: {
      byStatus: normalizeCountRows(projectionOutboxByStatus),
    },
    diagnostics,
  };
}

function normalizeRunHistoryInput(
  input: ReconciliationDashboardRunHistoryInput | undefined,
): Required<Pick<ReconciliationDashboardRunHistoryInput, 'page' | 'pageSize'>> & {
  status: ReconciliationRunStatusValue | null;
  trigger: ReconciliationRunTriggerValue | null;
} {
  const pageSize = clampInteger(input?.pageSize, RECENT_LIMIT, 1, MAX_RUN_HISTORY_PAGE_SIZE);
  return {
    status: cleanEnumFilter(input?.status, reconciliationRunStatus.enumValues),
    trigger: cleanEnumFilter(input?.trigger, reconciliationRunTrigger.enumValues),
    page: clampInteger(input?.page, 1, 1, 10_000),
    pageSize,
  };
}

function cleanEnumFilter<const T extends readonly string[]>(
  value: string | undefined,
  allowedValues: T,
): T[number] | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return allowedValues.includes(trimmed) ? trimmed : null;
}

function clampInteger(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

export async function getReconciliationClusterDetail(input: {
  db: DbOrTx;
  teamId: string;
  viewerUserId: string;
  clusterId: string;
}): Promise<ReconciliationClusterDetail | null> {
  const [cluster] = await input.db
    .select({
      id: artifactClusters.id,
      artifactClusterKind: artifactClusters.artifactClusterKind,
      artifactType: artifactClusters.artifactType,
      canonicalName: artifactClusters.canonicalName,
      status: artifactClusters.status,
      canonicalEntityId: artifactClusters.canonicalEntityId,
      updatedAt: artifactClusters.updatedAt,
    })
    .from(artifactClusters)
    .where(
      and(
        eq(artifactClusters.teamId, input.teamId),
        eq(artifactClusters.id, input.clusterId),
        isNull(artifactClusters.archivedAt),
      ),
    )
    .limit(1);
  if (!cluster) return null;

  const evidence = await listArtifactClusterEvidence(input.db as Db, {
    teamId: input.teamId,
    clusterId: input.clusterId,
    viewerUserId: input.viewerUserId,
  });
  const outputVisibility = visibilityEnvelopeVisibleToUser(
    {
      visibility: reconciliationOutputs.visibility,
      visibilityOwnerUserId: reconciliationOutputs.visibilityOwnerUserId,
      visibilityUserIds: reconciliationOutputs.visibilityUserIds,
    },
    input.viewerUserId,
  );
  const outputVisibilityFloor = visibilityEnvelopeVisibleToUser(
    {
      visibility: reconciliationOutputs.visibilityFloor,
      visibilityOwnerUserId: reconciliationOutputs.visibilityFloorOwnerUserId,
      visibilityUserIds: reconciliationOutputs.visibilityFloorUserIds,
    },
    input.viewerUserId,
  );
  const outputs = await input.db
    .select({
      id: reconciliationOutputs.id,
      clusterId: reconciliationOutputs.clusterId,
      outputKind: reconciliationOutputs.outputKind,
      targetKind: reconciliationOutputs.targetKind,
      operation: reconciliationOutputs.operation,
      targetId: reconciliationOutputs.targetId,
      status: reconciliationOutputs.status,
      requiresApproval: reconciliationOutputs.requiresApproval,
      confidence: reconciliationOutputs.confidence,
      sourceRefs: reconciliationOutputs.sourceRefs,
      sourcePayloadRefs: reconciliationOutputs.sourcePayloadRefs,
      payload: reconciliationOutputs.payload,
      createdAt: reconciliationOutputs.createdAt,
      updatedAt: reconciliationOutputs.updatedAt,
    })
    .from(reconciliationOutputs)
    .where(
      and(
        eq(reconciliationOutputs.teamId, input.teamId),
        eq(reconciliationOutputs.clusterId, input.clusterId),
        outputVisibility,
        outputVisibilityFloor,
      ),
    )
    .orderBy(desc(reconciliationOutputs.createdAt), desc(reconciliationOutputs.id));
  if (evidence.length === 0 && outputs.length === 0) return null;

  return { cluster, evidence, outputs };
}

function normalizeCountRows(
  rows: { key: string; count: number }[],
): ReconciliationDashboardCount[] {
  return rows
    .map((row) => ({ key: row.key, count: row.count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

function dashboardDiagnosticsFromOutputs(
  rows: {
    outputKind: string;
    status: string;
    requiresApproval: boolean;
    sourceRefs: unknown;
    payload: unknown;
  }[],
): ReconciliationDashboardSnapshot['diagnostics'] {
  const directWritesBySource = new Map<string, number>();
  const noActionReasons = new Map<string, number>();
  const ambiguityBySource = new Map<string, number>();
  let accepted = 0;
  let rejected = 0;
  let open = 0;
  let openConflicts = 0;

  for (const row of rows) {
    const sourceKeys = sourceKeysFromRefs(row.sourceRefs);
    if (row.outputKind === 'direct_write') {
      incrementEach(directWritesBySource, sourceKeys);
    }
    if (row.outputKind === 'conflict') {
      if (
        row.status === 'pending' ||
        row.status === 'approval_created' ||
        row.status === 'failed'
      ) {
        openConflicts += 1;
      }
      incrementEach(ambiguityBySource, sourceKeys);
    }
    if (row.outputKind === 'no_action') {
      increment(noActionReasons, noActionReasonFromPayload(row.payload));
    }
    if (row.requiresApproval || row.outputKind === 'approval_bundle') {
      if (row.status === 'applied') accepted += 1;
      else if (row.status === 'rejected') rejected += 1;
      else if (row.status === 'pending' || row.status === 'approval_created') open += 1;
    }
  }

  const totalDecided = accepted + rejected;
  return {
    openConflicts,
    directWritesBySource: countRowsFromMap(directWritesBySource),
    approvalStats: {
      accepted,
      rejected,
      open,
      totalDecided,
      acceptanceRate: totalDecided > 0 ? accepted / totalDecided : null,
    },
    topNoActionReasons: countRowsFromMap(noActionReasons).slice(0, 8),
    ambiguityBySource: countRowsFromMap(ambiguityBySource),
  };
}

function sourceKeysFromRefs(value: unknown): string[] {
  if (!Array.isArray(value)) return ['unknown'];
  const sources = value
    .map((entry) => (isRecord(entry) && typeof entry.source === 'string' ? entry.source : null))
    .filter((source): source is string => !!source);
  return sources.length > 0 ? [...new Set(sources)] : ['unknown'];
}

function noActionReasonFromPayload(value: unknown): string {
  if (!isRecord(value)) return 'unspecified';
  for (const key of ['reason_code', 'reasonCode', 'reason', 'no_action_reason']) {
    const reason = value[key];
    if (typeof reason === 'string' && reason.trim()) return reason.trim().slice(0, 80);
  }
  return 'unspecified';
}

function incrementEach(counts: Map<string, number>, keys: string[]): void {
  for (const key of keys) increment(counts, key);
}

function increment(counts: Map<string, number>, key: string): void {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

function countRowsFromMap(counts: Map<string, number>): ReconciliationDashboardCount[] {
  return normalizeCountRows([...counts].map(([key, countValue]) => ({ key, count: countValue })));
}

function visibleReconciliationRunFilter(teamId: string, userId: string): SQL {
  return sql`(
    EXISTS (
      SELECT 1
      FROM ${reconciliationOutputs}
      WHERE ${reconciliationOutputs.teamId} = ${teamId}
        AND ${reconciliationOutputs.runId} = ${reconciliationRuns.id}
        AND ${reconciliationOutputVisibleToUser(userId)}
    )
    OR NOT EXISTS (
      SELECT 1
      FROM ${reconciliationOutputs}
      WHERE ${reconciliationOutputs.teamId} = ${teamId}
        AND ${reconciliationOutputs.runId} = ${reconciliationRuns.id}
    )
  )`;
}

async function loadVisibleReconciliationClusterIds(
  input: ReconciliationDashboardInput,
): Promise<string[]> {
  const outputRows = await input.db
    .select({ clusterId: reconciliationOutputs.clusterId })
    .from(reconciliationOutputs)
    .where(
      and(
        eq(reconciliationOutputs.teamId, input.teamId),
        sql`${reconciliationOutputs.clusterId} IS NOT NULL`,
        reconciliationOutputVisibleToUser(input.viewerUserId),
      ),
    );
  const associationRows = await input.db
    .select({ clusterId: artifactEvidenceAssociations.clusterId })
    .from(artifactEvidenceAssociations)
    .where(
      and(
        eq(artifactEvidenceAssociations.teamId, input.teamId),
        associationVisibleToUser(input.viewerUserId),
      ),
    );

  return [
    ...new Set(
      [
        ...outputRows.map((row) => row.clusterId),
        ...associationRows.map((row) => row.clusterId),
      ].filter((id): id is string => typeof id === 'string' && id.length > 0),
    ),
  ];
}

function reconciliationOutputVisibleToUser(userId: string): SQL {
  const predicate = and(
    visibilityEnvelopeVisibleToUser(
      {
        visibility: reconciliationOutputs.visibility,
        visibilityOwnerUserId: reconciliationOutputs.visibilityOwnerUserId,
        visibilityUserIds: reconciliationOutputs.visibilityUserIds,
      },
      userId,
    ),
    visibilityEnvelopeVisibleToUser(
      {
        visibility: reconciliationOutputs.visibilityFloor,
        visibilityOwnerUserId: reconciliationOutputs.visibilityFloorOwnerUserId,
        visibilityUserIds: reconciliationOutputs.visibilityFloorUserIds,
      },
      userId,
    ),
  );
  if (!predicate) throw new Error('Expected reconciliation output visibility predicate');
  return predicate;
}

function associationVisibleToUser(userId: string): SQL {
  const predicate = and(
    visibilityEnvelopeVisibleToUser(
      {
        visibility: artifactEvidenceAssociations.visibility,
        visibilityOwnerUserId: artifactEvidenceAssociations.visibilityOwnerUserId,
        visibilityUserIds: artifactEvidenceAssociations.visibilityUserIds,
      },
      userId,
    ),
    visibilityEnvelopeVisibleToUser(
      {
        visibility: artifactEvidenceAssociations.visibilityFloor,
        visibilityOwnerUserId: artifactEvidenceAssociations.visibilityFloorOwnerUserId,
        visibilityUserIds: artifactEvidenceAssociations.visibilityFloorUserIds,
      },
      userId,
    ),
  );
  if (!predicate) throw new Error('Expected association visibility predicate');
  return predicate;
}

function visibilityEnvelopeVisibleToUser(
  row: {
    visibility:
      | typeof reconciliationOutputs.visibility
      | typeof reconciliationOutputs.visibilityFloor
      | typeof artifactEvidenceAssociations.visibility
      | typeof artifactEvidenceAssociations.visibilityFloor;
    visibilityOwnerUserId:
      | typeof reconciliationOutputs.visibilityOwnerUserId
      | typeof reconciliationOutputs.visibilityFloorOwnerUserId
      | typeof artifactEvidenceAssociations.visibilityOwnerUserId
      | typeof artifactEvidenceAssociations.visibilityFloorOwnerUserId;
    visibilityUserIds:
      | typeof reconciliationOutputs.visibilityUserIds
      | typeof reconciliationOutputs.visibilityFloorUserIds
      | typeof artifactEvidenceAssociations.visibilityUserIds
      | typeof artifactEvidenceAssociations.visibilityFloorUserIds;
  },
  userId: string,
) {
  return or(
    eq(row.visibility, 'team'),
    and(eq(row.visibility, 'private'), eq(row.visibilityOwnerUserId, userId)),
    and(
      eq(row.visibility, 'specific_users'),
      sql`COALESCE(${userId}::uuid = ANY(${row.visibilityUserIds}), false)`,
    ),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

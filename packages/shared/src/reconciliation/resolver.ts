import {
  artifactClusterAnchors,
  artifactClusters,
  artifactEvidenceAssociations,
  type Db,
  reconciliationEvidence,
  reconciliationEvidenceAnchors,
  reconciliationOutputs,
  reconciliationRuns,
} from '@timeline/db';
import { and, eq, inArray, sql } from 'drizzle-orm';

import {
  buildAssociationDedupeKey,
  buildOutputDedupeKey,
  reconciliationDedupeKey,
  type SourceRef,
} from '#src/reconciliation/index.js';

type DbTx = Parameters<Parameters<Db['transaction']>[0]>[0];
type DbOrTx = Db | DbTx;
type EvidenceAssociationRole = (typeof artifactEvidenceAssociations.$inferInsert)['role'];
type EvidenceAssociationSource =
  (typeof artifactEvidenceAssociations.$inferInsert)['associationSource'];
type EvidenceStrength = (typeof artifactEvidenceAssociations.$inferInsert)['strength'];
type ArtifactClusterKind = (typeof artifactClusters.$inferInsert)['artifactClusterKind'];
type ArtifactType = (typeof artifactClusters.$inferInsert)['artifactType'];
type ArtifactStatus = (typeof artifactClusters.$inferInsert)['status'];

export interface ResolveEvidenceClusterDefaults {
  artifactClusterKind: ArtifactClusterKind;
  artifactType: ArtifactType;
  canonicalName?: string | null;
  status?: ArtifactStatus;
  metadata?: Record<string, unknown>;
}

export interface ResolveEvidenceAssociationsInput {
  db: DbOrTx;
  teamId: string;
  evidenceIds: string[];
  clusterDefaults?: ResolveEvidenceClusterDefaults;
  role?: EvidenceAssociationRole;
  associationSource?: EvidenceAssociationSource;
  associationPolicyVersion?: string;
}

export interface ResolveEvidenceAssociationWrite {
  evidenceId: string;
  rawEventId: string;
  clusterId: string;
  associationId: string;
  outputId: string | null;
  createdCluster: boolean;
}

export interface ResolveEvidenceAssociationSkip {
  evidenceId: string;
  reason:
    | 'missing_evidence'
    | 'no_matchable_anchors'
    | 'no_cluster_defaults'
    | 'ambiguous_anchor_match';
  clusterIds?: string[];
  outputId?: string | null;
}

export interface ResolveEvidenceAssociationsResult {
  associated: ResolveEvidenceAssociationWrite[];
  skipped: ResolveEvidenceAssociationSkip[];
}

interface EvidenceRow {
  id: string;
  rawEventId: string;
  sourcePayloadRef: string | null;
  source: string;
  provider: string | null;
  externalObjectId: string | null;
  eventType: string;
  visibility: 'team' | 'private' | 'specific_users';
  visibilityOwnerUserId: string | null;
  visibilityUserIds: string[] | null;
  title: string | null;
  summary: string | null;
}

interface AnchorRow {
  evidenceId: string;
  anchorType: string;
  anchorValue: string;
  strength: EvidenceStrength;
  source: string;
}

const DEFAULT_ASSOCIATION_POLICY_VERSION = 'anchor-resolution-2026-06';
const RESOLVER_RUN_VERSION = 'anchor-resolution-run-2026-06';
const RESOLVER_PLANNER_VERSION = 'anchor-resolution-planner-2026-06';

export async function resolveEvidenceAssociations(
  input: ResolveEvidenceAssociationsInput,
): Promise<ResolveEvidenceAssociationsResult> {
  const evidenceIds = [...new Set(input.evidenceIds)].filter((id) => id.trim().length > 0);
  if (evidenceIds.length === 0) return { associated: [], skipped: [] };

  const evidenceRows = await input.db
    .select({
      id: reconciliationEvidence.id,
      rawEventId: reconciliationEvidence.rawEventId,
      sourcePayloadRef: reconciliationEvidence.sourcePayloadRef,
      source: reconciliationEvidence.source,
      provider: reconciliationEvidence.provider,
      externalObjectId: reconciliationEvidence.externalObjectId,
      eventType: reconciliationEvidence.eventType,
      visibility: reconciliationEvidence.visibility,
      visibilityOwnerUserId: reconciliationEvidence.visibilityOwnerUserId,
      visibilityUserIds: reconciliationEvidence.visibilityUserIds,
      title: reconciliationEvidence.title,
      summary: reconciliationEvidence.summary,
    })
    .from(reconciliationEvidence)
    .where(
      and(
        eq(reconciliationEvidence.teamId, input.teamId),
        inArray(reconciliationEvidence.id, evidenceIds),
      ),
    );

  const evidenceById = new Map(evidenceRows.map((row) => [row.id, row]));
  const anchorRows = await input.db
    .select({
      evidenceId: reconciliationEvidenceAnchors.evidenceId,
      anchorType: reconciliationEvidenceAnchors.anchorType,
      anchorValue: reconciliationEvidenceAnchors.anchorValue,
      strength: reconciliationEvidenceAnchors.strength,
      source: reconciliationEvidenceAnchors.source,
    })
    .from(reconciliationEvidenceAnchors)
    .where(
      and(
        eq(reconciliationEvidenceAnchors.teamId, input.teamId),
        inArray(reconciliationEvidenceAnchors.evidenceId, evidenceIds),
      ),
    );

  const anchorsByEvidenceId = groupAnchorsByEvidenceId(anchorRows);
  const associated: ResolveEvidenceAssociationWrite[] = [];
  const skipped: ResolveEvidenceAssociationSkip[] = [];
  let runId: string | null = null;
  const getRunId = async () => {
    runId ??= await ensureResolverRun(input.db, {
      teamId: input.teamId,
      evidenceIds,
      associationPolicyVersion:
        input.associationPolicyVersion ?? DEFAULT_ASSOCIATION_POLICY_VERSION,
    });
    return runId;
  };

  for (const evidenceId of evidenceIds) {
    const evidence = evidenceById.get(evidenceId);
    if (!evidence) {
      skipped.push({ evidenceId, reason: 'missing_evidence' });
      continue;
    }

    const anchors = matchableAnchors(anchorsByEvidenceId.get(evidenceId) ?? []);
    if (anchors.length === 0) {
      skipped.push({ evidenceId, reason: 'no_matchable_anchors' });
      continue;
    }

    const matchedClusterIds = await findMatchingClusterIds(input.db, input.teamId, anchors);
    if (matchedClusterIds.length > 1) {
      const outputId = await emitConflictOutput(input.db, {
        teamId: input.teamId,
        runId: await getRunId(),
        evidence,
        anchors,
        clusterIds: matchedClusterIds,
        associationPolicyVersion:
          input.associationPolicyVersion ?? DEFAULT_ASSOCIATION_POLICY_VERSION,
      });
      skipped.push({
        evidenceId,
        reason: 'ambiguous_anchor_match',
        clusterIds: matchedClusterIds,
        outputId,
      });
      continue;
    }

    let clusterId = matchedClusterIds[0] ?? null;
    let createdCluster = false;
    if (!clusterId) {
      if (!input.clusterDefaults) {
        skipped.push({ evidenceId, reason: 'no_cluster_defaults' });
        continue;
      }
      const created = await createClusterFromEvidence(
        input.db,
        input.teamId,
        evidence,
        input.clusterDefaults,
      );
      clusterId = created.clusterId;
      createdCluster = true;
      await claimClusterAnchors(input.db, input.teamId, clusterId, evidence.rawEventId, anchors);
    }
    const cluster = await loadClusterSnapshot(input.db, input.teamId, clusterId);
    const associationAnchors = createdCluster
      ? anchors
      : await anchorsMatchingCluster(input.db, input.teamId, clusterId, anchors);

    const role = input.role ?? 'evidence_only';
    const associationSource =
      input.associationSource ??
      defaultAssociationSource(associationAnchors.map((anchor) => anchor.strength));
    const dedupeKey = buildAssociationDedupeKey({
      teamId: input.teamId,
      clusterId,
      evidenceId,
      role,
      associationSource,
      associationPolicyVersion:
        input.associationPolicyVersion ?? DEFAULT_ASSOCIATION_POLICY_VERSION,
    });

    await input.db
      .insert(artifactEvidenceAssociations)
      .values({
        teamId: input.teamId,
        clusterId,
        evidenceId,
        rawEventId: evidence.rawEventId,
        role,
        strength: strongestAnchorStrength(associationAnchors.map((anchor) => anchor.strength)),
        confidence: 'high',
        associationSource,
        rationale: rationaleForAssociation(evidence, associationAnchors),
        sourceRefs: [
          {
            source: evidence.provider ?? evidence.source,
            rawEventId: evidence.rawEventId,
            evidenceId,
            sourcePayloadRef: evidence.sourcePayloadRef,
          },
        ],
        visibility: evidence.visibility,
        visibilityOwnerUserId: evidence.visibilityOwnerUserId,
        visibilityUserIds: evidence.visibilityUserIds,
        visibilityFloor: evidence.visibility,
        visibilityFloorOwnerUserId: evidence.visibilityOwnerUserId,
        visibilityFloorUserIds: evidence.visibilityUserIds,
        metadata: {
          resolver: 'anchor-resolution',
          event_type: evidence.eventType,
          anchor_count: associationAnchors.length,
          artifact_cluster_kind: cluster.artifactClusterKind,
        },
        dedupeKey,
      })
      .onConflictDoNothing();

    const [association] = await input.db
      .select({ id: artifactEvidenceAssociations.id })
      .from(artifactEvidenceAssociations)
      .where(
        and(
          eq(artifactEvidenceAssociations.teamId, input.teamId),
          eq(artifactEvidenceAssociations.dedupeKey, dedupeKey),
        ),
      )
      .limit(1);

    if (association) {
      const sourceRefs = sourceRefsForEvidence(evidence, association.id);
      const outputId = await emitObservedAssociationOutput(input.db, {
        teamId: input.teamId,
        runId: await getRunId(),
        evidence,
        anchors: associationAnchors,
        clusterId,
        artifactClusterKind: cluster.artifactClusterKind,
        associationId: association.id,
        role,
        associationSource,
        sourceRefs,
        createdCluster,
        associationPolicyVersion:
          input.associationPolicyVersion ?? DEFAULT_ASSOCIATION_POLICY_VERSION,
      });
      associated.push({
        evidenceId,
        rawEventId: evidence.rawEventId,
        clusterId,
        associationId: association.id,
        outputId,
        createdCluster,
      });
    }
  }

  return { associated, skipped };
}

async function ensureResolverRun(
  db: DbOrTx,
  input: {
    teamId: string;
    evidenceIds: string[];
    associationPolicyVersion: string;
  },
): Promise<string> {
  const inputFingerprint = reconciliationDedupeKey('anchor-resolution-run', {
    teamId: input.teamId,
    evidenceIds: [...input.evidenceIds].sort(),
    associationPolicyVersion: input.associationPolicyVersion,
  });
  const [run] = await db
    .insert(reconciliationRuns)
    .values({
      teamId: input.teamId,
      trigger: 'evidence_batch',
      scope: 'anchor_resolution',
      status: 'completed',
      inputFingerprint,
      engineVersion: RESOLVER_RUN_VERSION,
      completedAt: new Date(),
      metrics: {
        evidence_count: input.evidenceIds.length,
        policy_version: input.associationPolicyVersion,
      },
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
        metrics: {
          evidence_count: input.evidenceIds.length,
          policy_version: input.associationPolicyVersion,
        },
      },
    })
    .returning({ id: reconciliationRuns.id });
  if (!run) throw new Error('reconciliation_resolver_run_create_failed');
  return run.id;
}

async function emitObservedAssociationOutput(
  db: DbOrTx,
  input: {
    teamId: string;
    runId: string;
    evidence: EvidenceRow;
    anchors: AnchorRow[];
    clusterId: string;
    artifactClusterKind: ArtifactClusterKind;
    associationId: string;
    role: EvidenceAssociationRole;
    associationSource: EvidenceAssociationSource;
    sourceRefs: SourceRef[];
    createdCluster: boolean;
    associationPolicyVersion: string;
  },
): Promise<string | null> {
  const sourcePayloadRefs = input.evidence.sourcePayloadRef
    ? [input.evidence.sourcePayloadRef]
    : [];
  const [output] = await db
    .insert(reconciliationOutputs)
    .values({
      teamId: input.teamId,
      runId: input.runId,
      clusterId: input.clusterId,
      outputKind: 'observed_association',
      targetKind: 'cluster_identity',
      operation: 'link',
      payload: {
        resolver: 'anchor-resolution',
        evidence_id: input.evidence.id,
        association_id: input.associationId,
        association_role: input.role,
        association_source: input.associationSource,
        artifact_cluster_kind: input.artifactClusterKind,
        created_cluster: input.createdCluster,
        anchors: outputAnchors(input.anchors),
      },
      authorityDecision: {
        decision: 'observed_association',
        reason: 'evidence_anchor_resolved_to_cluster',
        policy_version: input.associationPolicyVersion,
      },
      confidence: 'high',
      requiresApproval: false,
      sourceRefs: input.sourceRefs,
      sourcePayloadRefs,
      visibility: input.evidence.visibility,
      visibilityOwnerUserId: input.evidence.visibilityOwnerUserId,
      visibilityUserIds: input.evidence.visibilityUserIds,
      visibilityFloor: input.evidence.visibility,
      visibilityFloorOwnerUserId: input.evidence.visibilityOwnerUserId,
      visibilityFloorUserIds: input.evidence.visibilityUserIds,
      dedupeKey: buildOutputDedupeKey({
        teamId: input.teamId,
        clusterId: input.clusterId,
        targetKind: 'cluster_identity',
        operation: 'link',
        targetId: null,
        targetIdentity: `${input.clusterId}:${stableEvidenceSourceIdentity(input.evidence)}:${input.role}:${input.associationSource}`,
        sourceRefs: input.sourceRefs,
        authorityPolicyVersion: input.associationPolicyVersion,
        plannerVersion: RESOLVER_PLANNER_VERSION,
      }),
      status: 'applied',
    })
    .onConflictDoUpdate({
      target: [reconciliationOutputs.teamId, reconciliationOutputs.dedupeKey],
      set: {
        runId: input.runId,
        status: 'applied',
        updatedAt: new Date(),
      },
    })
    .returning({ id: reconciliationOutputs.id });
  return output?.id ?? null;
}

async function emitConflictOutput(
  db: DbOrTx,
  input: {
    teamId: string;
    runId: string;
    evidence: EvidenceRow;
    anchors: AnchorRow[];
    clusterIds: string[];
    associationPolicyVersion: string;
  },
): Promise<string | null> {
  const sourceRefs = sourceRefsForEvidence(input.evidence);
  const sourcePayloadRefs = input.evidence.sourcePayloadRef
    ? [input.evidence.sourcePayloadRef]
    : [];
  const clusterIds = [...input.clusterIds].sort();
  const [output] = await db
    .insert(reconciliationOutputs)
    .values({
      teamId: input.teamId,
      runId: input.runId,
      clusterId: null,
      outputKind: 'conflict',
      targetKind: 'cluster_identity',
      operation: 'link',
      payload: {
        resolver: 'anchor-resolution',
        reason: 'ambiguous_anchor_match',
        evidence_id: input.evidence.id,
        candidate_cluster_ids: clusterIds,
        anchors: outputAnchors(input.anchors),
      },
      authorityDecision: {
        decision: 'conflict',
        reason: 'multiple_clusters_matched_evidence_anchors',
        policy_version: input.associationPolicyVersion,
      },
      confidence: 'high',
      requiresApproval: true,
      sourceRefs,
      sourcePayloadRefs,
      visibility: input.evidence.visibility,
      visibilityOwnerUserId: input.evidence.visibilityOwnerUserId,
      visibilityUserIds: input.evidence.visibilityUserIds,
      visibilityFloor: input.evidence.visibility,
      visibilityFloorOwnerUserId: input.evidence.visibilityOwnerUserId,
      visibilityFloorUserIds: input.evidence.visibilityUserIds,
      dedupeKey: buildOutputDedupeKey({
        teamId: input.teamId,
        clusterId: null,
        targetKind: 'cluster_identity',
        operation: 'link',
        targetId: null,
        targetIdentity: `ambiguous:${stableEvidenceSourceIdentity(input.evidence)}:${clusterIds.join(':')}`,
        sourceRefs,
        authorityPolicyVersion: input.associationPolicyVersion,
        plannerVersion: RESOLVER_PLANNER_VERSION,
      }),
      status: 'pending',
    })
    .onConflictDoUpdate({
      target: [reconciliationOutputs.teamId, reconciliationOutputs.dedupeKey],
      set: {
        runId: input.runId,
        status: 'pending',
        updatedAt: new Date(),
      },
    })
    .returning({ id: reconciliationOutputs.id });
  return output?.id ?? null;
}

function groupAnchorsByEvidenceId(rows: AnchorRow[]): Map<string, AnchorRow[]> {
  const grouped = new Map<string, AnchorRow[]>();
  for (const row of rows) {
    const existing = grouped.get(row.evidenceId) ?? [];
    existing.push(row);
    grouped.set(row.evidenceId, existing);
  }
  return grouped;
}

function matchableAnchors(anchors: AnchorRow[]): AnchorRow[] {
  const seen = new Set<string>();
  const result: AnchorRow[] = [];
  for (const anchor of anchors) {
    if (anchor.strength === 'semantic') continue;
    const key = `${anchor.anchorType}\0${anchor.anchorValue}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(anchor);
  }
  return result;
}

async function findMatchingClusterIds(
  db: DbOrTx,
  teamId: string,
  anchors: AnchorRow[],
): Promise<string[]> {
  const clauses = anchors.map(
    (anchor) =>
      sql`(${artifactClusterAnchors.anchorType} = ${anchor.anchorType} AND ${artifactClusterAnchors.anchorValue} = ${anchor.anchorValue})`,
  );
  const rows = await db
    .select({ clusterId: artifactClusterAnchors.clusterId })
    .from(artifactClusterAnchors)
    .where(and(eq(artifactClusterAnchors.teamId, teamId), sql.join(clauses, sql.raw(' OR '))));
  return [...new Set(rows.map((row) => row.clusterId))].sort();
}

async function anchorsMatchingCluster(
  db: DbOrTx,
  teamId: string,
  clusterId: string,
  anchors: AnchorRow[],
): Promise<AnchorRow[]> {
  const clusterAnchors = await db
    .select({
      anchorType: artifactClusterAnchors.anchorType,
      anchorValue: artifactClusterAnchors.anchorValue,
    })
    .from(artifactClusterAnchors)
    .where(
      and(
        eq(artifactClusterAnchors.teamId, teamId),
        eq(artifactClusterAnchors.clusterId, clusterId),
      ),
    );
  const matched = new Set(
    clusterAnchors.map((anchor) => `${anchor.anchorType}\0${anchor.anchorValue}`),
  );
  return anchors.filter((anchor) => matched.has(`${anchor.anchorType}\0${anchor.anchorValue}`));
}

async function createClusterFromEvidence(
  db: DbOrTx,
  teamId: string,
  evidence: EvidenceRow,
  defaults: ResolveEvidenceClusterDefaults,
): Promise<{ clusterId: string }> {
  const [cluster] = await db
    .insert(artifactClusters)
    .values({
      teamId,
      artifactClusterKind: defaults.artifactClusterKind,
      artifactType: defaults.artifactType,
      canonicalName:
        defaults.canonicalName ??
        evidence.title ??
        evidence.externalObjectId ??
        'Untitled artifact',
      status: defaults.status ?? 'open',
      metadata: {
        ...(defaults.metadata ?? {}),
        created_by: 'reconciliation_anchor_resolution',
        seed_evidence_id: evidence.id,
      },
    })
    .returning({ clusterId: artifactClusters.id });
  if (!cluster) throw new Error('reconciliation_cluster_create_failed');
  return cluster;
}

async function loadClusterSnapshot(
  db: DbOrTx,
  teamId: string,
  clusterId: string,
): Promise<{ artifactClusterKind: ArtifactClusterKind }> {
  const [cluster] = await db
    .select({ artifactClusterKind: artifactClusters.artifactClusterKind })
    .from(artifactClusters)
    .where(and(eq(artifactClusters.teamId, teamId), eq(artifactClusters.id, clusterId)))
    .limit(1);
  if (!cluster) throw new Error('reconciliation_cluster_not_found');
  return cluster;
}

async function claimClusterAnchors(
  db: DbOrTx,
  teamId: string,
  clusterId: string,
  rawEventId: string,
  anchors: AnchorRow[],
): Promise<void> {
  await db
    .insert(artifactClusterAnchors)
    .values(
      anchors.map((anchor) => ({
        teamId,
        clusterId,
        anchorType: anchor.anchorType,
        anchorValue: anchor.anchorValue,
        strength: anchor.strength,
        sourceRawEventId: rawEventId,
        metadata: {
          source: anchor.source,
        },
      })),
    )
    .onConflictDoNothing();
}

function defaultAssociationSource(strengths: EvidenceStrength[]): EvidenceAssociationSource {
  if (strengths.includes('hard') || strengths.includes('provider')) return 'hard_anchor';
  if (strengths.includes('human')) return 'human';
  return 'structured_anchor';
}

function strongestAnchorStrength(strengths: EvidenceStrength[]): EvidenceStrength {
  if (strengths.includes('hard')) return 'hard';
  if (strengths.includes('provider')) return 'provider';
  if (strengths.includes('structured')) return 'structured';
  if (strengths.includes('human')) return 'human';
  return 'semantic';
}

function rationaleForAssociation(evidence: EvidenceRow, anchors: AnchorRow[]): string {
  const [first] = anchors;
  const anchorSummary = first ? `${first.anchorType}:${first.anchorValue}` : 'anchor';
  return `${evidence.provider ?? evidence.source} ${evidence.eventType} matched ${anchorSummary}`;
}

function sourceRefsForEvidence(evidence: EvidenceRow, associationId?: string): SourceRef[] {
  return [
    {
      source: evidence.provider ?? evidence.source,
      rawEventId: evidence.rawEventId,
      evidenceId: evidence.id,
      associationId: associationId ?? null,
      sourcePayloadRef: evidence.sourcePayloadRef,
    },
  ];
}

function stableEvidenceSourceIdentity(evidence: EvidenceRow): string {
  return evidence.rawEventId;
}

function outputAnchors(anchors: AnchorRow[]): {
  anchorType: string;
  anchorValue: string;
  strength: EvidenceStrength;
}[] {
  return anchors.map((anchor) => ({
    anchorType: anchor.anchorType,
    anchorValue: anchor.anchorValue,
    strength: anchor.strength,
  }));
}

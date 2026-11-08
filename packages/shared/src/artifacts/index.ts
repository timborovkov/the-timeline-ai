import {
  artifactEvidenceAssociations,
  artifactClusterAnchors,
  artifactClusters,
  entities,
  rawEvents,
  reconciliationEvidence,
  type Db,
} from '@timeline/db';
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';

import {
  driveFileObjectIdFromResolution,
  driveObjectLinkCandidates,
  driveSelectionsWithChangedLink,
  latestDriveObjectLinkHintsByFileIds,
  resolveDriveFileObjectLink,
  type DriveObjectLinkHints,
  type DriveSelectionObjectLink,
} from '#src/integrations/google-drive-capture.js';
import { evaluateAuthorityPolicy } from '#src/reconciliation/authority.js';
import { buildAssociationDedupeKey, type SourceRef } from '#src/reconciliation/core.js';
import { normalizeRawEventsToEvidence } from '#src/reconciliation/normalization.js';

import type { artifactEvidenceRole } from '@timeline/db';
import type { SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

export type ArtifactType = (typeof artifactClusters.$inferSelect)['artifactType'];
export type ArtifactClusterKind = (typeof artifactClusters.$inferSelect)['artifactClusterKind'];
export type ArtifactStatus = (typeof artifactClusters.$inferSelect)['status'];
export type EvidenceRole = (typeof artifactEvidenceRole.enumValues)[number];
export type EvidenceStrength = (typeof artifactEvidenceAssociations.$inferSelect)['strength'];
type AssociationRole = (typeof artifactEvidenceAssociations.$inferInsert)['role'];
type AssociationSource = (typeof artifactEvidenceAssociations.$inferInsert)['associationSource'];
interface VisibilityColumns {
  visibility: AnyPgColumn;
  visibilityOwnerUserId: AnyPgColumn;
  visibilityUserIds: AnyPgColumn;
}

export interface ArtifactAnchorInput {
  type: string;
  value: string;
  strength?: EvidenceStrength;
  metadata?: Record<string, unknown>;
}

export interface ArtifactEvidenceInput {
  teamId: string;
  artifactClusterKind?: ArtifactClusterKind;
  artifactType: ArtifactType;
  canonicalName: string;
  status?: ArtifactStatus;
  canonicalEntityId?: string | null;
  rawEventId?: string | null;
  suggestionId?: string | null;
  provider?: string | null;
  externalObjectId?: string | null;
  role: EvidenceRole;
  strength: EvidenceStrength;
  authoritative?: boolean;
  occurredAt?: Date | string | null;
  anchors?: ArtifactAnchorInput[];
  metadata?: Record<string, unknown>;
}

export interface ArtifactReconcileResult {
  clusterId: string;
  created: boolean;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ARTIFACT_HELPER_NORMALIZER_VERSION = 'artifact-helper-raw-event-2026-06';
const ARTIFACT_HELPER_ASSOCIATION_POLICY_VERSION = 'artifact-helper-association-2026-06';

function normalizeAnchor(input: ArtifactAnchorInput): ArtifactAnchorInput | null {
  const type = input.type
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.:-]+/g, '_');
  const value = input.value.trim().toLowerCase();
  if (!type || !value) return null;
  const normalized: ArtifactAnchorInput = {
    type,
    value,
    strength: input.strength ?? 'structured',
  };
  if (input.metadata !== undefined) normalized.metadata = input.metadata;
  return normalized;
}

function uniqueAnchors(inputs: ArtifactAnchorInput[]): ArtifactAnchorInput[] {
  const seen = new Set<string>();
  const result: ArtifactAnchorInput[] = [];
  for (const input of inputs) {
    const anchor = normalizeAnchor(input);
    if (!anchor) continue;
    const key = `${anchor.type}\0${anchor.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(anchor);
  }
  return result;
}

function teamScopedAnchorWhere(teamId: string, matchClauses: SQL[]): SQL | undefined {
  if (matchClauses.length === 0) return undefined;
  return and(eq(artifactClusterAnchors.teamId, teamId), or(...matchClauses));
}

async function findClusterByAnchors(
  db: Db,
  teamId: string,
  anchors: ArtifactAnchorInput[],
): Promise<string | null> {
  const matchableAnchors = anchors.filter((anchor) => anchor.strength !== 'semantic');
  if (matchableAnchors.length === 0) return null;
  const clauses = matchableAnchors.map(
    (anchor) =>
      sql`(${artifactClusterAnchors.anchorType} = ${anchor.type} AND ${artifactClusterAnchors.anchorValue} = ${anchor.value})`,
  );
  const where = teamScopedAnchorWhere(teamId, clauses);
  if (!where) return null;
  const rows = await db
    .select({
      clusterId: artifactClusterAnchors.clusterId,
      createdAt: artifactClusterAnchors.createdAt,
    })
    .from(artifactClusterAnchors)
    .where(where)
    .orderBy(artifactClusterAnchors.createdAt)
    .limit(1);
  return rows[0]?.clusterId ?? null;
}

async function findClusterByEntity(
  db: Db,
  teamId: string,
  entityId: string | null | undefined,
): Promise<string | null> {
  if (!entityId || !UUID_RE.test(entityId)) return null;
  const rows = await db
    .select({ id: artifactClusters.id })
    .from(artifactClusters)
    .where(
      and(
        eq(artifactClusters.teamId, teamId),
        eq(artifactClusters.canonicalEntityId, entityId),
        isNull(artifactClusters.archivedAt),
      ),
    )
    .limit(1);
  return rows[0]?.id ?? null;
}

async function createCluster(
  db: Db,
  input: ArtifactEvidenceInput,
): Promise<ArtifactReconcileResult> {
  const inserted = await db
    .insert(artifactClusters)
    .values({
      teamId: input.teamId,
      artifactClusterKind: input.artifactClusterKind ?? 'other',
      artifactType: input.artifactType,
      canonicalName: input.canonicalName,
      status: input.status ?? 'open',
      canonicalEntityId: input.canonicalEntityId ?? null,
      metadata: input.metadata ?? {},
    })
    .onConflictDoNothing()
    .returning({ id: artifactClusters.id });
  const id = inserted[0]?.id;
  if (id) return { clusterId: id, created: true };

  const fallback = await findClusterByEntity(db, input.teamId, input.canonicalEntityId);
  if (fallback) return { clusterId: fallback, created: false };
  throw new Error('artifact_cluster_create_failed');
}

async function attachEvidenceAssociation(
  db: Db,
  input: ArtifactEvidenceInput,
  clusterId: string,
): Promise<void> {
  if (!input.rawEventId || hasIntegrationProjection(input)) return;

  const evidence = await loadOrCreateEvidenceForRawEvent(db, input.teamId, input.rawEventId);
  if (!evidence) throw new Error('artifact_evidence_raw_event_not_found');

  const role = associationRoleForEvidence(input.role);
  const associationSource = associationSourceForEvidence(input);
  const sourceRef: SourceRef = {
    source: input.provider ?? evidence.provider ?? evidence.source,
    rawEventId: input.rawEventId,
    evidenceId: evidence.id,
    sourcePayloadRef: evidence.sourcePayloadRef,
  };

  await db
    .insert(artifactEvidenceAssociations)
    .values({
      teamId: input.teamId,
      clusterId,
      evidenceId: evidence.id,
      rawEventId: input.rawEventId,
      role,
      strength: input.strength,
      confidence: confidenceForEvidence(input),
      associationSource,
      rationale: `${input.role} evidence attached to ${input.artifactType} artifact`,
      sourceRefs: [sourceRef],
      visibility: evidence.visibility,
      visibilityOwnerUserId: evidence.visibilityOwnerUserId,
      visibilityUserIds: evidence.visibilityUserIds,
      visibilityFloor: evidence.visibility,
      visibilityFloorOwnerUserId: evidence.visibilityOwnerUserId,
      visibilityFloorUserIds: evidence.visibilityUserIds,
      metadata: {
        ...(input.metadata ?? {}),
        canonical_name: input.canonicalName,
        original_evidence_role: input.role,
        artifact_type: input.artifactType,
        canonical_entity_id: input.canonicalEntityId ?? null,
        suggestion_id: input.suggestionId ?? null,
        provider: input.provider ?? evidence.provider ?? null,
        external_object_id: input.externalObjectId ?? evidence.externalObjectId ?? null,
        ...(input.status ? { status: input.status } : {}),
      },
      dedupeKey: buildAssociationDedupeKey({
        teamId: input.teamId,
        clusterId,
        evidenceId: evidence.id,
        role,
        associationSource,
        associationPolicyVersion: ARTIFACT_HELPER_ASSOCIATION_POLICY_VERSION,
      }),
    })
    .onConflictDoNothing();
}

async function loadOrCreateEvidenceForRawEvent(db: Db, teamId: string, rawEventId: string) {
  const existing = await selectEvidenceForRawEvent(db, teamId, rawEventId);
  if (existing) return existing;

  await normalizeRawEventsToEvidence({
    db,
    teamId,
    rawEventIds: [rawEventId],
    normalizerVersion: ARTIFACT_HELPER_NORMALIZER_VERSION,
  });

  return selectEvidenceForRawEvent(db, teamId, rawEventId);
}

async function selectEvidenceForRawEvent(db: Db, teamId: string, rawEventId: string) {
  const rows = await db
    .select({
      id: reconciliationEvidence.id,
      source: reconciliationEvidence.source,
      provider: reconciliationEvidence.provider,
      externalObjectId: reconciliationEvidence.externalObjectId,
      sourcePayloadRef: reconciliationEvidence.sourcePayloadRef,
      visibility: reconciliationEvidence.visibility,
      visibilityOwnerUserId: reconciliationEvidence.visibilityOwnerUserId,
      visibilityUserIds: reconciliationEvidence.visibilityUserIds,
    })
    .from(reconciliationEvidence)
    .where(
      and(
        eq(reconciliationEvidence.teamId, teamId),
        eq(reconciliationEvidence.rawEventId, rawEventId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

function hasIntegrationProjection(input: ArtifactEvidenceInput): boolean {
  return typeof input.metadata?.integration_id === 'string';
}

function associationRoleForEvidence(role: EvidenceRole): AssociationRole {
  if (role === 'lifecycle_update') return 'lifecycle_update';
  if (role === 'decision') return 'decision';
  if (role === 'discussion') return 'discussion';
  if (role === 'error' || role === 'issue') return 'blocker';
  if (role === 'related_context') return 'related_context';
  if (role === 'review' || role === 'report') return 'discussion';
  if (role === 'document') return 'evidence_only';
  return 'update';
}

function associationSourceForEvidence(input: ArtifactEvidenceInput): AssociationSource {
  if (input.authoritative && input.provider) return 'authoritative_provider';
  if (input.strength === 'hard') return 'hard_anchor';
  if (input.strength === 'human') return 'human';
  if (input.strength === 'semantic') return 'model_candidate';
  return 'structured_anchor';
}

function confidenceForEvidence(input: ArtifactEvidenceInput): string {
  if (input.authoritative || input.strength === 'hard' || input.strength === 'provider')
    return 'high';
  if (input.strength === 'semantic') return 'low';
  return 'medium';
}

function visibilityVisibleToUser(row: VisibilityColumns, userId: string): SQL {
  return sql`(
    ${row.visibility} = 'team'
    OR (${row.visibility} = 'private' AND ${row.visibilityOwnerUserId} = ${userId})
    OR (
      ${row.visibility} = 'specific_users'
      AND COALESCE(${userId}::uuid = ANY(${row.visibilityUserIds}), false)
    )
  )`;
}

async function claimAnchors(
  db: Db,
  input: ArtifactEvidenceInput,
  clusterId: string,
  anchors: ArtifactAnchorInput[],
): Promise<string> {
  if (anchors.length === 0) return clusterId;
  const claimableAnchors = anchors.filter((anchor) => anchor.strength !== 'semantic');
  await db
    .insert(artifactClusterAnchors)
    .values(
      anchors.map((anchor) => ({
        teamId: input.teamId,
        clusterId,
        anchorType: anchor.type,
        anchorValue: anchor.value,
        strength: anchor.strength ?? input.strength,
        sourceRawEventId: input.rawEventId ?? null,
        metadata: anchor.metadata ?? {},
      })),
    )
    .onConflictDoNothing();
  await refreshDriveInheritanceAnchorMetadata(db, input.teamId, anchors);

  if (claimableAnchors.length === 0) return clusterId;
  const clauses = claimableAnchors.map(
    (anchor) =>
      sql`(${artifactClusterAnchors.anchorType} = ${anchor.type} AND ${artifactClusterAnchors.anchorValue} = ${anchor.value})`,
  );
  const where = teamScopedAnchorWhere(input.teamId, clauses);
  if (!where) return clusterId;
  const rows = await db
    .select({
      clusterId: artifactClusterAnchors.clusterId,
      createdAt: artifactClusterAnchors.createdAt,
    })
    .from(artifactClusterAnchors)
    .where(where)
    .orderBy(artifactClusterAnchors.createdAt)
    .limit(1);
  return rows[0]?.clusterId ?? clusterId;
}

function statusAuthorityRank(input: ArtifactEvidenceInput): number {
  if (!input.authoritative || !input.status) return 0;
  const roleRank = statusRoleRank(input);
  if (roleRank === 0) return 0;
  return statusStateRank(input.status) * 10_000 + roleRank * 100 + evidenceStrengthRank(input);
}

function canRefreshStatusFromSameSource(input: ArtifactEvidenceInput): boolean {
  if (!input.provider || !input.externalObjectId) return false;
  return ['error', 'issue', 'document', 'decision', 'schedule', 'rsvp'].includes(input.role);
}

function statusStateRank(status: ArtifactStatus): number {
  if (status === 'archived') return 70;
  if (status === 'cancelled') return 60;
  if (status === 'resolved') return 50;
  if (status === 'blocked') return 40;
  if (status === 'active') return 30;
  return 20;
}

function statusRoleRank(input: ArtifactEvidenceInput): number {
  if (!input.authoritative || !input.status) return 0;
  if (input.role === 'lifecycle_update') return 50;
  if (['approval', 'signature', 'payment', 'release'].includes(input.role)) return 40;
  if (['error', 'issue', 'document', 'decision', 'schedule', 'rsvp'].includes(input.role))
    return 30;
  if (['implementation', 'review'].includes(input.role)) return 20;
  if (input.role === 'discussion') return 10;
  return 5;
}

function identityRoleRank(input: ArtifactEvidenceInput): number {
  if (!input.authoritative) return 0;
  if (['error', 'report', 'issue'].includes(input.role)) return 50;
  if (['document', 'signature', 'payment', 'schedule', 'rsvp', 'decision'].includes(input.role))
    return 45;
  if (['approval', 'lifecycle_update'].includes(input.role)) return 40;
  if (['implementation', 'review', 'release'].includes(input.role)) return 20;
  if (input.role === 'discussion') return 10;
  return 5;
}

function evidenceStrengthRank(input: ArtifactEvidenceInput): number {
  if (input.strength === 'hard') return 50;
  if (input.strength === 'provider') return 40;
  if (input.strength === 'structured') return 30;
  if (input.strength === 'human') return 20;
  return 10;
}

function identityAuthorityRank(input: ArtifactEvidenceInput): number {
  const roleRank = identityRoleRank(input);
  return roleRank === 0 ? 0 : roleRank * 100 + evidenceStrengthRank(input);
}

function authorityEventType(input: ArtifactEvidenceInput): string {
  const metadataEventType = input.metadata?.event_type;
  if (typeof metadataEventType === 'string' && metadataEventType.trim()) {
    return metadataEventType.trim();
  }
  return input.role;
}

function hasDirectClusterAuthority(
  input: ArtifactEvidenceInput,
  target: { targetKind: 'cluster_lifecycle' | 'cluster_identity'; targetField: string | null },
): boolean {
  return (
    evaluateAuthorityPolicy({
      source: input.provider ? 'integration' : 'artifact',
      provider: input.provider ?? null,
      eventType: authorityEventType(input),
      clusterKind: input.artifactClusterKind ?? null,
      targetKind: target.targetKind,
      targetField: target.targetField,
      externalObjectId: input.externalObjectId ?? null,
      visibility: 'team',
      confidence: confidenceForEvidence(input) as 'low' | 'medium' | 'high',
      currentOwner:
        input.provider && input.externalObjectId
          ? { provider: input.provider, externalObjectId: input.externalObjectId }
          : null,
    }).decision === 'direct'
  );
}

function statusAuthorityAt(input: ArtifactEvidenceInput): string {
  const value = input.occurredAt;
  const date = value instanceof Date ? value : value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

async function updateClusterStatusFromAuthoritativeEvidence(
  db: Db,
  input: ArtifactEvidenceInput,
  clusterId: string,
): Promise<void> {
  if (!input.authoritative || !input.status) return;
  if (
    !hasDirectClusterAuthority(input, {
      targetKind: 'cluster_lifecycle',
      targetField: 'status',
    })
  ) {
    return;
  }
  const rank = statusAuthorityRank(input);
  const authorityAt = statusAuthorityAt(input);
  const sourceCanRefresh = canRefreshStatusFromSameSource(input);
  await db.execute(sql`
    UPDATE ${artifactClusters}
    SET
      status = ${input.status},
      metadata = ${artifactClusters.metadata}
        || jsonb_build_object(
          'status_authority_rank', ${rank}::int,
          'status_authority_at', ${authorityAt}::text,
          'status_authority_source', ${input.provider ?? input.strength}::text,
          'status_authority_provider', ${input.provider ?? ''}::text,
          'status_authority_external_object_id', ${input.externalObjectId ?? ''}::text,
          'status_authority_role', ${input.role}::text
        ),
      updated_at = NOW()
    WHERE ${artifactClusters.teamId} = ${input.teamId}
      AND ${artifactClusters.id} = ${clusterId}
      AND (
        (${artifactClusters.metadata} ->> 'status_authority_rank') IS NULL
        OR ((${artifactClusters.metadata} ->> 'status_authority_rank')::int < ${rank}::int)
        OR (
          ((${artifactClusters.metadata} ->> 'status_authority_rank')::int = ${rank}::int)
          AND COALESCE(${artifactClusters.metadata} ->> 'status_authority_at', '') <= ${authorityAt}::text
        )
        OR (
          ${sourceCanRefresh}::boolean
          AND COALESCE(${artifactClusters.metadata} ->> 'status_authority_provider', '') = ${input.provider ?? ''}::text
          AND COALESCE(${artifactClusters.metadata} ->> 'status_authority_external_object_id', '') = ${input.externalObjectId ?? ''}::text
          AND COALESCE(${artifactClusters.metadata} ->> 'status_authority_at', '') <= ${authorityAt}::text
        )
      )
  `);
}

async function updateClusterIdentityFromAuthoritativeEvidence(
  db: Db,
  input: ArtifactEvidenceInput,
  clusterId: string,
): Promise<void> {
  if (
    !hasDirectClusterAuthority(input, {
      targetKind: 'cluster_identity',
      targetField: 'identity',
    })
  ) {
    return;
  }
  const rank = identityAuthorityRank(input);
  if (rank === 0) return;
  const authorityAt = statusAuthorityAt(input);
  await db.execute(sql`
    UPDATE ${artifactClusters}
    SET
      artifact_type = ${input.artifactType},
      canonical_name = ${input.canonicalName},
      metadata = ${artifactClusters.metadata}
        || jsonb_build_object(
          'identity_authority_rank', ${rank}::int,
          'identity_authority_at', ${authorityAt}::text,
          'identity_authority_source', ${input.provider ?? input.strength}::text
        ),
      updated_at = NOW()
    WHERE ${artifactClusters.teamId} = ${input.teamId}
      AND ${artifactClusters.id} = ${clusterId}
      AND (
        (${artifactClusters.metadata} ->> 'identity_authority_rank') IS NULL
        OR ((${artifactClusters.metadata} ->> 'identity_authority_rank')::int < ${rank}::int)
        OR (
          ((${artifactClusters.metadata} ->> 'identity_authority_rank')::int = ${rank}::int)
          AND COALESCE(${artifactClusters.metadata} ->> 'identity_authority_at', '') <= ${authorityAt}::text
        )
      )
  `);
}

async function moveClaimedAnchorsToWinningCluster(
  db: Db,
  input: ArtifactEvidenceInput,
  fromClusterId: string,
  toClusterId: string,
  anchors: ArtifactAnchorInput[],
): Promise<void> {
  if (fromClusterId === toClusterId) return;
  const anchorClauses = anchors.map((anchor) =>
    and(
      eq(artifactClusterAnchors.anchorType, anchor.type),
      eq(artifactClusterAnchors.anchorValue, anchor.value),
    ),
  );
  if (anchorClauses.length === 0) return;
  await db
    .update(artifactClusterAnchors)
    .set({ clusterId: toClusterId })
    .where(
      and(
        eq(artifactClusterAnchors.teamId, input.teamId),
        eq(artifactClusterAnchors.clusterId, fromClusterId),
        or(...anchorClauses),
      ),
    );
}

async function updateClusterKindFromEvidence(
  db: Db,
  input: ArtifactEvidenceInput,
  clusterId: string,
): Promise<void> {
  const artifactClusterKind = input.artifactClusterKind;
  if (!artifactClusterKind || artifactClusterKind === 'other') return;
  await db
    .update(artifactClusters)
    .set({ artifactClusterKind, updatedAt: new Date() })
    .where(
      and(
        eq(artifactClusters.teamId, input.teamId),
        eq(artifactClusters.id, clusterId),
        eq(artifactClusters.artifactClusterKind, 'other'),
      ),
    );
}

export async function reconcileArtifactEvidence(
  db: Db,
  input: ArtifactEvidenceInput,
): Promise<ArtifactReconcileResult> {
  const anchors = uniqueAnchors([
    ...(input.anchors ?? []),
    ...(input.provider && input.externalObjectId
      ? [
          {
            type: `provider_external:${input.provider}`,
            value: input.externalObjectId,
            strength: 'hard' as const,
          },
        ]
      : []),
  ]);
  const clusterId =
    (await findClusterByAnchors(db, input.teamId, anchors)) ??
    (await findClusterByEntity(db, input.teamId, input.canonicalEntityId));
  const result = clusterId ? { clusterId, created: false } : await createCluster(db, input);
  const claimedClusterId = await claimAnchors(db, input, result.clusterId, anchors);
  await moveClaimedAnchorsToWinningCluster(db, input, result.clusterId, claimedClusterId, anchors);
  await updateClusterKindFromEvidence(db, input, claimedClusterId);

  await attachEvidenceAssociation(db, input, claimedClusterId);
  await updateClusterIdentityFromAuthoritativeEvidence(db, input, claimedClusterId);
  await updateClusterStatusFromAuthoritativeEvidence(db, input, claimedClusterId);

  return {
    clusterId: claimedClusterId,
    created: result.created && claimedClusterId === result.clusterId,
  };
}

export async function listArtifactClusterEvidence(
  db: Db,
  input: { teamId: string; clusterId: string; viewerUserId: string },
) {
  const associationVisibility = and(
    visibilityVisibleToUser(
      {
        visibility: artifactEvidenceAssociations.visibility,
        visibilityOwnerUserId: artifactEvidenceAssociations.visibilityOwnerUserId,
        visibilityUserIds: artifactEvidenceAssociations.visibilityUserIds,
      },
      input.viewerUserId,
    ),
    visibilityVisibleToUser(
      {
        visibility: artifactEvidenceAssociations.visibilityFloor,
        visibilityOwnerUserId: artifactEvidenceAssociations.visibilityFloorOwnerUserId,
        visibilityUserIds: artifactEvidenceAssociations.visibilityFloorUserIds,
      },
      input.viewerUserId,
    ),
  );

  const associationRows = await db
    .select({
      clusterId: artifactClusters.id,
      artifactType: artifactClusters.artifactType,
      canonicalName: artifactClusters.canonicalName,
      status: artifactClusters.status,
      rawEventId: rawEvents.id,
      entityId: sql<string | null>`NULL`,
      provider: reconciliationEvidence.provider,
      externalObjectId: reconciliationEvidence.externalObjectId,
      role: artifactEvidenceAssociations.role,
      strength: artifactEvidenceAssociations.strength,
      authoritative: sql<boolean>`${artifactEvidenceAssociations.associationSource} = 'authoritative_provider'`,
      contentText: rawEvents.contentText,
      objectName: sql<string | null>`NULL`,
    })
    .from(artifactClusters)
    .innerJoin(
      artifactEvidenceAssociations,
      and(
        eq(artifactEvidenceAssociations.clusterId, artifactClusters.id),
        eq(artifactEvidenceAssociations.teamId, input.teamId),
      ),
    )
    .innerJoin(
      reconciliationEvidence,
      and(
        eq(reconciliationEvidence.id, artifactEvidenceAssociations.evidenceId),
        eq(reconciliationEvidence.teamId, input.teamId),
      ),
    )
    .leftJoin(
      rawEvents,
      and(
        eq(
          rawEvents.id,
          sql`COALESCE(${artifactEvidenceAssociations.rawEventId}, ${reconciliationEvidence.rawEventId})`,
        ),
        eq(rawEvents.teamId, input.teamId),
      ),
    )
    .where(
      and(
        eq(artifactClusters.teamId, input.teamId),
        eq(artifactClusters.id, input.clusterId),
        associationVisibility,
      ),
    );

  const seen = new Set<string>();
  return associationRows.filter((row) => {
    const key = [
      row.clusterId,
      row.rawEventId ?? '',
      row.provider ?? '',
      row.externalObjectId ?? '',
      row.role,
      row.strength,
    ].join('\0');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function findArtifactClustersByAnchors(
  db: Db,
  input: { teamId: string; anchors: ArtifactAnchorInput[] },
) {
  const anchors = uniqueAnchors(input.anchors).filter((anchor) => anchor.strength !== 'semantic');
  if (anchors.length === 0) return [];
  const clauses = anchors.map(
    (anchor) =>
      sql`(${artifactClusterAnchors.anchorType} = ${anchor.type} AND ${artifactClusterAnchors.anchorValue} = ${anchor.value})`,
  );
  const where = teamScopedAnchorWhere(input.teamId, clauses);
  if (!where) return [];
  return db
    .select({
      id: artifactClusters.id,
      artifactType: artifactClusters.artifactType,
      canonicalName: artifactClusters.canonicalName,
      status: artifactClusters.status,
      anchorType: artifactClusterAnchors.anchorType,
      anchorValue: artifactClusterAnchors.anchorValue,
    })
    .from(artifactClusterAnchors)
    .innerJoin(
      artifactClusters,
      and(
        eq(artifactClusters.id, artifactClusterAnchors.clusterId),
        eq(artifactClusters.teamId, input.teamId),
      ),
    )
    .where(where);
}

async function clusterForLinkedObject(
  db: Db,
  input: { teamId: string; objectId: string | null },
): Promise<string | null> {
  if (!input.objectId) return null;
  const existing = await findClusterByEntity(db, input.teamId, input.objectId);
  if (existing) return existing;
  const [object] = await db
    .select({
      id: entities.id,
      type: entities.type,
      canonicalName: entities.canonicalName,
    })
    .from(entities)
    .where(and(eq(entities.id, input.objectId), eq(entities.teamId, input.teamId)))
    .limit(1);
  if (!object) return null;
  const created = await createCluster(db, {
    teamId: input.teamId,
    artifactType: object.type,
    canonicalName: object.canonicalName,
    canonicalEntityId: object.id,
    role: 'related_context',
    strength: 'hard',
  });
  return created.clusterId;
}

function driveFileAnchorValues(fileId: string): ArtifactAnchorInput[] {
  return uniqueAnchors([
    { type: 'provider_object', value: `google_drive:${fileId}`, strength: 'hard' },
    { type: 'provider_external:google_drive', value: fileId, strength: 'hard' },
    { type: 'alias:file', value: fileId, strength: 'structured' },
  ]);
}

function driveProviderObjectFileId(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  const prefix = 'google_drive:';
  if (!normalized.startsWith(prefix)) return null;
  const fileId = normalized.slice(prefix.length).trim();
  return fileId || null;
}

function driveFileOwnsAnchorValue(value: string, fileId: string): boolean {
  const needle = fileId.trim().toLowerCase();
  const hay = value.trim().toLowerCase();
  if (!needle || !hay) return false;
  if (hay === needle || hay === `google_drive:${needle}`) return true;
  try {
    const url = new URL(value);
    const parts = url.pathname
      .split('/')
      .filter(Boolean)
      .map((part) => part.toLowerCase());
    if (parts.includes(needle)) return true;
    return url.searchParams.get('id')?.toLowerCase() === needle;
  } catch {
    return false;
  }
}

async function moveDriveFileAnchors(
  db: Db,
  input: { teamId: string; fileId: string; targetClusterId: string },
): Promise<void> {
  const fileId = uniqueAnchors([
    { type: 'alias:file', value: input.fileId, strength: 'structured' },
  ])[0]?.value;
  if (!fileId) return;
  const candidates = await db
    .select({
      clusterId: artifactClusterAnchors.clusterId,
      anchorType: artifactClusterAnchors.anchorType,
      anchorValue: artifactClusterAnchors.anchorValue,
      strength: artifactClusterAnchors.strength,
    })
    .from(artifactClusterAnchors)
    .where(
      and(
        eq(artifactClusterAnchors.teamId, input.teamId),
        sql`position(${fileId} in ${artifactClusterAnchors.anchorValue}) > 0`,
      ),
    );
  const owned = candidates.filter(
    (row) => row.strength !== 'semantic' && driveFileOwnsAnchorValue(row.anchorValue, fileId),
  );
  if (owned.length === 0) return;
  const clusterIds = [...new Set(owned.map((row) => row.clusterId))];
  const siblingRows =
    clusterIds.length > 0
      ? await db
          .select({
            clusterId: artifactClusterAnchors.clusterId,
            anchorValue: artifactClusterAnchors.anchorValue,
          })
          .from(artifactClusterAnchors)
          .where(
            and(
              eq(artifactClusterAnchors.teamId, input.teamId),
              inArray(artifactClusterAnchors.clusterId, clusterIds),
              eq(artifactClusterAnchors.anchorType, 'provider_object'),
            ),
          )
      : [];
  const siblingIdsByCluster = new Map<string, string[]>();
  for (const row of siblingRows) {
    const siblingId = driveProviderObjectFileId(row.anchorValue);
    if (!siblingId || siblingId === fileId) continue;
    const siblings = siblingIdsByCluster.get(row.clusterId) ?? [];
    siblings.push(siblingId);
    siblingIdsByCluster.set(row.clusterId, siblings);
  }
  const movable = owned.filter((row) => {
    const siblings = siblingIdsByCluster.get(row.clusterId) ?? [];
    return !siblings.some((siblingId) => driveFileOwnsAnchorValue(row.anchorValue, siblingId));
  });
  const clauses = movable.map(
    (row) =>
      sql`(${artifactClusterAnchors.anchorType} = ${row.anchorType} AND ${artifactClusterAnchors.anchorValue} = ${row.anchorValue})`,
  );
  const where = teamScopedAnchorWhere(input.teamId, clauses);
  if (!where) return;
  await db.update(artifactClusterAnchors).set({ clusterId: input.targetClusterId }).where(where);
}

async function refreshDriveInheritanceAnchorMetadata(
  db: Db,
  teamId: string,
  anchors: ArtifactAnchorInput[],
): Promise<void> {
  for (const anchor of anchors) {
    const patch = driveInheritanceMetadataPatch(anchor.metadata);
    if (!patch) continue;
    await db
      .update(artifactClusterAnchors)
      .set({
        metadata: sql`COALESCE(${artifactClusterAnchors.metadata}, '{}'::jsonb) || ${JSON.stringify(
          patch,
        )}::jsonb`,
      })
      .where(
        and(
          eq(artifactClusterAnchors.teamId, teamId),
          eq(artifactClusterAnchors.anchorType, anchor.type),
          eq(artifactClusterAnchors.anchorValue, anchor.value),
        ),
      );
  }
}

function driveInheritanceMetadataPatch(
  metadata: Record<string, unknown> | undefined,
): Record<string, unknown> | null {
  if (!metadata) return null;
  const inheritedFrom =
    typeof metadata.drive_inherited_from === 'string' ? metadata.drive_inherited_from : null;
  const candidates = stringArray(metadata.drive_inherited_candidates);
  const integrationId =
    typeof metadata.drive_integration_id === 'string' ? metadata.drive_integration_id : null;
  if (!inheritedFrom && candidates.length === 0 && !integrationId) return null;
  return {
    ...(inheritedFrom ? { drive_inherited_from: inheritedFrom } : {}),
    ...(candidates.length > 0 ? { drive_inherited_candidates: candidates } : {}),
    ...(integrationId ? { drive_integration_id: integrationId } : {}),
  };
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function driveInheritanceCandidatesFromAnchorMetadata(metadata: unknown): {
  candidates: string[] | null;
  integrationId: string | null;
} {
  const record = asRecord(metadata);
  if (!record) return { candidates: null, integrationId: null };
  const integrationId =
    typeof record.drive_integration_id === 'string' ? record.drive_integration_id : null;
  const candidates = stringArray(record.drive_inherited_candidates);
  if (candidates.length > 0) return { candidates, integrationId };
  const inheritedFrom =
    typeof record.drive_inherited_from === 'string' ? record.drive_inherited_from : null;
  if (inheritedFrom) return { candidates: [inheritedFrom], integrationId };
  return { candidates: null, integrationId };
}

function emptyDriveObjectLinkHints(): DriveObjectLinkHints {
  return { parentIds: [], driveId: null, matchedAncestorId: null, inheritedCandidates: null };
}

function driveAncestryIncludesSelection(
  candidates: readonly string[] | null | undefined,
  changedExternalId: string,
): boolean {
  const changed = changedExternalId.trim().toLowerCase();
  if (!changed || !candidates) return false;
  return candidates.some((id) => id.trim().toLowerCase() === changed);
}

function candidatesFromDriveLinkHints(
  fileId: string,
  hints: DriveObjectLinkHints,
): string[] | null {
  if (hints.inheritedCandidates && hints.inheritedCandidates.length > 0) {
    return hints.inheritedCandidates;
  }
  if (hints.parentIds.length === 0 && !hints.driveId && !hints.matchedAncestorId) return null;
  return driveObjectLinkCandidates({
    fileId,
    parentIds: hints.parentIds,
    ...(hints.matchedAncestorId ? { matchedAncestorId: hints.matchedAncestorId } : {}),
    ...(hints.driveId ? { driveId: hints.driveId } : {}),
  });
}

async function fillMissingDriveFileCandidates(
  db: Db,
  input: { teamId: string; integrationId: string; fileIds: string[] },
  candidatesByFileId: Map<string, string[] | null>,
): Promise<void> {
  const missing = [
    ...new Set(input.fileIds.filter((fileId) => !candidatesByFileId.get(fileId))),
  ].filter(Boolean);
  if (missing.length === 0) return;
  const hints = await latestDriveObjectLinkHintsByFileIds(db, {
    teamId: input.teamId,
    integrationId: input.integrationId,
    fileIds: missing,
  });
  for (const fileId of missing) {
    if (candidatesByFileId.get(fileId)) continue;
    candidatesByFileId.set(
      fileId,
      candidatesFromDriveLinkHints(fileId, hints.get(fileId) ?? emptyDriveObjectLinkHints()),
    );
  }
}

async function collectInheritedDriveFilesForSelection(
  db: Db,
  input: {
    teamId: string;
    integrationId: string;
    previousObjectId: string | null;
    changedExternalId: string;
  },
): Promise<Map<string, string[] | null>> {
  const inherited = await db
    .select({
      anchorValue: artifactClusterAnchors.anchorValue,
      metadata: artifactClusterAnchors.metadata,
      canonicalEntityId: artifactClusters.canonicalEntityId,
    })
    .from(artifactClusterAnchors)
    .innerJoin(
      artifactClusters,
      and(
        eq(artifactClusters.id, artifactClusterAnchors.clusterId),
        eq(artifactClusters.teamId, input.teamId),
      ),
    )
    .where(
      and(
        eq(artifactClusters.teamId, input.teamId),
        eq(artifactClusterAnchors.anchorType, 'provider_object'),
        sql`${artifactClusterAnchors.anchorValue} LIKE ${'google_drive:%'}`,
      ),
    );
  const candidatesByFileId = new Map<string, string[] | null>();
  const unresolvedFileIds: string[] = [];
  const unstampedOnPreviousCluster = new Set<string>();
  for (const row of inherited) {
    const fileId = row.anchorValue.slice('google_drive:'.length);
    if (!fileId) continue;
    const stamp = driveInheritanceCandidatesFromAnchorMetadata(row.metadata);
    if (
      stamp.integrationId &&
      stamp.integrationId.trim().toLowerCase() !== input.integrationId.trim().toLowerCase()
    ) {
      continue;
    }
    const onPreviousCluster = input.previousObjectId
      ? row.canonicalEntityId === input.previousObjectId
      : row.canonicalEntityId === null;
    if (
      stamp.candidates &&
      driveAncestryIncludesSelection(stamp.candidates, input.changedExternalId)
    ) {
      candidatesByFileId.set(fileId, stamp.candidates);
      continue;
    }
    unresolvedFileIds.push(fileId);
    if (onPreviousCluster && !stamp.candidates) unstampedOnPreviousCluster.add(fileId);
  }
  if (unresolvedFileIds.length > 0) {
    const hints = await latestDriveObjectLinkHintsByFileIds(db, {
      teamId: input.teamId,
      integrationId: input.integrationId,
      fileIds: unresolvedFileIds,
    });
    for (const fileId of unresolvedFileIds) {
      if (candidatesByFileId.has(fileId)) continue;
      const fromHints = candidatesFromDriveLinkHints(
        fileId,
        hints.get(fileId) ?? emptyDriveObjectLinkHints(),
      );
      if (driveAncestryIncludesSelection(fromHints, input.changedExternalId)) {
        candidatesByFileId.set(fileId, fromHints);
        continue;
      }
      if (unstampedOnPreviousCluster.has(fileId)) candidatesByFileId.set(fileId, fromHints);
    }
  }
  return candidatesByFileId;
}

function resolveDriveFileLinkAfterChange(input: {
  fileId: string;
  selectionKind: string;
  changedExternalId: string;
  previousObjectId: string | null;
  selections: DriveSelectionObjectLink[];
  candidates?: string[] | null;
}): { nextObjectId: string | null; skip: boolean } {
  const changed = {
    kind: input.selectionKind,
    externalId: input.changedExternalId,
    linkedObjectId: input.previousObjectId,
  };
  const previousSelections = driveSelectionsWithChangedLink(input.selections, changed);
  const fallback = input.selectionKind === 'drive.file' ? 'unique_container' : 'last_container';
  const previous = resolveDriveFileObjectLink({
    fileId: input.fileId,
    selections: previousSelections,
    ...(input.candidates !== undefined ? { candidates: input.candidates } : {}),
    fallback,
    changedExternalId: input.changedExternalId,
  });
  const next = resolveDriveFileObjectLink({
    fileId: input.fileId,
    selections: input.selections,
    ...(input.candidates !== undefined ? { candidates: input.candidates } : {}),
    fallback,
    changedExternalId: input.changedExternalId,
  });
  if (next.kind === 'keep') return { nextObjectId: input.previousObjectId, skip: true };
  const previousObjectId = driveFileObjectIdFromResolution(previous, input.previousObjectId);
  const nextObjectId = driveFileObjectIdFromResolution(next, input.previousObjectId);
  return { nextObjectId, skip: previousObjectId === nextObjectId };
}

/**
 * Move one Drive file's artifact anchors onto the cluster for `nextObjectId`.
 * Capture uses this when the live resolver picks a different linked ancestor
 * (file moved between folders) so later evidence attach follows that object.
 * Other files on the previous cluster are left in place.
 */
export async function rebindDriveFileObjectLink(
  db: Db,
  input: {
    teamId: string;
    fileId: string;
    nextObjectId: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  const current = await findClusterByAnchors(db, input.teamId, driveFileAnchorValues(input.fileId));
  if (!current) return;
  const targetClusterId = await clusterForLinkedObject(db, {
    teamId: input.teamId,
    objectId: input.nextObjectId,
  });
  if (!targetClusterId) return;
  if (current !== targetClusterId) {
    await moveDriveFileAnchors(db, {
      teamId: input.teamId,
      fileId: input.fileId,
      targetClusterId,
    });
  }
  if (!input.metadata) return;
  await refreshDriveInheritanceAnchorMetadata(db, input.teamId, [
    {
      type: 'provider_object',
      value: `google_drive:${input.fileId}`,
      strength: 'hard',
      metadata: input.metadata,
    },
  ]);
}

/**
 * When a Drive selection's workspace object link changes, move each affected
 * file onto the object that live-capture precedence would pick from the
 * post-change selection set. A remaining overlapping container keeps the
 * previous object only when it appears earlier in the candidate walk.
 * Assigning a previously unlinked folder or shared drive rebinds files whose
 * ancestry includes that selection, including files already on an outer folder
 * or shared-drive object, then applies live-capture before/after precedence.
 */
export async function rebindDriveSelectionArtifactLink(
  db: Db,
  input: {
    teamId: string;
    integrationId: string;
    selectionKind: string;
    externalId: string;
    previousObjectId: string | null;
    selections?: DriveSelectionObjectLink[];
  },
): Promise<string[]> {
  const selections = input.selections ?? [];
  const candidatesByFileId = new Map<string, string[] | null>();
  if (input.selectionKind === 'drive.file') candidatesByFileId.set(input.externalId, null);
  if (input.selectionKind === 'drive.folder' || input.selectionKind === 'drive.shared_drive') {
    for (const [fileId, candidates] of await collectInheritedDriveFilesForSelection(db, {
      teamId: input.teamId,
      integrationId: input.integrationId,
      previousObjectId: input.previousObjectId,
      changedExternalId: input.externalId,
    })) {
      candidatesByFileId.set(fileId, candidates);
    }
  }
  if (candidatesByFileId.size === 0) return [];
  const unknownFileIds = [...candidatesByFileId]
    .filter(([, candidates]) => !candidates)
    .map(([fileId]) => fileId);
  if (unknownFileIds.length > 0) {
    await fillMissingDriveFileCandidates(
      db,
      {
        teamId: input.teamId,
        integrationId: input.integrationId,
        fileIds: unknownFileIds,
      },
      candidatesByFileId,
    );
  }
  const clusterByObjectId = new Map<string | null, string | null>();
  const rebound: string[] = [];
  for (const [fileId, candidates] of candidatesByFileId) {
    const resolved = resolveDriveFileLinkAfterChange({
      fileId,
      selectionKind: input.selectionKind,
      changedExternalId: input.externalId,
      previousObjectId: input.previousObjectId,
      selections,
      candidates,
    });
    if (resolved.skip) continue;
    rebound.push(fileId);
    const nextObjectId = resolved.nextObjectId;
    let targetClusterId = clusterByObjectId.get(nextObjectId);
    if (targetClusterId === undefined) {
      if (nextObjectId) {
        targetClusterId = await clusterForLinkedObject(db, {
          teamId: input.teamId,
          objectId: nextObjectId,
        });
      } else {
        targetClusterId = null;
      }
      clusterByObjectId.set(nextObjectId, targetClusterId ?? null);
    }
    if (nextObjectId) {
      if (!targetClusterId) continue;
      await moveDriveFileAnchors(db, {
        teamId: input.teamId,
        fileId,
        targetClusterId,
      });
      continue;
    }
    if (targetClusterId) {
      await moveDriveFileAnchors(db, {
        teamId: input.teamId,
        fileId,
        targetClusterId,
      });
      continue;
    }
    const current = await findClusterByAnchors(db, input.teamId, driveFileAnchorValues(fileId));
    if (!current) continue;
    const [source] = await db
      .select({
        id: artifactClusters.id,
        artifactType: artifactClusters.artifactType,
        canonicalName: artifactClusters.canonicalName,
        canonicalEntityId: artifactClusters.canonicalEntityId,
      })
      .from(artifactClusters)
      .where(and(eq(artifactClusters.teamId, input.teamId), eq(artifactClusters.id, current)))
      .limit(1);
    if (!source?.canonicalEntityId) continue;
    const unbound = await createCluster(db, {
      teamId: input.teamId,
      artifactType: source.artifactType,
      canonicalName: source.canonicalName,
      canonicalEntityId: null,
      role: 'related_context',
      strength: 'hard',
    });
    clusterByObjectId.set(null, unbound.clusterId);
    await moveDriveFileAnchors(db, {
      teamId: input.teamId,
      fileId,
      targetClusterId: unbound.clusterId,
    });
  }
  return rebound;
}

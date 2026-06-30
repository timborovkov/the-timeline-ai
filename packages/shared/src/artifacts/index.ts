import {
  artifactEvidenceAssociations,
  artifactClusterAnchors,
  artifactClusterMembers,
  artifactClusters,
  entities,
  rawEvents,
  reconciliationEvidence,
  type Db,
} from '@timeline/db';
import { and, eq, isNull, or, sql } from 'drizzle-orm';

import type { SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

import { buildAssociationDedupeKey, type SourceRef } from '#src/reconciliation/index.js';
import { normalizeRawEventsToEvidence } from '#src/reconciliation/normalization.js';

export type ArtifactType = (typeof artifactClusters.$inferSelect)['artifactType'];
export type ArtifactClusterKind = (typeof artifactClusters.$inferSelect)['artifactClusterKind'];
export type ArtifactStatus = (typeof artifactClusters.$inferSelect)['status'];
export type EvidenceRole = (typeof artifactClusterMembers.$inferSelect)['role'];
export type EvidenceStrength = (typeof artifactClusterMembers.$inferSelect)['strength'];
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
  const rows = await db
    .select({
      clusterId: artifactClusterAnchors.clusterId,
      createdAt: artifactClusterAnchors.createdAt,
    })
    .from(artifactClusterAnchors)
    .where(and(eq(artifactClusterAnchors.teamId, teamId), sql.join(clauses, sql.raw(' OR '))))
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
  if (input.authoritative) return 'authoritative_provider';
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

  if (claimableAnchors.length === 0) return clusterId;
  const clauses = claimableAnchors.map(
    (anchor) =>
      sql`(${artifactClusterAnchors.anchorType} = ${anchor.type} AND ${artifactClusterAnchors.anchorValue} = ${anchor.value})`,
  );
  const rows = await db
    .select({
      clusterId: artifactClusterAnchors.clusterId,
      createdAt: artifactClusterAnchors.createdAt,
    })
    .from(artifactClusterAnchors)
    .where(and(eq(artifactClusterAnchors.teamId, input.teamId), sql.join(clauses, sql.raw(' OR '))))
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
  const rawEventVisibility = visibilityVisibleToUser(
    {
      visibility: rawEvents.visibility,
      visibilityOwnerUserId: rawEvents.visibilityOwnerUserId,
      visibilityUserIds: rawEvents.visibilityUserIds,
    },
    input.viewerUserId,
  );
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

  const legacyRows = await db
    .select({
      clusterId: artifactClusters.id,
      artifactType: artifactClusters.artifactType,
      canonicalName: artifactClusters.canonicalName,
      status: artifactClusters.status,
      rawEventId: artifactClusterMembers.rawEventId,
      entityId: artifactClusterMembers.entityId,
      provider: artifactClusterMembers.provider,
      externalObjectId: artifactClusterMembers.externalObjectId,
      role: artifactClusterMembers.role,
      strength: artifactClusterMembers.strength,
      authoritative: artifactClusterMembers.authoritative,
      contentText: rawEvents.contentText,
      objectName: entities.canonicalName,
    })
    .from(artifactClusters)
    .innerJoin(
      artifactClusterMembers,
      and(
        eq(artifactClusterMembers.clusterId, artifactClusters.id),
        eq(artifactClusterMembers.teamId, input.teamId),
      ),
    )
    .leftJoin(
      rawEvents,
      and(eq(rawEvents.id, artifactClusterMembers.rawEventId), eq(rawEvents.teamId, input.teamId)),
    )
    .leftJoin(
      entities,
      and(eq(entities.id, artifactClusterMembers.entityId), eq(entities.teamId, input.teamId)),
    )
    .where(
      and(
        eq(artifactClusters.teamId, input.teamId),
        eq(artifactClusters.id, input.clusterId),
        or(isNull(artifactClusterMembers.rawEventId), rawEventVisibility),
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

  const rows = [...associationRows, ...legacyRows];
  const seen = new Set<string>();
  return rows.filter((row) => {
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
    .where(
      and(eq(artifactClusterAnchors.teamId, input.teamId), sql.join(clauses, sql.raw(' OR '))),
    );
}

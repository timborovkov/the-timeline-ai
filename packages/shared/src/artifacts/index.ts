import {
  artifactClusterAnchors,
  artifactClusterMembers,
  artifactClusters,
  entities,
  rawEvents,
  type Db,
} from '@timeline/db';
import { and, eq, isNull, or, sql } from 'drizzle-orm';

export type ArtifactType = (typeof artifactClusters.$inferSelect)['artifactType'];
export type ArtifactStatus = (typeof artifactClusters.$inferSelect)['status'];
export type EvidenceRole = (typeof artifactClusterMembers.$inferSelect)['role'];
export type EvidenceStrength = (typeof artifactClusterMembers.$inferSelect)['strength'];

export interface ArtifactAnchorInput {
  type: string;
  value: string;
  strength?: EvidenceStrength;
  metadata?: Record<string, unknown>;
}

export interface ArtifactEvidenceInput {
  teamId: string;
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

async function attachMember(
  db: Db,
  input: ArtifactEvidenceInput,
  clusterId: string,
): Promise<void> {
  await db
    .insert(artifactClusterMembers)
    .values({
      teamId: input.teamId,
      clusterId,
      rawEventId: input.rawEventId ?? null,
      entityId: input.canonicalEntityId ?? null,
      suggestionId: input.suggestionId ?? null,
      provider: input.provider ?? null,
      externalObjectId: input.externalObjectId ?? null,
      role: input.role,
      strength: input.strength,
      authoritative: input.authoritative ?? false,
      metadata: {
        ...(input.metadata ?? {}),
        canonical_name: input.canonicalName,
        ...(input.status ? { status: input.status } : {}),
      },
    })
    .onConflictDoNothing();
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
  await db.execute(sql`
    UPDATE ${artifactClusters}
    SET
      status = ${input.status},
      metadata = ${artifactClusters.metadata}
        || jsonb_build_object(
          'status_authority_rank', ${rank}::int,
          'status_authority_at', ${authorityAt}::text,
          'status_authority_source', ${input.provider ?? input.strength}::text
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

  await attachMember(db, input, claimedClusterId);
  await updateClusterIdentityFromAuthoritativeEvidence(db, input, claimedClusterId);
  await updateClusterStatusFromAuthoritativeEvidence(db, input, claimedClusterId);

  return {
    clusterId: claimedClusterId,
    created: result.created && claimedClusterId === result.clusterId,
  };
}

export async function listArtifactClusterEvidence(
  db: Db,
  input: { teamId: string; clusterId: string },
) {
  return db
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
    .innerJoin(artifactClusterMembers, eq(artifactClusterMembers.clusterId, artifactClusters.id))
    .leftJoin(rawEvents, eq(rawEvents.id, artifactClusterMembers.rawEventId))
    .leftJoin(entities, eq(entities.id, artifactClusterMembers.entityId))
    .where(
      and(eq(artifactClusters.teamId, input.teamId), eq(artifactClusters.id, input.clusterId)),
    );
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
    .innerJoin(artifactClusters, eq(artifactClusters.id, artifactClusterAnchors.clusterId))
    .where(
      and(eq(artifactClusterAnchors.teamId, input.teamId), sql.join(clauses, sql.raw(' OR '))),
    );
}

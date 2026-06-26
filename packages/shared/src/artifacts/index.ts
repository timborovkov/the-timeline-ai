import {
  artifactClusterAnchors,
  artifactClusterMembers,
  artifactClusters,
  entities,
  rawEvents,
  type Db,
} from '@timeline/db';
import { and, eq, isNull, sql } from 'drizzle-orm';

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
  anchors?: ArtifactAnchorInput[];
  metadata?: Record<string, unknown>;
}

export interface ArtifactReconcileResult {
  clusterId: string;
  created: boolean;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
      metadata: input.metadata ?? {},
    })
    .onConflictDoNothing();
}

async function attachAnchors(
  db: Db,
  input: ArtifactEvidenceInput,
  clusterId: string,
  anchors: ArtifactAnchorInput[],
): Promise<void> {
  if (anchors.length === 0) return;
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

  await attachMember(db, input, result.clusterId);
  await attachAnchors(db, input, result.clusterId, anchors);

  return result;
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

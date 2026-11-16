import { artifactClusterAnchors, artifactClusters, entities, type Db } from '@timeline/db';
import { and, eq, isNull, or, sql, type SQL } from 'drizzle-orm';

import type {
  ArtifactAnchorInput,
  ArtifactEvidenceInput,
  ArtifactReconcileResult,
} from '#src/artifacts/index.js';
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
  if (input.metadataPatch !== undefined) normalized.metadataPatch = input.metadataPatch;
  return normalized;
}

export function uniqueAnchors(inputs: ArtifactAnchorInput[]): ArtifactAnchorInput[] {
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

export function teamScopedAnchorWhere(teamId: string, matchClauses: SQL[]): SQL | undefined {
  if (matchClauses.length === 0) return undefined;
  return and(eq(artifactClusterAnchors.teamId, teamId), or(...matchClauses));
}

export async function findClusterByAnchors(
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

export async function findClusterByEntity(
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

export async function createCluster(
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

export async function clusterForLinkedObject(
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

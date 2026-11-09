import { artifactClusterAnchors, artifactClusters, type Db } from '@timeline/db';
import { and, eq, inArray, sql } from 'drizzle-orm';

import { refreshArtifactAnchorMetadata } from '#src/artifacts/anchor-metadata.js';
import {
  clusterForLinkedObject,
  createCluster,
  findClusterByAnchors,
  teamScopedAnchorWhere,
  uniqueAnchors,
} from '#src/artifacts/cluster-store.js';
import {
  latestDriveObjectLinkHintsByFileIds,
  type DriveObjectLinkHints,
} from '#src/integrations/google-drive-capture.js';
import {
  driveInheritanceCandidatesFromAnchorMetadata,
  driveInheritanceMetadataPatch,
  emptyDriveObjectLinkHints,
} from '#src/integrations/google-drive-contracts.js';
import {
  driveFileObjectIdFromResolution,
  driveObjectLinkCandidates,
  driveSelectionsWithChangedLink,
  resolveDriveFileObjectLink,
  type DriveSelectionObjectLink,
} from '#src/integrations/google-drive-link-policy.js';

import type { ArtifactAnchorInput } from '#src/artifacts/index.js';

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
  const metadataPatch = driveInheritanceMetadataPatch(input.metadata);
  if (!metadataPatch) return;
  await refreshArtifactAnchorMetadata(db, input.teamId, [
    {
      type: 'provider_object',
      value: `google_drive:${input.fileId}`,
      strength: 'hard',
      metadataPatch,
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

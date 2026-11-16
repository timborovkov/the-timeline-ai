import type { DriveSnapshotLocate } from '#src/integrations/google-drive-diff.js';

export interface DrivePermissionGrant {
  id: string;
  type: string;
  role: string;
  email: string;
  domain: string;
}

export interface DriveSnapshotRecord {
  contentHash: string;
  snapshotText: string;
  commentsHash: string;
  permissionsHash: string;
  mimeType: string | null;
  commentsSnapshot?: unknown;
  permissionsSnapshot?: DrivePermissionGrant[];
  snapshotLocate?: DriveSnapshotLocate | null;
  ancestry?: DriveObjectLinkHints | null;
}

export interface DriveObjectLinkHints {
  parentIds: string[];
  driveId: string | null;
  matchedAncestorId: string | null;
  inheritedCandidates: string[] | null;
}

/** Persisted rows may predate hashes added by later capture versions. */
export type StoredDriveSnapshot = Omit<DriveSnapshotRecord, 'commentsHash' | 'permissionsHash'> & {
  commentsHash: string | null;
  permissionsHash: string | null;
};

export function driveInheritanceMetadataPatch(
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

export function driveInheritanceCandidatesFromAnchorMetadata(metadata: unknown): {
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

export function emptyDriveObjectLinkHints(): DriveObjectLinkHints {
  return { parentIds: [], driveId: null, matchedAncestorId: null, inheritedCandidates: null };
}

export function driveInheritanceAnchorMetadataFromSource(
  drive: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const inheritedFrom =
    typeof drive.inherited_from === 'string' && drive.inherited_from.trim().length > 0
      ? drive.inherited_from
      : null;
  const candidates = Array.isArray(drive.inherited_candidates)
    ? drive.inherited_candidates.filter(
        (item): item is string => typeof item === 'string' && item.trim().length > 0,
      )
    : [];
  const integrationId =
    typeof drive.integration_id === 'string' && drive.integration_id.trim().length > 0
      ? drive.integration_id
      : null;
  if (!inheritedFrom && candidates.length === 0 && !integrationId) return undefined;
  return {
    ...(inheritedFrom ? { drive_inherited_from: inheritedFrom } : {}),
    ...(candidates.length > 0 ? { drive_inherited_candidates: candidates } : {}),
    ...(integrationId ? { drive_integration_id: integrationId } : {}),
  };
}

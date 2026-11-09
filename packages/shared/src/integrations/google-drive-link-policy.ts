import {
  emptyDriveObjectLinkHints,
  type DriveObjectLinkHints,
} from '#src/integrations/google-drive-contracts.js';
import {
  DRIVE_FOLDER_KIND,
  DRIVE_SHARED_DRIVE_KIND,
  driveAncestryIds,
  driveAncestorKindFromSelectionKind,
  pickMostSpecificDriveAncestor,
} from '#src/integrations/google-drive-scope.js';

export function driveObjectLinkCandidates(input: {
  fileId: string;
  parentIds: string[];
  matchedAncestorId?: string | null;
  driveId?: string | null;
  myDriveRootId?: string | null;
}): string[] {
  return driveAncestryIds({
    fileId: input.fileId,
    parentIds: input.parentIds,
    ...(input.matchedAncestorId !== undefined
      ? { matchedAncestorId: input.matchedAncestorId }
      : {}),
    ...(input.driveId !== undefined ? { driveId: input.driveId } : {}),
    ...(input.myDriveRootId !== undefined ? { myDriveRootId: input.myDriveRootId } : {}),
  });
}

export interface DriveLinkedObject {
  id: string;
  canonicalName: string;
  type: string;
  inheritedFrom: string;
  inheritedCandidates: string[];
}

export interface DriveSelectionObjectLink {
  kind: string;
  externalId: string;
  linkedObjectId: string | null;
}

export type DriveFileObjectLinkResolution =
  { kind: 'object'; objectId: string; via: string } | { kind: 'unbind' } | { kind: 'keep' };

function isDriveContainerSelectionKind(kind: string): boolean {
  return kind === DRIVE_FOLDER_KIND || kind === DRIVE_SHARED_DRIVE_KIND;
}

function selectionKey(externalId: string): string {
  return externalId.trim().toLowerCase();
}

function linkedDriveSelectionsByExternalId(
  selections: DriveSelectionObjectLink[],
): Map<string, { externalId: string; linkedObjectId: string; kind: string }> {
  const byId = new Map<string, { externalId: string; linkedObjectId: string; kind: string }>();
  for (const selection of selections) {
    if (typeof selection.linkedObjectId !== 'string' || selection.linkedObjectId.length === 0) {
      continue;
    }
    const key = selectionKey(selection.externalId);
    if (!key) continue;
    byId.set(key, {
      externalId: selection.externalId,
      linkedObjectId: selection.linkedObjectId,
      kind: selection.kind,
    });
  }
  return byId;
}

function driveLinkCandidates(input: {
  fileId: string;
  candidates?: string[] | null;
  parentIds?: string[];
  matchedAncestorId?: string | null;
  driveId?: string | null;
  myDriveRootId?: string | null;
}): { ids: string[]; known: boolean } {
  if (input.candidates === null) return { ids: [], known: false };
  if (input.candidates && input.candidates.length > 0) {
    return {
      ids: input.candidates.filter((id) => id.trim().length > 0),
      known: true,
    };
  }
  const ids = driveObjectLinkCandidates({
    fileId: input.fileId,
    parentIds: input.parentIds ?? [],
    ...(input.matchedAncestorId !== undefined
      ? { matchedAncestorId: input.matchedAncestorId }
      : {}),
    ...(input.driveId !== undefined ? { driveId: input.driveId } : {}),
    ...(input.myDriveRootId !== undefined ? { myDriveRootId: input.myDriveRootId } : {}),
  }).filter((id) => id.trim().length > 0);
  const hasAncestry =
    (input.parentIds?.length ?? 0) > 0 ||
    Boolean(input.matchedAncestorId) ||
    Boolean(input.driveId) ||
    Boolean(input.myDriveRootId);
  return { ids, known: hasAncestry };
}

function uniqueLinkedDriveContainerObject(selections: DriveSelectionObjectLink[]): string | null {
  const objectIds = [
    ...new Set(
      selections
        .filter(
          (selection): selection is DriveSelectionObjectLink & { linkedObjectId: string } =>
            isDriveContainerSelectionKind(selection.kind) &&
            typeof selection.linkedObjectId === 'string' &&
            selection.linkedObjectId.length > 0,
        )
        .map((selection) => selection.linkedObjectId),
    ),
  ];
  return objectIds.length === 1 ? (objectIds[0] ?? null) : null;
}

function linkedDriveContainerCount(selections: DriveSelectionObjectLink[]): number {
  return selections.filter(
    (selection) =>
      isDriveContainerSelectionKind(selection.kind) &&
      typeof selection.linkedObjectId === 'string' &&
      selection.linkedObjectId.length > 0,
  ).length;
}

/** Overlay one selection's object link onto a selection set (omit the row when unlinked). */
export function driveSelectionsWithChangedLink(
  selections: DriveSelectionObjectLink[],
  changed: DriveSelectionObjectLink,
): DriveSelectionObjectLink[] {
  const key = selectionKey(changed.externalId);
  const rest = selections.filter((selection) => selectionKey(selection.externalId) !== key);
  if (typeof changed.linkedObjectId !== 'string' || changed.linkedObjectId.length === 0) {
    return rest;
  }
  return [...rest, changed];
}

/**
 * Live-capture precedence: the most specific selected ancestor wins
 * (file, then folder, then shared drive) even when a shared drive appears
 * earlier in a stamped candidate list. Unstamped files fall back to a unique
 * remaining container object, or keep when two containers still disagree.
 */
export function resolveDriveFileObjectLink(input: {
  fileId: string;
  selections: DriveSelectionObjectLink[];
  candidates?: string[] | null;
  parentIds?: string[];
  matchedAncestorId?: string | null;
  driveId?: string | null;
  myDriveRootId?: string | null;
  fallback?: 'unique_container' | 'last_container';
  changedExternalId?: string;
}): DriveFileObjectLinkResolution {
  const byId = linkedDriveSelectionsByExternalId(input.selections);
  const candidates = driveLinkCandidates(input);
  const walk = candidates.known
    ? candidates.ids
    : [
        input.fileId,
        ...candidates.ids.filter((id) => selectionKey(id) !== selectionKey(input.fileId)),
      ];
  const winner = pickMostSpecificDriveAncestor(walk, (id) => {
    const hit = byId.get(selectionKey(id));
    return hit ? driveAncestorKindFromSelectionKind(hit.kind) : null;
  });
  if (winner) {
    const hit = byId.get(selectionKey(winner));
    if (hit) return { kind: 'object', objectId: hit.linkedObjectId, via: hit.externalId };
  }
  if (candidates.known) return { kind: 'unbind' };
  const unique = uniqueLinkedDriveContainerObject(input.selections);
  if (input.fallback === 'last_container') {
    const changed = input.changedExternalId ? selectionKey(input.changedExternalId) : '';
    const otherContainers = linkedDriveContainerCount(
      input.selections.filter((selection) => selectionKey(selection.externalId) !== changed),
    );
    if (otherContainers > 0) return { kind: 'keep' };
    const changedLink = changed ? (byId.get(changed)?.linkedObjectId ?? null) : null;
    return changedLink
      ? { kind: 'object', objectId: changedLink, via: input.changedExternalId ?? 'changed' }
      : { kind: 'unbind' };
  }
  if (unique) return { kind: 'object', objectId: unique, via: 'unique_container' };
  if (linkedDriveContainerCount(input.selections) === 0) return { kind: 'unbind' };
  return { kind: 'keep' };
}

export function driveFileObjectIdFromResolution(
  resolution: DriveFileObjectLinkResolution,
  keepObjectId: string | null,
): string | null {
  if (resolution.kind === 'object') return resolution.objectId;
  if (resolution.kind === 'keep') return keepObjectId;
  return null;
}

/**
 * A Drive file inherited the changed folder/shared-drive selection when that
 * selection is the first live object-link candidate. A remaining selection
 * keeps the previous object only when it appears earlier in that walk.
 * Explicit file links are never inherited rebinds.
 */
export function driveFileInheritsChangedSelection(input: {
  fileId: string;
  changedExternalId: string;
  remainingLinkedExternalIds?: string[];
  preserveFileIds?: string[];
  candidates?: string[] | null;
  parentIds?: string[];
  matchedAncestorId?: string | null;
  driveId?: string | null;
  myDriveRootId?: string | null;
}): boolean {
  const fileKey = input.fileId.trim().toLowerCase();
  if (!fileKey) return false;
  if ((input.preserveFileIds ?? []).some((id) => id.trim().toLowerCase() === fileKey)) {
    return false;
  }
  const changed = input.changedExternalId.trim();
  if (!changed) return false;
  const winner = resolveDriveFileObjectLink({
    fileId: input.fileId,
    selections: [
      { kind: DRIVE_FOLDER_KIND, externalId: changed, linkedObjectId: 'changed' },
      ...(input.remainingLinkedExternalIds ?? [])
        .filter((id) => selectionKey(id) !== selectionKey(changed))
        .map((id) => ({
          kind: DRIVE_FOLDER_KIND,
          externalId: id,
          linkedObjectId: 'remaining',
        })),
    ],
    ...(input.candidates !== undefined ? { candidates: input.candidates } : {}),
    ...(input.parentIds !== undefined ? { parentIds: input.parentIds } : {}),
    ...(input.matchedAncestorId !== undefined
      ? { matchedAncestorId: input.matchedAncestorId }
      : {}),
    ...(input.driveId !== undefined ? { driveId: input.driveId } : {}),
    ...(input.myDriveRootId !== undefined ? { myDriveRootId: input.myDriveRootId } : {}),
  });
  return winner.kind === 'object' && selectionKey(winner.via) === selectionKey(changed);
}

/**
 * After an explicit `drive.file` selection is dropped, resolve the object
 * link the file still inherits from remaining folder/shared-drive (or file)
 * selections. Candidate order matches live capture lookup.
 */
export function survivingLinkedObjectForDriveFile(input: {
  fileId: string;
  remainingSelections: DriveSelectionObjectLink[];
  parentIds?: string[];
  matchedAncestorId?: string | null;
  driveId?: string | null;
  inheritedCandidates?: string[] | null;
}): string | null {
  const resolution = resolveDriveFileObjectLink({
    fileId: input.fileId,
    selections: input.remainingSelections,
    ...(input.inheritedCandidates !== undefined ? { candidates: input.inheritedCandidates } : {}),
    ...(input.parentIds !== undefined ? { parentIds: input.parentIds } : {}),
    ...(input.matchedAncestorId !== undefined
      ? { matchedAncestorId: input.matchedAncestorId }
      : {}),
    ...(input.driveId !== undefined ? { driveId: input.driveId } : {}),
    fallback: 'unique_container',
  });
  return resolution.kind === 'object' ? resolution.objectId : null;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
}

export function driveSnapshotAncestryFromMembership(input: {
  parents?: string[];
  driveId?: string | null;
  matchedAncestorId: string | null;
  ancestryIds: string[];
}): DriveObjectLinkHints {
  return {
    parentIds: [...(input.parents ?? [])],
    driveId: input.driveId ?? null,
    matchedAncestorId: input.matchedAncestorId,
    inheritedCandidates: input.ancestryIds.length > 0 ? [...input.ancestryIds] : null,
  };
}

export function parseDriveSnapshotAncestry(value: unknown): DriveObjectLinkHints | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const parentIds = stringList(record.parentIds);
  const inheritedCandidates = stringList(record.inheritedCandidates);
  const matchedAncestorId =
    typeof record.matchedAncestorId === 'string' && record.matchedAncestorId.length > 0
      ? record.matchedAncestorId
      : null;
  const driveId =
    typeof record.driveId === 'string' && record.driveId.length > 0 ? record.driveId : null;
  if (
    parentIds.length === 0 &&
    !driveId &&
    !matchedAncestorId &&
    inheritedCandidates.length === 0
  ) {
    return null;
  }
  return {
    parentIds,
    driveId,
    matchedAncestorId,
    inheritedCandidates: inheritedCandidates.length > 0 ? inheritedCandidates : null,
  };
}

function driveObjectLinkHintsHaveAncestry(hints: DriveObjectLinkHints): boolean {
  return (
    hints.parentIds.length > 0 ||
    Boolean(hints.driveId) ||
    Boolean(hints.matchedAncestorId) ||
    Boolean(hints.inheritedCandidates && hints.inheritedCandidates.length > 0)
  );
}

function sameDriveIdList(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((id, index) => id === right[index]);
}

/** True when both stamps name the same walked membership. */
export function driveObjectLinkHintsEqual(
  left: DriveObjectLinkHints | null | undefined,
  right: DriveObjectLinkHints | null | undefined,
): boolean {
  const previous = left ?? emptyDriveObjectLinkHints();
  const next = right ?? emptyDriveObjectLinkHints();
  return (
    previous.driveId === next.driveId &&
    previous.matchedAncestorId === next.matchedAncestorId &&
    sameDriveIdList(previous.parentIds, next.parentIds) &&
    sameDriveIdList(previous.inheritedCandidates ?? [], next.inheritedCandidates ?? [])
  );
}

/**
 * One source of truth for current Drive membership used by coverage and
 * cleanup: the newest snapshot ancestry or event hint, not event-only.
 */
export function pickNewestDriveTrackedAncestry(input: {
  event?: { at: Date; hints: DriveObjectLinkHints };
  snapshot?: { at: Date; hints: DriveObjectLinkHints };
}): DriveObjectLinkHints {
  const event =
    input.event && driveObjectLinkHintsHaveAncestry(input.event.hints) ? input.event : null;
  const snapshot =
    input.snapshot && driveObjectLinkHintsHaveAncestry(input.snapshot.hints)
      ? input.snapshot
      : null;
  if (event && snapshot) {
    return snapshot.at.getTime() >= event.at.getTime() ? snapshot.hints : event.hints;
  }
  if (snapshot) return snapshot.hints;
  if (event) return event.hints;
  return emptyDriveObjectLinkHints();
}

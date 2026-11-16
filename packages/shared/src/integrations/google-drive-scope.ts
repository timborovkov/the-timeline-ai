export const DRIVE_FOLDER_KIND = 'drive.folder';
export const DRIVE_FILE_KIND = 'drive.file';
export const DRIVE_SHARED_DRIVE_KIND = 'drive.shared_drive';

const DRIVE_SUPPORTED_MIME_TYPES = new Set([
  'application/vnd.google-apps.document',
  'application/vnd.google-apps.spreadsheet',
  'application/vnd.google-apps.presentation',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

export interface DriveSelection {
  kind: string;
  externalId: string;
}

export interface DriveScopeSets {
  files: Set<string>;
  folders: Set<string>;
  sharedDrives: Set<string>;
  watchesRoot: boolean;
  myDriveRootId: string | null;
}

export type DriveAncestorKind = 'file' | 'folder' | 'shared_drive';
export type DriveFileCoverage = 'in' | 'out' | 'unknown';

export function driveScopeFromSelections(selections: DriveSelection[]): DriveScopeSets {
  const files = new Set<string>();
  const folders = new Set<string>();
  const sharedDrives = new Set<string>();
  let watchesRoot = false;
  for (const selection of selections) {
    if (selection.kind === DRIVE_FILE_KIND) files.add(selection.externalId);
    else if (selection.kind === DRIVE_SHARED_DRIVE_KIND) sharedDrives.add(selection.externalId);
    else if (selection.kind === DRIVE_FOLDER_KIND) {
      if (selection.externalId === 'root') watchesRoot = true;
      folders.add(selection.externalId);
    }
  }
  return { files, folders, sharedDrives, watchesRoot, myDriveRootId: null };
}

export function driveSelectionIsWatchable(kind: string): boolean {
  return kind === DRIVE_FILE_KIND || kind === DRIVE_FOLDER_KIND || kind === DRIVE_SHARED_DRIVE_KIND;
}

export function isSupportedDriveMimeType(mimeType: string): boolean {
  return DRIVE_SUPPORTED_MIME_TYPES.has(mimeType);
}

export function driveResourceKindForMime(mimeType: string): string {
  return mimeType === 'application/vnd.google-apps.folder' ? DRIVE_FOLDER_KIND : DRIVE_FILE_KIND;
}

export function driveAncestorKindFromSelectionKind(kind: string): DriveAncestorKind | null {
  if (kind === DRIVE_FILE_KIND) return 'file';
  if (kind === DRIVE_FOLDER_KIND) return 'folder';
  if (kind === DRIVE_SHARED_DRIVE_KIND) return 'shared_drive';
  return null;
}

function driveFileIsMyDriveDescendant(input: {
  fileId: string;
  parentIds: string[];
  matchedAncestorId?: string | null;
  driveId?: string | null;
  myDriveRootId?: string | null;
}): boolean {
  if (typeof input.driveId === 'string' && input.driveId.length > 0) return false;
  const rootIds = new Set<string>(['root']);
  if (input.myDriveRootId) rootIds.add(input.myDriveRootId);
  if (rootIds.has(input.fileId)) return true;
  if (input.matchedAncestorId && rootIds.has(input.matchedAncestorId)) return true;
  return input.parentIds.some((id) => rootIds.has(id));
}

/**
 * Most-specific-first ancestry: file, immediate parents, matched folder,
 * then shared drive / My Drive root. A shared drive never precedes a folder.
 */
export function driveAncestryIds(input: {
  fileId: string;
  parentIds?: string[];
  matchedAncestorId?: string | null;
  driveId?: string | null;
  myDriveRootId?: string | null;
  candidates?: string[] | null;
}): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  const push = (id?: string | null) => {
    if (typeof id !== 'string' || id.length === 0) return;
    if (seen.has(id)) return;
    seen.add(id);
    ids.push(id);
  };
  if (input.candidates && input.candidates.length > 0) {
    for (const id of input.candidates) push(id);
    return ids;
  }
  push(input.fileId);
  for (const parent of input.parentIds ?? []) push(parent);
  push(input.matchedAncestorId);
  push(input.driveId);
  if (
    driveFileIsMyDriveDescendant({
      fileId: input.fileId,
      parentIds: input.parentIds ?? [],
      ...(input.matchedAncestorId !== undefined
        ? { matchedAncestorId: input.matchedAncestorId }
        : {}),
      ...(input.driveId !== undefined ? { driveId: input.driveId } : {}),
      ...(input.myDriveRootId !== undefined ? { myDriveRootId: input.myDriveRootId } : {}),
    })
  ) {
    push('root');
  }
  return ids;
}

/**
 * File beats folder beats shared drive, independent of list order so a
 * later overlapping drive cannot outrank a selected folder on the path.
 */
export function pickMostSpecificDriveAncestor(
  ids: string[],
  kindOf: (id: string) => DriveAncestorKind | null,
): string | null {
  let file: string | null = null;
  let folder: string | null = null;
  let sharedDrive: string | null = null;
  for (const id of ids) {
    const kind = kindOf(id);
    if (kind === 'file' && !file) file = id;
    else if (kind === 'folder' && !folder) folder = id;
    else if (kind === 'shared_drive' && !sharedDrive) sharedDrive = id;
  }
  return file ?? folder ?? sharedDrive;
}

function driveAncestorKindInScope(
  id: string,
  fileId: string,
  scope: DriveScopeSets,
): DriveAncestorKind | null {
  if (id === fileId && scope.files.has(id)) return 'file';
  if (scope.folders.has(id) || (id === 'root' && scope.watchesRoot)) return 'folder';
  if (scope.sharedDrives.has(id)) return 'shared_drive';
  return null;
}

export function driveMostSpecificSelectedAncestor(input: {
  fileId: string;
  parents?: string[];
  driveId?: string | null;
  matchedAncestorId?: string | null;
  myDriveRootId?: string | null;
  candidates?: string[] | null;
  scope: DriveScopeSets;
  cache?: DriveAncestryCache;
}): string | null {
  const ids = [
    ...driveAncestryIds({
      fileId: input.fileId,
      ...(input.parents !== undefined ? { parentIds: input.parents } : {}),
      ...(input.matchedAncestorId !== undefined
        ? { matchedAncestorId: input.matchedAncestorId }
        : {}),
      ...(input.driveId !== undefined ? { driveId: input.driveId } : {}),
      ...(input.myDriveRootId !== undefined
        ? { myDriveRootId: input.myDriveRootId }
        : { myDriveRootId: input.scope.myDriveRootId }),
      ...(input.candidates !== undefined ? { candidates: input.candidates } : {}),
    }),
  ];
  if (input.cache) {
    for (const parent of input.parents ?? []) {
      const cached = input.cache.selectedAncestorById.get(parent);
      if (cached) ids.push(cached);
    }
    const cachedFile = input.cache.selectedAncestorById.get(input.fileId);
    if (cachedFile) ids.push(cachedFile);
  }
  return pickMostSpecificDriveAncestor(ids, (id) =>
    driveAncestorKindInScope(id, input.fileId, input.scope),
  );
}

function hasKnownDriveAncestryWalk(input: {
  candidates?: string[] | null;
  matchedAncestorId?: string | null;
}): boolean {
  if (input.candidates && input.candidates.length > 0) return true;
  return typeof input.matchedAncestorId === 'string' && input.matchedAncestorId.length > 0;
}

function hasDriveContainers(scope: DriveScopeSets): boolean {
  return scope.folders.size > 0 || scope.sharedDrives.size > 0 || scope.watchesRoot;
}

/**
 * Coverage against remaining selections. A stamped candidate walk that misses
 * every remaining selection is `out` even when other containers remain.
 * Payload-only nested parents stay `unknown` so membership can walk.
 */
export function driveFileCoverage(input: {
  fileId: string;
  parents?: string[];
  driveId?: string | null;
  matchedAncestorId?: string | null;
  myDriveRootId?: string | null;
  candidates?: string[] | null;
  scope: DriveScopeSets;
  cache?: DriveAncestryCache;
}): DriveFileCoverage {
  if (input.scope.files.has(input.fileId)) return 'in';
  if (driveMostSpecificSelectedAncestor(input)) return 'in';
  if (!hasDriveContainers(input.scope) && input.scope.files.size === 0) return 'out';
  if (!hasDriveContainers(input.scope)) return 'out';
  if (hasKnownDriveAncestryWalk(input)) return 'out';
  return 'unknown';
}

/**
 * Membership using only identifiers already present on the change/file.
 * Returns `unknown` when a parent walk would be required for nested folders.
 */
export function driveFileScopeHint(input: {
  fileId: string;
  parents?: string[];
  driveId?: string | null;
  scope: DriveScopeSets;
}): DriveFileCoverage {
  return driveFileCoverage(input);
}

/**
 * Parent-walk memo for nested Drive folders. Stores fetched parent ids and
 * the selected ancestor that admitted a folder — never an early "out of
 * scope" boolean, which would reject later files under the same nested path.
 */
export interface DriveAncestryCache {
  parents: Map<string, string[] | null>;
  selectedAncestorById: Map<string, string>;
}

export function createDriveAncestryCache(): DriveAncestryCache {
  return { parents: new Map(), selectedAncestorById: new Map() };
}

function rememberSelectedAncestor(
  cache: DriveAncestryCache,
  path: string[],
  selectedId: string,
): void {
  cache.selectedAncestorById.set(selectedId, selectedId);
  for (const id of path) cache.selectedAncestorById.set(id, selectedId);
}

function selectedFolderOnPath(id: string, scope: DriveScopeSets): boolean {
  return scope.folders.has(id) || (id === 'root' && scope.watchesRoot);
}

/**
 * `inScope` / `matchedAncestorId` are the most specific selected ancestor
 * (explicit file, then folder, then shared drive). `ancestryIds` is the full
 * walked path, including unlinked selected ancestors, so inherited object-link
 * lookup can pick the nearest *linked* ancestor along that path.
 */
export interface DriveFileMembership {
  inScope: boolean;
  matchedAncestorId: string | null;
  ancestryIds: string[];
}

function membershipAncestryIds(
  input: {
    fileId: string;
    parents?: string[];
    driveId?: string | null;
    matchedAncestorId?: string | null;
    myDriveRootId?: string | null;
    scope: DriveScopeSets;
  },
  walked: string[],
): string[] {
  return driveAncestryIds({
    fileId: input.fileId,
    parentIds: [...(input.parents ?? []), ...walked],
    ...(input.matchedAncestorId !== undefined
      ? { matchedAncestorId: input.matchedAncestorId }
      : {}),
    ...(input.driveId !== undefined ? { driveId: input.driveId } : {}),
    myDriveRootId: input.myDriveRootId ?? input.scope.myDriveRootId,
  });
}

function membershipResult(
  input: Parameters<typeof membershipAncestryIds>[0],
  walked: string[],
  matchedAncestorId: string | null,
  inScope: boolean,
): DriveFileMembership {
  return {
    inScope,
    matchedAncestorId,
    ancestryIds: membershipAncestryIds(input, walked),
  };
}

export async function resolveDriveFileMembership(input: {
  fileId: string;
  parents?: string[];
  driveId?: string | null;
  scope: DriveScopeSets;
  cache: DriveAncestryCache;
  getParents: (folderId: string) => Promise<string[] | null>;
  depthCap?: number;
}): Promise<DriveFileMembership> {
  const explicitFile = input.scope.files.has(input.fileId);
  const shouldWalk = (input.parents?.length ?? 0) > 0 && hasDriveContainers(input.scope);
  const walked = shouldWalk
    ? await walkNearestSelectedAncestor(input)
    : { selectedId: null, ancestryIds: [] };

  // Explicit files stay in-scope as themselves, but still walk ancestors so an
  // unlinked file can inherit a linked folder or shared drive further up.
  if (explicitFile) {
    return membershipResult(input, walked.ancestryIds, input.fileId, true);
  }

  if (walked.selectedId) {
    return membershipResult(input, walked.ancestryIds, walked.selectedId, true);
  }

  const payloadAncestor = driveMostSpecificSelectedAncestor(input);
  if (payloadAncestor) return membershipResult(input, walked.ancestryIds, payloadAncestor, true);

  const hint = driveFileCoverage(input);
  if (hint === 'out') return membershipResult(input, walked.ancestryIds, null, false);
  if (hint === 'in') {
    return membershipResult(
      input,
      walked.ancestryIds,
      driveMostSpecificSelectedAncestor(input),
      true,
    );
  }
  return membershipResult(input, walked.ancestryIds, null, false);
}

async function walkNearestSelectedAncestor(input: {
  fileId: string;
  parents?: string[];
  driveId?: string | null;
  scope: DriveScopeSets;
  cache: DriveAncestryCache;
  getParents: (folderId: string) => Promise<string[] | null>;
  depthCap?: number;
}): Promise<{ selectedId: string | null; ancestryIds: string[] }> {
  const depthCap = input.depthCap ?? 32;
  const queue: { id: string; path: string[] }[] = (input.parents ?? []).map((id) => ({
    id,
    path: [id],
  }));
  const seen = new Set<string>();
  const ancestryIds: string[] = [];
  let nearestFolder: { id: string; path: string[] } | null = null;
  let nearestSharedDrive: { id: string; path: string[] } | null = null;
  let depth = 0;
  while (queue.length > 0 && depth++ < depthCap) {
    const node = queue.shift();
    if (!node) break;
    if (seen.has(node.id)) continue;
    seen.add(node.id);
    ancestryIds.push(node.id);
    if (selectedFolderOnPath(node.id, input.scope)) {
      nearestFolder ??= node;
    } else {
      const knownSelected = input.cache.selectedAncestorById.get(node.id);
      if (knownSelected && selectedFolderOnPath(knownSelected, input.scope)) {
        nearestFolder ??= { id: knownSelected, path: [...node.path, knownSelected] };
      }
    }
    if (input.scope.sharedDrives.has(node.id)) {
      nearestSharedDrive ??= node;
      continue;
    }
    if (input.cache.parents.has(node.id)) {
      const cachedParents = input.cache.parents.get(node.id);
      if (!cachedParents) continue;
      for (const parent of cachedParents) {
        queue.push({ id: parent, path: [...node.path, parent] });
      }
      continue;
    }
    const fetched = await input.getParents(node.id);
    input.cache.parents.set(node.id, fetched);
    if (!fetched) continue;
    for (const parent of fetched) {
      queue.push({ id: parent, path: [...node.path, parent] });
    }
  }
  const selected = nearestFolder ?? nearestSharedDrive;
  if (selected) {
    rememberSelectedAncestor(input.cache, selected.path, selected.id);
    return { selectedId: selected.id, ancestryIds };
  }
  if (input.driveId && input.scope.sharedDrives.has(input.driveId)) {
    rememberSelectedAncestor(input.cache, input.parents ?? [], input.driveId);
    if (!ancestryIds.includes(input.driveId)) ancestryIds.push(input.driveId);
    return { selectedId: input.driveId, ancestryIds };
  }
  return { selectedId: null, ancestryIds };
}

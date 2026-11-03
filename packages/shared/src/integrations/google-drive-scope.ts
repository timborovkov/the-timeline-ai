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

/**
 * Membership using only identifiers already present on the change/file.
 * Returns `unknown` when a parent walk would be required for nested folders.
 */
export function driveFileScopeHint(input: {
  fileId: string;
  parents?: string[];
  driveId?: string | null;
  scope: DriveScopeSets;
}): 'in' | 'out' | 'unknown' {
  const { fileId, parents = [], driveId, scope } = input;
  if (scope.files.has(fileId)) return 'in';
  if (driveId && scope.sharedDrives.has(driveId)) return 'in';
  if (parents.some((parent) => scope.folders.has(parent))) return 'in';
  if (scope.watchesRoot && parents.includes('root')) return 'in';
  if (scope.files.size > 0 && scope.folders.size === 0 && scope.sharedDrives.size === 0) {
    return 'out';
  }
  if (scope.folders.size === 0 && scope.sharedDrives.size === 0 && !scope.watchesRoot) return 'out';
  return 'unknown';
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

function driveMatchedScopeId(input: {
  fileId: string;
  parents?: string[];
  driveId?: string | null;
  scope: DriveScopeSets;
  cache?: DriveAncestryCache;
}): string | null {
  const { fileId, parents = [], driveId, scope, cache } = input;
  if (scope.files.has(fileId)) return fileId;
  for (const parent of parents) {
    if (scope.folders.has(parent) || scope.sharedDrives.has(parent)) return parent;
    const selected = cache?.selectedAncestorById.get(parent);
    if (selected) return selected;
  }
  if (driveId && scope.sharedDrives.has(driveId)) return driveId;
  if (scope.watchesRoot && parents.includes('root')) return 'root';
  const fileSelected = cache?.selectedAncestorById.get(fileId);
  return fileSelected ?? null;
}

function folderIsSelected(id: string, scope: DriveScopeSets): boolean {
  return (
    scope.folders.has(id) || scope.sharedDrives.has(id) || (id === 'root' && scope.watchesRoot)
  );
}

function rememberSelectedAncestor(
  cache: DriveAncestryCache,
  path: string[],
  selectedId: string,
): void {
  cache.selectedAncestorById.set(selectedId, selectedId);
  for (const id of path) cache.selectedAncestorById.set(id, selectedId);
}

export async function resolveDriveFileMembership(input: {
  fileId: string;
  parents?: string[];
  driveId?: string | null;
  scope: DriveScopeSets;
  cache: DriveAncestryCache;
  getParents: (folderId: string) => Promise<string[] | null>;
  depthCap?: number;
}): Promise<{ inScope: boolean; matchedAncestorId: string | null }> {
  const hint = driveFileScopeHint(input);
  if (hint === 'in') {
    return { inScope: true, matchedAncestorId: driveMatchedScopeId(input) };
  }
  if (hint === 'out') return { inScope: false, matchedAncestorId: null };

  const cachedHit = driveMatchedScopeId(input);
  if (cachedHit) return { inScope: true, matchedAncestorId: cachedHit };

  const depthCap = input.depthCap ?? 32;
  const stack: { id: string; path: string[] }[] = (input.parents ?? []).map((id) => ({
    id,
    path: [id],
  }));
  let depth = 0;
  while (stack.length > 0 && depth++ < depthCap) {
    const node = stack.pop();
    if (!node) break;
    if (folderIsSelected(node.id, input.scope)) {
      rememberSelectedAncestor(input.cache, node.path, node.id);
      return { inScope: true, matchedAncestorId: node.id };
    }
    const knownSelected = input.cache.selectedAncestorById.get(node.id);
    if (knownSelected) {
      rememberSelectedAncestor(input.cache, node.path, knownSelected);
      return { inScope: true, matchedAncestorId: knownSelected };
    }
    if (input.cache.parents.has(node.id)) {
      const cachedParents = input.cache.parents.get(node.id);
      if (!cachedParents) continue;
      for (const parent of cachedParents) {
        stack.push({ id: parent, path: [...node.path, parent] });
      }
      continue;
    }
    const fetched = await input.getParents(node.id);
    input.cache.parents.set(node.id, fetched);
    if (!fetched) continue;
    for (const parent of fetched) {
      stack.push({ id: parent, path: [...node.path, parent] });
    }
  }
  return { inScope: false, matchedAncestorId: null };
}

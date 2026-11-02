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
  return { files, folders, sharedDrives, watchesRoot };
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

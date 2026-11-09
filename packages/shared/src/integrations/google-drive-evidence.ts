/**
 * Single Drive snapshot-advance guard. Every persist path — including
 * strong-signal comments and judge-noise — must run through
 * `decideDriveSnapshotAdvance`. A changed text hash advances only when every
 * distinct span is witnessed in the hunks and in packed event text. Comment
 * fingerprints advance only when every changed comment and reply appears in
 * the packed comment stream. Packing and this guard share one invariant:
 * `commentFragment` values rejoin to the exact original preview, including
 * whitespace at split boundaries. Otherwise the field is deferred; it is
 * never advanced unwitnessed.
 */

import {
  driveCommentChangeIsWitnessed,
  type DriveCommentSnapshot,
} from '#src/integrations/google-drive-comments.js';
import {
  driveHunksContainChangedSpan,
  type DriveSnapshotLocate,
  type DriveTextDiff,
} from '#src/integrations/google-drive-diff.js';

import type {
  DriveSnapshotRecord,
  DrivePermissionGrant,
} from '#src/integrations/google-drive-contracts.js';

export interface DrivePackedChangeEvent {
  contentText: string;
  hunks: string[];
  /**
   * Exact slice of `commentPreview` written into this event. Concatenating
   * these across events must equal the original preview, including spaces
   * that fall on a split boundary. Do not trim.
   */
  commentFragment: string;
}

/** Rejoin packed comment slices. This is the stream the witnessed check reads. */
export function packedCommentContext(events: DrivePackedChangeEvent[] | null): string {
  if (!events || events.length === 0) return '';
  return events.map((event) => event.commentFragment).join('');
}

export interface DriveSnapshotAdvanceFields extends Omit<
  DriveSnapshotRecord,
  'commentsSnapshot' | 'snapshotLocate' | 'permissionsSnapshot'
> {
  snapshotLocate: DriveSnapshotLocate | null;
  commentsSnapshot: DriveCommentSnapshot[];
  permissionsSnapshot?: DrivePermissionGrant[] | undefined;
}

export interface DriveSnapshotAdvanceDecision {
  advanceText: boolean;
  advanceComments: boolean;
  advancePermissions: boolean;
  persist: boolean;
  snapshot: DriveSnapshotAdvanceFields;
}

function packedBlob(events: DrivePackedChangeEvent[] | null): string {
  if (!events || events.length === 0) return '';
  return events.map((event) => event.contentText).join('');
}

function packedHunks(events: DrivePackedChangeEvent[] | null): string[] {
  return events ? events.flatMap((event) => event.hunks) : [];
}

function drivePackedEventsWitnessTextChange(input: {
  packedEvents: DrivePackedChangeEvent[] | null;
  hunks: string[];
  previousText: string;
  nextText: string;
}): boolean {
  if (!input.packedEvents) return false;
  const blob = packedBlob(input.packedEvents);
  if (input.hunks.some((hunk) => hunk.length > 0 && !blob.includes(hunk))) return false;
  if (input.previousText === input.nextText) return true;
  return driveHunksContainChangedSpan(
    packedHunks(input.packedEvents),
    input.previousText,
    input.nextText,
  );
}

function canAdvanceDriveTextBaseline(input: {
  previousHash: string;
  nextHash: string;
  previousText: string;
  nextText: string;
  diff: DriveTextDiff;
  packedEvents: DrivePackedChangeEvent[] | null;
}): boolean {
  if (input.previousHash === input.nextHash) return true;
  if (!input.diff.changed) {
    return input.diff.reason !== 'identical' || input.previousText === input.nextText;
  }
  if (!driveHunksContainChangedSpan(input.diff.hunks, input.previousText, input.nextText)) {
    return false;
  }
  return drivePackedEventsWitnessTextChange({
    packedEvents: input.packedEvents,
    hunks: input.diff.hunks,
    previousText: input.previousText,
    nextText: input.nextText,
  });
}

function canAdvanceDriveCommentsBaseline(input: {
  previousHash: string;
  nextHash: string;
  previousComments: DriveCommentSnapshot[];
  nextComments: DriveCommentSnapshot[];
  packedEvents: DrivePackedChangeEvent[] | null;
}): boolean {
  if (input.previousHash === input.nextHash) return true;
  const context = packedCommentContext(input.packedEvents);
  if (!context.trim()) return false;
  return driveCommentChangeIsWitnessed(context, input.previousComments, input.nextComments);
}

/**
 * Decide which snapshot fields may persist. Callers must pass the packed
 * events that would be written (or null when packing failed / was skipped).
 * Strong-signal and comment-only paths are not exempt.
 */
export function decideDriveSnapshotAdvance(input: {
  previous: DriveSnapshotAdvanceFields;
  next: DriveSnapshotAdvanceFields;
  diff: DriveTextDiff;
  previousText: string;
  nextText: string;
  packedEvents: DrivePackedChangeEvent[] | null;
}): DriveSnapshotAdvanceDecision {
  const textUnchanged = input.previous.contentHash === input.next.contentHash;
  const commentsUnchanged = input.previous.commentsHash === input.next.commentsHash;
  const permissionsUnchanged = input.previous.permissionsHash === input.next.permissionsHash;
  const advanceText =
    textUnchanged ||
    canAdvanceDriveTextBaseline({
      previousHash: input.previous.contentHash,
      nextHash: input.next.contentHash,
      previousText: input.previousText,
      nextText: input.nextText,
      diff: input.diff,
      packedEvents: input.packedEvents,
    });
  const advanceComments =
    commentsUnchanged ||
    canAdvanceDriveCommentsBaseline({
      previousHash: input.previous.commentsHash,
      nextHash: input.next.commentsHash,
      previousComments: input.previous.commentsSnapshot,
      nextComments: input.next.commentsSnapshot,
      packedEvents: input.packedEvents,
    });
  const advancePermissions = true;
  const persistText = !textUnchanged && advanceText;
  const persistComments = !commentsUnchanged && advanceComments;
  const persistPermissions = !permissionsUnchanged && advancePermissions;
  return {
    advanceText: persistText,
    advanceComments: persistComments,
    advancePermissions: persistPermissions,
    persist: persistText || persistComments || persistPermissions,
    snapshot: {
      contentHash: persistText ? input.next.contentHash : input.previous.contentHash,
      snapshotText: persistText ? input.next.snapshotText : input.previous.snapshotText,
      snapshotLocate: persistText ? input.next.snapshotLocate : input.previous.snapshotLocate,
      commentsHash: persistComments ? input.next.commentsHash : input.previous.commentsHash,
      commentsSnapshot: persistComments
        ? input.next.commentsSnapshot
        : input.previous.commentsSnapshot,
      permissionsHash: persistPermissions
        ? input.next.permissionsHash
        : input.previous.permissionsHash,
      permissionsSnapshot: persistPermissions
        ? input.next.permissionsSnapshot
        : input.previous.permissionsSnapshot,
      mimeType: input.next.mimeType ?? input.previous.mimeType,
    },
  };
}

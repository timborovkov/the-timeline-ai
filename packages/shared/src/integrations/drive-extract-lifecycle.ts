import {
  applyDriveExtractTombstoneDeletes,
  driveExtractTombstoneKeys,
  retainDriveExtractCleanupCursor,
  shouldRetainDriveExtractCleanup,
  type DriveExtractCursor,
  type DriveExtractTombstone,
} from '#src/integrations/drive-extract-protocol.js';

export type DriveExtractObjectDeleter = (cursor: {
  objectKey: string;
  resultObjectKey: string;
  pendingDeleteKeys?: string[];
  tombstones?: DriveExtractTombstone[];
}) => Promise<string[]>;

/** S3 success cannot prove a still-running producer will not write its result later. */
export async function cleanupDriveExtract(input: {
  cursor: DriveExtractCursor;
  mode: 'consume' | 'cancel' | 'disconnect';
  now: Date;
  deleteObjects: DriveExtractObjectDeleter;
  persist: (cursor: DriveExtractCursor | null) => Promise<void>;
}): Promise<void> {
  const remainingKeys = await input.deleteObjects(input.cursor);
  const remaining = new Set(remainingKeys);
  const byExtractId = new Map(
    (input.cursor.tombstones ?? []).map((tombstone) => [
      tombstone.extractId,
      driveExtractTombstoneKeys(tombstone).filter((key) => remaining.has(key)),
    ]),
  );
  const cleaned = applyDriveExtractTombstoneDeletes(input.cursor, byExtractId, input.now.getTime());
  const remainingCurrent = remainingKeys.filter(
    (key) => key === cleaned.objectKey || key === cleaned.resultObjectKey,
  );
  const cancelledAt =
    input.mode === 'consume'
      ? cleaned.cancelledAt
      : (cleaned.cancelledAt ?? input.now.toISOString());
  const next = retainDriveExtractCleanupCursor(cleaned, remainingCurrent, {
    ...(cancelledAt ? { cancelledAt } : {}),
  });
  const retain = shouldRetainDriveExtractCleanup(next, remainingCurrent, {
    mode: input.mode === 'consume' ? 'consume' : 'cancel',
    now: input.now.getTime(),
  });
  if (input.mode === 'disconnect') {
    if (remainingKeys.length > 0) {
      throw new Error(`drive transient extract objects remain: ${remainingKeys.join(',')}`);
    }
    if (retain) throw new Error('drive transient extract still in flight');
  }
  await input.persist(retain ? next : null);
}

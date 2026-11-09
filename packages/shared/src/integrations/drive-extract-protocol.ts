export function driveExtractCursorKey(fileId: string): string {
  return `drive.extract.${fileId}`;
}

export function driveExtractFileIdFromResourceType(resourceType: string): string | null {
  if (!resourceType.startsWith('drive.extract.')) return null;
  const fileId = resourceType.slice('drive.extract.'.length);
  return fileId.length > 0 ? fileId : null;
}

/** Re-enqueue a missing result after the same quiet window as file debounce. */
export const DRIVE_EXTRACT_PENDING_STALE_MS = 15 * 60 * 1000;
/** Drop Drive transient extract objects whose resume never ran. */
export const DRIVE_TRANSIENT_EXTRACT_ORPHAN_MS = 24 * 60 * 60 * 1000;
export interface DriveExtractTombstone {
  extractId: string;
  objectKey: string;
  resultObjectKey: string;
  enqueuedAt: string;
  cancelledAt: string;
  pendingDeleteKeys: string[];
}

export interface DriveExtractCursor {
  extractId: string;
  objectKey: string;
  resultObjectKey: string;
  contentType: string;
  filename: string;
  enqueuedAt: string;
  /** Drive `headRevisionId` / md5 / modifiedTime of the bytes sent to extract. */
  revisionId?: string;
  /** S3 deletes failed; janitor retries until both objects are gone. */
  cleanupPending?: boolean;
  /** Leftover keys from a replaced extract that still need delete. */
  pendingDeleteKeys?: string[];
  /**
   * Cancel/out-of-scope cleanup started. S3 DeleteObject treats a not-yet-written
   * `result.json` as success, so the tombstone stays until the producer wait
   * window elapses and the janitor can delete a late write.
   */
  cancelledAt?: string;
  /**
   * False until the document-extract job is accepted. Unpublished cursors are
   * immediately stale so publish failures retry instead of waiting 15 minutes.
   * Legacy cursors omit the field and are treated as published.
   */
  jobPublished?: boolean;
  /**
   * Every extract id this cursor replaced. Kept until the producer wait/TTL
   * elapses even when DeleteObject reported success (including S3 404).
   */
  tombstones?: DriveExtractTombstone[];
}

export function parseDriveExtractCursor(cursor: unknown): DriveExtractCursor | null {
  if (!cursor || typeof cursor !== 'object') return null;
  const record = cursor as Record<string, unknown>;
  if (
    typeof record.extractId !== 'string' ||
    record.extractId.length === 0 ||
    typeof record.objectKey !== 'string' ||
    record.objectKey.length === 0 ||
    typeof record.resultObjectKey !== 'string' ||
    record.resultObjectKey.length === 0 ||
    typeof record.contentType !== 'string' ||
    record.contentType.length === 0 ||
    typeof record.filename !== 'string' ||
    record.filename.length === 0 ||
    typeof record.enqueuedAt !== 'string'
  ) {
    return null;
  }
  const pendingDeleteKeys = Array.isArray(record.pendingDeleteKeys)
    ? record.pendingDeleteKeys.filter(
        (key): key is string => typeof key === 'string' && key.length > 0,
      )
    : [];
  const tombstones = parseDriveExtractTombstones(record.tombstones);
  return {
    extractId: record.extractId,
    objectKey: record.objectKey,
    resultObjectKey: record.resultObjectKey,
    contentType: record.contentType,
    filename: record.filename,
    enqueuedAt: record.enqueuedAt,
    ...(typeof record.revisionId === 'string' && record.revisionId.length > 0
      ? { revisionId: record.revisionId }
      : {}),
    ...(record.cleanupPending === true ? { cleanupPending: true } : {}),
    ...(pendingDeleteKeys.length > 0 ? { pendingDeleteKeys } : {}),
    ...(typeof record.cancelledAt === 'string' && record.cancelledAt.length > 0
      ? { cancelledAt: record.cancelledAt }
      : {}),
    ...(record.jobPublished === false ? { jobPublished: false } : {}),
    ...(tombstones.length > 0 ? { tombstones } : {}),
  };
}

function parseDriveExtractTombstones(value: unknown): DriveExtractTombstone[] {
  if (!Array.isArray(value)) return [];
  const found: DriveExtractTombstone[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    if (
      typeof record.extractId !== 'string' ||
      record.extractId.length === 0 ||
      typeof record.objectKey !== 'string' ||
      record.objectKey.length === 0 ||
      typeof record.resultObjectKey !== 'string' ||
      record.resultObjectKey.length === 0 ||
      typeof record.enqueuedAt !== 'string' ||
      record.enqueuedAt.length === 0 ||
      typeof record.cancelledAt !== 'string' ||
      record.cancelledAt.length === 0
    ) {
      continue;
    }
    if (seen.has(record.extractId)) continue;
    seen.add(record.extractId);
    const pendingDeleteKeys = Array.isArray(record.pendingDeleteKeys)
      ? record.pendingDeleteKeys.filter(
          (key): key is string => typeof key === 'string' && key.length > 0,
        )
      : [record.objectKey, record.resultObjectKey];
    found.push({
      extractId: record.extractId,
      objectKey: record.objectKey,
      resultObjectKey: record.resultObjectKey,
      enqueuedAt: record.enqueuedAt,
      cancelledAt: record.cancelledAt,
      pendingDeleteKeys:
        pendingDeleteKeys.length > 0
          ? pendingDeleteKeys
          : [record.objectKey, record.resultObjectKey],
    });
  }
  return found;
}

function s3ErrorHttpStatus(err: unknown): number | undefined {
  if (!err || typeof err !== 'object') return undefined;
  if (
    '$metadata' in err &&
    err.$metadata &&
    typeof err.$metadata === 'object' &&
    'httpStatusCode' in err.$metadata &&
    typeof err.$metadata.httpStatusCode === 'number'
  ) {
    return err.$metadata.httpStatusCode;
  }
  if ('statusCode' in err && typeof err.statusCode === 'number') return err.statusCode;
  return undefined;
}

function s3ErrorCode(err: unknown): string {
  if (!err || typeof err !== 'object') return '';
  if ('name' in err && typeof err.name === 'string' && err.name.length > 0) return err.name;
  if ('Code' in err && typeof err.Code === 'string') return err.Code;
  if ('code' in err && typeof err.code === 'string') return err.code;
  return '';
}

export function isMissingS3ObjectError(err: unknown): boolean {
  const code = s3ErrorCode(err);
  const httpStatus = s3ErrorHttpStatus(err);
  return code === 'NoSuchKey' || code === 'NotFound' || httpStatus === 404;
}

const RETRYABLE_DRIVE_EXTRACT_STORAGE_CODES = new Set([
  'Timeout',
  'TimeoutError',
  'RequestTimeout',
  'RequestTimeoutException',
  'InternalError',
  'InternalServerError',
  'ServiceUnavailable',
  'SlowDown',
  'Throttling',
  'ThrottlingException',
  'TooManyRequestsException',
  'NetworkingError',
  'ECONNRESET',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'ENOTFOUND',
]);

/** Transient S3/network faults while reading a valid extract result. Do not consume the slot. */
export function isRetryableDriveExtractStorageError(err: unknown): boolean {
  if (isMissingS3ObjectError(err)) return false;
  const message = err instanceof Error ? err.message : String(err);
  if (isDriveExtractResultTooLarge(message)) return false;
  const httpStatus = s3ErrorHttpStatus(err);
  if (httpStatus === 429 || (typeof httpStatus === 'number' && httpStatus >= 500)) return true;
  const code = s3ErrorCode(err);
  if (RETRYABLE_DRIVE_EXTRACT_STORAGE_CODES.has(code)) return true;
  return /timeout|timed out|ECONNRESET|ETIMEDOUT|SlowDown|throttl|service unavailable|\b50[0234]\b/iu.test(
    message,
  );
}

/** Keep a cancel tombstone until remaining keys, live tombstones, or the producer wait remain. */
export function shouldRetainDriveExtractCleanup(
  cursor: DriveExtractCursor,
  remainingCurrentKeys: string[],
  opts: { mode: 'consume' | 'cancel'; now?: number },
): boolean {
  if (remainingCurrentKeys.length > 0) return true;
  if ((cursor.tombstones?.length ?? 0) > 0) return true;
  if (opts.mode !== 'cancel') return false;
  return !isDriveExtractCancelSettled(cursor, opts.now ?? Date.now());
}

export function driveExtractTombstoneKeys(tombstone: DriveExtractTombstone): string[] {
  return [
    ...new Set(
      [tombstone.objectKey, tombstone.resultObjectKey, ...tombstone.pendingDeleteKeys].filter(
        (key) => key.length > 0,
      ),
    ),
  ];
}

export function driveExtractObjectKeys(cursor: DriveExtractCursor): string[] {
  return [
    ...new Set(
      [
        cursor.objectKey,
        cursor.resultObjectKey,
        ...(cursor.pendingDeleteKeys ?? []),
        ...(cursor.tombstones ?? []).flatMap((tombstone) => driveExtractTombstoneKeys(tombstone)),
      ].filter((key) => key.length > 0),
    ),
  ];
}

function driveExtractDeleteSucceeded(result: PromiseSettledResult<unknown>): boolean {
  return result.status === 'fulfilled' || isMissingS3ObjectError(result.reason);
}

export function remainingDriveExtractObjectKeys(
  keys: string[],
  results: PromiseSettledResult<unknown>[],
): string[] {
  return keys.filter((_, index) => {
    const result = results[index];
    return !result || !driveExtractDeleteSucceeded(result);
  });
}

export function retainDriveExtractCleanupCursor(
  cursor: DriveExtractCursor,
  remainingKeys: string[],
  opts?: { cancelledAt?: string },
): DriveExtractCursor {
  const cancelledAt = opts?.cancelledAt ?? cursor.cancelledAt;
  const currentKeys = [cursor.objectKey, cursor.resultObjectKey];
  const remainingCurrent = remainingKeys.filter((key) => currentKeys.includes(key));
  return {
    ...cursor,
    cleanupPending: true,
    pendingDeleteKeys: remainingCurrent.length > 0 ? remainingCurrent : currentKeys,
    ...(cancelledAt ? { cancelledAt } : {}),
    ...(cursor.tombstones && cursor.tombstones.length > 0 ? { tombstones: cursor.tombstones } : {}),
  };
}

/** Always keep a replaced extract id, even when DeleteObject reported success. */
export function carryDriveExtractTombstones(
  existing: DriveExtractCursor,
  nowIso: string,
): DriveExtractTombstone[] {
  const self: DriveExtractTombstone = {
    extractId: existing.extractId,
    objectKey: existing.objectKey,
    resultObjectKey: existing.resultObjectKey,
    enqueuedAt: existing.enqueuedAt,
    cancelledAt: existing.cancelledAt ?? nowIso,
    pendingDeleteKeys: driveExtractTombstoneKeys({
      extractId: existing.extractId,
      objectKey: existing.objectKey,
      resultObjectKey: existing.resultObjectKey,
      enqueuedAt: existing.enqueuedAt,
      cancelledAt: existing.cancelledAt ?? nowIso,
      pendingDeleteKeys: [
        existing.objectKey,
        existing.resultObjectKey,
        ...(existing.pendingDeleteKeys ?? []),
      ],
    }),
  };
  const byId = new Map<string, DriveExtractTombstone>();
  for (const tombstone of [...(existing.tombstones ?? []), self]) {
    byId.set(tombstone.extractId, tombstone);
  }
  return [...byId.values()];
}

export function partitionDriveExtractTombstones(
  tombstones: DriveExtractTombstone[],
  now = Date.now(),
): { settled: DriveExtractTombstone[]; live: DriveExtractTombstone[] } {
  const settled: DriveExtractTombstone[] = [];
  const live: DriveExtractTombstone[] = [];
  for (const tombstone of tombstones) {
    if (
      isDriveExtractCancelSettled(
        {
          extractId: tombstone.extractId,
          objectKey: tombstone.objectKey,
          resultObjectKey: tombstone.resultObjectKey,
          contentType: 'application/octet-stream',
          filename: 'tombstone',
          enqueuedAt: tombstone.enqueuedAt,
          cancelledAt: tombstone.cancelledAt,
        },
        now,
      )
    ) {
      settled.push(tombstone);
    } else {
      live.push(tombstone);
    }
  }
  return { settled, live };
}

/** Drop TTL-expired tombstones whose keys deleted (or 404'd); keep failed deletes. */
export function applyDriveExtractTombstoneDeletes(
  cursor: DriveExtractCursor,
  remainingKeysByExtractId: Map<string, string[]>,
  now = Date.now(),
): DriveExtractCursor {
  const { settled, live } = partitionDriveExtractTombstones(cursor.tombstones ?? [], now);
  const next: DriveExtractTombstone[] = [...live];
  for (const tombstone of settled) {
    const remaining = remainingKeysByExtractId.get(tombstone.extractId) ?? [];
    if (remaining.length > 0) next.push({ ...tombstone, pendingDeleteKeys: remaining });
  }
  if (next.length === 0) {
    const { tombstones: _dropped, ...rest } = cursor;
    return rest;
  }
  return { ...cursor, tombstones: next };
}

/** True once a cancel tombstone has waited for a late orchestrator PUT. */
export function isDriveExtractCancelSettled(cursor: DriveExtractCursor, now = Date.now()): boolean {
  const enqueuedAtMs = Date.parse(cursor.enqueuedAt);
  if (Number.isFinite(enqueuedAtMs) && now - enqueuedAtMs >= DRIVE_TRANSIENT_EXTRACT_ORPHAN_MS) {
    return true;
  }
  const cancelledAtMs = Date.parse(cursor.cancelledAt ?? '');
  if (!Number.isFinite(cancelledAtMs)) return false;
  return now - cancelledAtMs >= DRIVE_EXTRACT_PENDING_STALE_MS;
}

export function isDriveExtractPendingStale(cursor: DriveExtractCursor, now = Date.now()): boolean {
  if (cursor.cleanupPending) return false;
  if (cursor.jobPublished === false) return true;
  const enqueuedAtMs = Date.parse(cursor.enqueuedAt);
  if (!Number.isFinite(enqueuedAtMs)) return true;
  return now - enqueuedAtMs >= DRIVE_EXTRACT_PENDING_STALE_MS;
}

export function isDriveExtractCursorOrphan(cursor: DriveExtractCursor, now = Date.now()): boolean {
  if (cursor.cleanupPending) return true;
  const enqueuedAtMs = Date.parse(cursor.enqueuedAt);
  if (!Number.isFinite(enqueuedAtMs)) return true;
  return now - enqueuedAtMs >= DRIVE_TRANSIENT_EXTRACT_ORPHAN_MS;
}

export function driveTransientExtractKeys(input: {
  teamId: string;
  integrationId: string;
  fileId: string;
  extractId: string;
}): { objectKey: string; resultObjectKey: string } {
  const prefix = `drive-transient/${input.teamId}/${input.integrationId}/${input.fileId}/${input.extractId}`;
  return {
    objectKey: `${prefix}/source`,
    resultObjectKey: `${prefix}/result.json`,
  };
}

export type DriveTransientExtractResultPayload =
  { ok: true; text: string } | { ok: false; error: string };

export const DRIVE_TRANSIENT_RESULT_MAX_BYTES = 2 * 1024 * 1024;
export const DRIVE_TRANSIENT_RESULT_TOO_LARGE = 'extract_result_too_large';

export function parseDriveTransientExtractResult(body: Buffer): DriveTransientExtractResultPayload {
  const parsed: unknown = JSON.parse(body.toString('utf8'));
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('invalid drive transient extract result');
  }
  const record = parsed as Record<string, unknown>;
  if (record.ok === true && typeof record.text === 'string') {
    return { ok: true, text: record.text };
  }
  if (record.ok === false && typeof record.error === 'string') {
    return { ok: false, error: record.error };
  }
  throw new Error('invalid drive transient extract result');
}

export function driveTransientExtractResultBody(
  payload: DriveTransientExtractResultPayload,
): Buffer {
  const body = Buffer.from(JSON.stringify(payload));
  if (body.length <= DRIVE_TRANSIENT_RESULT_MAX_BYTES) return body;
  return Buffer.from(JSON.stringify({ ok: false, error: DRIVE_TRANSIENT_RESULT_TOO_LARGE }));
}

export function isDriveExtractResultTooLarge(error: string): boolean {
  return (
    error === DRIVE_TRANSIENT_RESULT_TOO_LARGE ||
    /exceeds \d+ bytes/u.test(error) ||
    /exceeded \d+ bytes/u.test(error)
  );
}

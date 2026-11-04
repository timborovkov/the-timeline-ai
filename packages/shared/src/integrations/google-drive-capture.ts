import { createHash } from 'node:crypto';

import {
  entities,
  googleDriveFileSnapshots,
  integrations as integrationsTable,
  integrationSelections,
  integrationSyncState,
  rawEvents,
  teamMembers,
  users,
  type Db,
} from '@timeline/db';
import { and, asc, desc, eq, gt, inArray, isNull, notInArray, or, sql } from 'drizzle-orm';

import { parseDriveCommentSnapshots } from '#src/integrations/google-drive-comments.js';
import {
  hashesOnlyDriveSnapshotLocate,
  parseDriveSnapshotLocate,
  type DriveSnapshotLocate,
} from '#src/integrations/google-drive-diff.js';
import {
  DRIVE_FILE_KIND,
  DRIVE_FOLDER_KIND,
  DRIVE_SHARED_DRIVE_KIND,
  driveAncestryIds,
  driveAncestorKindFromSelectionKind,
  driveFileCoverage,
  driveScopeFromSelections,
  pickMostSpecificDriveAncestor,
} from '#src/integrations/google-drive-scope.js';
import {
  checkRateLimit,
  RATE_LIMITS,
  rateLimitKey,
  type RateLimitInput,
  type RateLimitResult,
} from '#src/rate-limit/index.js';

export const DRIVE_FILE_DEBOUNCE_MS = 15 * 60 * 1000;
export const DRIVE_FILE_MAX_LATENCY_MS = 60 * 60 * 1000;
const DRIVE_SNAPSHOT_RETENTION = 3;

export interface DriveDebouncePlan {
  delayMs: number;
  firstQueuedAt: string;
  quietUntil: string;
}

export interface DriveSnapshotRecord {
  contentHash: string;
  snapshotText: string;
  commentsHash: string;
  permissionsHash: string;
  mimeType: string | null;
  commentsSnapshot?: unknown;
  snapshotLocate?: DriveSnapshotLocate | null;
  ancestry?: DriveObjectLinkHints | null;
}

export function driveDebouncePlan(
  existing: { firstQueuedAt?: string } | null | undefined,
  now = Date.now(),
): DriveDebouncePlan {
  const firstQueuedAtMs = existing?.firstQueuedAt ? Date.parse(existing.firstQueuedAt) : Number.NaN;
  const firstQueuedAt = Number.isFinite(firstQueuedAtMs) ? firstQueuedAtMs : now;
  const maxAt = firstQueuedAt + DRIVE_FILE_MAX_LATENCY_MS;
  const quietUntilMs = Math.min(now + DRIVE_FILE_DEBOUNCE_MS, maxAt);
  return {
    delayMs: Math.max(0, quietUntilMs - now),
    firstQueuedAt: new Date(firstQueuedAt).toISOString(),
    quietUntil: new Date(quietUntilMs).toISOString(),
  };
}

export function hashDrivePayload(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export async function takeDriveProcessSlot(input: {
  integrationId: string;
  fileId: string;
  checkRateLimit?: (input: RateLimitInput) => Promise<RateLimitResult>;
}): Promise<
  { allowed: true } | { allowed: false; reason: 'file' | 'connection'; retryAfterMs: number }
> {
  const check = input.checkRateLimit ?? checkRateLimit;
  const file = await check({
    key: rateLimitKey('drive-process', 'file', input.integrationId, input.fileId),
    ...RATE_LIMITS.driveFilePerDay,
  });
  if (!file.ok) {
    return { allowed: false, reason: 'file', retryAfterMs: Math.max(250, file.retryAfterMs) };
  }
  const connection = await check({
    key: rateLimitKey('drive-process', 'connection', input.integrationId),
    ...RATE_LIMITS.driveConnectionPerDay,
  });
  if (!connection.ok) {
    return {
      allowed: false,
      reason: 'connection',
      retryAfterMs: Math.max(250, connection.retryAfterMs),
    };
  }
  return { allowed: true };
}

export async function takeDriveExtractSlot(input: {
  integrationId: string;
  fileId: string;
  checkRateLimit?: (input: RateLimitInput) => Promise<RateLimitResult>;
}): Promise<
  { allowed: true } | { allowed: false; reason: 'file' | 'connection'; retryAfterMs: number }
> {
  const check = input.checkRateLimit ?? checkRateLimit;
  const file = await check({
    key: rateLimitKey('drive-extract', 'file', input.integrationId, input.fileId),
    ...RATE_LIMITS.driveExtractFilePerDay,
  });
  if (!file.ok) {
    return { allowed: false, reason: 'file', retryAfterMs: Math.max(250, file.retryAfterMs) };
  }
  const connection = await check({
    key: rateLimitKey('drive-extract', 'connection', input.integrationId),
    ...RATE_LIMITS.driveExtractConnectionPerDay,
  });
  if (!connection.ok) {
    return {
      allowed: false,
      reason: 'connection',
      retryAfterMs: Math.max(250, connection.retryAfterMs),
    };
  }
  return { allowed: true };
}

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
/** Bounded page for orphan sweeps and disconnect S3 cleanup. */
export const DRIVE_EXTRACT_CURSOR_PAGE_SIZE = 500;

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

export function driveFileContentRevision(file: {
  headRevisionId?: string | null;
  md5Checksum?: string | null;
  modifiedTime?: string | null;
}): string | null {
  const head = file.headRevisionId?.trim();
  if (head) return `rev:${head}`;
  const md5 = file.md5Checksum?.trim();
  if (md5) return `md5:${md5}`;
  const modified = file.modifiedTime?.trim();
  if (modified) return `mod:${modified}`;
  return null;
}

/** Legacy cursors and metadata-less files cannot disprove a match. */
export function driveExtractMatchesFileRevision(
  storedRevisionId: string | undefined,
  fileRevisionId: string | null,
): boolean {
  if (!storedRevisionId || !fileRevisionId) return true;
  return storedRevisionId === fileRevisionId;
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

export function driveFileChangeDedupKey(input: {
  fileId: string;
  occurrence: string;
  contentHash: string;
  commentsHash: string;
  permissionsHash: string;
  part?: number;
}): string {
  const base = `google_drive:file:${input.fileId}:${input.occurrence}:${input.contentHash}:${input.commentsHash}:${input.permissionsHash}`;
  return input.part !== undefined ? `${base}:part:${String(input.part)}` : base;
}

export interface DriveExtractCursorRow {
  id: string;
  teamId: string;
  integrationId: string;
  fileId: string;
  cursor: DriveExtractCursor;
  updatedAt: Date;
}

function driveExtractCursorPopulatedSql() {
  const cursor = integrationSyncState.cursor;
  return and(
    sql`jsonb_typeof(${cursor} -> 'extractId') = 'string'`,
    sql`length(${cursor} ->> 'extractId') > 0`,
    sql`jsonb_typeof(${cursor} -> 'objectKey') = 'string'`,
    sql`length(${cursor} ->> 'objectKey') > 0`,
    sql`jsonb_typeof(${cursor} -> 'resultObjectKey') = 'string'`,
    sql`length(${cursor} ->> 'resultObjectKey') > 0`,
    sql`jsonb_typeof(${cursor} -> 'contentType') = 'string'`,
    sql`length(${cursor} ->> 'contentType') > 0`,
    sql`jsonb_typeof(${cursor} -> 'filename') = 'string'`,
    sql`length(${cursor} ->> 'filename') > 0`,
    sql`jsonb_typeof(${cursor} -> 'enqueuedAt') = 'string'`,
    sql`length(${cursor} ->> 'enqueuedAt') > 0`,
  );
}

function driveExtractCursorOrphanSql(now: Date) {
  const cutoff = new Date(now.getTime() - DRIVE_TRANSIENT_EXTRACT_ORPHAN_MS).toISOString();
  const cursor = integrationSyncState.cursor;
  const enqueuedAt = sql`${cursor} ->> ${sql.raw("'enqueuedAt'")}`;
  return sql`(
    (${cursor} ->> ${sql.raw("'cleanupPending'")}) = ${'true'}
    OR ${enqueuedAt} !~ ${'^[0-9]{4}-[0-9]{2}-[0-9]{2}T'}
    OR ${enqueuedAt} <= ${cutoff}
  )`;
}

function driveExtractCursorAfterSql(after: { updatedAt: Date; id: string }) {
  return or(
    gt(integrationSyncState.updatedAt, after.updatedAt),
    and(eq(integrationSyncState.updatedAt, after.updatedAt), gt(integrationSyncState.id, after.id)),
  );
}

/**
 * Worker discovery only: team ids that still have populated Drive extract
 * cursors. Payload reads go through `withTeam(...).integrations.listDriveExtractCursors`.
 */
export async function adminListTeamIdsWithDriveExtractCursors(
  db: Db,
  input: { now?: Date; orphanOnly?: boolean } = {},
): Promise<string[]> {
  const now = input.now ?? new Date();
  const rows = await db
    .selectDistinct({ teamId: integrationsTable.teamId })
    .from(integrationSyncState)
    .innerJoin(integrationsTable, eq(integrationsTable.id, integrationSyncState.integrationId))
    .where(
      and(
        sql`${integrationSyncState.resourceType} LIKE 'drive.extract.%'`,
        driveExtractCursorPopulatedSql(),
        ...(input.orphanOnly ? [driveExtractCursorOrphanSql(now)] : []),
      ),
    )
    .orderBy(asc(integrationsTable.teamId));
  return rows.map((row) => row.teamId);
}

export async function listDriveExtractCursors(
  db: Db,
  input: {
    teamId: string;
    integrationId?: string;
    now?: Date;
    orphanOnly?: boolean;
    limit?: number;
    after?: { updatedAt: Date; id: string };
  },
): Promise<DriveExtractCursorRow[]> {
  const limit = input.limit ?? DRIVE_EXTRACT_CURSOR_PAGE_SIZE;
  const now = input.now ?? new Date();
  const rows = await db
    .select({
      id: integrationSyncState.id,
      teamId: integrationsTable.teamId,
      integrationId: integrationSyncState.integrationId,
      resourceType: integrationSyncState.resourceType,
      cursor: integrationSyncState.cursor,
      updatedAt: integrationSyncState.updatedAt,
    })
    .from(integrationSyncState)
    .innerJoin(integrationsTable, eq(integrationsTable.id, integrationSyncState.integrationId))
    .where(
      and(
        eq(integrationsTable.teamId, input.teamId),
        sql`${integrationSyncState.resourceType} LIKE 'drive.extract.%'`,
        driveExtractCursorPopulatedSql(),
        ...(input.integrationId
          ? [eq(integrationSyncState.integrationId, input.integrationId)]
          : []),
        ...(input.orphanOnly ? [driveExtractCursorOrphanSql(now)] : []),
        ...(input.after ? [driveExtractCursorAfterSql(input.after)] : []),
      ),
    )
    .orderBy(asc(integrationSyncState.updatedAt), asc(integrationSyncState.id))
    .limit(limit);
  const found: DriveExtractCursorRow[] = [];
  for (const row of rows) {
    const fileId = driveExtractFileIdFromResourceType(row.resourceType);
    const cursor = parseDriveExtractCursor(row.cursor);
    if (!fileId || !cursor) continue;
    found.push({
      id: row.id,
      teamId: row.teamId,
      integrationId: row.integrationId,
      fileId,
      cursor,
      updatedAt: row.updatedAt,
    });
  }
  return found;
}

export async function forEachDriveExtractCursorPage(
  db: Db,
  input: {
    teamId: string;
    integrationId?: string;
    now?: Date;
    orphanOnly?: boolean;
    limit?: number;
    onPage: (rows: DriveExtractCursorRow[]) => Promise<void>;
  },
): Promise<number> {
  const limit = input.limit ?? DRIVE_EXTRACT_CURSOR_PAGE_SIZE;
  let after: { updatedAt: Date; id: string } | undefined;
  let seen = 0;
  for (;;) {
    const page = await listDriveExtractCursors(db, {
      teamId: input.teamId,
      limit,
      ...(input.integrationId ? { integrationId: input.integrationId } : {}),
      ...(input.now ? { now: input.now } : {}),
      ...(input.orphanOnly ? { orphanOnly: true } : {}),
      ...(after ? { after } : {}),
    });
    if (page.length === 0) break;
    await input.onPage(page);
    seen += page.length;
    if (page.length < limit) break;
    const last = page[page.length - 1];
    if (!last) break;
    after = { updatedAt: last.updatedAt, id: last.id };
  }
  return seen;
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

function asLinkHintRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
}

export interface DriveObjectLinkHints {
  parentIds: string[];
  driveId: string | null;
  matchedAncestorId: string | null;
  inheritedCandidates: string[] | null;
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

function parseDriveSnapshotAncestry(value: unknown): DriveObjectLinkHints | null {
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

export async function latestDriveObjectLinkHints(
  db: Db,
  input: { teamId: string; integrationId: string; fileId: string },
): Promise<DriveObjectLinkHints> {
  const fileId = input.fileId.trim();
  if (!fileId) return emptyDriveObjectLinkHints();
  const hints = await latestDriveObjectLinkHintsByFileIds(db, {
    teamId: input.teamId,
    integrationId: input.integrationId,
    fileIds: [fileId],
  });
  return hints.get(fileId) ?? emptyDriveObjectLinkHints();
}

function emptyDriveObjectLinkHints(): DriveObjectLinkHints {
  return { parentIds: [], driveId: null, matchedAncestorId: null, inheritedCandidates: null };
}

function driveObjectLinkHintsFromSourceMetadata(value: unknown): DriveObjectLinkHints {
  const metadata = asLinkHintRecord(value);
  const drive = asLinkHintRecord(metadata?.drive);
  if (!drive) return emptyDriveObjectLinkHints();
  const inheritedCandidates = stringList(drive.inherited_candidates);
  const inheritedFrom = typeof drive.inherited_from === 'string' ? drive.inherited_from : null;
  const matchedAncestorId =
    typeof drive.matched_ancestor_id === 'string' ? drive.matched_ancestor_id : inheritedFrom;
  const driveId = typeof drive.drive_id === 'string' ? drive.drive_id : null;
  return {
    parentIds: stringList(drive.parents),
    driveId,
    matchedAncestorId,
    inheritedCandidates: inheritedCandidates.length > 0 ? inheritedCandidates : null,
  };
}

export async function latestDriveObjectLinkHintsByFileIds(
  db: Db,
  input: { teamId: string; integrationId: string; fileIds: string[] },
): Promise<Map<string, DriveObjectLinkHints>> {
  const fileIds = [...new Set(input.fileIds.map((fileId) => fileId.trim()).filter(Boolean))];
  const hints = new Map<string, DriveObjectLinkHints>();
  if (fileIds.length === 0) return hints;
  const rows = await db
    .select({
      sourceMetadata: rawEvents.sourceMetadata,
      occurredAt: rawEvents.occurredAt,
    })
    .from(rawEvents)
    .where(
      and(
        eq(rawEvents.teamId, input.teamId),
        eq(rawEvents.source, 'integration'),
        sql`${rawEvents.sourceMetadata} ->> 'provider' = 'google_drive'`,
        sql`${rawEvents.sourceMetadata} ->> 'integration_id' = ${input.integrationId}`,
        inArray(
          sql`lower(${rawEvents.sourceMetadata} ->> 'external_object_id')`,
          fileIds.map((fileId) => fileId.toLowerCase()),
        ),
      ),
    );
  const latestEvent = new Map<string, { at: Date; hints: DriveObjectLinkHints }>();
  for (const row of rows) {
    const metadata = asLinkHintRecord(row.sourceMetadata);
    const fileId =
      typeof metadata?.external_object_id === 'string'
        ? metadata.external_object_id.trim().toLowerCase()
        : '';
    if (!fileId) continue;
    const previous = latestEvent.get(fileId);
    if (!previous || previous.at < row.occurredAt) {
      latestEvent.set(fileId, {
        at: row.occurredAt,
        hints: driveObjectLinkHintsFromSourceMetadata(row.sourceMetadata),
      });
    }
  }
  const snapshots = await db
    .select({
      fileId: googleDriveFileSnapshots.fileId,
      ancestry: googleDriveFileSnapshots.ancestry,
      createdAt: googleDriveFileSnapshots.createdAt,
    })
    .from(googleDriveFileSnapshots)
    .where(
      and(
        eq(googleDriveFileSnapshots.teamId, input.teamId),
        eq(googleDriveFileSnapshots.integrationId, input.integrationId),
        inArray(googleDriveFileSnapshots.fileId, fileIds),
      ),
    );
  const latestSnapshot = new Map<string, { at: Date; hints: DriveObjectLinkHints }>();
  for (const row of snapshots) {
    const parsed = parseDriveSnapshotAncestry(row.ancestry);
    if (!parsed) continue;
    const previous = latestSnapshot.get(row.fileId);
    if (!previous || previous.at < row.createdAt) {
      latestSnapshot.set(row.fileId, { at: row.createdAt, hints: parsed });
    }
  }
  for (const fileId of fileIds) {
    const event = latestEvent.get(fileId.toLowerCase());
    const snapshot = latestSnapshot.get(fileId);
    hints.set(
      fileId,
      pickNewestDriveTrackedAncestry({
        ...(event ? { event } : {}),
        ...(snapshot ? { snapshot } : {}),
      }),
    );
  }
  return hints;
}

async function listDriveSnapshotFileIds(
  db: Db,
  input: { teamId: string; integrationId: string },
): Promise<string[]> {
  const rows = await db
    .select({ fileId: googleDriveFileSnapshots.fileId })
    .from(googleDriveFileSnapshots)
    .where(
      and(
        eq(googleDriveFileSnapshots.teamId, input.teamId),
        eq(googleDriveFileSnapshots.integrationId, input.integrationId),
      ),
    );
  return [...new Set(rows.map((row) => row.fileId))];
}

export async function loadLatestDriveSnapshot(
  db: Db,
  input: { teamId: string; integrationId: string; fileId: string },
): Promise<DriveSnapshotRecord | null> {
  const [row] = await db
    .select({
      contentHash: googleDriveFileSnapshots.contentHash,
      snapshotText: googleDriveFileSnapshots.snapshotText,
      commentsHash: googleDriveFileSnapshots.commentsHash,
      permissionsHash: googleDriveFileSnapshots.permissionsHash,
      commentsSnapshot: googleDriveFileSnapshots.commentsSnapshot,
      mimeType: googleDriveFileSnapshots.mimeType,
      snapshotLocate: googleDriveFileSnapshots.snapshotLocate,
      ancestry: googleDriveFileSnapshots.ancestry,
    })
    .from(googleDriveFileSnapshots)
    .where(
      and(
        eq(googleDriveFileSnapshots.teamId, input.teamId),
        eq(googleDriveFileSnapshots.integrationId, input.integrationId),
        eq(googleDriveFileSnapshots.fileId, input.fileId),
      ),
    )
    .orderBy(desc(googleDriveFileSnapshots.createdAt))
    .limit(1);
  if (!row) return null;
  return {
    contentHash: row.contentHash,
    snapshotText: row.snapshotText,
    commentsHash: row.commentsHash,
    permissionsHash: row.permissionsHash,
    commentsSnapshot: row.commentsSnapshot,
    mimeType: row.mimeType,
    snapshotLocate: parseDriveSnapshotLocate(row.snapshotLocate),
    ancestry: parseDriveSnapshotAncestry(row.ancestry),
  };
}

export async function saveDriveSnapshot(
  db: Db,
  input: {
    teamId: string;
    integrationId: string;
    fileId: string;
    snapshot: DriveSnapshotRecord;
  },
): Promise<void> {
  await db
    .insert(googleDriveFileSnapshots)
    .values({
      teamId: input.teamId,
      integrationId: input.integrationId,
      fileId: input.fileId,
      contentHash: input.snapshot.contentHash,
      snapshotText: input.snapshot.snapshotText,
      commentsHash: input.snapshot.commentsHash,
      permissionsHash: input.snapshot.permissionsHash,
      commentsSnapshot: parseDriveCommentSnapshots(input.snapshot.commentsSnapshot),
      mimeType: input.snapshot.mimeType,
      snapshotLocate: parseDriveSnapshotLocate(input.snapshot.snapshotLocate),
      ancestry: parseDriveSnapshotAncestry(input.snapshot.ancestry),
    })
    .onConflictDoUpdate({
      target: [
        googleDriveFileSnapshots.integrationId,
        googleDriveFileSnapshots.fileId,
        googleDriveFileSnapshots.contentHash,
        googleDriveFileSnapshots.commentsHash,
        googleDriveFileSnapshots.permissionsHash,
      ],
      set: {
        snapshotText: sql`excluded.snapshot_text`,
        snapshotLocate: sql`excluded.snapshot_locate`,
        commentsSnapshot: sql`excluded.comments_snapshot`,
        mimeType: sql`excluded.mime_type`,
        ancestry: sql`coalesce(excluded.ancestry, google_drive_file_snapshots.ancestry)`,
        // Revisit of a retained fingerprint must become the latest baseline.
        // `onConflictDoNothing` left the later distinct snapshot as latest, so
        // A→B→A compared later captures against B and a later edit back to B
        // was dropped as unchanged. `clock_timestamp()` advances inside a
        // transaction where `now()` would not.
        createdAt: sql`clock_timestamp()`,
      },
    });
  const kept = await db
    .select({
      id: googleDriveFileSnapshots.id,
      snapshotLocate: googleDriveFileSnapshots.snapshotLocate,
    })
    .from(googleDriveFileSnapshots)
    .where(
      and(
        eq(googleDriveFileSnapshots.teamId, input.teamId),
        eq(googleDriveFileSnapshots.integrationId, input.integrationId),
        eq(googleDriveFileSnapshots.fileId, input.fileId),
      ),
    )
    .orderBy(desc(googleDriveFileSnapshots.createdAt))
    .limit(DRIVE_SNAPSHOT_RETENTION);
  const keepIds = kept.map((row) => row.id);
  if (keepIds.length === 0) return;
  await db
    .delete(googleDriveFileSnapshots)
    .where(
      and(
        eq(googleDriveFileSnapshots.teamId, input.teamId),
        eq(googleDriveFileSnapshots.integrationId, input.integrationId),
        eq(googleDriveFileSnapshots.fileId, input.fileId),
        notInArray(googleDriveFileSnapshots.id, keepIds),
      ),
    );
  for (const row of kept.slice(1)) {
    const locate = parseDriveSnapshotLocate(row.snapshotLocate);
    if (!locate || locate.chunkTexts.length === 0) continue;
    await db
      .update(googleDriveFileSnapshots)
      .set({ snapshotLocate: hashesOnlyDriveSnapshotLocate(locate) })
      .where(
        and(
          eq(googleDriveFileSnapshots.id, row.id),
          eq(googleDriveFileSnapshots.teamId, input.teamId),
          eq(googleDriveFileSnapshots.integrationId, input.integrationId),
          eq(googleDriveFileSnapshots.fileId, input.fileId),
        ),
      );
  }
}

export async function deleteDriveSnapshotsForFile(
  db: Db,
  input: { teamId: string; integrationId: string; fileId: string },
): Promise<void> {
  await db
    .delete(googleDriveFileSnapshots)
    .where(
      and(
        eq(googleDriveFileSnapshots.teamId, input.teamId),
        eq(googleDriveFileSnapshots.integrationId, input.integrationId),
        eq(googleDriveFileSnapshots.fileId, input.fileId),
      ),
    );
}

export type DriveTrackedExtractObjectDeleter = (cursor: {
  objectKey: string;
  resultObjectKey: string;
  pendingDeleteKeys?: string[];
  tombstones?: DriveExtractTombstone[];
}) => Promise<string[]>;

export type DriveTrackedFileDiscarder = (fileId: string) => Promise<void>;

/** Cancel an in-flight extract. `cancel` keeps a tombstone; `disconnect` fails closed. */
async function cancelDriveTrackedExtract(
  db: Db,
  input: {
    teamId: string;
    integrationId: string;
    fileId: string;
    deleteExtractObjects: DriveTrackedExtractObjectDeleter;
    now?: Date;
    mode: 'cancel' | 'disconnect';
  },
): Promise<void> {
  const extractType = driveExtractCursorKey(input.fileId);
  const [extractRow] = await db
    .select({ cursor: integrationSyncState.cursor })
    .from(integrationSyncState)
    .innerJoin(integrationsTable, eq(integrationsTable.id, integrationSyncState.integrationId))
    .where(
      and(
        eq(integrationsTable.teamId, input.teamId),
        eq(integrationSyncState.integrationId, input.integrationId),
        eq(integrationSyncState.resourceType, extractType),
      ),
    )
    .limit(1);
  const extractCursor = parseDriveExtractCursor(extractRow?.cursor);
  if (!extractCursor) return;
  const remainingKeys = await input.deleteExtractObjects(extractCursor);
  if (input.mode === 'disconnect') {
    if (remainingKeys.length > 0) {
      throw new Error(`drive transient extract objects remain: ${remainingKeys.join(',')}`);
    }
    await db
      .delete(integrationSyncState)
      .where(
        and(
          eq(integrationSyncState.integrationId, input.integrationId),
          eq(integrationSyncState.resourceType, extractType),
        ),
      );
    return;
  }
  const remainingCurrent = remainingKeys.filter(
    (key) => key === extractCursor.objectKey || key === extractCursor.resultObjectKey,
  );
  const now = input.now ?? new Date();
  const next = retainDriveExtractCleanupCursor(extractCursor, remainingCurrent, {
    cancelledAt: extractCursor.cancelledAt ?? now.toISOString(),
  });
  if (
    shouldRetainDriveExtractCleanup(next, remainingCurrent, {
      mode: 'cancel',
      now: now.getTime(),
    })
  ) {
    await db
      .update(integrationSyncState)
      .set({ cursor: next, updatedAt: now })
      .where(
        and(
          eq(integrationSyncState.integrationId, input.integrationId),
          eq(integrationSyncState.resourceType, extractType),
        ),
      );
    return;
  }
  await db
    .delete(integrationSyncState)
    .where(
      and(
        eq(integrationSyncState.integrationId, input.integrationId),
        eq(integrationSyncState.resourceType, extractType),
      ),
    );
}

export async function discardDriveTrackedFile(
  db: Db,
  input: {
    teamId: string;
    integrationId: string;
    fileId: string;
    deleteExtractObjects: DriveTrackedExtractObjectDeleter;
    now?: Date;
    mode?: 'cancel' | 'disconnect';
  },
): Promise<void> {
  await deleteDriveSnapshotsForFile(db, {
    teamId: input.teamId,
    integrationId: input.integrationId,
    fileId: input.fileId,
  });
  await cancelDriveTrackedExtract(db, {
    teamId: input.teamId,
    integrationId: input.integrationId,
    fileId: input.fileId,
    deleteExtractObjects: input.deleteExtractObjects,
    mode: input.mode ?? 'cancel',
    ...(input.now ? { now: input.now } : {}),
  });
}

/**
 * Coverage-aware snapshot/extract cleanup after a selection set narrows.
 * Remaining empty means every tracked file is uncovered. Force-discard ids
 * (live out-of-scope/missing/removed) are dropped even if stored ancestry
 * still matches a remaining selection. Coverage reads
 * `latestDriveObjectLinkHintsByFileIds` — the newest snapshot or event
 * ancestry, not event hints alone.
 */
export async function cleanupUncoveredDriveTrackedFiles(
  db: Db,
  input: {
    teamId: string;
    integrationId: string;
    remainingSelections: { kind: string; externalId: string }[];
    extraTrackedFileIds?: string[];
    forceDiscardFileIds?: string[];
    discardFile: DriveTrackedFileDiscarder;
  },
): Promise<string[]> {
  const remainingScope = driveScopeFromSelections(input.remainingSelections);
  const keepFileIds = new Set(
    input.remainingSelections
      .filter((selection) => selection.kind === DRIVE_FILE_KIND)
      .map((selection) => selection.externalId),
  );
  const forceDiscardFileIds = new Set(input.forceDiscardFileIds ?? []);
  const trackedFileIds = new Set(
    await listDriveSnapshotFileIds(db, {
      teamId: input.teamId,
      integrationId: input.integrationId,
    }),
  );
  await forEachDriveExtractCursorPage(db, {
    teamId: input.teamId,
    integrationId: input.integrationId,
    onPage: (page) => {
      for (const row of page) trackedFileIds.add(row.fileId);
      return Promise.resolve();
    },
  });
  for (const fileId of input.extraTrackedFileIds ?? []) trackedFileIds.add(fileId);
  for (const fileId of forceDiscardFileIds) trackedFileIds.add(fileId);
  const hints = await latestDriveObjectLinkHintsByFileIds(db, {
    teamId: input.teamId,
    integrationId: input.integrationId,
    fileIds: [...trackedFileIds],
  });
  const discarded: string[] = [];
  for (const fileId of trackedFileIds) {
    if (!forceDiscardFileIds.has(fileId) && keepFileIds.has(fileId)) continue;
    const hint = hints.get(fileId);
    const coverage = forceDiscardFileIds.has(fileId)
      ? 'out'
      : driveFileCoverage({
          fileId,
          scope: remainingScope,
          ...(hint?.parentIds.length ? { parents: hint.parentIds } : {}),
          ...(hint?.driveId ? { driveId: hint.driveId } : {}),
          ...(hint?.matchedAncestorId ? { matchedAncestorId: hint.matchedAncestorId } : {}),
          ...(hint?.inheritedCandidates ? { candidates: hint.inheritedCandidates } : {}),
        });
    if (coverage !== 'out') continue;
    await input.discardFile(fileId);
    discarded.push(fileId);
  }
  return discarded;
}

export async function deleteDriveSnapshotsForIntegration(
  db: Db,
  input: { teamId: string; integrationId: string },
): Promise<void> {
  await db
    .delete(googleDriveFileSnapshots)
    .where(
      and(
        eq(googleDriveFileSnapshots.teamId, input.teamId),
        eq(googleDriveFileSnapshots.integrationId, input.integrationId),
      ),
    );
}

export async function listTeamEmailDomains(db: Db, teamId: string): Promise<string[]> {
  const rows = await db
    .select({ email: users.email })
    .from(teamMembers)
    .innerJoin(users, eq(users.id, teamMembers.userId))
    .where(and(eq(teamMembers.teamId, teamId), isNull(teamMembers.removedAt)));
  const domains = new Set<string>();
  for (const row of rows) {
    const at = row.email.lastIndexOf('@');
    if (at > 0) domains.add(row.email.slice(at + 1).toLowerCase());
  }
  return [...domains];
}

export async function linkedObjectForDriveSelection(
  db: Db,
  input: {
    teamId: string;
    integrationId: string;
    fileId: string;
    parentIds: string[];
    matchedAncestorId?: string | null;
    driveId?: string | null;
    myDriveRootId?: string | null;
  },
): Promise<DriveLinkedObject | null> {
  const candidates = driveObjectLinkCandidates(input);
  if (candidates.length === 0) return null;
  const rows = await db
    .select({
      externalId: integrationSelections.externalId,
      selectionKind: integrationSelections.selectionKind,
      objectId: integrationSelections.linkedObjectId,
      canonicalName: entities.canonicalName,
      type: entities.type,
    })
    .from(integrationSelections)
    .innerJoin(entities, eq(entities.id, integrationSelections.linkedObjectId))
    .where(
      and(
        eq(entities.teamId, input.teamId),
        eq(integrationSelections.integrationId, input.integrationId),
        inArray(integrationSelections.externalId, candidates),
      ),
    );
  const byId = new Map(rows.map((row) => [row.externalId, row]));
  const winner = pickMostSpecificDriveAncestor(candidates, (id) => {
    const hit = byId.get(id);
    return hit?.objectId ? driveAncestorKindFromSelectionKind(hit.selectionKind) : null;
  });
  if (!winner) return null;
  const hit = byId.get(winner);
  if (!hit?.objectId) return null;
  return {
    id: hit.objectId,
    canonicalName: hit.canonicalName,
    type: hit.type,
    inheritedFrom: winner,
    inheritedCandidates: candidates,
  };
}

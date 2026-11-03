import { createHash } from 'node:crypto';

import {
  entities,
  googleDriveFileSnapshots,
  integrations as integrationsTable,
  integrationSelections,
  integrationSyncState,
  teamMembers,
  users,
  type Db,
} from '@timeline/db';
import { and, asc, desc, eq, gt, inArray, isNull, notInArray, or, sql } from 'drizzle-orm';

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

export interface DriveExtractCursor {
  extractId: string;
  objectKey: string;
  resultObjectKey: string;
  contentType: string;
  filename: string;
  enqueuedAt: string;
  /** Drive `headRevisionId` / md5 / modifiedTime of the bytes sent to extract. */
  revisionId?: string;
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
  };
}

export function isDriveExtractPendingStale(cursor: DriveExtractCursor, now = Date.now()): boolean {
  const enqueuedAtMs = Date.parse(cursor.enqueuedAt);
  if (!Number.isFinite(enqueuedAtMs)) return true;
  return now - enqueuedAtMs >= DRIVE_EXTRACT_PENDING_STALE_MS;
}

export function isDriveExtractCursorOrphan(cursor: DriveExtractCursor, now = Date.now()): boolean {
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
}): string {
  return `google_drive:file:${input.fileId}:${input.occurrence}:${input.contentHash}:${input.commentsHash}:${input.permissionsHash}`;
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
  const enqueuedAt = sql`${integrationSyncState.cursor} ->> ${sql.raw("'enqueuedAt'")}`;
  return sql`(
    ${enqueuedAt} !~ ${'^[0-9]{4}-[0-9]{2}-[0-9]{2}T'}
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
  const ids = [input.fileId, input.matchedAncestorId, input.driveId, ...input.parentIds].filter(
    (id): id is string => typeof id === 'string' && id.length > 0,
  );
  if (driveFileIsMyDriveDescendant(input)) ids.push('root');
  return [...new Set(ids)];
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
      mimeType: googleDriveFileSnapshots.mimeType,
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
  return row ?? null;
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
      mimeType: input.snapshot.mimeType,
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
        mimeType: sql`excluded.mime_type`,
        // Revisit of a retained fingerprint must become the latest baseline.
        // `onConflictDoNothing` left the later distinct snapshot as latest, so
        // A→B→A compared later captures against B and a later edit back to B
        // was dropped as unchanged. `clock_timestamp()` advances inside a
        // transaction where `now()` would not.
        createdAt: sql`clock_timestamp()`,
      },
    });
  const kept = await db
    .select({ id: googleDriveFileSnapshots.id })
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
): Promise<{ id: string; canonicalName: string; type: string } | null> {
  const candidates = driveObjectLinkCandidates(input);
  if (candidates.length === 0) return null;
  const rows = await db
    .select({
      externalId: integrationSelections.externalId,
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
  for (const candidate of candidates) {
    const hit = byId.get(candidate);
    if (hit?.objectId) {
      return { id: hit.objectId, canonicalName: hit.canonicalName, type: hit.type };
    }
  }
  return null;
}

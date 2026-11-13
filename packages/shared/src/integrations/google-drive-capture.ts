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

import {
  cleanupDriveExtract,
  type DriveExtractObjectDeleter,
} from '#src/integrations/drive-extract-lifecycle.js';
import {
  driveExtractCursorKey,
  driveExtractFileIdFromResourceType,
  DRIVE_TRANSIENT_EXTRACT_ORPHAN_MS,
  type DriveExtractCursor,
  parseDriveExtractCursor,
} from '#src/integrations/drive-extract-protocol.js';
import { parseDriveCommentSnapshots } from '#src/integrations/google-drive-comments.js';
import { emptyDriveObjectLinkHints } from '#src/integrations/google-drive-contracts.js';
import {
  hashesOnlyDriveSnapshotLocate,
  parseDriveSnapshotLocate,
  type DriveSnapshotLocate,
} from '#src/integrations/google-drive-diff.js';
import {
  driveObjectLinkCandidates,
  parseDriveSnapshotAncestry,
  pickNewestDriveTrackedAncestry,
  type DriveLinkedObject,
} from '#src/integrations/google-drive-link-policy.js';
import {
  DRIVE_FILE_KIND,
  driveAncestorKindFromSelectionKind,
  driveFileCoverage,
  driveScopeFromSelections,
  pickMostSpecificDriveAncestor,
} from '#src/integrations/google-drive-scope.js';
import { activeWorkspaceCondition } from '#src/platform-admin/runtime.js';
import {
  checkRateLimit,
  RATE_LIMITS,
  rateLimitKey,
  type RateLimitInput,
  type RateLimitResult,
} from '#src/rate-limit/index.js';

import type {
  DrivePermissionGrant,
  DriveSnapshotRecord,
  DriveObjectLinkHints,
} from '#src/integrations/google-drive-contracts.js';

/** Bounded page for orphan sweeps and disconnect S3 cleanup. */
export const DRIVE_EXTRACT_CURSOR_PAGE_SIZE = 500;

export const DRIVE_FILE_DEBOUNCE_MS = 15 * 60 * 1000;
export const DRIVE_FILE_MAX_LATENCY_MS = 60 * 60 * 1000;
const DRIVE_SNAPSHOT_RETENTION = 3;

export interface DriveDebouncePlan {
  delayMs: number;
  firstQueuedAt: string;
  quietUntil: string;
}

export function compactDrivePermissionGrants(
  permissions: readonly {
    id?: string;
    type?: string;
    role?: string;
    emailAddress?: string;
    email?: string;
    domain?: string;
  }[],
): DrivePermissionGrant[] {
  return permissions.map((permission) => {
    const email = permission.emailAddress ?? permission.email ?? '';
    const domain =
      permission.domain && permission.domain.length > 0
        ? permission.domain
        : email.includes('@')
          ? email.slice(email.lastIndexOf('@') + 1)
          : '';
    return {
      id: permission.id ?? '',
      type: permission.type ?? '',
      role: permission.role ?? '',
      email,
      domain,
    };
  });
}

function parseDrivePermissionGrants(value: unknown): DrivePermissionGrant[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const grants = (value as Record<string, unknown>).permissionGrants;
  if (!Array.isArray(grants)) return [];
  return compactDrivePermissionGrants(
    grants.flatMap((grant) => {
      if (!grant || typeof grant !== 'object' || Array.isArray(grant)) return [];
      const record = grant as Record<string, unknown>;
      return [
        {
          id: typeof record.id === 'string' ? record.id : '',
          type: typeof record.type === 'string' ? record.type : '',
          role: typeof record.role === 'string' ? record.role : '',
          emailAddress: typeof record.email === 'string' ? record.email : '',
          domain: typeof record.domain === 'string' ? record.domain : '',
        },
      ];
    }),
  );
}

type StoredDriveSnapshotLocate = NonNullable<
  (typeof googleDriveFileSnapshots)['$inferInsert']['snapshotLocate']
>;

function persistableDriveSnapshotLocate(
  locate: DriveSnapshotLocate | null | undefined,
  grants: DrivePermissionGrant[] | undefined,
): StoredDriveSnapshotLocate | null {
  const parsed = parseDriveSnapshotLocate(locate ?? null);
  const permissionGrants = grants ?? [];
  if (!parsed) {
    return permissionGrants.length > 0 ? ({ permissionGrants } as StoredDriveSnapshotLocate) : null;
  }
  return { ...parsed, permissionGrants };
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
        activeWorkspaceCondition(integrationsTable.teamId),
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

function asLinkHintRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
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

function driveObjectLinkHintsFromSourceMetadata(value: unknown): DriveObjectLinkHints {
  const metadata = asLinkHintRecord(value);
  const drive = asLinkHintRecord(metadata?.drive);
  if (!drive) return emptyDriveObjectLinkHints();
  const inheritedCandidates = Array.isArray(drive.inherited_candidates)
    ? drive.inherited_candidates.filter(
        (item): item is string => typeof item === 'string' && item.length > 0,
      )
    : [];
  const inheritedFrom = typeof drive.inherited_from === 'string' ? drive.inherited_from : null;
  const matchedAncestorId =
    typeof drive.matched_ancestor_id === 'string' ? drive.matched_ancestor_id : inheritedFrom;
  const driveId = typeof drive.drive_id === 'string' ? drive.drive_id : null;
  return {
    parentIds: Array.isArray(drive.parents)
      ? drive.parents.filter((item): item is string => typeof item === 'string' && item.length > 0)
      : [],
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

function driveAncestryIncludesAncestor(
  hints: DriveObjectLinkHints | null | undefined,
  ancestorId: string,
): boolean {
  const needle = ancestorId.trim().toLowerCase();
  if (!needle) return false;
  const ids = [
    ...(hints?.parentIds ?? []),
    ...(hints?.inheritedCandidates ?? []),
    hints?.matchedAncestorId,
    hints?.driveId,
  ];
  return ids.some((id) => typeof id === 'string' && id.trim().toLowerCase() === needle);
}

/** Tracked files whose stored walk includes `ancestorId` (folder or shared drive). */
export async function listDriveTrackedDescendantFileIds(
  db: Db,
  input: { teamId: string; integrationId: string; ancestorId: string },
): Promise<string[]> {
  const ancestorId = input.ancestorId.trim();
  if (!ancestorId) return [];
  const fileIds = await listDriveSnapshotFileIds(db, {
    teamId: input.teamId,
    integrationId: input.integrationId,
  });
  if (fileIds.length === 0) return [];
  const hints = await latestDriveObjectLinkHintsByFileIds(db, {
    teamId: input.teamId,
    integrationId: input.integrationId,
    fileIds,
  });
  return fileIds.filter(
    (fileId) =>
      fileId.trim().toLowerCase() !== ancestorId.toLowerCase() &&
      driveAncestryIncludesAncestor(hints.get(fileId), ancestorId),
  );
}

async function resolveLiveLinkedEntity(
  db: Db,
  teamId: string,
  objectId: string,
): Promise<{ id: string; canonicalName: string; type: string } | null> {
  const seen = new Set<string>();
  let currentId = objectId;
  for (;;) {
    if (seen.has(currentId)) return null;
    seen.add(currentId);
    const [row] = await db
      .select({
        id: entities.id,
        canonicalName: entities.canonicalName,
        type: entities.type,
        mergedIntoId: entities.mergedIntoId,
      })
      .from(entities)
      .where(and(eq(entities.id, currentId), eq(entities.teamId, teamId)))
      .limit(1);
    if (!row) return null;
    if (!row.mergedIntoId) {
      return { id: row.id, canonicalName: row.canonicalName, type: row.type };
    }
    currentId = row.mergedIntoId;
  }
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
    permissionsSnapshot: parseDrivePermissionGrants(row.snapshotLocate),
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
      snapshotLocate: persistableDriveSnapshotLocate(
        input.snapshot.snapshotLocate,
        input.snapshot.permissionsSnapshot,
      ),
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

export type DriveTrackedExtractObjectDeleter = DriveExtractObjectDeleter;

export type DriveTrackedFileDiscarder = (fileId: string) => Promise<void>;

/**
 * Cancel an in-flight extract. `cancel` keeps a tombstone until the producer
 * wait elapses. `disconnect` fails closed while that wait remains, even when
 * DeleteObject already 404'd a not-yet-written `result.json`.
 */
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
  const now = input.now ?? new Date();
  await cleanupDriveExtract({
    cursor: extractCursor,
    mode: input.mode,
    now,
    deleteObjects: input.deleteExtractObjects,
    async persist(cursor) {
      const condition = and(
        eq(integrationSyncState.integrationId, input.integrationId),
        eq(integrationSyncState.resourceType, extractType),
      );
      if (cursor) {
        await db.update(integrationSyncState).set({ cursor, updatedAt: now }).where(condition);
      } else {
        await db.delete(integrationSyncState).where(condition);
      }
    },
  });
}

/**
 * Persist cancel tombstones for every Drive extract on an integration before
 * the disconnect transaction. Collect file ids first so cursor `updatedAt`
 * changes cannot loop pagination. Disconnect then fails closed until the
 * producer wait settles, so a late `result.json` still has cleanup tracking.
 */
export async function retainDriveExtractsForDisconnect(
  db: Db,
  input: {
    teamId: string;
    integrationId: string;
    deleteExtractObjects: DriveTrackedExtractObjectDeleter;
    now?: Date;
  },
): Promise<void> {
  const fileIds: string[] = [];
  await forEachDriveExtractCursorPage(db, {
    teamId: input.teamId,
    integrationId: input.integrationId,
    ...(input.now ? { now: input.now } : {}),
    onPage: (page) => {
      for (const row of page) fileIds.push(row.fileId);
      return Promise.resolve();
    },
  });
  for (const fileId of fileIds) {
    await cancelDriveTrackedExtract(db, {
      teamId: input.teamId,
      integrationId: input.integrationId,
      fileId,
      deleteExtractObjects: input.deleteExtractObjects,
      mode: 'cancel',
      ...(input.now ? { now: input.now } : {}),
    });
  }
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
  const live = await resolveLiveLinkedEntity(db, input.teamId, hit.objectId);
  if (!live) return null;
  return {
    id: live.id,
    canonicalName: live.canonicalName,
    type: live.type,
    inheritedFrom: winner,
    inheritedCandidates: candidates,
  };
}

export type {
  DrivePermissionGrant,
  DriveSnapshotRecord,
  DriveObjectLinkHints,
} from '#src/integrations/google-drive-contracts.js';

export * from '#src/integrations/drive-extract-protocol.js';

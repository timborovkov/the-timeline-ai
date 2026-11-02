import { createHash } from 'node:crypto';

import {
  entities,
  googleDriveFileSnapshots,
  integrationSelections,
  teamMembers,
  users,
  type Db,
} from '@timeline/db';
import { and, desc, eq, inArray, isNull, notInArray } from 'drizzle-orm';

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
    .onConflictDoNothing();
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
  input: { teamId: string; integrationId: string; fileId: string; parentIds: string[] },
): Promise<{ id: string; canonicalName: string; type: string } | null> {
  const ids = [...new Set([input.fileId, ...input.parentIds, 'root'])];
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
        inArray(integrationSelections.externalId, ids),
      ),
    );
  const byId = new Map(rows.map((row) => [row.externalId, row]));
  for (const candidate of [input.fileId, ...input.parentIds, 'root']) {
    const hit = byId.get(candidate);
    if (hit?.objectId) {
      return { id: hit.objectId, canonicalName: hit.canonicalName, type: hit.type };
    }
  }
  return null;
}

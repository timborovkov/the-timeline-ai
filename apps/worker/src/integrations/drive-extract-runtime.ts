import { randomUUID } from 'node:crypto';

import type { Db } from '@timeline/db';
import {
  deleteObject,
  getDocumentsBucket,
  getObjectBuffer,
  getS3Client,
  integrations as integrationsLib,
  putObject,
  queue,
  withTeam,
} from '@timeline/shared';
import { cleanupDriveExtract } from '@timeline/shared/integrations/drive-extract-lifecycle';
import * as extractProtocol from '@timeline/shared/integrations/drive-extract-protocol';

const ZERO_UUID = '00000000-0000-0000-0000-000000000000';

interface DriveTransientExtractIO {
  getDocumentsBucket: () => string;
  putDocumentObject: (input: {
    bucket: string;
    key: string;
    body: Buffer;
    contentType: string;
  }) => Promise<void>;
  getDocumentObject: (input: {
    bucket: string;
    key: string;
    maxBytes: number;
  }) => Promise<{ body: Buffer }>;
  deleteDocumentObject: (input: { bucket: string; key: string }) => Promise<void>;
  enqueueDocumentExtractJob: (data: queue.DocumentExtractJobData) => Promise<void>;
}

const defaultDriveTransientExtractIO: DriveTransientExtractIO = {
  getDocumentsBucket,
  async putDocumentObject(input) {
    await putObject(getS3Client(), input);
  },
  async getDocumentObject(input) {
    return getObjectBuffer(getS3Client(), input.bucket, input.key, input.maxBytes);
  },
  async deleteDocumentObject(input) {
    await deleteObject(getS3Client(), input.bucket, input.key);
  },
  enqueueDocumentExtractJob: queue.enqueueDocumentExtractJob,
};

const DRIVE_TRANSIENT_RESULT_MAX_BYTES = extractProtocol.DRIVE_TRANSIENT_RESULT_MAX_BYTES;

interface DriveExtractCursorScope {
  getIntegration: (id: string) => Promise<{ id: string; teamId: string } | null>;
  loadCursor: (integrationId: string, resourceType: string) => Promise<unknown>;
  saveCursor: (
    integrationId: string,
    resourceType: string,
    cursor: unknown,
    status?: { lastStatus?: string; lastError?: string | null },
  ) => Promise<void>;
}

async function requireDriveExtractIntegration(
  integrations: DriveExtractCursorScope,
  integrationId: string,
): Promise<{ id: string; teamId: string }> {
  const integration = await integrations.getIntegration(integrationId);
  if (!integration) throw new Error('drive extract integration not found for team');
  return integration;
}

function driveTransientExtractJob(input: {
  teamId: string;
  integrationId: string;
  fileId: string;
  cursor: extractProtocol.DriveExtractCursor;
}): queue.DriveTransientExtractJobData {
  return {
    kind: 'drive_transient',
    teamId: input.teamId,
    integrationId: input.integrationId,
    fileId: input.fileId,
    extractId: input.cursor.extractId,
    objectKey: input.cursor.objectKey,
    resultObjectKey: input.cursor.resultObjectKey,
    contentType: input.cursor.contentType,
    filename: input.cursor.filename,
  };
}

async function loadDriveExtractCursor(
  integrations: DriveExtractCursorScope,
  integrationId: string,
  fileId: string,
): Promise<extractProtocol.DriveExtractCursor | null> {
  const integration = await integrations.getIntegration(integrationId);
  if (!integration) return null;
  return extractProtocol.parseDriveExtractCursor(
    await integrations.loadCursor(integrationId, extractProtocol.driveExtractCursorKey(fileId)),
  );
}

async function saveDriveExtractCursor(
  integrations: DriveExtractCursorScope,
  integrationId: string,
  fileId: string,
  cursor: extractProtocol.DriveExtractCursor | Record<string, never>,
): Promise<void> {
  const integration = await integrations.getIntegration(integrationId);
  if (!integration) return;
  await integrations.saveCursor(
    integrationId,
    extractProtocol.driveExtractCursorKey(fileId),
    cursor,
  );
}

async function expireDriveExtractTombstones(
  io: DriveTransientExtractIO,
  cursor: extractProtocol.DriveExtractCursor,
  nowMs: number,
): Promise<extractProtocol.DriveExtractCursor> {
  const tombstones = cursor.tombstones ?? [];
  if (tombstones.length === 0) return cursor;
  const { settled } = extractProtocol.partitionDriveExtractTombstones(tombstones, nowMs);
  const remainingKeysByExtractId = new Map<string, string[]>();
  for (const tombstone of settled) {
    const keys = extractProtocol.driveExtractTombstoneKeys(tombstone);
    const results = await Promise.allSettled(
      keys.map((key) => io.deleteDocumentObject({ bucket: io.getDocumentsBucket(), key })),
    );
    remainingKeysByExtractId.set(
      tombstone.extractId,
      extractProtocol.remainingDriveExtractObjectKeys(keys, results),
    );
  }
  return extractProtocol.applyDriveExtractTombstoneDeletes(cursor, remainingKeysByExtractId, nowMs);
}

function publishedDriveExtractCursor(
  cursor: extractProtocol.DriveExtractCursor,
): extractProtocol.DriveExtractCursor {
  const { jobPublished: _published, ...rest } = cursor;
  return rest;
}

export async function putAndEnqueueDriveTransientExtract(input: {
  integrations: DriveExtractCursorScope;
  teamId: string;
  integrationId: string;
  fileId: string;
  filename: string;
  contentType: string;
  body: Buffer;
  revisionId?: string;
  io?: DriveTransientExtractIO;
  now?: Date;
}): Promise<void> {
  const io = input.io ?? defaultDriveTransientExtractIO;
  await requireDriveExtractIntegration(input.integrations, input.integrationId);
  const extractId = randomUUID();
  const keys = extractProtocol.driveTransientExtractKeys({
    teamId: input.teamId,
    integrationId: input.integrationId,
    fileId: input.fileId,
    extractId,
  });
  const existing = await loadDriveExtractCursor(
    input.integrations,
    input.integrationId,
    input.fileId,
  );
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  const nowMs = now.getTime();
  let tombstones: extractProtocol.DriveExtractTombstone[] = [];
  if (existing) {
    tombstones = extractProtocol.carryDriveExtractTombstones(existing, nowIso);
    const leftoverKeys = extractProtocol.driveExtractObjectKeys(existing);
    await Promise.allSettled(
      leftoverKeys.map((key) => io.deleteDocumentObject({ bucket: io.getDocumentsBucket(), key })),
    );
  }
  let cursor: extractProtocol.DriveExtractCursor = {
    extractId,
    objectKey: keys.objectKey,
    resultObjectKey: keys.resultObjectKey,
    contentType: input.contentType,
    filename: input.filename,
    enqueuedAt: nowIso,
    jobPublished: false,
    ...(input.revisionId ? { revisionId: input.revisionId } : {}),
    ...(tombstones.length > 0 ? { tombstones } : {}),
  };
  cursor = await expireDriveExtractTombstones(io, cursor, nowMs);
  await io.putDocumentObject({
    bucket: io.getDocumentsBucket(),
    key: keys.objectKey,
    body: input.body,
    contentType: input.contentType,
  });
  try {
    // Persist the extract cursor before Redis sees the job so a late
    // result.json always has a cleanup reference, including when enqueue fails.
    await saveDriveExtractCursor(input.integrations, input.integrationId, input.fileId, cursor);
  } catch (err) {
    await Promise.allSettled([
      io.deleteDocumentObject({ bucket: io.getDocumentsBucket(), key: keys.objectKey }),
    ]);
    throw err;
  }
  // Failed publication leaves jobPublished: false so retries need not wait 15 minutes.
  await io.enqueueDocumentExtractJob(
    driveTransientExtractJob({
      teamId: input.teamId,
      integrationId: input.integrationId,
      fileId: input.fileId,
      cursor,
    }),
  );
  await saveDriveExtractCursor(
    input.integrations,
    input.integrationId,
    input.fileId,
    publishedDriveExtractCursor(cursor),
  );
}

function withExtractRevision<T extends object>(
  result: T,
  cursor: extractProtocol.DriveExtractCursor,
): T & { revisionId?: string } {
  return cursor.revisionId ? { ...result, revisionId: cursor.revisionId } : result;
}

export async function readDriveTransientExtract(input: {
  integrations: DriveExtractCursorScope;
  teamId: string;
  integrationId: string;
  fileId: string;
  io?: DriveTransientExtractIO;
  now?: Date;
}): Promise<
  | { status: 'pending'; revisionId?: string; reschedule?: boolean }
  | { status: 'ready'; text: string; revisionId?: string }
  | { status: 'failed'; error: string; revisionId?: string }
  | null
> {
  const io = input.io ?? defaultDriveTransientExtractIO;
  const now = input.now ?? new Date();
  let cursor = await loadDriveExtractCursor(input.integrations, input.integrationId, input.fileId);
  if (!cursor || cursor.cleanupPending) return null;
  const tombstoneCount = cursor.tombstones?.length ?? 0;
  cursor = await expireDriveExtractTombstones(io, cursor, now.getTime());
  const tombstonesChanged = (cursor.tombstones?.length ?? 0) !== tombstoneCount;
  if (tombstonesChanged) {
    await saveDriveExtractCursor(input.integrations, input.integrationId, input.fileId, cursor);
  }
  try {
    const fetched = await io.getDocumentObject({
      bucket: io.getDocumentsBucket(),
      key: cursor.resultObjectKey,
      maxBytes: DRIVE_TRANSIENT_RESULT_MAX_BYTES,
    });
    const parsed = extractProtocol.parseDriveTransientExtractResult(fetched.body);
    if (parsed.ok) {
      return withExtractRevision({ status: 'ready' as const, text: parsed.text }, cursor);
    }
    return withExtractRevision({ status: 'failed' as const, error: parsed.error }, cursor);
  } catch (err) {
    if (extractProtocol.isRetryableDriveExtractStorageError(err)) throw err;
    if (!extractProtocol.isMissingS3ObjectError(err)) {
      const message = err instanceof Error ? err.message : String(err);
      const error = extractProtocol.isDriveExtractResultTooLarge(message)
        ? extractProtocol.DRIVE_TRANSIENT_RESULT_TOO_LARGE
        : message.slice(0, 500);
      return withExtractRevision({ status: 'failed' as const, error }, cursor);
    }
    const stale = extractProtocol.isDriveExtractPendingStale(cursor, now.getTime());
    if (stale) {
      try {
        await io.enqueueDocumentExtractJob(
          driveTransientExtractJob({
            teamId: input.teamId,
            integrationId: input.integrationId,
            fileId: input.fileId,
            cursor,
          }),
        );
        await saveDriveExtractCursor(
          input.integrations,
          input.integrationId,
          input.fileId,
          publishedDriveExtractCursor({ ...cursor, enqueuedAt: now.toISOString() }),
        );
      } catch {
        await saveDriveExtractCursor(input.integrations, input.integrationId, input.fileId, {
          ...cursor,
          jobPublished: false,
        });
      }
    }
    return withExtractRevision(
      { status: 'pending' as const, ...(stale ? { reschedule: true as const } : {}) },
      cursor,
    );
  }
}

export async function clearDriveTransientExtract(input: {
  integrations: DriveExtractCursorScope;
  integrationId: string;
  fileId: string;
  io?: DriveTransientExtractIO;
  /** `consume` wipes once S3 deletes succeed. `cancel` keeps a tombstone until the producer wait elapses. */
  mode?: 'consume' | 'cancel';
  now?: Date;
}): Promise<void> {
  const io = input.io ?? defaultDriveTransientExtractIO;
  const mode = input.mode ?? 'consume';
  const now = input.now ?? new Date();
  const cursor = await loadDriveExtractCursor(
    input.integrations,
    input.integrationId,
    input.fileId,
  );
  if (!cursor) {
    await saveDriveExtractCursor(input.integrations, input.integrationId, input.fileId, {});
    return;
  }
  await cleanupDriveExtract({
    cursor,
    mode,
    now,
    async deleteObjects(value) {
      const keys = extractProtocol.driveExtractObjectKeys({ ...cursor, ...value });
      const results = await Promise.allSettled(
        keys.map((key) => io.deleteDocumentObject({ bucket: io.getDocumentsBucket(), key })),
      );
      return extractProtocol.remainingDriveExtractObjectKeys(keys, results);
    },
    persist: (next) =>
      saveDriveExtractCursor(input.integrations, input.integrationId, input.fileId, next ?? {}),
  });
}

export async function sweepOrphanDriveTransientExtracts(input: {
  db: Db;
  now?: Date;
  limit?: number;
  io?: DriveTransientExtractIO;
}): Promise<number> {
  const now = input.now ?? new Date();
  const remainingLimit = input.limit ?? integrationsLib.DRIVE_EXTRACT_CURSOR_PAGE_SIZE;
  const teamIds = await integrationsLib.adminListTeamIdsWithDriveExtractCursors(input.db, {
    orphanOnly: true,
    now,
  });
  let remaining = remainingLimit;
  let cleared = 0;
  for (const teamId of teamIds) {
    if (remaining <= 0) break;
    const scope = withTeam(input.db, teamId, ZERO_UUID, { skipMembershipCheck: true });
    const orphans = await scope.integrations.listDriveExtractCursors({
      orphanOnly: true,
      now,
      limit: remaining,
    });
    for (const row of orphans) {
      await clearDriveTransientExtract({
        integrations: scope.integrations,
        integrationId: row.integrationId,
        fileId: row.fileId,
        mode: 'cancel',
        now,
        ...(input.io ? { io: input.io } : {}),
      });
      cleared += 1;
      remaining -= 1;
      if (remaining <= 0) break;
    }
  }
  return cleared;
}

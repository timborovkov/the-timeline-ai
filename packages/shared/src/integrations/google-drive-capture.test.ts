import { PGlite } from '@electric-sql/pglite';
import {
  artifactClusterAnchors,
  artifactClusters,
  entities,
  googleDriveFileSnapshots,
  integrations,
  integrationSelections,
  integrationSyncState,
  rawEvents,
} from '@timeline/db';
import { expect, vi } from '@timeline/test-support';
import { afterEach, beforeEach, describe, it } from 'bun:test';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';

const s3Fakes = vi.hoisted(() => ({
  deleteObject: vi.fn().mockResolvedValue(undefined),
}));

await vi.mock(
  import.meta.resolve('#src/s3/objects.js'),
  () => ({
    deleteObject: async (...args: unknown[]) => {
      await s3Fakes.deleteObject(...args);
    },
  }),
  () => import('#src/s3/objects.js'),
);
await vi.mock(
  import.meta.resolve('#src/s3/client.js'),
  () => ({
    getS3Client: () => ({}),
    getDocumentsBucket: () => 'timeline-documents',
  }),
  () => import('#src/s3/client.js'),
);

import {
  DRIVE_EXTRACT_CURSOR_PAGE_SIZE,
  DRIVE_EXTRACT_PENDING_STALE_MS,
  DRIVE_FILE_DEBOUNCE_MS,
  DRIVE_FILE_MAX_LATENCY_MS,
  DRIVE_TRANSIENT_EXTRACT_ORPHAN_MS,
  DRIVE_TRANSIENT_RESULT_MAX_BYTES,
  DRIVE_TRANSIENT_RESULT_TOO_LARGE,
  driveDebouncePlan,
  driveExtractCursorKey,
  driveExtractFileIdFromResourceType,
  driveExtractMatchesFileRevision,
  driveFileChangeDedupKey,
  driveFileContentRevision,
  driveObjectLinkCandidates,
  driveFileInheritsChangedSelection,
  driveTransientExtractKeys,
  driveTransientExtractResultBody,
  hashDrivePayload,
  isDriveExtractCancelSettled,
  isDriveExtractCursorOrphan,
  isDriveExtractPendingStale,
  isDriveExtractResultTooLarge,
  isRetryableDriveExtractStorageError,
  shouldRetainDriveExtractCleanup,
  survivingLinkedObjectForDriveFile,
  adminListTeamIdsWithDriveExtractCursors,
  forEachDriveExtractCursorPage,
  linkedObjectForDriveSelection,
  listDriveExtractCursors,
  deleteDriveSnapshotsForFile,
  loadLatestDriveSnapshot,
  parseDriveExtractCursor,
  parseDriveTransientExtractResult,
  remainingDriveExtractObjectKeys,
  retainDriveExtractCleanupCursor,
  applyDriveExtractTombstoneDeletes,
  carryDriveExtractTombstones,
  partitionDriveExtractTombstones,
  saveDriveSnapshot,
  takeDriveExtractSlot,
  takeDriveProcessSlot,
} from '#src/integrations/google-drive-capture.js';
import { buildDriveSnapshotLocate } from '#src/integrations/google-drive-diff.js';
import { driveChangeJudgePrompt } from '#src/integrations/google-drive-judge.js';
import { applyDbMigrations } from '#src/test/pglite.js';

const { withTeam } = await import('#src/team-scope.js');

const TEAM_ID = '11111111-1111-1111-1111-111111111111';
const OTHER_TEAM_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const OTHER_USER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

describe('driveObjectLinkCandidates', () => {
  it('covers My Drive, shared drives, individual files, and missing ancestors', () => {
    expect(
      driveObjectLinkCandidates({
        fileId: 'doc-1',
        parentIds: ['root'],
        matchedAncestorId: 'root',
      }),
    ).toEqual(['doc-1', 'root']);
    expect(
      driveObjectLinkCandidates({
        fileId: 'nested-doc',
        parentIds: ['clients'],
        matchedAncestorId: '0AMK-my-drive',
        myDriveRootId: '0AMK-my-drive',
      }),
    ).toEqual(['nested-doc', '0AMK-my-drive', 'clients', 'root']);
    expect(
      driveObjectLinkCandidates({
        fileId: 'shared-doc',
        parentIds: ['shared-folder'],
        matchedAncestorId: 'shared-drive',
        driveId: 'shared-drive',
        myDriveRootId: '0AMK-my-drive',
      }),
    ).toEqual(['shared-doc', 'shared-drive', 'shared-folder']);
    expect(
      driveObjectLinkCandidates({
        fileId: 'picked-file',
        parentIds: ['outside'],
        matchedAncestorId: 'picked-file',
      }),
    ).toEqual(['picked-file', 'outside']);
    expect(
      driveObjectLinkCandidates({
        fileId: 'shared-picked',
        parentIds: ['team-folder'],
        matchedAncestorId: 'shared-picked',
        driveId: 'shared-drive',
      }),
    ).toEqual(['shared-picked', 'shared-drive', 'team-folder']);
    expect(
      driveObjectLinkCandidates({
        fileId: 'orphan',
        parentIds: ['unknown'],
      }),
    ).toEqual(['orphan', 'unknown']);
  });
});

describe('driveFileInheritsChangedSelection', () => {
  it('rebinds only files whose current object link comes from the changed selection', () => {
    expect(
      driveFileInheritsChangedSelection({
        fileId: 'file-a',
        changedExternalId: 'folder-1',
        candidates: ['file-a', 'folder-1'],
      }),
    ).toBe(true);
    expect(
      driveFileInheritsChangedSelection({
        fileId: 'file-b',
        changedExternalId: 'folder-1',
        remainingLinkedExternalIds: ['folder-2'],
        candidates: ['file-b', 'folder-2'],
      }),
    ).toBe(false);
    expect(
      driveFileInheritsChangedSelection({
        fileId: 'file-both',
        changedExternalId: 'folder-1',
        remainingLinkedExternalIds: ['folder-2'],
        candidates: ['file-both', 'folder-1', 'folder-2'],
      }),
    ).toBe(false);
    expect(
      driveFileInheritsChangedSelection({
        fileId: 'file-nested',
        changedExternalId: 'folder-1',
        parentIds: ['nested', 'folder-1'],
        matchedAncestorId: 'folder-1',
      }),
    ).toBe(true);
    expect(
      driveFileInheritsChangedSelection({
        fileId: 'shared-file',
        changedExternalId: 'shared-drive',
        remainingLinkedExternalIds: ['folder-1'],
        candidates: ['shared-file', 'shared-drive'],
      }),
    ).toBe(true);
    expect(
      driveFileInheritsChangedSelection({
        fileId: 'folder-file',
        changedExternalId: 'shared-drive',
        remainingLinkedExternalIds: ['folder-1'],
        candidates: ['folder-file', 'folder-1', 'shared-drive'],
      }),
    ).toBe(false);
    expect(
      driveFileInheritsChangedSelection({
        fileId: 'file-keep',
        changedExternalId: 'folder-1',
        preserveFileIds: ['file-keep'],
        candidates: ['file-keep', 'folder-1'],
      }),
    ).toBe(false);
  });
});

describe('survivingLinkedObjectForDriveFile', () => {
  it('rebinds a dropped explicit file onto the remaining folder object', () => {
    expect(
      survivingLinkedObjectForDriveFile({
        fileId: 'file-b',
        remainingSelections: [
          { kind: 'drive.folder', externalId: 'folder-1', linkedObjectId: 'object-a' },
        ],
        parentIds: ['folder-1'],
      }),
    ).toBe('object-a');
    expect(
      survivingLinkedObjectForDriveFile({
        fileId: 'file-b',
        remainingSelections: [
          { kind: 'drive.folder', externalId: 'folder-1', linkedObjectId: 'object-a' },
        ],
      }),
    ).toBe('object-a');
    expect(
      survivingLinkedObjectForDriveFile({
        fileId: 'file-b',
        remainingSelections: [
          { kind: 'drive.folder', externalId: 'folder-1', linkedObjectId: 'object-a' },
          { kind: 'drive.folder', externalId: 'folder-2', linkedObjectId: 'object-c' },
        ],
        inheritedCandidates: ['file-b', 'folder-1'],
      }),
    ).toBe('object-a');
    expect(
      survivingLinkedObjectForDriveFile({
        fileId: 'file-b',
        remainingSelections: [
          { kind: 'drive.folder', externalId: 'folder-1', linkedObjectId: 'object-a' },
          { kind: 'drive.folder', externalId: 'folder-2', linkedObjectId: 'object-c' },
        ],
      }),
    ).toBeNull();
  });
});

describe('isRetryableDriveExtractStorageError', () => {
  it('retries timeout and 5xx storage faults, not missing or oversized results', () => {
    const timeout = Object.assign(new Error('RequestTimeout'), {
      name: 'TimeoutError',
      $metadata: { httpStatusCode: 503 },
    });
    const server = Object.assign(new Error('InternalError'), {
      name: 'InternalError',
      $metadata: { httpStatusCode: 500 },
    });
    const missing = Object.assign(new Error('missing'), { name: 'NoSuchKey' });
    expect(isRetryableDriveExtractStorageError(timeout)).toBe(true);
    expect(isRetryableDriveExtractStorageError(server)).toBe(true);
    expect(isRetryableDriveExtractStorageError(new Error('socket hang up ECONNRESET'))).toBe(true);
    expect(isRetryableDriveExtractStorageError(missing)).toBe(false);
    expect(
      isRetryableDriveExtractStorageError(
        new Error('S3 object docs/result.json exceeds 2097152 bytes'),
      ),
    ).toBe(false);
  });
});

describe('driveDebouncePlan', () => {
  it('waits the quiet window from the latest notification', () => {
    const now = Date.parse('2026-06-01T10:00:00.000Z');
    const plan = driveDebouncePlan(null, now);
    expect(plan.delayMs).toBe(DRIVE_FILE_DEBOUNCE_MS);
    expect(plan.firstQueuedAt).toBe('2026-06-01T10:00:00.000Z');
  });

  it('caps trailing debounce at one hour from the first notification', () => {
    const first = Date.parse('2026-06-01T10:00:00.000Z');
    const now = first + DRIVE_FILE_MAX_LATENCY_MS - 60_000;
    const plan = driveDebouncePlan({ firstQueuedAt: new Date(first).toISOString() }, now);
    expect(plan.delayMs).toBe(60_000);
  });
});

describe('takeDriveProcessSlot', () => {
  it('rejects after the per-file daily cap', async () => {
    const checkRateLimit = ({ key }: { key: string }) =>
      Promise.resolve(
        key.includes('file')
          ? { ok: false as const, retryAfterMs: 1_000, remaining: 0 }
          : { ok: true as const, remaining: 10 },
      );
    await expect(
      takeDriveProcessSlot({
        integrationId: 'int-1',
        fileId: 'file-1',
        checkRateLimit,
      }),
    ).resolves.toMatchObject({ allowed: false, reason: 'file' });
  });
});

describe('takeDriveExtractSlot', () => {
  it('rejects after the per-connection extract cap without consuming the judge cap', async () => {
    const seen: string[] = [];
    const checkRateLimit = ({ key }: { key: string }) => {
      seen.push(key);
      return Promise.resolve(
        key.includes('connection')
          ? { ok: false as const, retryAfterMs: 2_000, remaining: 0 }
          : { ok: true as const, remaining: 3 },
      );
    };
    await expect(
      takeDriveExtractSlot({
        integrationId: 'int-1',
        fileId: 'file-1',
        checkRateLimit,
      }),
    ).resolves.toMatchObject({ allowed: false, reason: 'connection' });
    expect(seen.some((key) => key.includes('drive-extract'))).toBe(true);
    expect(seen.some((key) => key.includes('drive-process'))).toBe(false);
  });
});

describe('drive transient extract helpers', () => {
  it('builds per-extract object keys and parses visible failures', () => {
    expect(driveExtractCursorKey('file-1')).toBe('drive.extract.file-1');
    expect(driveExtractFileIdFromResourceType('drive.extract.file-1')).toBe('file-1');
    expect(driveExtractFileIdFromResourceType('drive.changes')).toBeNull();
    expect(
      driveTransientExtractKeys({
        teamId: 'team-1',
        integrationId: 'int-1',
        fileId: 'file-1',
        extractId: 'ext-1',
      }),
    ).toEqual({
      objectKey: 'drive-transient/team-1/int-1/file-1/ext-1/source',
      resultObjectKey: 'drive-transient/team-1/int-1/file-1/ext-1/result.json',
    });
    expect(
      parseDriveTransientExtractResult(Buffer.from(JSON.stringify({ ok: true, text: 'Hello' }))),
    ).toEqual({ ok: true, text: 'Hello' });
    expect(
      parseDriveTransientExtractResult(
        Buffer.from(JSON.stringify({ ok: false, error: 'Daytona is not configured' })),
      ),
    ).toEqual({ ok: false, error: 'Daytona is not configured' });
  });

  it('rejects oversized extract JSON at write time instead of storing an unreadable blob', () => {
    const small = driveTransientExtractResultBody({ ok: true, text: 'Hello' });
    expect(JSON.parse(small.toString('utf8'))).toEqual({ ok: true, text: 'Hello' });
    const huge = driveTransientExtractResultBody({
      ok: true,
      text: 'x'.repeat(DRIVE_TRANSIENT_RESULT_MAX_BYTES),
    });
    expect(huge.length).toBeLessThan(DRIVE_TRANSIENT_RESULT_MAX_BYTES);
    expect(JSON.parse(huge.toString('utf8'))).toEqual({
      ok: false,
      error: DRIVE_TRANSIENT_RESULT_TOO_LARGE,
    });
    expect(isDriveExtractResultTooLarge(DRIVE_TRANSIENT_RESULT_TOO_LARGE)).toBe(true);
    expect(isDriveExtractResultTooLarge('S3 object docs/result.json exceeds 2097152 bytes')).toBe(
      true,
    );
    expect(isDriveExtractResultTooLarge('Daytona is not configured')).toBe(false);
  });

  it('parses extract cursors and treats missing or aged pending as stale', () => {
    const cursor = parseDriveExtractCursor({
      extractId: 'ext-1',
      objectKey: 'source',
      resultObjectKey: 'result.json',
      contentType: 'application/pdf',
      filename: 'Notes.pdf',
      enqueuedAt: '2026-11-02T12:00:00.000Z',
    });
    expect(cursor).toEqual({
      extractId: 'ext-1',
      objectKey: 'source',
      resultObjectKey: 'result.json',
      contentType: 'application/pdf',
      filename: 'Notes.pdf',
      enqueuedAt: '2026-11-02T12:00:00.000Z',
    });
    expect(parseDriveExtractCursor({ extractId: 'ext-1' })).toBeNull();
    expect(
      parseDriveExtractCursor({
        extractId: 'ext-1',
        objectKey: 'source',
        resultObjectKey: 'result.json',
        contentType: 'application/pdf',
        filename: 'Notes.pdf',
        enqueuedAt: '2026-11-02T12:00:00.000Z',
        cleanupPending: true,
        pendingDeleteKeys: ['source', 'result.json'],
        cancelledAt: '2026-11-02T12:01:00.000Z',
      }),
    ).toMatchObject({
      cleanupPending: true,
      pendingDeleteKeys: ['source', 'result.json'],
      cancelledAt: '2026-11-02T12:01:00.000Z',
    });
    expect(cursor).not.toBeNull();
    if (!cursor) return;
    expect(isDriveExtractPendingStale(cursor, Date.parse('2026-11-02T12:05:00.000Z'))).toBe(false);
    expect(
      isDriveExtractPendingStale(
        cursor,
        Date.parse('2026-11-02T12:00:00.000Z') + DRIVE_EXTRACT_PENDING_STALE_MS,
      ),
    ).toBe(true);
    expect(isDriveExtractPendingStale({ ...cursor, enqueuedAt: 'not-a-date' })).toBe(true);
    expect(isDriveExtractPendingStale({ ...cursor, cleanupPending: true })).toBe(false);
    expect(
      isDriveExtractPendingStale(
        { ...cursor, jobPublished: false },
        Date.parse('2026-11-02T12:00:01.000Z'),
      ),
    ).toBe(true);
    expect(
      retainDriveExtractCleanupCursor(cursor, [], { cancelledAt: '2026-11-02T12:01:00.000Z' }),
    ).toMatchObject({
      cleanupPending: true,
      pendingDeleteKeys: ['source', 'result.json'],
      cancelledAt: '2026-11-02T12:01:00.000Z',
    });
    expect(
      isDriveExtractCancelSettled(
        {
          ...cursor,
          cancelledAt: '2026-11-02T12:01:00.000Z',
        },
        Date.parse('2026-11-02T12:05:00.000Z'),
      ),
    ).toBe(false);
    expect(
      isDriveExtractCancelSettled(
        {
          ...cursor,
          cancelledAt: '2026-11-02T12:01:00.000Z',
        },
        Date.parse('2026-11-02T12:01:00.000Z') + DRIVE_EXTRACT_PENDING_STALE_MS,
      ),
    ).toBe(true);
    const cancelled = retainDriveExtractCleanupCursor(cursor, [], {
      cancelledAt: '2026-11-02T12:01:00.000Z',
    });
    expect(
      shouldRetainDriveExtractCleanup(cancelled, [], {
        mode: 'cancel',
        now: Date.parse('2026-11-02T12:05:00.000Z'),
      }),
    ).toBe(true);
    expect(
      shouldRetainDriveExtractCleanup(cancelled, [], {
        mode: 'cancel',
        now: Date.parse('2026-11-02T12:01:00.000Z') + DRIVE_EXTRACT_PENDING_STALE_MS,
      }),
    ).toBe(false);
    expect(
      shouldRetainDriveExtractCleanup(cancelled, [], {
        mode: 'consume',
        now: Date.parse('2026-11-02T12:05:00.000Z'),
      }),
    ).toBe(false);
    expect(
      isDriveExtractCancelSettled(
        cursor,
        Date.parse('2026-11-02T12:00:00.000Z') + DRIVE_TRANSIENT_EXTRACT_ORPHAN_MS,
      ),
    ).toBe(true);
    const missing = Object.assign(new Error('missing'), { name: 'NoSuchKey' });
    expect(
      remainingDriveExtractObjectKeys(
        ['source', 'result.json'],
        [
          { status: 'fulfilled', value: undefined },
          { status: 'rejected', reason: missing },
        ],
      ),
    ).toEqual([]);
    expect(
      remainingDriveExtractObjectKeys(
        ['source', 'result.json'],
        [
          { status: 'fulfilled', value: undefined },
          { status: 'rejected', reason: new Error('AccessDenied') },
        ],
      ),
    ).toEqual(['result.json']);
  });

  it('carries extract tombstones across replacements and drops them only after TTL deletes', () => {
    const unpublished = parseDriveExtractCursor({
      extractId: 'ext-1',
      objectKey: 'source-1',
      resultObjectKey: 'result-1.json',
      contentType: 'application/pdf',
      filename: 'Notes.pdf',
      enqueuedAt: '2026-11-02T12:00:00.000Z',
      jobPublished: false,
      pendingDeleteKeys: ['source-1', 'result-1.json', 'source-1-extra'],
    });
    expect(unpublished?.jobPublished).toBe(false);
    if (!unpublished) throw new Error('expected unpublished extract cursor');
    expect(isDriveExtractPendingStale(unpublished, Date.parse('2026-11-02T12:00:01.000Z'))).toBe(
      true,
    );

    const states: { extractId: string; tombstoneIds: string[] }[] = [];
    let current = unpublished;
    const firstTombstones = carryDriveExtractTombstones(current, '2026-11-02T12:02:00.000Z');
    expect(firstTombstones[0]?.pendingDeleteKeys).toEqual([
      'source-1',
      'result-1.json',
      'source-1-extra',
    ]);
    for (let generation = 2; generation <= 5; generation++) {
      const nowIso = `2026-11-02T12:0${String(generation)}:00.000Z`;
      const tombstones = carryDriveExtractTombstones(current, nowIso);
      current = {
        extractId: `ext-${String(generation)}`,
        objectKey: `source-${String(generation)}`,
        resultObjectKey: `result-${String(generation)}.json`,
        contentType: 'application/pdf',
        filename: 'Notes.pdf',
        enqueuedAt: nowIso,
        jobPublished: false,
        tombstones,
      };
      states.push({
        extractId: current.extractId,
        tombstoneIds: tombstones.map((tombstone) => tombstone.extractId),
      });
    }
    expect(states.map((state) => state.tombstoneIds)).toEqual([
      ['ext-1'],
      ['ext-1', 'ext-2'],
      ['ext-1', 'ext-2', 'ext-3'],
      ['ext-1', 'ext-2', 'ext-3', 'ext-4'],
    ]);
    const settledNow = Date.parse('2026-11-02T12:05:00.000Z') + DRIVE_EXTRACT_PENDING_STALE_MS;
    const { settled, live } = partitionDriveExtractTombstones(current.tombstones ?? [], settledNow);
    expect(live).toEqual([]);
    expect(settled.map((tombstone) => tombstone.extractId)).toEqual([
      'ext-1',
      'ext-2',
      'ext-3',
      'ext-4',
    ]);
    const remaining = new Map<string, string[]>(
      settled.map((tombstone) => [tombstone.extractId, []]),
    );
    const expired = applyDriveExtractTombstoneDeletes(current, remaining, settledNow);
    expect(expired.tombstones).toBeUndefined();
    const blocked = applyDriveExtractTombstoneDeletes(
      current,
      new Map([['ext-1', ['result-1.json']]]),
      settledNow,
    );
    expect(blocked.tombstones?.map((tombstone) => tombstone.extractId)).toEqual(['ext-1']);
  });

  it('stamps extract revisions from Drive headRevisionId, md5, then modifiedTime', () => {
    expect(
      driveFileContentRevision({
        headRevisionId: 'rev-9',
        md5Checksum: 'abcd',
        modifiedTime: '2026-06-20T10:00:00.000Z',
      }),
    ).toBe('rev:rev-9');
    expect(
      driveFileContentRevision({
        md5Checksum: 'abcd',
        modifiedTime: '2026-06-20T10:00:00.000Z',
      }),
    ).toBe('md5:abcd');
    expect(driveFileContentRevision({ modifiedTime: '2026-06-20T10:00:00.000Z' })).toBe(
      'mod:2026-06-20T10:00:00.000Z',
    );
    expect(
      driveFileChangeDedupKey({
        fileId: 'file-1',
        occurrence: 'rev:b-2',
        contentHash: 'hash-b',
        commentsHash: 'comments',
        permissionsHash: 'permissions',
      }),
    ).toBe('google_drive:file:file-1:rev:b-2:hash-b:comments:permissions');
    expect(
      driveFileChangeDedupKey({
        fileId: 'file-1',
        occurrence: 'rev:b-1',
        contentHash: 'hash-b',
        commentsHash: 'comments',
        permissionsHash: 'permissions',
      }),
    ).not.toBe(
      driveFileChangeDedupKey({
        fileId: 'file-1',
        occurrence: 'rev:b-2',
        contentHash: 'hash-b',
        commentsHash: 'comments',
        permissionsHash: 'permissions',
      }),
    );
    expect(
      isDriveExtractCursorOrphan(
        {
          extractId: 'ext-1',
          objectKey: 'source',
          resultObjectKey: 'result.json',
          contentType: 'application/pdf',
          filename: 'Notes.pdf',
          enqueuedAt: '2026-11-02T12:00:00.000Z',
        },
        Date.parse('2026-11-02T12:00:00.000Z') + DRIVE_TRANSIENT_EXTRACT_ORPHAN_MS,
      ),
    ).toBe(true);
    expect(
      isDriveExtractCursorOrphan(
        {
          extractId: 'ext-1',
          objectKey: 'source',
          resultObjectKey: 'result.json',
          contentType: 'application/pdf',
          filename: 'Notes.pdf',
          enqueuedAt: '2026-11-02T12:00:00.000Z',
        },
        Date.parse('2026-11-02T12:00:00.000Z') + DRIVE_EXTRACT_PENDING_STALE_MS,
      ),
    ).toBe(false);
    expect(
      isDriveExtractCursorOrphan({
        extractId: 'ext-1',
        objectKey: 'source',
        resultObjectKey: 'result.json',
        contentType: 'application/pdf',
        filename: 'Notes.pdf',
        enqueuedAt: '2026-11-02T12:00:00.000Z',
        cleanupPending: true,
      }),
    ).toBe(true);
    expect(driveExtractMatchesFileRevision('rev:old', 'rev:new')).toBe(false);
    expect(driveExtractMatchesFileRevision('rev:same', 'rev:same')).toBe(true);
    expect(driveExtractMatchesFileRevision(undefined, 'rev:new')).toBe(true);
    expect(driveExtractMatchesFileRevision('rev:old', null)).toBe(true);
  });

  it('parses extract cursors that carry a Drive revision id', () => {
    expect(
      parseDriveExtractCursor({
        extractId: 'ext-1',
        objectKey: 'source',
        resultObjectKey: 'result.json',
        contentType: 'application/pdf',
        filename: 'Notes.pdf',
        enqueuedAt: '2026-11-02T12:00:00.000Z',
        revisionId: 'rev:rev-9',
      }),
    ).toMatchObject({ revisionId: 'rev:rev-9' });
  });
});

describe('driveChangeJudgePrompt', () => {
  it('sends hunks and signals without a full document', () => {
    const prompt = driveChangeJudgePrompt({
      fileName: 'SOW',
      mimeType: 'application/vnd.google-apps.document',
      hunks: ['Signed $48k Northstar contract'],
      strongSignals: ['comment_added', 'shared_external_domain'],
    });
    expect(prompt).toContain('Signed $48k Northstar contract');
    expect(prompt).toContain('comment_added');
    expect(prompt).not.toContain('ya29.');
  });

  it('hashes payloads without echoing them', () => {
    expect(hashDrivePayload('secret-doc')).toMatch(/^[a-f0-9]{64}$/);
    expect(hashDrivePayload('secret-doc')).not.toContain('secret');
  });
});

describe('saveDriveSnapshot uniqueness', () => {
  let pg: PGlite;
  let db: ReturnType<typeof drizzle>;

  beforeEach(async () => {
    s3Fakes.deleteObject.mockReset();
    s3Fakes.deleteObject.mockResolvedValue(undefined);
    pg = new PGlite();
    await applyDbMigrations(pg);
    db = drizzle(pg);
    await pg.exec(`
      INSERT INTO teams (id, slug, name) VALUES ('${TEAM_ID}', 'team-a', 'Team A');
      INSERT INTO users (id, email) VALUES ('${USER_ID}', 'owner@example.com');
      INSERT INTO team_members (team_id, user_id, role) VALUES
        ('${TEAM_ID}', '${USER_ID}', 'owner');
    `);
  }, 60_000);

  afterEach(async () => {
    await pg.close();
  });

  it('inserts comment-only and permission-only snapshots that share a content hash', async () => {
    const [integration] = await db
      .insert(integrations)
      .values({
        teamId: TEAM_ID,
        connectedByUserId: USER_ID,
        provider: 'google_drive',
        displayName: 'Google Drive',
        externalAccountId: 'drive-acct',
        visibilityDefault: 'team',
      })
      .returning();
    if (!integration) throw new Error('integration insert failed');

    const snapshot = {
      contentHash: hashDrivePayload('same-body'),
      snapshotText: 'same-body',
      commentsHash: 'comments-1',
      permissionsHash: 'permissions-1',
      mimeType: 'application/vnd.google-apps.document',
    };
    await saveDriveSnapshot(db as never, {
      teamId: TEAM_ID,
      integrationId: integration.id,
      fileId: 'file-1',
      snapshot,
    });
    await saveDriveSnapshot(db as never, {
      teamId: TEAM_ID,
      integrationId: integration.id,
      fileId: 'file-1',
      snapshot: { ...snapshot, commentsHash: 'comments-2' },
    });
    await saveDriveSnapshot(db as never, {
      teamId: TEAM_ID,
      integrationId: integration.id,
      fileId: 'file-1',
      snapshot: { ...snapshot, commentsHash: 'comments-2' },
    });

    const rows = await db.select().from(googleDriveFileSnapshots);
    expect(rows).toHaveLength(2);
    const latest = await loadLatestDriveSnapshot(db as never, {
      teamId: TEAM_ID,
      integrationId: integration.id,
      fileId: 'file-1',
    });
    expect(latest?.commentsHash).toBe('comments-2');
    expect(latest?.contentHash).toBe(snapshot.contentHash);
  });

  it('makes a revisited fingerprint the latest baseline across A→B→A→B', async () => {
    const [integration] = await db
      .insert(integrations)
      .values({
        teamId: TEAM_ID,
        connectedByUserId: USER_ID,
        provider: 'google_drive',
        displayName: 'Google Drive',
        externalAccountId: 'drive-acct-revisit',
        visibilityDefault: 'team',
      })
      .returning();
    if (!integration) throw new Error('integration insert failed');

    const snapshotA = {
      contentHash: hashDrivePayload('body-a'),
      snapshotText: 'body-a',
      commentsHash: 'comments-stable',
      permissionsHash: 'permissions-stable',
      mimeType: 'application/vnd.google-apps.document',
    };
    const snapshotB = {
      ...snapshotA,
      contentHash: hashDrivePayload('body-b'),
      snapshotText: 'body-b',
    };
    const loadLatest = () =>
      loadLatestDriveSnapshot(db as never, {
        teamId: TEAM_ID,
        integrationId: integration.id,
        fileId: 'file-ab',
      });
    const save = (snapshot: typeof snapshotA) =>
      saveDriveSnapshot(db as never, {
        teamId: TEAM_ID,
        integrationId: integration.id,
        fileId: 'file-ab',
        snapshot,
      });

    await save(snapshotA);
    expect((await loadLatest())?.contentHash).toBe(snapshotA.contentHash);

    await save(snapshotB);
    expect((await loadLatest())?.contentHash).toBe(snapshotB.contentHash);

    await save(snapshotA);
    expect((await loadLatest())?.contentHash).toBe(snapshotA.contentHash);

    await save(snapshotB);
    expect((await loadLatest())?.contentHash).toBe(snapshotB.contentHash);

    const rows = await db.select().from(googleDriveFileSnapshots);
    expect(rows).toHaveLength(2);
  });

  it('loads and saves Drive snapshots through the team integrations scope', async () => {
    const [integration] = await db
      .insert(integrations)
      .values({
        teamId: TEAM_ID,
        connectedByUserId: USER_ID,
        provider: 'google_drive',
        displayName: 'Google Drive',
        externalAccountId: 'drive-acct-scope',
        visibilityDefault: 'team',
      })
      .returning();
    if (!integration) throw new Error('integration insert failed');
    const snapshot = {
      contentHash: hashDrivePayload('scope-body'),
      snapshotText: 'scope-body',
      commentsHash: 'comments-scope',
      permissionsHash: 'permissions-scope',
      mimeType: 'application/vnd.google-apps.document',
    };
    const scope = withTeam(db as never, TEAM_ID, USER_ID);

    await scope.integrations.saveDriveSnapshot(integration.id, 'file-9', snapshot);
    const loaded = await scope.integrations.loadLatestDriveSnapshot(integration.id, 'file-9');
    expect(loaded).toMatchObject(snapshot);
    await expect(scope.integrations.listTeamEmailDomains()).resolves.toEqual(['example.com']);
  });

  it('persists and reloads the suffix plus chunk-hash locate index', async () => {
    const [integration] = await db
      .insert(integrations)
      .values({
        teamId: TEAM_ID,
        connectedByUserId: USER_ID,
        provider: 'google_drive',
        displayName: 'Google Drive',
        externalAccountId: 'drive-acct-locate',
        visibilityDefault: 'team',
      })
      .returning();
    if (!integration) throw new Error('integration insert failed');
    const body = `${'A'.repeat(25_000)}Renewal amount is $48k for Northstar.`;
    const snapshot = {
      contentHash: hashDrivePayload(body),
      snapshotText: body.slice(0, 20_000),
      snapshotLocate: buildDriveSnapshotLocate(body),
      commentsHash: 'comments-locate',
      permissionsHash: 'permissions-locate',
      mimeType: 'application/vnd.google-apps.document',
    };
    await saveDriveSnapshot(db as never, {
      teamId: TEAM_ID,
      integrationId: integration.id,
      fileId: 'file-locate',
      snapshot,
    });
    const loaded = await loadLatestDriveSnapshot(db as never, {
      teamId: TEAM_ID,
      integrationId: integration.id,
      fileId: 'file-locate',
    });
    expect(loaded?.snapshotLocate).toEqual(snapshot.snapshotLocate);
    expect(loaded?.snapshotLocate?.suffix).toContain('$48k');
  });

  it('keeps extracted chunk text only on the latest snapshot and purges it on disconnect or file removal', async () => {
    const [integration] = await db
      .insert(integrations)
      .values({
        teamId: TEAM_ID,
        connectedByUserId: USER_ID,
        provider: 'google_drive',
        displayName: 'Google Drive',
        externalAccountId: 'drive-acct-chunk-text',
        visibilityDefault: 'team',
      })
      .returning();
    if (!integration) throw new Error('integration insert failed');
    const bodyA = `${'A'.repeat(25_000)}Renewal amount is $12k for Northstar.`;
    const bodyB = `${'B'.repeat(25_000)}Renewal amount is $48k for Northstar.`;
    const bodyC = `${'C'.repeat(25_000)}Renewal amount is $96k for Northstar.`;
    const save = (body: string, fileId = 'file-chunks') =>
      saveDriveSnapshot(db as never, {
        teamId: TEAM_ID,
        integrationId: integration.id,
        fileId,
        snapshot: {
          contentHash: hashDrivePayload(body),
          snapshotText: body.slice(0, 20_000),
          snapshotLocate: buildDriveSnapshotLocate(body),
          commentsHash: 'comments-chunks',
          permissionsHash: 'permissions-chunks',
          mimeType: 'application/vnd.google-apps.document',
        },
      });

    await save(bodyA);
    await save(bodyB);
    await save(bodyC);

    const rows = await db.select().from(googleDriveFileSnapshots);
    expect(rows).toHaveLength(3);
    const latest = await loadLatestDriveSnapshot(db as never, {
      teamId: TEAM_ID,
      integrationId: integration.id,
      fileId: 'file-chunks',
    });
    expect(latest?.snapshotLocate?.chunkTexts.join('')).toBe(bodyC);
    const older = rows.filter((row) => row.contentHash !== latest?.contentHash);
    expect(older).toHaveLength(2);
    for (const row of older) {
      expect(row.snapshotLocate?.chunkTexts ?? []).toEqual([]);
      expect(row.snapshotLocate?.chunkHashes.length).toBeGreaterThan(0);
    }

    await deleteDriveSnapshotsForFile(db as never, {
      teamId: TEAM_ID,
      integrationId: integration.id,
      fileId: 'file-chunks',
    });
    expect(
      await db
        .select()
        .from(googleDriveFileSnapshots)
        .then((found) => found.length),
    ).toBe(0);

    await save(bodyA, 'file-keep');
    await save(bodyB, 'file-drop');
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    await scope.integrations.deleteDriveSnapshotsForFile(integration.id, 'file-drop');
    const remaining = await db.select().from(googleDriveFileSnapshots);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.fileId).toBe('file-keep');
    expect(remaining[0]?.snapshotLocate?.chunkTexts.join('')).toBe(bodyA);

    await expect(scope.integrations.deleteIntegration(integration.id)).resolves.toBeUndefined();
    expect(await db.select().from(googleDriveFileSnapshots)).toEqual([]);
  });

  it('resolves Drive object links for My Drive, shared drives, individual files, and missing ancestors', async () => {
    const [integration] = await db
      .insert(integrations)
      .values({
        teamId: TEAM_ID,
        connectedByUserId: USER_ID,
        provider: 'google_drive',
        displayName: 'Google Drive',
        externalAccountId: 'drive-acct-link',
        visibilityDefault: 'team',
      })
      .returning();
    if (!integration) throw new Error('integration insert failed');
    const [northstar] = await db
      .insert(entities)
      .values({
        teamId: TEAM_ID,
        type: 'company',
        canonicalName: 'Northstar',
        status: 'open',
      })
      .returning();
    const [rootObject] = await db
      .insert(entities)
      .values({
        teamId: TEAM_ID,
        type: 'project',
        canonicalName: 'My Drive root',
        status: 'open',
      })
      .returning();
    const [sharedObject] = await db
      .insert(entities)
      .values({
        teamId: TEAM_ID,
        type: 'project',
        canonicalName: 'Engineering drive',
        status: 'open',
      })
      .returning();
    const [fileObject] = await db
      .insert(entities)
      .values({
        teamId: TEAM_ID,
        type: 'project',
        canonicalName: 'Picked SOW',
        status: 'open',
      })
      .returning();
    if (!northstar || !rootObject || !sharedObject || !fileObject) {
      throw new Error('object insert failed');
    }
    await db.insert(integrationSelections).values([
      {
        integrationId: integration.id,
        selectionKind: 'drive.folder',
        externalId: 'selected-folder',
        linkedObjectId: northstar.id,
      },
      {
        integrationId: integration.id,
        selectionKind: 'drive.folder',
        externalId: 'root',
        linkedObjectId: rootObject.id,
      },
      {
        integrationId: integration.id,
        selectionKind: 'drive.shared_drive',
        externalId: 'shared-drive',
        linkedObjectId: sharedObject.id,
      },
      {
        integrationId: integration.id,
        selectionKind: 'drive.file',
        externalId: 'picked-file',
        linkedObjectId: fileObject.id,
      },
    ]);

    const lookup = (
      input: Omit<Parameters<typeof linkedObjectForDriveSelection>[1], 'teamId' | 'integrationId'>,
    ) =>
      linkedObjectForDriveSelection(db as never, {
        teamId: TEAM_ID,
        integrationId: integration.id,
        ...input,
      });

    await expect(
      lookup({ fileId: 'mine', parentIds: ['root'], matchedAncestorId: 'root' }),
    ).resolves.toMatchObject({
      id: rootObject.id,
      inheritedFrom: 'root',
      inheritedCandidates: ['mine', 'root'],
    });
    await expect(
      lookup({
        fileId: 'nested-my-drive',
        parentIds: ['clients'],
        matchedAncestorId: '0AMK-my-drive',
        myDriveRootId: '0AMK-my-drive',
      }),
    ).resolves.toMatchObject({ id: rootObject.id });
    await expect(
      lookup({
        fileId: 'nested-file',
        parentIds: ['nested'],
        matchedAncestorId: 'selected-folder',
      }),
    ).resolves.toMatchObject({ id: northstar.id, canonicalName: 'Northstar', type: 'company' });
    await expect(
      lookup({
        fileId: 'shared-doc',
        parentIds: ['shared-folder'],
        matchedAncestorId: 'shared-drive',
        driveId: 'shared-drive',
        myDriveRootId: '0AMK-my-drive',
      }),
    ).resolves.toMatchObject({ id: sharedObject.id });
    await expect(
      lookup({
        fileId: 'unlinked-shared',
        parentIds: ['other-shared-folder'],
        matchedAncestorId: 'other-shared-drive',
        driveId: 'other-shared-drive',
        myDriveRootId: '0AMK-my-drive',
      }),
    ).resolves.toBeNull();
    await expect(
      lookup({
        fileId: 'picked-file',
        parentIds: ['outside'],
        matchedAncestorId: 'picked-file',
      }),
    ).resolves.toMatchObject({ id: fileObject.id });
    await expect(
      lookup({
        fileId: 'shared-picked',
        parentIds: ['team-folder'],
        matchedAncestorId: 'shared-picked',
        driveId: 'shared-drive',
      }),
    ).resolves.toMatchObject({ id: sharedObject.id });
    await expect(lookup({ fileId: 'orphan', parentIds: ['unknown'] })).resolves.toBeNull();

    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    await expect(
      scope.integrations.linkedObjectForDriveSelection({
        integrationId: integration.id,
        fileId: 'nested-file',
        parentIds: ['nested'],
        matchedAncestorId: 'selected-folder',
      }),
    ).resolves.toMatchObject({ id: northstar.id });
    await expect(
      scope.integrations.linkedObjectForDriveSelection({
        integrationId: integration.id,
        fileId: 'unlinked-shared',
        parentIds: ['other-shared-folder'],
        matchedAncestorId: 'other-shared-drive',
        driveId: 'other-shared-drive',
        myDriveRootId: '0AMK-my-drive',
      }),
    ).resolves.toBeNull();
  });

  it('lists orphan Drive extract cursors and ignores fresh pending extracts', async () => {
    const [integration] = await db
      .insert(integrations)
      .values({
        teamId: TEAM_ID,
        connectedByUserId: USER_ID,
        provider: 'google_drive',
        displayName: 'Google Drive',
        externalAccountId: 'drive-acct-orphan',
        visibilityDefault: 'team',
      })
      .returning();
    if (!integration) throw new Error('integration insert failed');

    const staleEnqueuedAt = new Date(
      Date.parse('2026-11-03T00:00:00.000Z') - DRIVE_TRANSIENT_EXTRACT_ORPHAN_MS,
    ).toISOString();
    await db.insert(integrationSyncState).values([
      {
        integrationId: integration.id,
        resourceType: driveExtractCursorKey('stale-file'),
        cursor: {
          extractId: 'ext-stale',
          objectKey: 'stale-source',
          resultObjectKey: 'stale-result.json',
          contentType: 'application/pdf',
          filename: 'Stale.pdf',
          enqueuedAt: staleEnqueuedAt,
        },
        updatedAt: new Date('2026-11-01T00:00:00.000Z'),
      },
      {
        integrationId: integration.id,
        resourceType: driveExtractCursorKey('fresh-file'),
        cursor: {
          extractId: 'ext-fresh',
          objectKey: 'fresh-source',
          resultObjectKey: 'fresh-result.json',
          contentType: 'application/pdf',
          filename: 'Fresh.pdf',
          enqueuedAt: '2026-11-03T00:00:00.000Z',
        },
        updatedAt: new Date('2026-11-03T00:00:00.000Z'),
      },
    ]);

    const now = new Date('2026-11-03T00:00:00.000Z');
    const orphans = await listDriveExtractCursors(db as never, {
      teamId: TEAM_ID,
      orphanOnly: true,
      now,
    });
    expect(orphans).toHaveLength(1);
    expect(orphans[0]).toMatchObject({
      teamId: TEAM_ID,
      integrationId: integration.id,
      fileId: 'stale-file',
      cursor: { extractId: 'ext-stale' },
    });
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const forIntegration = await scope.integrations.listDriveExtractCursors({
      integrationId: integration.id,
    });
    expect(forIntegration.map((row) => row.fileId).sort()).toEqual(['fresh-file', 'stale-file']);

    await expect(scope.integrations.deleteIntegration(integration.id)).resolves.toBeUndefined();
    expect(s3Fakes.deleteObject).toHaveBeenCalled();
    await expect(
      listDriveExtractCursors(db as never, { teamId: TEAM_ID, integrationId: integration.id }),
    ).resolves.toEqual([]);
  });

  it('deletes extract tombstone objects when disconnecting Drive', async () => {
    const [integration] = await db
      .insert(integrations)
      .values({
        teamId: TEAM_ID,
        connectedByUserId: USER_ID,
        provider: 'google_drive',
        displayName: 'Google Drive',
        externalAccountId: 'drive-acct-tombstone-disconnect',
        visibilityDefault: 'team',
      })
      .returning();
    if (!integration) throw new Error('integration insert failed');
    await db.insert(integrationSyncState).values({
      integrationId: integration.id,
      resourceType: driveExtractCursorKey('live-file'),
      cursor: {
        extractId: 'ext-live',
        objectKey: 'live-source',
        resultObjectKey: 'live-result.json',
        contentType: 'application/pdf',
        filename: 'Live.pdf',
        enqueuedAt: '2026-11-03T00:00:00.000Z',
        tombstones: [
          {
            extractId: 'ext-old',
            objectKey: 'old-source',
            resultObjectKey: 'old-result.json',
            enqueuedAt: '2026-11-02T00:00:00.000Z',
            cancelledAt: '2026-11-02T00:01:00.000Z',
            pendingDeleteKeys: ['old-source', 'old-result.json', 'old-extra'],
          },
        ],
      },
    });
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    await expect(scope.integrations.deleteIntegration(integration.id)).resolves.toBeUndefined();
    const deletedKeys = s3Fakes.deleteObject.mock.calls.map((call) =>
      typeof call[2] === 'string' ? call[2] : '',
    );
    expect(deletedKeys).toEqual(
      expect.arrayContaining([
        'live-source',
        'live-result.json',
        'old-source',
        'old-result.json',
        'old-extra',
      ]),
    );
  });

  it('purges snapshots and extract when a Drive file selection is dropped', async () => {
    const [integration] = await db
      .insert(integrations)
      .values({
        teamId: TEAM_ID,
        connectedByUserId: USER_ID,
        provider: 'google_drive',
        displayName: 'Google Drive',
        externalAccountId: 'drive-acct-drop-file',
        visibilityDefault: 'team',
      })
      .returning();
    if (!integration) throw new Error('integration insert failed');
    await db.insert(integrationSelections).values({
      integrationId: integration.id,
      selectionKind: 'drive.file',
      externalId: 'file-drop',
    });
    await saveDriveSnapshot(db as never, {
      teamId: TEAM_ID,
      integrationId: integration.id,
      fileId: 'file-drop',
      snapshot: {
        contentHash: hashDrivePayload('drop-body'),
        snapshotText: 'drop-body',
        commentsHash: 'comments-drop',
        permissionsHash: 'permissions-drop',
        mimeType: 'application/pdf',
      },
    });
    await db.insert(integrationSyncState).values({
      integrationId: integration.id,
      resourceType: driveExtractCursorKey('file-drop'),
      cursor: {
        extractId: 'ext-drop',
        objectKey: 'drop-source',
        resultObjectKey: 'drop-result.json',
        contentType: 'application/pdf',
        filename: 'Drop.pdf',
        enqueuedAt: new Date().toISOString(),
        tombstones: [
          {
            extractId: 'ext-drop-old',
            objectKey: 'drop-old-source',
            resultObjectKey: 'drop-old-result.json',
            enqueuedAt: '2026-11-02T00:00:00.000Z',
            cancelledAt: '2026-11-02T00:01:00.000Z',
            pendingDeleteKeys: ['drop-old-source'],
          },
        ],
      },
    });
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    await scope.integrations.setSelections(integration.id, []);
    expect(await db.select().from(googleDriveFileSnapshots)).toEqual([]);
    const extractCursors = await listDriveExtractCursors(db as never, {
      teamId: TEAM_ID,
      integrationId: integration.id,
    });
    expect(extractCursors).toHaveLength(1);
    expect(extractCursors[0]?.fileId).toBe('file-drop');
    expect(extractCursors[0]?.cursor.extractId).toBe('ext-drop');
    expect(extractCursors[0]?.cursor.cleanupPending).toBe(true);
    expect(extractCursors[0]?.cursor.cancelledAt).toEqual(expect.any(String));
    const deletedKeys = s3Fakes.deleteObject.mock.calls.map((call) =>
      typeof call[2] === 'string' ? call[2] : '',
    );
    expect(deletedKeys).toEqual(
      expect.arrayContaining(['drop-source', 'drop-result.json', 'drop-old-source']),
    );
  });

  it('keeps snapshots and extract when a dropped file remains in folder scope', async () => {
    const [integration] = await db
      .insert(integrations)
      .values({
        teamId: TEAM_ID,
        connectedByUserId: USER_ID,
        provider: 'google_drive',
        displayName: 'Google Drive',
        externalAccountId: 'drive-acct-drop-file-keep-folder',
        visibilityDefault: 'team',
      })
      .returning();
    if (!integration) throw new Error('integration insert failed');
    await db.insert(integrationSelections).values([
      {
        integrationId: integration.id,
        selectionKind: 'drive.file',
        externalId: 'file-keep',
      },
      {
        integrationId: integration.id,
        selectionKind: 'drive.folder',
        externalId: 'folder-1',
      },
    ]);
    await saveDriveSnapshot(db as never, {
      teamId: TEAM_ID,
      integrationId: integration.id,
      fileId: 'file-keep',
      snapshot: {
        contentHash: hashDrivePayload('keep-body'),
        snapshotText: 'keep-body',
        commentsHash: 'comments-keep',
        permissionsHash: 'permissions-keep',
        mimeType: 'application/pdf',
      },
    });
    await db.insert(integrationSyncState).values({
      integrationId: integration.id,
      resourceType: driveExtractCursorKey('file-keep'),
      cursor: {
        extractId: 'ext-keep',
        objectKey: 'keep-source',
        resultObjectKey: 'keep-result.json',
        contentType: 'application/pdf',
        filename: 'Keep.pdf',
        enqueuedAt: '2026-11-03T00:00:00.000Z',
      },
    });
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    await scope.integrations.setSelections(integration.id, [
      { kind: 'drive.folder', externalId: 'folder-1' },
    ]);
    const snapshots = await db.select().from(googleDriveFileSnapshots);
    expect(snapshots.map((row) => row.fileId)).toEqual(['file-keep']);
    const extractCursors = await listDriveExtractCursors(db as never, {
      teamId: TEAM_ID,
      integrationId: integration.id,
    });
    expect(extractCursors.map((row) => row.fileId)).toEqual(['file-keep']);
    expect(s3Fakes.deleteObject).not.toHaveBeenCalled();
  });

  it('rebinds a dropped explicit file onto the remaining folder object link', async () => {
    const [integration] = await db
      .insert(integrations)
      .values({
        teamId: TEAM_ID,
        connectedByUserId: USER_ID,
        provider: 'google_drive',
        displayName: 'Google Drive',
        externalAccountId: 'drive-acct-drop-file-rebind',
        visibilityDefault: 'team',
      })
      .returning();
    if (!integration) throw new Error('integration insert failed');
    const [northstar] = await db
      .insert(entities)
      .values({
        teamId: TEAM_ID,
        type: 'company',
        canonicalName: 'Northstar',
        status: 'open',
      })
      .returning();
    const [acme] = await db
      .insert(entities)
      .values({
        teamId: TEAM_ID,
        type: 'company',
        canonicalName: 'Acme Labs',
        status: 'open',
      })
      .returning();
    if (!northstar || !acme) throw new Error('company insert failed');
    await db.insert(integrationSelections).values([
      {
        integrationId: integration.id,
        selectionKind: 'drive.file',
        externalId: 'file-b',
        linkedObjectId: acme.id,
      },
      {
        integrationId: integration.id,
        selectionKind: 'drive.folder',
        externalId: 'folder-1',
        linkedObjectId: northstar.id,
      },
    ]);
    const [source] = await db
      .insert(artifactClusters)
      .values({
        teamId: TEAM_ID,
        artifactType: 'company',
        canonicalName: 'Acme Labs',
        canonicalEntityId: acme.id,
      })
      .returning();
    if (!source) throw new Error('cluster insert failed');
    await db.insert(artifactClusterAnchors).values({
      teamId: TEAM_ID,
      clusterId: source.id,
      anchorType: 'provider_object',
      anchorValue: 'google_drive:file-b',
      strength: 'hard',
    });
    await db.insert(rawEvents).values({
      teamId: TEAM_ID,
      authorUserId: USER_ID,
      source: 'integration',
      contentText: 'File b changed',
      occurredAt: new Date('2026-06-20T10:00:00Z'),
      visibility: 'team',
      sourceMetadata: {
        provider: 'google_drive',
        integration_id: integration.id,
        external_object_id: 'file-b',
        drive: { parents: ['folder-1'], inherited_from: 'folder-1' },
      },
    });
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    await scope.integrations.setSelections(integration.id, [
      { kind: 'drive.folder', externalId: 'folder-1' },
    ]);
    const [northstarCluster] = await db
      .select()
      .from(artifactClusters)
      .where(eq(artifactClusters.canonicalEntityId, northstar.id));
    const [anchor] = await db.select().from(artifactClusterAnchors);
    expect(anchor?.clusterId).toBe(northstarCluster?.id);
    expect(anchor?.clusterId).not.toBe(source.id);
  });

  it('purges leftover folder-file snapshots when no Drive container remains', async () => {
    const [integration] = await db
      .insert(integrations)
      .values({
        teamId: TEAM_ID,
        connectedByUserId: USER_ID,
        provider: 'google_drive',
        displayName: 'Google Drive',
        externalAccountId: 'drive-acct-drop-folder',
        visibilityDefault: 'team',
      })
      .returning();
    if (!integration) throw new Error('integration insert failed');
    await db.insert(integrationSelections).values({
      integrationId: integration.id,
      selectionKind: 'drive.folder',
      externalId: 'folder-1',
    });
    await saveDriveSnapshot(db as never, {
      teamId: TEAM_ID,
      integrationId: integration.id,
      fileId: 'nested-file',
      snapshot: {
        contentHash: hashDrivePayload('nested-body'),
        snapshotText: 'nested-body',
        commentsHash: 'comments-nested',
        permissionsHash: 'permissions-nested',
        mimeType: 'application/vnd.google-apps.document',
      },
    });
    await db.insert(integrationSyncState).values({
      integrationId: integration.id,
      resourceType: driveExtractCursorKey('nested-file'),
      cursor: {
        extractId: 'ext-nested',
        objectKey: 'nested-source',
        resultObjectKey: 'nested-result.json',
        contentType: 'application/pdf',
        filename: 'Nested.pdf',
        enqueuedAt: new Date().toISOString(),
      },
    });
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    await scope.integrations.setSelections(integration.id, []);
    expect(await db.select().from(googleDriveFileSnapshots)).toEqual([]);
    const extractCursors = await listDriveExtractCursors(db as never, {
      teamId: TEAM_ID,
      integrationId: integration.id,
    });
    expect(extractCursors.map((row) => row.fileId)).toEqual(['nested-file']);
    expect(extractCursors[0]?.cursor.cleanupPending).toBe(true);
    expect(extractCursors[0]?.cursor.cancelledAt).toEqual(expect.any(String));
  });

  it('rebinds Drive file artifact anchors when the selection object link changes', async () => {
    const [integration] = await db
      .insert(integrations)
      .values({
        teamId: TEAM_ID,
        connectedByUserId: USER_ID,
        provider: 'google_drive',
        displayName: 'Google Drive',
        externalAccountId: 'drive-acct-rebind',
        visibilityDefault: 'team',
      })
      .returning();
    if (!integration) throw new Error('integration insert failed');
    const [northstar] = await db
      .insert(entities)
      .values({
        teamId: TEAM_ID,
        type: 'company',
        canonicalName: 'Northstar',
        status: 'open',
      })
      .returning();
    const [acme] = await db
      .insert(entities)
      .values({
        teamId: TEAM_ID,
        type: 'company',
        canonicalName: 'Acme Labs',
        status: 'open',
      })
      .returning();
    if (!northstar || !acme) throw new Error('company insert failed');
    const [selection] = await db
      .insert(integrationSelections)
      .values({
        integrationId: integration.id,
        selectionKind: 'drive.file',
        externalId: 'file-rebind',
        linkedObjectId: northstar.id,
      })
      .returning();
    if (!selection) throw new Error('selection insert failed');
    const [source] = await db
      .insert(artifactClusters)
      .values({
        teamId: TEAM_ID,
        artifactType: 'company',
        canonicalName: 'Northstar',
        canonicalEntityId: northstar.id,
      })
      .returning();
    if (!source) throw new Error('cluster insert failed');
    await db.insert(artifactClusterAnchors).values({
      teamId: TEAM_ID,
      clusterId: source.id,
      anchorType: 'provider_object',
      anchorValue: 'google_drive:file-rebind',
      strength: 'hard',
    });
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    await scope.integrations.setSelectionLinkedObject(integration.id, selection.id, acme.id);
    const [northstarCluster] = await db
      .select()
      .from(artifactClusters)
      .where(eq(artifactClusters.id, source.id));
    expect(northstarCluster?.canonicalEntityId).toBe(northstar.id);
    const [acmeCluster] = await db
      .select()
      .from(artifactClusters)
      .where(eq(artifactClusters.canonicalEntityId, acme.id));
    const [anchor] = await db.select().from(artifactClusterAnchors);
    expect(anchor?.clusterId).toBe(acmeCluster?.id);
    expect(anchor?.clusterId).not.toBe(source.id);
  });

  it('replacing one folder link does not rebind files inherited from a sibling folder', async () => {
    const [integration] = await db
      .insert(integrations)
      .values({
        teamId: TEAM_ID,
        connectedByUserId: USER_ID,
        provider: 'google_drive',
        displayName: 'Google Drive',
        externalAccountId: 'drive-acct-two-folders',
        visibilityDefault: 'team',
      })
      .returning();
    if (!integration) throw new Error('integration insert failed');
    const [northstar] = await db
      .insert(entities)
      .values({
        teamId: TEAM_ID,
        type: 'company',
        canonicalName: 'Northstar',
        status: 'open',
      })
      .returning();
    const [acme] = await db
      .insert(entities)
      .values({
        teamId: TEAM_ID,
        type: 'company',
        canonicalName: 'Acme Labs',
        status: 'open',
      })
      .returning();
    if (!northstar || !acme) throw new Error('company insert failed');
    const [folderOne] = await db
      .insert(integrationSelections)
      .values({
        integrationId: integration.id,
        selectionKind: 'drive.folder',
        externalId: 'folder-1',
        linkedObjectId: northstar.id,
      })
      .returning();
    await db.insert(integrationSelections).values({
      integrationId: integration.id,
      selectionKind: 'drive.folder',
      externalId: 'folder-2',
      linkedObjectId: northstar.id,
    });
    if (!folderOne) throw new Error('selection insert failed');
    const [source] = await db
      .insert(artifactClusters)
      .values({
        teamId: TEAM_ID,
        artifactType: 'company',
        canonicalName: 'Northstar',
        canonicalEntityId: northstar.id,
      })
      .returning();
    if (!source) throw new Error('cluster insert failed');
    await db.insert(artifactClusterAnchors).values([
      {
        teamId: TEAM_ID,
        clusterId: source.id,
        anchorType: 'provider_object',
        anchorValue: 'google_drive:file-folder-1',
        strength: 'hard',
        metadata: {
          drive_inherited_from: 'folder-1',
          drive_inherited_candidates: ['file-folder-1', 'folder-1'],
          drive_integration_id: integration.id,
        },
      },
      {
        teamId: TEAM_ID,
        clusterId: source.id,
        anchorType: 'provider_object',
        anchorValue: 'google_drive:file-folder-2',
        strength: 'hard',
        metadata: {
          drive_inherited_from: 'folder-2',
          drive_inherited_candidates: ['file-folder-2', 'folder-2'],
          drive_integration_id: integration.id,
        },
      },
    ]);
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    await scope.integrations.setSelectionLinkedObject(integration.id, folderOne.id, acme.id);
    const [acmeCluster] = await db
      .select()
      .from(artifactClusters)
      .where(eq(artifactClusters.canonicalEntityId, acme.id));
    const anchors = await db.select().from(artifactClusterAnchors);
    expect(anchors.find((row) => row.anchorValue === 'google_drive:file-folder-1')?.clusterId).toBe(
      acmeCluster?.id,
    );
    expect(anchors.find((row) => row.anchorValue === 'google_drive:file-folder-2')?.clusterId).toBe(
      source.id,
    );
  });

  it('dropping one of two folders unbinds only files that inherited that folder', async () => {
    const [integration] = await db
      .insert(integrations)
      .values({
        teamId: TEAM_ID,
        connectedByUserId: USER_ID,
        provider: 'google_drive',
        displayName: 'Google Drive',
        externalAccountId: 'drive-acct-drop-folder',
        visibilityDefault: 'team',
      })
      .returning();
    if (!integration) throw new Error('integration insert failed');
    const [northstar] = await db
      .insert(entities)
      .values({
        teamId: TEAM_ID,
        type: 'company',
        canonicalName: 'Northstar',
        status: 'open',
      })
      .returning();
    if (!northstar) throw new Error('company insert failed');
    await db.insert(integrationSelections).values([
      {
        integrationId: integration.id,
        selectionKind: 'drive.folder',
        externalId: 'folder-1',
        linkedObjectId: northstar.id,
      },
      {
        integrationId: integration.id,
        selectionKind: 'drive.folder',
        externalId: 'folder-2',
        linkedObjectId: northstar.id,
      },
    ]);
    const [source] = await db
      .insert(artifactClusters)
      .values({
        teamId: TEAM_ID,
        artifactType: 'company',
        canonicalName: 'Northstar',
        canonicalEntityId: northstar.id,
      })
      .returning();
    if (!source) throw new Error('cluster insert failed');
    await db.insert(artifactClusterAnchors).values([
      {
        teamId: TEAM_ID,
        clusterId: source.id,
        anchorType: 'provider_object',
        anchorValue: 'google_drive:file-folder-1',
        strength: 'hard',
        metadata: {
          drive_inherited_from: 'folder-1',
          drive_inherited_candidates: ['file-folder-1', 'folder-1'],
          drive_integration_id: integration.id,
        },
      },
      {
        teamId: TEAM_ID,
        clusterId: source.id,
        anchorType: 'provider_object',
        anchorValue: 'google_drive:file-folder-2',
        strength: 'hard',
        metadata: {
          drive_inherited_from: 'folder-2',
          drive_inherited_candidates: ['file-folder-2', 'folder-2'],
          drive_integration_id: integration.id,
        },
      },
    ]);
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    await scope.integrations.setSelections(integration.id, [
      { kind: 'drive.folder', externalId: 'folder-2' },
    ]);
    const anchors = await db.select().from(artifactClusterAnchors);
    expect(anchors.find((row) => row.anchorValue === 'google_drive:file-folder-2')?.clusterId).toBe(
      source.id,
    );
    const unbound = anchors.find((row) => row.anchorValue === 'google_drive:file-folder-1');
    expect(unbound?.clusterId).not.toBe(source.id);
    const [unboundCluster] = await db
      .select()
      .from(artifactClusters)
      .where(eq(artifactClusters.id, unbound?.clusterId ?? ''));
    expect(unboundCluster?.canonicalEntityId).toBeNull();
  });

  it('assigns a previously unlinked folder from unbound inherited file anchors', async () => {
    const [integration] = await db
      .insert(integrations)
      .values({
        teamId: TEAM_ID,
        connectedByUserId: USER_ID,
        provider: 'google_drive',
        displayName: 'Google Drive',
        externalAccountId: 'drive-acct-relink-folder',
        visibilityDefault: 'team',
      })
      .returning();
    if (!integration) throw new Error('integration insert failed');
    const [northstar] = await db
      .insert(entities)
      .values({
        teamId: TEAM_ID,
        type: 'company',
        canonicalName: 'Northstar',
        status: 'open',
      })
      .returning();
    const [acme] = await db
      .insert(entities)
      .values({
        teamId: TEAM_ID,
        type: 'company',
        canonicalName: 'Acme Labs',
        status: 'open',
      })
      .returning();
    if (!northstar || !acme) throw new Error('company insert failed');
    const [folderOne] = await db
      .insert(integrationSelections)
      .values({
        integrationId: integration.id,
        selectionKind: 'drive.folder',
        externalId: 'folder-1',
        linkedObjectId: null,
      })
      .returning();
    await db.insert(integrationSelections).values({
      integrationId: integration.id,
      selectionKind: 'drive.folder',
      externalId: 'folder-2',
      linkedObjectId: northstar.id,
    });
    if (!folderOne) throw new Error('selection insert failed');
    const [source] = await db
      .insert(artifactClusters)
      .values({
        teamId: TEAM_ID,
        artifactType: 'company',
        canonicalName: 'Northstar',
        canonicalEntityId: northstar.id,
      })
      .returning();
    const [unbound] = await db
      .insert(artifactClusters)
      .values({
        teamId: TEAM_ID,
        artifactType: 'company',
        canonicalName: 'Unbound Drive files',
        canonicalEntityId: null,
      })
      .returning();
    if (!source || !unbound) throw new Error('cluster insert failed');
    await db.insert(artifactClusterAnchors).values([
      {
        teamId: TEAM_ID,
        clusterId: unbound.id,
        anchorType: 'provider_object',
        anchorValue: 'google_drive:file-folder-1',
        strength: 'hard',
        metadata: {
          drive_inherited_from: 'folder-1',
          drive_inherited_candidates: ['file-folder-1', 'folder-1'],
          drive_integration_id: integration.id,
        },
      },
      {
        teamId: TEAM_ID,
        clusterId: source.id,
        anchorType: 'provider_object',
        anchorValue: 'google_drive:file-folder-2',
        strength: 'hard',
        metadata: {
          drive_inherited_from: 'folder-2',
          drive_inherited_candidates: ['file-folder-2', 'folder-2'],
          drive_integration_id: integration.id,
        },
      },
    ]);
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    await scope.integrations.setSelectionLinkedObject(integration.id, folderOne.id, acme.id);
    const [acmeCluster] = await db
      .select()
      .from(artifactClusters)
      .where(eq(artifactClusters.canonicalEntityId, acme.id));
    const anchors = await db.select().from(artifactClusterAnchors);
    expect(anchors.find((row) => row.anchorValue === 'google_drive:file-folder-1')?.clusterId).toBe(
      acmeCluster?.id,
    );
    expect(anchors.find((row) => row.anchorValue === 'google_drive:file-folder-2')?.clusterId).toBe(
      source.id,
    );
  });

  it('keeps extract cursors when disconnect cannot delete transient S3 objects', async () => {
    const [integration] = await db
      .insert(integrations)
      .values({
        teamId: TEAM_ID,
        connectedByUserId: USER_ID,
        provider: 'google_drive',
        displayName: 'Google Drive',
        externalAccountId: 'drive-acct-s3-fail',
        visibilityDefault: 'team',
      })
      .returning();
    if (!integration) throw new Error('integration insert failed');
    await db.insert(integrationSyncState).values({
      integrationId: integration.id,
      resourceType: driveExtractCursorKey('stuck-file'),
      cursor: {
        extractId: 'ext-stuck',
        objectKey: 'stuck-source',
        resultObjectKey: 'stuck-result.json',
        contentType: 'application/pdf',
        filename: 'Stuck.pdf',
        enqueuedAt: '2026-11-03T00:00:00.000Z',
      },
    });
    s3Fakes.deleteObject.mockRejectedValue(new Error('AccessDenied'));
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    await expect(scope.integrations.deleteIntegration(integration.id)).rejects.toThrow(
      'drive transient extract objects remain',
    );
    const remaining = await listDriveExtractCursors(db as never, {
      teamId: TEAM_ID,
      integrationId: integration.id,
    });
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.fileId).toBe('stuck-file');
    expect(remaining[0]?.cursor.extractId).toBe('ext-stuck');
  });

  it('filters cleared extract cursors in SQL before the page limit', async () => {
    const [integration] = await db
      .insert(integrations)
      .values({
        teamId: TEAM_ID,
        connectedByUserId: USER_ID,
        provider: 'google_drive',
        displayName: 'Google Drive',
        externalAccountId: 'drive-acct-cleared',
        visibilityDefault: 'team',
      })
      .returning();
    if (!integration) throw new Error('integration insert failed');

    const staleEnqueuedAt = new Date(
      Date.parse('2026-11-03T00:00:00.000Z') - DRIVE_TRANSIENT_EXTRACT_ORPHAN_MS,
    ).toISOString();
    const cleared = Array.from({ length: DRIVE_EXTRACT_CURSOR_PAGE_SIZE }, (_, index) => ({
      integrationId: integration.id,
      resourceType: driveExtractCursorKey(`cleared-${String(index)}`),
      cursor: {},
      updatedAt: new Date('2026-10-01T00:00:00.000Z'),
    }));
    await db.insert(integrationSyncState).values([
      ...cleared,
      {
        integrationId: integration.id,
        resourceType: driveExtractCursorKey('orphan-file'),
        cursor: {
          extractId: 'ext-orphan',
          objectKey: 'orphan-source',
          resultObjectKey: 'orphan-result.json',
          contentType: 'application/pdf',
          filename: 'Orphan.pdf',
          enqueuedAt: staleEnqueuedAt,
        },
        updatedAt: new Date('2026-11-01T00:00:00.000Z'),
      },
    ]);

    const now = new Date('2026-11-03T00:00:00.000Z');
    const orphans = await listDriveExtractCursors(db as never, {
      teamId: TEAM_ID,
      orphanOnly: true,
      now,
      limit: 10,
    });
    expect(orphans.map((row) => row.fileId)).toEqual(['orphan-file']);
    await expect(
      adminListTeamIdsWithDriveExtractCursors(db as never, { orphanOnly: true, now }),
    ).resolves.toEqual([TEAM_ID]);
  });

  it('lists cleanupPending extract cursors as orphans without waiting 24 hours', async () => {
    const [integration] = await db
      .insert(integrations)
      .values({
        teamId: TEAM_ID,
        connectedByUserId: USER_ID,
        provider: 'google_drive',
        displayName: 'Google Drive',
        externalAccountId: 'drive-acct-cleanup',
        visibilityDefault: 'team',
      })
      .returning();
    if (!integration) throw new Error('integration insert failed');
    await db.insert(integrationSyncState).values({
      integrationId: integration.id,
      resourceType: driveExtractCursorKey('cleanup-file'),
      cursor: {
        extractId: 'ext-cleanup',
        objectKey: 'cleanup-source',
        resultObjectKey: 'cleanup-result.json',
        contentType: 'application/pdf',
        filename: 'Cleanup.pdf',
        enqueuedAt: '2026-11-03T00:00:00.000Z',
        cleanupPending: true,
        pendingDeleteKeys: ['cleanup-result.json'],
      },
      updatedAt: new Date('2026-11-03T00:00:00.000Z'),
    });
    const now = new Date('2026-11-03T00:05:00.000Z');
    const orphans = await listDriveExtractCursors(db as never, {
      teamId: TEAM_ID,
      orphanOnly: true,
      now,
    });
    expect(orphans.map((row) => row.fileId)).toEqual(['cleanup-file']);
    expect(orphans[0]?.cursor.cleanupPending).toBe(true);
  });

  it('paginates populated extract cursors so disconnect cleanup can walk past a full page', async () => {
    const [integration] = await db
      .insert(integrations)
      .values({
        teamId: TEAM_ID,
        connectedByUserId: USER_ID,
        provider: 'google_drive',
        displayName: 'Google Drive',
        externalAccountId: 'drive-acct-pages',
        visibilityDefault: 'team',
      })
      .returning();
    if (!integration) throw new Error('integration insert failed');

    await db.insert(integrationSyncState).values(
      ['a', 'b', 'c'].map((fileId, index) => ({
        integrationId: integration.id,
        resourceType: driveExtractCursorKey(fileId),
        cursor: {
          extractId: `ext-${fileId}`,
          objectKey: `${fileId}-source`,
          resultObjectKey: `${fileId}-result.json`,
          contentType: 'application/pdf',
          filename: `${fileId}.pdf`,
          enqueuedAt: '2026-11-03T00:00:00.000Z',
        },
        updatedAt: new Date(`2026-11-03T00:00:0${String(index)}.000Z`),
      })),
    );

    const pages: string[][] = [];
    const seen = await forEachDriveExtractCursorPage(db as never, {
      teamId: TEAM_ID,
      integrationId: integration.id,
      limit: 2,
      onPage: (page) => {
        pages.push(page.map((row) => row.fileId));
        return Promise.resolve();
      },
    });
    expect(seen).toBe(3);
    expect(pages).toEqual([['a', 'b'], ['c']]);
  });

  it('does not list another team Drive extract cursor', async () => {
    await pg.exec(`
      INSERT INTO teams (id, slug, name) VALUES ('${OTHER_TEAM_ID}', 'team-b', 'Team B');
      INSERT INTO users (id, email) VALUES ('${OTHER_USER_ID}', 'other@example.com');
      INSERT INTO team_members (team_id, user_id, role) VALUES
        ('${OTHER_TEAM_ID}', '${OTHER_USER_ID}', 'owner');
    `);
    const [home] = await db
      .insert(integrations)
      .values({
        teamId: TEAM_ID,
        connectedByUserId: USER_ID,
        provider: 'google_drive',
        displayName: 'Google Drive',
        externalAccountId: 'drive-acct-home',
        visibilityDefault: 'team',
      })
      .returning();
    const [away] = await db
      .insert(integrations)
      .values({
        teamId: OTHER_TEAM_ID,
        connectedByUserId: OTHER_USER_ID,
        provider: 'google_drive',
        displayName: 'Google Drive',
        externalAccountId: 'drive-acct-away',
        visibilityDefault: 'team',
      })
      .returning();
    if (!home || !away) throw new Error('integration insert failed');

    const staleEnqueuedAt = new Date(
      Date.parse('2026-11-03T00:00:00.000Z') - DRIVE_TRANSIENT_EXTRACT_ORPHAN_MS,
    ).toISOString();
    await db.insert(integrationSyncState).values([
      {
        integrationId: home.id,
        resourceType: driveExtractCursorKey('home-file'),
        cursor: {
          extractId: 'ext-home',
          objectKey: 'home-source',
          resultObjectKey: 'home-result.json',
          contentType: 'application/pdf',
          filename: 'Home.pdf',
          enqueuedAt: staleEnqueuedAt,
        },
      },
      {
        integrationId: away.id,
        resourceType: driveExtractCursorKey('away-file'),
        cursor: {
          extractId: 'ext-away',
          objectKey: 'away-source',
          resultObjectKey: 'away-result.json',
          contentType: 'application/pdf',
          filename: 'Away.pdf',
          enqueuedAt: staleEnqueuedAt,
        },
      },
    ]);

    const now = new Date('2026-11-03T00:00:00.000Z');
    const homeScope = withTeam(db as never, TEAM_ID, USER_ID);
    const awayScope = withTeam(db as never, OTHER_TEAM_ID, OTHER_USER_ID);
    const homeOrphans = await homeScope.integrations.listDriveExtractCursors({
      orphanOnly: true,
      now,
    });
    const awayOrphans = await awayScope.integrations.listDriveExtractCursors({
      orphanOnly: true,
      now,
    });
    expect(homeOrphans.map((row) => row.fileId)).toEqual(['home-file']);
    expect(awayOrphans.map((row) => row.fileId)).toEqual(['away-file']);
    await expect(
      adminListTeamIdsWithDriveExtractCursors(db as never, { orphanOnly: true, now }),
    ).resolves.toEqual([TEAM_ID, OTHER_TEAM_ID]);
  });
});

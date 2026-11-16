import { PGlite } from '@electric-sql/pglite';
import {
  artifactClusterAnchors,
  artifactClusters,
  entities,
  googleDriveFileSnapshots,
  integrations,
  integrationSelections,
  integrationSyncState,
  providerConnections,
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
  driveTransientExtractKeys,
  driveTransientExtractResultBody,
  hashDrivePayload,
  isDriveExtractCancelSettled,
  isDriveExtractCursorOrphan,
  isDriveExtractPendingStale,
  isDriveExtractResultTooLarge,
  isRetryableDriveExtractStorageError,
  shouldRetainDriveExtractCleanup,
  adminListTeamIdsWithDriveExtractCursors,
  forEachDriveExtractCursorPage,
  latestDriveObjectLinkHints,
  latestDriveObjectLinkHintsByFileIds,
  linkedObjectForDriveSelection,
  listDriveTrackedDescendantFileIds,
  listDriveExtractCursors,
  cleanupUncoveredDriveTrackedFiles,
  compactDrivePermissionGrants,
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
import {
  driveObjectLinkCandidates,
  driveFileInheritsChangedSelection,
  driveSelectionsWithChangedLink,
  resolveDriveFileObjectLink,
  survivingLinkedObjectForDriveFile,
  driveObjectLinkHintsEqual,
  pickNewestDriveTrackedAncestry,
} from '#src/integrations/google-drive-link-policy.js';
import { applyDbMigrations } from '#src/test/pglite.js';

const { withTeam } = await import('#src/team-scope.js');

const TEAM_ID = '11111111-1111-1111-1111-111111111111';
const OTHER_TEAM_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const OTHER_USER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function folderAncestryHints(fileId: string, folderId: string) {
  return {
    parentIds: [folderId],
    driveId: null,
    matchedAncestorId: folderId,
    inheritedCandidates: [fileId, folderId],
  };
}

describe('pickNewestDriveTrackedAncestry', () => {
  const folderA = folderAncestryHints('moved-file', 'folder-a');
  const folderB = folderAncestryHints('moved-file', 'folder-b');

  it('uses the newest snapshot or event, and the snapshot on a tie', () => {
    const older = new Date('2026-06-20T10:00:00.000Z');
    const newer = new Date('2026-06-21T10:00:00.000Z');
    expect(
      pickNewestDriveTrackedAncestry({
        event: { at: older, hints: folderA },
        snapshot: { at: newer, hints: folderB },
      }),
    ).toEqual(folderB);
    expect(
      pickNewestDriveTrackedAncestry({
        event: { at: newer, hints: folderA },
        snapshot: { at: older, hints: folderB },
      }),
    ).toEqual(folderA);
    expect(
      pickNewestDriveTrackedAncestry({
        event: { at: newer, hints: folderA },
        snapshot: { at: newer, hints: folderB },
      }),
    ).toEqual(folderB);
    expect(pickNewestDriveTrackedAncestry({ event: { at: older, hints: folderA } })).toEqual(
      folderA,
    );
    expect(pickNewestDriveTrackedAncestry({ snapshot: { at: newer, hints: folderB } })).toEqual(
      folderB,
    );
  });

  it('ignores stamps that do not carry ancestry', () => {
    expect(
      pickNewestDriveTrackedAncestry({
        event: {
          at: new Date('2026-06-21T10:00:00.000Z'),
          hints: {
            parentIds: [],
            driveId: null,
            matchedAncestorId: null,
            inheritedCandidates: null,
          },
        },
        snapshot: { at: new Date('2026-06-20T10:00:00.000Z'), hints: folderA },
      }),
    ).toEqual(folderA);
  });
});

describe('driveObjectLinkHintsEqual', () => {
  it('compares walked membership, not object identity', () => {
    const folderA = folderAncestryHints('moved-file', 'folder-a');
    expect(driveObjectLinkHintsEqual(folderA, { ...folderA })).toBe(true);
    expect(driveObjectLinkHintsEqual(folderA, folderAncestryHints('moved-file', 'folder-b'))).toBe(
      false,
    );
    expect(driveObjectLinkHintsEqual(undefined, folderA)).toBe(false);
    expect(driveObjectLinkHintsEqual(undefined, undefined)).toBe(true);
  });
});

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
    ).toEqual(['nested-doc', 'clients', '0AMK-my-drive', 'root']);
    expect(
      driveObjectLinkCandidates({
        fileId: 'shared-doc',
        parentIds: ['shared-folder'],
        matchedAncestorId: 'shared-drive',
        driveId: 'shared-drive',
        myDriveRootId: '0AMK-my-drive',
      }),
    ).toEqual(['shared-doc', 'shared-folder', 'shared-drive']);
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
    ).toEqual(['shared-picked', 'team-folder', 'shared-drive']);
    expect(
      driveObjectLinkCandidates({
        fileId: 'orphan',
        parentIds: ['unknown'],
      }),
    ).toEqual(['orphan', 'unknown']);
  });
});

describe('driveFileInheritsChangedSelection', () => {
  it('rebinds only when the changed selection is first in live-capture precedence', () => {
    const cases: {
      name: string;
      fileId: string;
      changedExternalId: string;
      remainingLinkedExternalIds?: string[];
      preserveFileIds?: string[];
      candidates?: string[];
      parentIds?: string[];
      matchedAncestorId?: string;
      inherit: boolean;
    }[] = [
      {
        name: 'single folder',
        fileId: 'file-a',
        changedExternalId: 'folder-1',
        candidates: ['file-a', 'folder-1'],
        inherit: true,
      },
      {
        name: 'sibling folder only',
        fileId: 'file-b',
        changedExternalId: 'folder-1',
        remainingLinkedExternalIds: ['folder-2'],
        candidates: ['file-b', 'folder-2'],
        inherit: false,
      },
      {
        name: 'two folders, earlier changed',
        fileId: 'file-both',
        changedExternalId: 'folder-1',
        remainingLinkedExternalIds: ['folder-2'],
        candidates: ['file-both', 'folder-1', 'folder-2'],
        inherit: true,
      },
      {
        name: 'two folders, later changed',
        fileId: 'file-both',
        changedExternalId: 'folder-2',
        remainingLinkedExternalIds: ['folder-1'],
        candidates: ['file-both', 'folder-1', 'folder-2'],
        inherit: false,
      },
      {
        name: 'nested ancestor',
        fileId: 'file-nested',
        changedExternalId: 'folder-1',
        parentIds: ['nested', 'folder-1'],
        matchedAncestorId: 'folder-1',
        inherit: true,
      },
      {
        name: 'shared drive with no earlier folder',
        fileId: 'shared-file',
        changedExternalId: 'shared-drive',
        remainingLinkedExternalIds: ['folder-1'],
        candidates: ['shared-file', 'shared-drive'],
        inherit: true,
      },
      {
        name: 'folder earlier than shared drive, relink shared drive',
        fileId: 'folder-file',
        changedExternalId: 'shared-drive',
        remainingLinkedExternalIds: ['folder-1'],
        candidates: ['folder-file', 'folder-1', 'shared-drive'],
        inherit: false,
      },
      {
        name: 'folder earlier than shared drive, relink folder',
        fileId: 'folder-file',
        changedExternalId: 'folder-1',
        remainingLinkedExternalIds: ['shared-drive'],
        candidates: ['folder-file', 'folder-1', 'shared-drive'],
        inherit: true,
      },
      {
        name: 'explicit file link',
        fileId: 'file-keep',
        changedExternalId: 'folder-1',
        preserveFileIds: ['file-keep'],
        candidates: ['file-keep', 'folder-1'],
        inherit: false,
      },
    ];
    for (const testCase of cases) {
      const actual = driveFileInheritsChangedSelection({
        fileId: testCase.fileId,
        changedExternalId: testCase.changedExternalId,
        ...(testCase.remainingLinkedExternalIds
          ? { remainingLinkedExternalIds: testCase.remainingLinkedExternalIds }
          : {}),
        ...(testCase.preserveFileIds ? { preserveFileIds: testCase.preserveFileIds } : {}),
        ...(testCase.candidates ? { candidates: testCase.candidates } : {}),
        ...(testCase.parentIds ? { parentIds: testCase.parentIds } : {}),
        ...(testCase.matchedAncestorId ? { matchedAncestorId: testCase.matchedAncestorId } : {}),
      });
      if (actual !== testCase.inherit) {
        throw new Error(`${testCase.name}: expected inherit=${String(testCase.inherit)}`);
      }
    }
  });
});

describe('resolveDriveFileObjectLink', () => {
  it('keeps a later shared drive from blocking a folder relink, and falls through on unlink', () => {
    const folderAndDrive = [
      { kind: 'drive.folder', externalId: 'folder-1', linkedObjectId: 'object-b' },
      { kind: 'drive.shared_drive', externalId: 'shared-drive', linkedObjectId: 'object-a' },
    ];
    expect(
      resolveDriveFileObjectLink({
        fileId: 'nested-file',
        selections: folderAndDrive,
        candidates: ['nested-file', 'folder-1', 'shared-drive'],
      }),
    ).toEqual({ kind: 'object', objectId: 'object-b', via: 'folder-1' });
    const afterUnlinkFolder = driveSelectionsWithChangedLink(folderAndDrive, {
      kind: 'drive.folder',
      externalId: 'folder-1',
      linkedObjectId: null,
    });
    expect(
      resolveDriveFileObjectLink({
        fileId: 'nested-file',
        selections: afterUnlinkFolder,
        candidates: ['nested-file', 'folder-1', 'shared-drive'],
      }),
    ).toEqual({ kind: 'object', objectId: 'object-a', via: 'shared-drive' });
    expect(
      resolveDriveFileObjectLink({
        fileId: 'nested-file',
        selections: folderAndDrive,
        candidates: ['nested-file', 'folder-1', 'shared-drive'],
        fallback: 'last_container',
        changedExternalId: 'shared-drive',
      }),
    ).toEqual({ kind: 'object', objectId: 'object-b', via: 'folder-1' });
    expect(
      resolveDriveFileObjectLink({
        fileId: 'nested-file',
        selections: folderAndDrive,
        candidates: ['nested-file', 'shared-drive', 'folder-1'],
      }),
    ).toEqual({ kind: 'object', objectId: 'object-b', via: 'folder-1' });
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
    ).resolves.toMatchObject({ allowed: false, reason: 'connection', retryAfterMs: 2_000 });
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

  it('persists snapshot ancestry and keeps it when a later save omits it', async () => {
    const [integration] = await db
      .insert(integrations)
      .values({
        teamId: TEAM_ID,
        connectedByUserId: USER_ID,
        provider: 'google_drive',
        displayName: 'Google Drive',
        externalAccountId: 'drive-acct-ancestry',
        visibilityDefault: 'team',
      })
      .returning();
    if (!integration) throw new Error('integration insert failed');
    const ancestry = {
      parentIds: ['folder-1'],
      driveId: null,
      matchedAncestorId: 'folder-1',
      inheritedCandidates: ['file-1', 'folder-1'],
    };
    const snapshot = {
      contentHash: hashDrivePayload('same-body'),
      snapshotText: 'same-body',
      commentsHash: 'comments-1',
      permissionsHash: 'permissions-1',
      mimeType: 'application/vnd.google-apps.document',
      ancestry,
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
      snapshot: {
        contentHash: snapshot.contentHash,
        snapshotText: snapshot.snapshotText,
        commentsHash: snapshot.commentsHash,
        permissionsHash: snapshot.permissionsHash,
        mimeType: snapshot.mimeType,
      },
    });
    const [row] = await db.select().from(googleDriveFileSnapshots);
    expect(row?.ancestry).toEqual(ancestry);
  });

  it('refreshes snapshot ancestry when a same-hash save includes a new walk', async () => {
    const [integration] = await db
      .insert(integrations)
      .values({
        teamId: TEAM_ID,
        connectedByUserId: USER_ID,
        provider: 'google_drive',
        displayName: 'Google Drive',
        externalAccountId: 'drive-acct-ancestry-move',
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
      ancestry: folderAncestryHints('file-1', 'folder-a'),
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
      snapshot: {
        ...snapshot,
        ancestry: folderAncestryHints('file-1', 'folder-b'),
      },
    });
    const latest = await loadLatestDriveSnapshot(db as never, {
      teamId: TEAM_ID,
      integrationId: integration.id,
      fileId: 'file-1',
    });
    expect(latest?.ancestry).toEqual(folderAncestryHints('file-1', 'folder-b'));
  });

  it('lists tracked descendants whose stored ancestry includes a folder', async () => {
    const [integration] = await db
      .insert(integrations)
      .values({
        teamId: TEAM_ID,
        connectedByUserId: USER_ID,
        provider: 'google_drive',
        displayName: 'Google Drive',
        externalAccountId: 'drive-acct-descendants',
        visibilityDefault: 'team',
      })
      .returning();
    if (!integration) throw new Error('integration insert failed');
    await saveDriveSnapshot(db as never, {
      teamId: TEAM_ID,
      integrationId: integration.id,
      fileId: 'in-folder',
      snapshot: {
        contentHash: hashDrivePayload('in'),
        snapshotText: 'in',
        commentsHash: 'c1',
        permissionsHash: 'p1',
        mimeType: 'application/vnd.google-apps.document',
        ancestry: folderAncestryHints('in-folder', 'clients'),
      },
    });
    await saveDriveSnapshot(db as never, {
      teamId: TEAM_ID,
      integrationId: integration.id,
      fileId: 'elsewhere',
      snapshot: {
        contentHash: hashDrivePayload('out'),
        snapshotText: 'out',
        commentsHash: 'c1',
        permissionsHash: 'p1',
        mimeType: 'application/vnd.google-apps.document',
        ancestry: folderAncestryHints('elsewhere', 'other'),
      },
    });
    await expect(
      listDriveTrackedDescendantFileIds(db as never, {
        teamId: TEAM_ID,
        integrationId: integration.id,
        ancestorId: 'clients',
      }),
    ).resolves.toEqual(['in-folder']);
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    await expect(
      scope.integrations.listDriveTrackedDescendantFileIds(integration.id, 'clients'),
    ).resolves.toEqual(['in-folder']);
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

  it('persists and reloads compact permission grants beside the locate index', async () => {
    const [integration] = await db
      .insert(integrations)
      .values({
        teamId: TEAM_ID,
        connectedByUserId: USER_ID,
        provider: 'google_drive',
        displayName: 'Google Drive',
        externalAccountId: 'drive-acct-grants',
        visibilityDefault: 'team',
      })
      .returning();
    if (!integration) throw new Error('integration insert failed');
    const body = 'Northstar SOW';
    const permissionsSnapshot = compactDrivePermissionGrants([
      { id: 'p-anyone', type: 'anyone', role: 'reader' },
      { id: 'p-client', type: 'user', role: 'reader', emailAddress: 'buyer@northstar.test' },
    ]);
    await saveDriveSnapshot(db as never, {
      teamId: TEAM_ID,
      integrationId: integration.id,
      fileId: 'file-grants',
      snapshot: {
        contentHash: hashDrivePayload(body),
        snapshotText: body,
        snapshotLocate: buildDriveSnapshotLocate(body),
        commentsHash: 'comments-grants',
        permissionsHash: 'permissions-grants',
        permissionsSnapshot,
        mimeType: 'application/vnd.google-apps.document',
      },
    });
    const loaded = await loadLatestDriveSnapshot(db as never, {
      teamId: TEAM_ID,
      integrationId: integration.id,
      fileId: 'file-grants',
    });
    expect(loaded?.permissionsSnapshot).toEqual(permissionsSnapshot);
    expect(loaded?.snapshotLocate?.chunkHashes.length).toBeGreaterThan(0);
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
        driveId: 'shared-drive',
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

  it('resolves a merged selection link to the surviving object', async () => {
    const [integration] = await db
      .insert(integrations)
      .values({
        teamId: TEAM_ID,
        connectedByUserId: USER_ID,
        provider: 'google_drive',
        displayName: 'Google Drive',
        externalAccountId: 'drive-acct-merged-link',
        visibilityDefault: 'team',
      })
      .returning();
    if (!integration) throw new Error('integration insert failed');
    const [survivor] = await db
      .insert(entities)
      .values({
        teamId: TEAM_ID,
        type: 'company',
        canonicalName: 'Northstar',
        status: 'open',
      })
      .returning();
    const [loser] = await db
      .insert(entities)
      .values({
        teamId: TEAM_ID,
        type: 'company',
        canonicalName: 'North Star Inc',
        status: 'open',
        mergedIntoId: survivor?.id,
      })
      .returning();
    if (!survivor || !loser) throw new Error('object insert failed');
    await db.insert(integrationSelections).values({
      integrationId: integration.id,
      selectionKind: 'drive.folder',
      externalId: 'clients',
      linkedObjectId: loser.id,
    });

    await expect(
      linkedObjectForDriveSelection(db as never, {
        teamId: TEAM_ID,
        integrationId: integration.id,
        fileId: 'sow',
        parentIds: ['clients'],
        matchedAncestorId: 'clients',
      }),
    ).resolves.toMatchObject({
      id: survivor.id,
      canonicalName: 'Northstar',
      type: 'company',
      inheritedFrom: 'clients',
    });
  });

  it('picks the nearest linked selected ancestor when a closer selected folder is unlinked', async () => {
    const [integration] = await db
      .insert(integrations)
      .values({
        teamId: TEAM_ID,
        connectedByUserId: USER_ID,
        provider: 'google_drive',
        displayName: 'Google Drive',
        externalAccountId: 'drive-acct-inner-unlinked',
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
    if (!northstar) throw new Error('object insert failed');
    await db.insert(integrationSelections).values([
      {
        integrationId: integration.id,
        selectionKind: 'drive.folder',
        externalId: 'inner',
        linkedObjectId: null,
      },
      {
        integrationId: integration.id,
        selectionKind: 'drive.folder',
        externalId: 'outer',
        linkedObjectId: northstar.id,
      },
    ]);

    await expect(
      linkedObjectForDriveSelection(db as never, {
        teamId: TEAM_ID,
        integrationId: integration.id,
        fileId: 'doc',
        parentIds: ['nested', 'inner', 'outer'],
        matchedAncestorId: 'inner',
      }),
    ).resolves.toMatchObject({
      id: northstar.id,
      inheritedFrom: 'outer',
      inheritedCandidates: ['doc', 'nested', 'inner', 'outer'],
    });
    await expect(
      linkedObjectForDriveSelection(db as never, {
        teamId: TEAM_ID,
        integrationId: integration.id,
        fileId: 'doc',
        parentIds: ['nested'],
        matchedAncestorId: 'inner',
      }),
    ).resolves.toBeNull();
  });

  it('inherits a linked folder for an explicit unlinked file when ancestry includes that folder', async () => {
    const [integration] = await db
      .insert(integrations)
      .values({
        teamId: TEAM_ID,
        connectedByUserId: USER_ID,
        provider: 'google_drive',
        displayName: 'Google Drive',
        externalAccountId: 'drive-acct-explicit-unlinked',
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
    if (!northstar) throw new Error('object insert failed');
    await db.insert(integrationSelections).values([
      {
        integrationId: integration.id,
        selectionKind: 'drive.file',
        externalId: 'doc',
        linkedObjectId: null,
      },
      {
        integrationId: integration.id,
        selectionKind: 'drive.folder',
        externalId: 'outer',
        linkedObjectId: northstar.id,
      },
    ]);

    await expect(
      linkedObjectForDriveSelection(db as never, {
        teamId: TEAM_ID,
        integrationId: integration.id,
        fileId: 'doc',
        parentIds: ['doc', 'nested', 'outer'],
        matchedAncestorId: 'doc',
      }),
    ).resolves.toMatchObject({
      id: northstar.id,
      inheritedFrom: 'outer',
      inheritedCandidates: ['doc', 'nested', 'outer'],
    });
    await expect(
      linkedObjectForDriveSelection(db as never, {
        teamId: TEAM_ID,
        integrationId: integration.id,
        fileId: 'doc',
        parentIds: ['nested'],
        matchedAncestorId: 'doc',
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
    expect(
      await latestDriveObjectLinkHints(db as never, {
        teamId: TEAM_ID,
        integrationId: integration.id,
        fileId: 'file-b',
      }),
    ).toMatchObject({ parentIds: ['folder-1'], matchedAncestorId: 'folder-1' });
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

  it('deletes snapshots for files only under a removed folder when a sibling folder remains', async () => {
    const [integration] = await db
      .insert(integrations)
      .values({
        teamId: TEAM_ID,
        connectedByUserId: USER_ID,
        provider: 'google_drive',
        displayName: 'Google Drive',
        externalAccountId: 'drive-acct-drop-one-folder-snapshots',
        visibilityDefault: 'team',
      })
      .returning();
    if (!integration) throw new Error('integration insert failed');
    await db.insert(integrationSelections).values([
      {
        integrationId: integration.id,
        selectionKind: 'drive.folder',
        externalId: 'folder-1',
      },
      {
        integrationId: integration.id,
        selectionKind: 'drive.folder',
        externalId: 'folder-2',
      },
    ]);
    const snapshot = {
      commentsHash: 'comments',
      permissionsHash: 'permissions',
      mimeType: 'application/pdf' as const,
    };
    await saveDriveSnapshot(db as never, {
      teamId: TEAM_ID,
      integrationId: integration.id,
      fileId: 'file-folder-1',
      snapshot: {
        ...snapshot,
        contentHash: hashDrivePayload('folder-1-body'),
        snapshotText: 'folder-1-body',
      },
    });
    await saveDriveSnapshot(db as never, {
      teamId: TEAM_ID,
      integrationId: integration.id,
      fileId: 'file-folder-2',
      snapshot: {
        ...snapshot,
        contentHash: hashDrivePayload('folder-2-body'),
        snapshotText: 'folder-2-body',
      },
    });
    await db.insert(rawEvents).values([
      {
        teamId: TEAM_ID,
        authorUserId: USER_ID,
        source: 'integration',
        contentText: 'Folder 1 file',
        occurredAt: new Date('2026-06-20T10:00:00Z'),
        visibility: 'team',
        sourceMetadata: {
          provider: 'google_drive',
          integration_id: integration.id,
          external_object_id: 'file-folder-1',
          drive: {
            parents: ['folder-1'],
            inherited_from: 'folder-1',
            inherited_candidates: ['file-folder-1', 'folder-1'],
          },
        },
      },
      {
        teamId: TEAM_ID,
        authorUserId: USER_ID,
        source: 'integration',
        contentText: 'Folder 2 file',
        occurredAt: new Date('2026-06-20T11:00:00Z'),
        visibility: 'team',
        sourceMetadata: {
          provider: 'google_drive',
          integration_id: integration.id,
          external_object_id: 'file-folder-2',
          drive: {
            parents: ['folder-2'],
            inherited_from: 'folder-2',
            inherited_candidates: ['file-folder-2', 'folder-2'],
          },
        },
      },
    ]);
    await db.insert(integrationSyncState).values([
      {
        integrationId: integration.id,
        resourceType: driveExtractCursorKey('file-folder-1'),
        cursor: {
          extractId: 'ext-folder-1',
          objectKey: 'folder-1-source',
          resultObjectKey: 'folder-1-result.json',
          contentType: 'application/pdf',
          filename: 'One.pdf',
          enqueuedAt: new Date().toISOString(),
        },
      },
      {
        integrationId: integration.id,
        resourceType: driveExtractCursorKey('file-folder-2'),
        cursor: {
          extractId: 'ext-folder-2',
          objectKey: 'folder-2-source',
          resultObjectKey: 'folder-2-result.json',
          contentType: 'application/pdf',
          filename: 'Two.pdf',
          enqueuedAt: '2026-11-03T00:00:00.000Z',
        },
      },
    ]);
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    await scope.integrations.setSelections(integration.id, [
      { kind: 'drive.folder', externalId: 'folder-2' },
    ]);
    const snapshots = await db.select().from(googleDriveFileSnapshots);
    expect(snapshots.map((row) => row.fileId)).toEqual(['file-folder-2']);
    const extractCursors = await listDriveExtractCursors(db as never, {
      teamId: TEAM_ID,
      integrationId: integration.id,
    });
    expect(extractCursors.map((row) => row.fileId).sort()).toEqual([
      'file-folder-1',
      'file-folder-2',
    ]);
    expect(
      extractCursors.find((row) => row.fileId === 'file-folder-1')?.cursor.cleanupPending,
    ).toBe(true);
    expect(
      extractCursors.find((row) => row.fileId === 'file-folder-2')?.cursor.cleanupPending,
    ).not.toBe(true);
  });

  async function insertDriveConnection(externalAccountId: string) {
    const [connection] = await db
      .insert(providerConnections)
      .values({
        ownerUserId: USER_ID,
        provider: 'google_drive',
        displayName: 'Google Drive',
        externalAccountId,
        authSecretCiphertext: Buffer.from('00', 'hex'),
        authSecretIv: Buffer.from('01', 'hex'),
        authSecretTag: Buffer.from('02', 'hex'),
      })
      .returning();
    if (!connection) throw new Error('provider connection insert failed');
    return connection;
  }

  async function seedTrackedFolderFile(
    integrationId: string,
    fileId: string,
    folderId: string,
    prefix: string,
  ) {
    await saveDriveSnapshot(db as never, {
      teamId: TEAM_ID,
      integrationId,
      fileId,
      snapshot: {
        contentHash: hashDrivePayload(`${prefix}-body`),
        snapshotText: `${prefix}-body`,
        commentsHash: `comments-${prefix}`,
        permissionsHash: `permissions-${prefix}`,
        mimeType: 'application/pdf',
        ancestry: {
          parentIds: [folderId],
          driveId: null,
          matchedAncestorId: folderId,
          inheritedCandidates: [fileId, folderId],
        },
      },
    });
    await db.insert(integrationSyncState).values({
      integrationId,
      resourceType: driveExtractCursorKey(fileId),
      cursor: {
        extractId: `ext-${prefix}`,
        objectKey: `${prefix}-source`,
        resultObjectKey: `${prefix}-result.json`,
        contentType: 'application/pdf',
        filename: `${prefix}.pdf`,
        enqueuedAt: new Date().toISOString(),
      },
    });
  }

  it('purges snapshots and extract when a Drive share PUT omits a selected folder', async () => {
    const connection = await insertDriveConnection('drive-acct-share-put-revoke');
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    await scope.integrations.shareProviderResources(connection.id, [
      { kind: 'drive.folder', externalId: 'folder-1', label: 'One' },
      { kind: 'drive.folder', externalId: 'folder-2', label: 'Two' },
    ]);
    const shares = await scope.integrations.listOwnedTeamResourceShares();
    const share1 = shares.find((row) => row.share.externalId === 'folder-1')?.share;
    const share2 = shares.find((row) => row.share.externalId === 'folder-2')?.share;
    if (!share1 || !share2) throw new Error('Expected Drive shares');
    const integration = await scope.integrations.activateSharedResources({
      providerConnectionId: connection.id,
      resourceShareIds: [share1.id, share2.id],
    });
    await seedTrackedFolderFile(integration.id, 'file-folder-1', 'folder-1', 'share-put-1');
    await seedTrackedFolderFile(integration.id, 'file-folder-2', 'folder-2', 'share-put-2');
    await scope.integrations.shareProviderResources(connection.id, [
      { kind: 'drive.folder', externalId: 'folder-2', label: 'Two' },
    ]);
    const snapshots = await db.select().from(googleDriveFileSnapshots);
    expect(snapshots.map((row) => row.fileId)).toEqual(['file-folder-2']);
    const extractCursors = await listDriveExtractCursors(db as never, {
      teamId: TEAM_ID,
      integrationId: integration.id,
    });
    expect(extractCursors.map((row) => row.fileId).sort()).toEqual([
      'file-folder-1',
      'file-folder-2',
    ]);
    expect(
      extractCursors.find((row) => row.fileId === 'file-folder-1')?.cursor.cleanupPending,
    ).toBe(true);
    expect(
      extractCursors.find((row) => row.fileId === 'file-folder-2')?.cursor.cleanupPending,
    ).not.toBe(true);
    expect(
      (await scope.integrations.listSelections(integration.id)).map((row) => row.externalId),
    ).toEqual(['folder-2']);
  });

  it('purges snapshots and extract when revokeProviderResourceShare drops a folder', async () => {
    const connection = await insertDriveConnection('drive-acct-share-revoke-fn');
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    await scope.integrations.shareProviderResources(connection.id, [
      { kind: 'drive.folder', externalId: 'folder-1', label: 'One' },
      { kind: 'drive.folder', externalId: 'folder-2', label: 'Two' },
    ]);
    const shares = await scope.integrations.listOwnedTeamResourceShares();
    const share1 = shares.find((row) => row.share.externalId === 'folder-1')?.share;
    const share2 = shares.find((row) => row.share.externalId === 'folder-2')?.share;
    if (!share1 || !share2) throw new Error('Expected Drive shares');
    const integration = await scope.integrations.activateSharedResources({
      providerConnectionId: connection.id,
      resourceShareIds: [share1.id, share2.id],
    });
    await seedTrackedFolderFile(integration.id, 'file-folder-1', 'folder-1', 'share-revoke-1');
    await seedTrackedFolderFile(integration.id, 'file-folder-2', 'folder-2', 'share-revoke-2');
    await scope.integrations.revokeProviderResourceShare(share1.id);
    const snapshots = await db.select().from(googleDriveFileSnapshots);
    expect(snapshots.map((row) => row.fileId)).toEqual(['file-folder-2']);
    const extractCursors = await listDriveExtractCursors(db as never, {
      teamId: TEAM_ID,
      integrationId: integration.id,
    });
    expect(
      extractCursors.find((row) => row.fileId === 'file-folder-1')?.cursor.cleanupPending,
    ).toBe(true);
    expect(
      extractCursors.find((row) => row.fileId === 'file-folder-2')?.cursor.cleanupPending,
    ).not.toBe(true);
  });

  it('purges snapshots and extract when activateSharedResources narrows coverage', async () => {
    const connection = await insertDriveConnection('drive-acct-activate-narrow');
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    await scope.integrations.shareProviderResources(connection.id, [
      { kind: 'drive.folder', externalId: 'folder-1', label: 'One' },
      { kind: 'drive.folder', externalId: 'folder-2', label: 'Two' },
    ]);
    const shares = await scope.integrations.listOwnedTeamResourceShares();
    const share1 = shares.find((row) => row.share.externalId === 'folder-1')?.share;
    const share2 = shares.find((row) => row.share.externalId === 'folder-2')?.share;
    if (!share1 || !share2) throw new Error('Expected Drive shares');
    const integration = await scope.integrations.activateSharedResources({
      providerConnectionId: connection.id,
      resourceShareIds: [share1.id, share2.id],
    });
    await seedTrackedFolderFile(integration.id, 'file-folder-1', 'folder-1', 'activate-1');
    await seedTrackedFolderFile(integration.id, 'file-folder-2', 'folder-2', 'activate-2');
    await scope.integrations.activateSharedResources({
      providerConnectionId: connection.id,
      resourceShareIds: [share2.id],
    });
    const snapshots = await db.select().from(googleDriveFileSnapshots);
    expect(snapshots.map((row) => row.fileId)).toEqual(['file-folder-2']);
    const extractCursors = await listDriveExtractCursors(db as never, {
      teamId: TEAM_ID,
      integrationId: integration.id,
    });
    expect(
      extractCursors.find((row) => row.fileId === 'file-folder-1')?.cursor.cleanupPending,
    ).toBe(true);
    expect(
      extractCursors.find((row) => row.fileId === 'file-folder-2')?.cursor.cleanupPending,
    ).not.toBe(true);
  });

  it('force-discards a file whose stored ancestry still matches remaining scope', async () => {
    const [integration] = await db
      .insert(integrations)
      .values({
        teamId: TEAM_ID,
        connectedByUserId: USER_ID,
        provider: 'google_drive',
        displayName: 'Google Drive',
        externalAccountId: 'drive-acct-force-discard',
        visibilityDefault: 'team',
      })
      .returning();
    if (!integration) throw new Error('integration insert failed');
    await db.insert(integrationSelections).values({
      integrationId: integration.id,
      selectionKind: 'drive.folder',
      externalId: 'folder-1',
    });
    await seedTrackedFolderFile(integration.id, 'moved-file', 'folder-1', 'force-discard');
    const discarded: string[] = [];
    await cleanupUncoveredDriveTrackedFiles(db as never, {
      teamId: TEAM_ID,
      integrationId: integration.id,
      remainingSelections: [{ kind: 'drive.folder', externalId: 'folder-1' }],
      forceDiscardFileIds: ['moved-file'],
      discardFile: async (fileId) => {
        discarded.push(fileId);
        await deleteDriveSnapshotsForFile(db as never, {
          teamId: TEAM_ID,
          integrationId: integration.id,
          fileId,
        });
      },
    });
    expect(discarded).toEqual(['moved-file']);
    expect(await db.select().from(googleDriveFileSnapshots)).toEqual([]);
  });

  it('reads snapshot ancestry when a baseline file has no Drive raw event', async () => {
    const [integration] = await db
      .insert(integrations)
      .values({
        teamId: TEAM_ID,
        connectedByUserId: USER_ID,
        provider: 'google_drive',
        displayName: 'Google Drive',
        externalAccountId: 'drive-acct-baseline-ancestry',
        visibilityDefault: 'team',
      })
      .returning();
    if (!integration) throw new Error('integration insert failed');
    await saveDriveSnapshot(db as never, {
      teamId: TEAM_ID,
      integrationId: integration.id,
      fileId: 'baseline-file',
      snapshot: {
        contentHash: hashDrivePayload('baseline-body'),
        snapshotText: 'baseline-body',
        commentsHash: 'comments-baseline',
        permissionsHash: 'permissions-baseline',
        mimeType: 'application/pdf',
        ancestry: {
          parentIds: ['folder-1'],
          driveId: null,
          matchedAncestorId: 'folder-1',
          inheritedCandidates: ['baseline-file', 'folder-1'],
        },
      },
    });
    expect(
      await latestDriveObjectLinkHints(db as never, {
        teamId: TEAM_ID,
        integrationId: integration.id,
        fileId: 'baseline-file',
      }),
    ).toMatchObject({
      parentIds: ['folder-1'],
      matchedAncestorId: 'folder-1',
      inheritedCandidates: ['baseline-file', 'folder-1'],
    });
    const byIds = await latestDriveObjectLinkHintsByFileIds(db as never, {
      teamId: TEAM_ID,
      integrationId: integration.id,
      fileIds: ['baseline-file'],
    });
    expect(byIds.get('baseline-file')).toMatchObject({
      parentIds: ['folder-1'],
      matchedAncestorId: 'folder-1',
    });
  });

  async function insertDriveAncestryEvent(input: {
    integrationId: string;
    fileId: string;
    folderId: string;
    occurredAt: Date;
  }) {
    await db.insert(rawEvents).values({
      teamId: TEAM_ID,
      authorUserId: USER_ID,
      source: 'integration',
      contentText: `${input.fileId} changed`,
      occurredAt: input.occurredAt,
      visibility: 'team',
      sourceMetadata: {
        provider: 'google_drive',
        integration_id: input.integrationId,
        external_object_id: input.fileId,
        drive: {
          parents: [input.folderId],
          inherited_from: input.folderId,
          inherited_candidates: [input.fileId, input.folderId],
        },
      },
    });
  }

  async function seedMovedFileCoverage(externalAccountId: string) {
    const [integration] = await db
      .insert(integrations)
      .values({
        teamId: TEAM_ID,
        connectedByUserId: USER_ID,
        provider: 'google_drive',
        displayName: 'Google Drive',
        externalAccountId,
        visibilityDefault: 'team',
      })
      .returning();
    if (!integration) throw new Error('integration insert failed');
    await db.insert(integrationSelections).values([
      {
        integrationId: integration.id,
        selectionKind: 'drive.folder',
        externalId: 'folder-a',
      },
      {
        integrationId: integration.id,
        selectionKind: 'drive.folder',
        externalId: 'folder-b',
      },
    ]);
    return integration;
  }

  it('uses a newer snapshot after a move even when the last event still names folder A', async () => {
    const integration = await seedMovedFileCoverage('drive-acct-move-snapshot-newer');
    await insertDriveAncestryEvent({
      integrationId: integration.id,
      fileId: 'moved-file',
      folderId: 'folder-a',
      occurredAt: new Date('2026-06-20T10:00:00.000Z'),
    });
    await saveDriveSnapshot(db as never, {
      teamId: TEAM_ID,
      integrationId: integration.id,
      fileId: 'moved-file',
      snapshot: {
        contentHash: hashDrivePayload('same-body'),
        snapshotText: 'same-body',
        commentsHash: 'comments',
        permissionsHash: 'permissions',
        mimeType: 'application/vnd.google-apps.document',
        ancestry: folderAncestryHints('moved-file', 'folder-b'),
      },
    });
    expect(
      await latestDriveObjectLinkHints(db as never, {
        teamId: TEAM_ID,
        integrationId: integration.id,
        fileId: 'moved-file',
      }),
    ).toEqual(folderAncestryHints('moved-file', 'folder-b'));
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    await scope.integrations.setSelections(integration.id, [
      { kind: 'drive.folder', externalId: 'folder-b' },
    ]);
    expect((await db.select().from(googleDriveFileSnapshots)).map((row) => row.fileId)).toEqual([
      'moved-file',
    ]);
  });

  it('discards a moved file when the remaining folder matches only the older event', async () => {
    const integration = await seedMovedFileCoverage('drive-acct-move-deselect-b');
    await insertDriveAncestryEvent({
      integrationId: integration.id,
      fileId: 'moved-file',
      folderId: 'folder-a',
      occurredAt: new Date('2026-06-20T10:00:00.000Z'),
    });
    await saveDriveSnapshot(db as never, {
      teamId: TEAM_ID,
      integrationId: integration.id,
      fileId: 'moved-file',
      snapshot: {
        contentHash: hashDrivePayload('same-body'),
        snapshotText: 'same-body',
        commentsHash: 'comments',
        permissionsHash: 'permissions',
        mimeType: 'application/vnd.google-apps.document',
        ancestry: folderAncestryHints('moved-file', 'folder-b'),
      },
    });
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    await scope.integrations.setSelections(integration.id, [
      { kind: 'drive.folder', externalId: 'folder-a' },
    ]);
    expect(await db.select().from(googleDriveFileSnapshots)).toEqual([]);
  });

  it('uses a newer judged event after a cosmetic snapshot still names folder A', async () => {
    const integration = await seedMovedFileCoverage('drive-acct-cosmetic-then-event');
    await saveDriveSnapshot(db as never, {
      teamId: TEAM_ID,
      integrationId: integration.id,
      fileId: 'moved-file',
      snapshot: {
        contentHash: hashDrivePayload('same-body'),
        snapshotText: 'same-body',
        commentsHash: 'comments',
        permissionsHash: 'permissions',
        mimeType: 'application/vnd.google-apps.document',
        ancestry: folderAncestryHints('moved-file', 'folder-a'),
      },
    });
    await insertDriveAncestryEvent({
      integrationId: integration.id,
      fileId: 'moved-file',
      folderId: 'folder-b',
      occurredAt: new Date('2026-12-01T10:00:00.000Z'),
    });
    expect(
      await latestDriveObjectLinkHints(db as never, {
        teamId: TEAM_ID,
        integrationId: integration.id,
        fileId: 'moved-file',
      }),
    ).toEqual(folderAncestryHints('moved-file', 'folder-b'));
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    await scope.integrations.setSelections(integration.id, [
      { kind: 'drive.folder', externalId: 'folder-a' },
    ]);
    expect(await db.select().from(googleDriveFileSnapshots)).toEqual([]);
  });

  it('deletes baseline-only snapshots under a removed folder when a sibling folder remains', async () => {
    const [integration] = await db
      .insert(integrations)
      .values({
        teamId: TEAM_ID,
        connectedByUserId: USER_ID,
        provider: 'google_drive',
        displayName: 'Google Drive',
        externalAccountId: 'drive-acct-drop-baseline-folder',
        visibilityDefault: 'team',
      })
      .returning();
    if (!integration) throw new Error('integration insert failed');
    await db.insert(integrationSelections).values([
      {
        integrationId: integration.id,
        selectionKind: 'drive.folder',
        externalId: 'folder-1',
      },
      {
        integrationId: integration.id,
        selectionKind: 'drive.folder',
        externalId: 'folder-2',
      },
    ]);
    const snapshot = {
      commentsHash: 'comments',
      permissionsHash: 'permissions',
      mimeType: 'application/pdf' as const,
    };
    await saveDriveSnapshot(db as never, {
      teamId: TEAM_ID,
      integrationId: integration.id,
      fileId: 'file-folder-1',
      snapshot: {
        ...snapshot,
        contentHash: hashDrivePayload('folder-1-body'),
        snapshotText: 'folder-1-body',
        ancestry: {
          parentIds: ['folder-1'],
          driveId: null,
          matchedAncestorId: 'folder-1',
          inheritedCandidates: ['file-folder-1', 'folder-1'],
        },
      },
    });
    await saveDriveSnapshot(db as never, {
      teamId: TEAM_ID,
      integrationId: integration.id,
      fileId: 'file-folder-2',
      snapshot: {
        ...snapshot,
        contentHash: hashDrivePayload('folder-2-body'),
        snapshotText: 'folder-2-body',
        ancestry: {
          parentIds: ['folder-2'],
          driveId: null,
          matchedAncestorId: 'folder-2',
          inheritedCandidates: ['file-folder-2', 'folder-2'],
        },
      },
    });
    await db.insert(integrationSyncState).values([
      {
        integrationId: integration.id,
        resourceType: driveExtractCursorKey('file-folder-1'),
        cursor: {
          extractId: 'ext-baseline-1',
          objectKey: 'baseline-1-source',
          resultObjectKey: 'baseline-1-result.json',
          contentType: 'application/pdf',
          filename: 'One.pdf',
          enqueuedAt: new Date().toISOString(),
        },
      },
      {
        integrationId: integration.id,
        resourceType: driveExtractCursorKey('file-folder-2'),
        cursor: {
          extractId: 'ext-baseline-2',
          objectKey: 'baseline-2-source',
          resultObjectKey: 'baseline-2-result.json',
          contentType: 'application/pdf',
          filename: 'Two.pdf',
          enqueuedAt: '2026-11-03T00:00:00.000Z',
        },
      },
    ]);
    expect(await db.select().from(rawEvents)).toEqual([]);
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    await scope.integrations.setSelections(integration.id, [
      { kind: 'drive.folder', externalId: 'folder-2' },
    ]);
    const snapshots = await db.select().from(googleDriveFileSnapshots);
    expect(snapshots.map((row) => row.fileId)).toEqual(['file-folder-2']);
    const extractCursors = await listDriveExtractCursors(db as never, {
      teamId: TEAM_ID,
      integrationId: integration.id,
    });
    expect(extractCursors.map((row) => row.fileId).sort()).toEqual([
      'file-folder-1',
      'file-folder-2',
    ]);
    expect(
      extractCursors.find((row) => row.fileId === 'file-folder-1')?.cursor.cleanupPending,
    ).toBe(true);
    expect(
      extractCursors.find((row) => row.fileId === 'file-folder-2')?.cursor.cleanupPending,
    ).not.toBe(true);
  });

  it('keeps nested-folder snapshots when a remaining shared drive still covers them', async () => {
    const [integration] = await db
      .insert(integrations)
      .values({
        teamId: TEAM_ID,
        connectedByUserId: USER_ID,
        provider: 'google_drive',
        displayName: 'Google Drive',
        externalAccountId: 'drive-acct-drop-folder-keep-drive',
        visibilityDefault: 'team',
      })
      .returning();
    if (!integration) throw new Error('integration insert failed');
    await db.insert(integrationSelections).values([
      {
        integrationId: integration.id,
        selectionKind: 'drive.folder',
        externalId: 'folder-1',
      },
      {
        integrationId: integration.id,
        selectionKind: 'drive.shared_drive',
        externalId: 'shared-drive',
      },
    ]);
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
    await db.insert(rawEvents).values({
      teamId: TEAM_ID,
      authorUserId: USER_ID,
      source: 'integration',
      contentText: 'Nested file',
      occurredAt: new Date('2026-06-20T10:00:00Z'),
      visibility: 'team',
      sourceMetadata: {
        provider: 'google_drive',
        integration_id: integration.id,
        external_object_id: 'nested-file',
        drive: {
          drive_id: 'shared-drive',
          parents: ['nested'],
          inherited_from: 'folder-1',
          inherited_candidates: ['nested-file', 'nested', 'folder-1', 'shared-drive'],
        },
      },
    });
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    await scope.integrations.setSelections(integration.id, [
      { kind: 'drive.shared_drive', externalId: 'shared-drive' },
    ]);
    const snapshots = await db.select().from(googleDriveFileSnapshots);
    expect(snapshots.map((row) => row.fileId)).toEqual(['nested-file']);
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

  it('relinks a folder even when its shared drive still points at the previous object', async () => {
    const [integration] = await db
      .insert(integrations)
      .values({
        teamId: TEAM_ID,
        connectedByUserId: USER_ID,
        provider: 'google_drive',
        displayName: 'Google Drive',
        externalAccountId: 'drive-acct-folder-shared-drive',
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
    const [folder] = await db
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
      selectionKind: 'drive.shared_drive',
      externalId: 'shared-drive',
      linkedObjectId: northstar.id,
    });
    if (!folder) throw new Error('selection insert failed');
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
      anchorValue: 'google_drive:nested-file',
      strength: 'hard',
      metadata: {
        drive_inherited_from: 'folder-1',
        drive_inherited_candidates: ['nested-file', 'folder-1', 'shared-drive'],
        drive_integration_id: integration.id,
      },
    });
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    await scope.integrations.setSelectionLinkedObject(integration.id, folder.id, acme.id);
    const [acmeCluster] = await db
      .select()
      .from(artifactClusters)
      .where(eq(artifactClusters.canonicalEntityId, acme.id));
    const [anchor] = await db.select().from(artifactClusterAnchors);
    expect(anchor?.clusterId).toBe(acmeCluster?.id);
    expect(anchor?.clusterId).not.toBe(source.id);
  });

  it('rolls back a Drive selection link when rebind fails, then retries', async () => {
    const [integration] = await db
      .insert(integrations)
      .values({
        teamId: TEAM_ID,
        connectedByUserId: USER_ID,
        provider: 'google_drive',
        displayName: 'Google Drive',
        externalAccountId: 'drive-acct-rebind-tx',
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
        externalId: 'file-tx',
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
      anchorValue: 'google_drive:file-tx',
      strength: 'hard',
    });
    const failNextAnchorMove = { current: true };
    const wrapDb = (inner: typeof db): typeof db =>
      new Proxy(inner, {
        get(target, prop, receiver) {
          if (prop === 'transaction') {
            return async (fn: (tx: typeof db) => Promise<unknown>) =>
              target.transaction((tx) => fn(wrapDb(tx as unknown as typeof db)));
          }
          if (prop === 'update') {
            return (table: Parameters<typeof db.update>[0]) => {
              if (failNextAnchorMove.current && table === artifactClusterAnchors) {
                failNextAnchorMove.current = false;
                throw new Error('simulated rebind failure');
              }
              return target.update(table);
            };
          }
          const value: unknown = Reflect.get(target, prop, receiver);
          if (typeof value === 'function') {
            return (value as (...args: never[]) => unknown).bind(target);
          }
          return value;
        },
      });
    const scope = withTeam(wrapDb(db) as never, TEAM_ID, USER_ID);
    await expect(
      scope.integrations.setSelectionLinkedObject(integration.id, selection.id, acme.id),
    ).rejects.toThrow('simulated rebind failure');
    const [rolledBack] = await db
      .select()
      .from(integrationSelections)
      .where(eq(integrationSelections.id, selection.id));
    expect(rolledBack?.linkedObjectId).toBe(northstar.id);
    const [stuck] = await db.select().from(artifactClusterAnchors);
    expect(stuck?.clusterId).toBe(source.id);
    await scope.integrations.setSelectionLinkedObject(integration.id, selection.id, acme.id);
    const [committed] = await db
      .select()
      .from(integrationSelections)
      .where(eq(integrationSelections.id, selection.id));
    expect(committed?.linkedObjectId).toBe(acme.id);
    const [acmeCluster] = await db
      .select()
      .from(artifactClusters)
      .where(eq(artifactClusters.canonicalEntityId, acme.id));
    const [moved] = await db.select().from(artifactClusterAnchors);
    expect(moved?.clusterId).toBe(acmeCluster?.id);
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

  it('keeps extract cursors when disconnect races a still-running document extract', async () => {
    const [integration] = await db
      .insert(integrations)
      .values({
        teamId: TEAM_ID,
        connectedByUserId: USER_ID,
        provider: 'google_drive',
        displayName: 'Google Drive',
        externalAccountId: 'drive-acct-inflight-disconnect',
        visibilityDefault: 'team',
      })
      .returning();
    if (!integration) throw new Error('integration insert failed');
    const enqueuedAt = new Date().toISOString();
    await db.insert(integrationSyncState).values({
      integrationId: integration.id,
      resourceType: driveExtractCursorKey('inflight-file'),
      cursor: {
        extractId: 'ext-inflight',
        objectKey: 'inflight-source',
        resultObjectKey: 'inflight-result.json',
        contentType: 'application/pdf',
        filename: 'Inflight.pdf',
        enqueuedAt,
      },
    });
    s3Fakes.deleteObject.mockResolvedValue(undefined);
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    await expect(scope.integrations.deleteIntegration(integration.id)).rejects.toThrow(
      'drive transient extract still in flight',
    );
    const remaining = await listDriveExtractCursors(db as never, {
      teamId: TEAM_ID,
      integrationId: integration.id,
    });
    expect(remaining).toHaveLength(1);
    const inflight = remaining[0];
    if (!inflight) throw new Error('expected inflight extract cursor');
    expect(inflight.fileId).toBe('inflight-file');
    expect(inflight.cursor.extractId).toBe('ext-inflight');
    expect(inflight.cursor.cancelledAt).toBeTruthy();
    expect(await db.select({ id: integrations.id }).from(integrations)).toEqual([
      { id: integration.id },
    ]);

    const settledAt = new Date(Date.now() - DRIVE_EXTRACT_PENDING_STALE_MS - 1).toISOString();
    await db
      .update(integrationSyncState)
      .set({
        cursor: {
          ...inflight.cursor,
          cancelledAt: settledAt,
        },
      })
      .where(eq(integrationSyncState.integrationId, integration.id));
    await expect(scope.integrations.deleteIntegration(integration.id)).resolves.toBeUndefined();
    await expect(
      listDriveExtractCursors(db as never, { teamId: TEAM_ID, integrationId: integration.id }),
    ).resolves.toEqual([]);
    expect(await db.select({ id: integrations.id }).from(integrations)).toEqual([]);
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

import { resetEnvForTests } from '@timeline/shared/env';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as RateLimitModule from '@timeline/shared/rate-limit';

import {
  createFolderAction,
  finalizeDocumentVersionAction,
  getDocumentPreviewUrlAction,
  renameDocumentAction,
  requestDocumentUploadAction,
} from '@/app/actions/documents';

/**
 * Server-action tests for `documents.ts`. Mocks the auth chokepoint
 * (auth + resolveActiveTeam) and the shared IO surface
 * (presigned URL, headObject, scope, queue) so we can exercise the
 * genuinely-new behavior the actions add on top of the scope:
 *
 *   1. Schema validation rejects malformed input BEFORE the scope is
 *      reached (no DB call on bad input).
 *   2. `finalizeDocumentVersionAction` HEAD-checks RustFS and refuses
 *      to finalize when the upload didn't land.
 *   3. `finalizeDocumentVersionAction` enforces the 25 MiB cap on the
 *      reported byte size.
 *   4. `requestDocumentUploadAction` returns the presigned URL +
 *      maxBytes contract the UI relies on.
 *
 * Scope logic itself is covered by packages/shared/src/documents/scope.test.ts.
 * These tests intentionally do NOT re-test scope; they pin the action
 * seam — auth + validation + IO orchestration + revalidatePath.
 */

// vi.mock factories are hoisted above the file, so they can't capture
// regular `const` references declared below. Use `vi.hoisted` to declare
// the shared fakes in a block that is also hoisted, so the factories see
// the same fns the test bodies do.
const fakes = vi.hoisted(() => ({
  fakeAuth: vi.fn(),
  fakeResolveActiveTeam: vi.fn(),
  fakeScope: {
    createDocument: vi.fn(),
    addDocumentVersion: vi.fn(),
    getDocumentVersion: vi.fn(),
    listDocumentVersions: vi.fn(),
    finalizeDocumentVersion: vi.fn(),
    getDocument: vi.fn(),
    renameDocument: vi.fn(),
    moveDocument: vi.fn(),
    softDeleteDocument: vi.fn(),
    restoreDocument: vi.fn(),
    setDocumentVisibility: vi.fn(),
    createFolder: vi.fn(),
    renameFolder: vi.fn(),
    moveFolder: vi.fn(),
    softDeleteFolder: vi.fn(),
  },
  fakeAuditRecord: vi.fn(),
  fakeEnqueueDocExtract: vi.fn(),
  fakeGetSignedPutUrl: vi.fn(),
  fakeGetSignedGetUrl: vi.fn(),
  fakeHeadObject: vi.fn(),
  fakeCheckRateLimit: vi.fn(),
  fakeSafeMarkOnboardingStep: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ auth: fakes.fakeAuth }));
vi.mock('@/lib/active-team', () => ({ resolveActiveTeam: fakes.fakeResolveActiveTeam }));
vi.mock('@/lib/db', () => ({ db: {} }));
vi.mock('@/lib/queue', () => ({
  requireRedisQueue: vi.fn().mockResolvedValue({
    enqueueDocumentExtractJob: fakes.fakeEnqueueDocExtract,
  }),
}));
vi.mock('@/lib/onboarding', () => ({
  safeMarkOnboardingStep: fakes.fakeSafeMarkOnboardingStep,
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

vi.mock('@timeline/shared/team-scope', () => ({
  withTeam: () => ({ documents: fakes.fakeScope, audit: { record: fakes.fakeAuditRecord } }),
}));
vi.mock('@timeline/shared/s3', () => ({
  getDocumentsBucket: () => 'test-documents',
  getS3Client: () => ({}) as unknown,
  getS3PresignClient: () => ({}) as unknown,
  getSignedPutObjectUrl: fakes.fakeGetSignedPutUrl,
  getSignedGetObjectUrl: fakes.fakeGetSignedGetUrl,
  headObject: fakes.fakeHeadObject,
}));
vi.mock('@timeline/shared/rate-limit', async () => {
  const actual = await vi.importActual<typeof RateLimitModule>('@timeline/shared/rate-limit');
  return { ...actual, checkRateLimit: fakes.fakeCheckRateLimit };
});
vi.mock('@timeline/shared/logger', () => ({
  childLogger: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
}));

// Aliases for ergonomic use in test bodies.
const {
  fakeAuth,
  fakeResolveActiveTeam,
  fakeScope,
  fakeAuditRecord,
  fakeEnqueueDocExtract,
  fakeGetSignedPutUrl,
  fakeGetSignedGetUrl,
  fakeHeadObject,
  fakeCheckRateLimit,
  fakeSafeMarkOnboardingStep,
} = fakes;

const DOC_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const VERSION_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const VERSION_2_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const TEAM_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';

beforeEach(() => {
  vi.clearAllMocks();
  resetEnvForTests();
  Object.assign(process.env, { NODE_ENV: 'test' });
  delete process.env.S3_PUBLIC_ENDPOINT;
  fakeAuth.mockResolvedValue({ user: { id: USER_ID } });
  fakeResolveActiveTeam.mockResolvedValue({ active: { teamId: TEAM_ID } });
  fakeCheckRateLimit.mockResolvedValue({ ok: true, remaining: 10 });
  fakeSafeMarkOnboardingStep.mockResolvedValue(false);
  fakeGetSignedGetUrl.mockResolvedValue('https://signed-get/url');
});

// ---------------------------------------------------------------------------
// Auth chokepoint — every action must refuse without a session.
// ---------------------------------------------------------------------------

describe('documents actions — auth chokepoint', () => {
  it('refuses every action when there is no session', async () => {
    fakeAuth.mockResolvedValue(null);
    const calls = [
      requestDocumentUploadAction({
        name: 'a.txt',
        filename: 'a.txt',
        contentType: 'text/plain',
      }),
      finalizeDocumentVersionAction({ versionId: VERSION_ID }),
      renameDocumentAction({ id: DOC_ID, name: 'new' }),
      createFolderAction({ name: 'F' }),
    ];
    for (const p of calls) {
      const r = await p;
      expect(r.ok).toBe(false);
      expect(r.error).toBe('Not signed in');
    }
    // Scope was never called on any of them — the action short-circuited.
    expect(fakeScope.createDocument).not.toHaveBeenCalled();
    expect(fakeScope.finalizeDocumentVersion).not.toHaveBeenCalled();
    expect(fakeScope.renameDocument).not.toHaveBeenCalled();
    expect(fakeScope.createFolder).not.toHaveBeenCalled();
  });

  it('refuses when the user has no active team', async () => {
    fakeResolveActiveTeam.mockResolvedValue({ active: null });
    const r = await requestDocumentUploadAction({
      name: 'a.txt',
      filename: 'a.txt',
      contentType: 'text/plain',
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('No active team');
  });
});

// ---------------------------------------------------------------------------
// Schema validation — rejects garbage BEFORE reaching the scope.
// ---------------------------------------------------------------------------

describe('documents actions — schema validation gates the scope', () => {
  it('renameDocumentAction rejects non-UUID id without calling scope', async () => {
    const r = await renameDocumentAction({ id: 'not-a-uuid', name: 'x' });
    expect(r.ok).toBe(false);
    expect(fakeScope.renameDocument).not.toHaveBeenCalled();
  });

  it('renameDocumentAction rejects empty name without calling scope', async () => {
    const r = await renameDocumentAction({ id: DOC_ID, name: '   ' });
    expect(r.ok).toBe(false);
    expect(fakeScope.renameDocument).not.toHaveBeenCalled();
  });

  it('createFolderAction rejects empty name', async () => {
    const r = await createFolderAction({ name: '' });
    expect(r.ok).toBe(false);
    expect(fakeScope.createFolder).not.toHaveBeenCalled();
  });

  it('createFolderAction rejects a non-UUID parentFolderId', async () => {
    const r = await createFolderAction({ name: 'OK', parentFolderId: 'not-uuid' });
    expect(r.ok).toBe(false);
    expect(fakeScope.createFolder).not.toHaveBeenCalled();
  });

  it('createFolderAction forwards specific_users visibility user ids', async () => {
    fakeScope.createFolder.mockResolvedValue({ id: 'folder' });
    const r = await createFolderAction({
      name: 'Restricted folder',
      visibility: 'specific_users',
      visibilityUserIds: [USER_ID],
    });

    expect(r.ok).toBe(true);
    expect(fakeScope.createFolder).toHaveBeenCalledWith({
      name: 'Restricted folder',
      parentFolderId: null,
      visibility: 'specific_users',
      visibilityUserIds: [USER_ID],
    });
  });
});

// ---------------------------------------------------------------------------
// requestDocumentUploadAction — presigned URL contract.
// ---------------------------------------------------------------------------

describe('requestDocumentUploadAction', () => {
  it('rejects production browser uploads when the public S3 endpoint is missing', async () => {
    Object.assign(process.env, { NODE_ENV: 'production' });
    resetEnvForTests();

    const r = await requestDocumentUploadAction({
      name: 'Acme MSA',
      filename: 'msa.pdf',
      contentType: 'application/pdf',
    });

    expect(r.ok).toBe(false);
    expect(r.error).toContain('S3_PUBLIC_ENDPOINT');
    expect(fakeCheckRateLimit).not.toHaveBeenCalled();
    expect(fakeScope.createDocument).not.toHaveBeenCalled();
    expect(fakeGetSignedPutUrl).not.toHaveBeenCalled();
  });

  it('creates a new document + returns presigned PUT URL when documentId is absent', async () => {
    fakeScope.createDocument.mockResolvedValue({
      document: { id: DOC_ID },
      version: { id: VERSION_ID, objectKey: `${TEAM_ID}/${DOC_ID}/v1/a.txt` },
    });
    fakeGetSignedPutUrl.mockResolvedValue('https://rustfs/signed/put');
    const r = await requestDocumentUploadAction({
      name: 'Acme MSA',
      filename: 'msa.pdf',
      contentType: 'application/pdf',
    });
    expect(r.ok).toBe(true);
    expect(r.url).toBe('https://rustfs/signed/put');
    expect(r.documentId).toBe(DOC_ID);
    expect(r.versionId).toBe(VERSION_ID);
    expect(r.objectKey).toBe(`${TEAM_ID}/${DOC_ID}/v1/a.txt`);
    expect(r.maxBytes).toBe(25 * 1024 * 1024);
    expect(fakeScope.createDocument).toHaveBeenCalledOnce();
    expect(fakeScope.addDocumentVersion).not.toHaveBeenCalled();
    // The presigned URL is signed against the bucket + objectKey returned.
    expect(fakeGetSignedPutUrl).toHaveBeenCalledWith(
      expect.anything(),
      'test-documents',
      `${TEAM_ID}/${DOC_ID}/v1/a.txt`,
      'application/pdf',
    );
  });

  it('takes the new-version path when documentId is passed', async () => {
    fakeScope.addDocumentVersion.mockResolvedValue({
      id: VERSION_ID,
      objectKey: `${TEAM_ID}/${DOC_ID}/v2/a.txt`,
    });
    fakeGetSignedPutUrl.mockResolvedValue('https://rustfs/signed/put-v2');
    const r = await requestDocumentUploadAction({
      documentId: DOC_ID,
      name: 'Acme MSA',
      filename: 'msa.pdf',
      contentType: 'application/pdf',
    });
    expect(r.ok).toBe(true);
    expect(r.versionId).toBe(VERSION_ID);
    expect(fakeScope.createDocument).not.toHaveBeenCalled();
    expect(fakeScope.addDocumentVersion).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// finalizeDocumentVersionAction — HEAD check is load-bearing.
// ---------------------------------------------------------------------------

describe('finalizeDocumentVersionAction', () => {
  beforeEach(() => {
    fakeScope.getDocumentVersion.mockResolvedValue({
      id: VERSION_ID,
      objectKey: 'team/doc/v1/x',
      contentType: 'text/plain',
    });
  });

  it('rejects when HEAD returns no Content-Length (upload not confirmed)', async () => {
    // RustFS sometimes returns 200 without a Content-Length header on a
    // partial / aborted PUT. The action must refuse rather than write a
    // raw_events 'Uploaded' row pointing at a missing-bytes object.
    fakeHeadObject.mockResolvedValue({ contentLength: undefined });
    const r = await finalizeDocumentVersionAction({ versionId: VERSION_ID });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('Upload not confirmed');
    expect(fakeScope.finalizeDocumentVersion).not.toHaveBeenCalled();
    expect(fakeEnqueueDocExtract).not.toHaveBeenCalled();
  });

  it('rejects when the uploaded blob exceeds MAX_UPLOAD_BYTES (25 MiB)', async () => {
    fakeHeadObject.mockResolvedValue({ contentLength: 26 * 1024 * 1024 });
    const r = await finalizeDocumentVersionAction({ versionId: VERSION_ID });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('File exceeds size limit');
    expect(fakeScope.finalizeDocumentVersion).not.toHaveBeenCalled();
    expect(fakeEnqueueDocExtract).not.toHaveBeenCalled();
  });

  it('rejects when the version row is not visible to the user', async () => {
    fakeScope.getDocumentVersion.mockResolvedValue(null);
    const r = await finalizeDocumentVersionAction({ versionId: VERSION_ID });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('Version not found');
    expect(fakeHeadObject).not.toHaveBeenCalled();
    expect(fakeScope.finalizeDocumentVersion).not.toHaveBeenCalled();
  });

  it('finalizes + enqueues the documentExtract job on a confirmed upload', async () => {
    fakeHeadObject.mockResolvedValue({ contentLength: 4096, contentType: 'text/plain' });
    fakeScope.finalizeDocumentVersion.mockResolvedValue({
      document: { id: DOC_ID },
      version: { id: VERSION_ID, processingStatus: 'pending' },
    });
    const r = await finalizeDocumentVersionAction({ versionId: VERSION_ID });
    expect(r.ok).toBe(true);
    expect(r.documentId).toBe(DOC_ID);
    expect(r.processingStatus).toBe('pending');
    expect(fakeScope.finalizeDocumentVersion).toHaveBeenCalledWith({
      versionId: VERSION_ID,
      byteSize: 4096,
      contentType: 'text/plain',
    });
    expect(fakeEnqueueDocExtract).toHaveBeenCalledWith({
      documentVersionId: VERSION_ID,
      teamId: TEAM_ID,
    });
    expect(fakeSafeMarkOnboardingStep).toHaveBeenCalledWith(expect.anything(), 'first_document');
  });

  it('does not mark onboarding complete when extraction enqueue fails', async () => {
    fakeHeadObject.mockResolvedValue({ contentLength: 4096, contentType: 'text/plain' });
    fakeScope.finalizeDocumentVersion.mockResolvedValue({
      document: { id: DOC_ID },
      version: { id: VERSION_ID, processingStatus: 'pending' },
    });
    fakeEnqueueDocExtract.mockRejectedValue(new Error('redis down'));

    const r = await finalizeDocumentVersionAction({ versionId: VERSION_ID });

    expect(r.ok).toBe(false);
    expect(r.error).toBe('redis down');
    expect(fakeEnqueueDocExtract).toHaveBeenCalledWith({
      documentVersionId: VERSION_ID,
      teamId: TEAM_ID,
    });
    expect(fakeSafeMarkOnboardingStep).not.toHaveBeenCalled();
  });

  it('rejects malformed versionId via schema (HEAD never called)', async () => {
    const r = await finalizeDocumentVersionAction({ versionId: 'not-a-uuid' });
    expect(r.ok).toBe(false);
    expect(fakeHeadObject).not.toHaveBeenCalled();
    expect(fakeScope.finalizeDocumentVersion).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// getDocumentPreviewUrlAction — inline media preview contract.
// ---------------------------------------------------------------------------

describe('getDocumentPreviewUrlAction', () => {
  beforeEach(() => {
    fakeScope.getDocument.mockResolvedValue({
      id: DOC_ID,
      currentVersionId: VERSION_ID,
      visibility: 'team',
      ownerUserId: USER_ID,
      visibilityUserIds: null,
      name: 'photo.jpg',
    });
    fakeScope.getDocumentVersion.mockResolvedValue({
      id: VERSION_ID,
      documentId: DOC_ID,
      version: 1,
      objectKey: `${TEAM_ID}/${DOC_ID}/v1/photo.jpg`,
      contentType: 'image/jpeg',
    });
  });

  it('signs a visible media document version for inline preview', async () => {
    const r = await getDocumentPreviewUrlAction({ documentId: DOC_ID });

    expect(r).toEqual({
      ok: true,
      url: 'https://signed-get/url',
      filename: 'photo.jpg',
      contentType: 'image/jpeg',
      mediaKind: 'image',
    });
    expect(fakeGetSignedGetUrl).toHaveBeenCalledWith(
      expect.anything(),
      'test-documents',
      `${TEAM_ID}/${DOC_ID}/v1/photo.jpg`,
      3600,
    );
    expect(fakeAuditRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'document.signed_url',
        targetId: DOC_ID,
        metadata: { version: 1, purpose: 'preview' },
      }),
    );
  });

  it('resolves numeric source metadata to the original document version', async () => {
    fakeScope.getDocument.mockResolvedValue({
      id: DOC_ID,
      currentVersionId: VERSION_2_ID,
      visibility: 'team',
      ownerUserId: USER_ID,
      visibilityUserIds: null,
      name: 'photo.jpg',
    });
    fakeScope.listDocumentVersions.mockResolvedValue([
      {
        id: VERSION_2_ID,
        documentId: DOC_ID,
        version: 2,
        objectKey: `${TEAM_ID}/${DOC_ID}/v2/photo.jpg`,
        contentType: 'image/jpeg',
      },
      {
        id: VERSION_ID,
        documentId: DOC_ID,
        version: 1,
        objectKey: `${TEAM_ID}/${DOC_ID}/v1/photo.jpg`,
        contentType: 'image/jpeg',
      },
    ]);

    const r = await getDocumentPreviewUrlAction({ documentId: DOC_ID, versionNumber: 1 });

    expect(r.ok).toBe(true);
    expect(fakeScope.getDocumentVersion).not.toHaveBeenCalledWith(VERSION_2_ID);
    expect(fakeGetSignedGetUrl).toHaveBeenCalledWith(
      expect.anything(),
      'test-documents',
      `${TEAM_ID}/${DOC_ID}/v1/photo.jpg`,
      3600,
    );
  });

  it('refuses non-media document versions', async () => {
    fakeScope.getDocumentVersion.mockResolvedValue({
      id: VERSION_ID,
      documentId: DOC_ID,
      version: 1,
      objectKey: `${TEAM_ID}/${DOC_ID}/v1/notes.txt`,
      contentType: 'text/plain',
    });

    const r = await getDocumentPreviewUrlAction({ versionId: VERSION_ID });

    expect(r.ok).toBe(false);
    expect(r.error).toBe('Preview is not available for this file type');
    expect(fakeGetSignedGetUrl).not.toHaveBeenCalled();
  });

  it('refuses a visible version whose parent document is not visible', async () => {
    fakeScope.getDocument.mockResolvedValue(null);

    const r = await getDocumentPreviewUrlAction({ versionId: VERSION_ID });

    expect(r.ok).toBe(false);
    expect(r.error).toBe('Document not found');
    expect(fakeGetSignedGetUrl).not.toHaveBeenCalled();
  });
});

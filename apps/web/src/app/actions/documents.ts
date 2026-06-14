'use server';
import { getEnv } from '@timeline/shared/env';
import { childLogger } from '@timeline/shared/logger';
import * as rateLimit from '@timeline/shared/rate-limit';
import {
  getDocumentsBucket,
  getS3Client,
  getS3PresignClient,
  getSignedGetObjectUrl,
  getSignedPutObjectUrl,
  headObject,
} from '@timeline/shared/s3';
import { withTeam } from '@timeline/shared/team-scope';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { resolveActiveTeam } from '@/lib/active-team';
import { trackProductEventBestEffort } from '@/lib/analytics';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { safeMarkOnboardingStep } from '@/lib/onboarding';
import { requireRedisQueue } from '@/lib/queue';
import { runSentryServerAction } from '@/lib/sentry-action';
import { reportCaughtError } from '@/lib/sentry-report';
import { visibilitySchema, type Visibility } from '@/lib/visibility';

const log = childLogger('web:actions:documents');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Cap incoming uploads. 25 MiB matches the worker's processing cap so we
// reject early rather than waste a presigned PUT on a file the worker will
// refuse to chunk.
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

const folderIdSchema = z.string().regex(UUID_RE);
const documentIdSchema = z.string().regex(UUID_RE);
const versionIdSchema = z.string().regex(UUID_RE);

interface Result {
  ok: boolean;
  error?: string;
}

interface CreateFolderResult extends Result {
  id?: string;
}

interface PreviewDocument {
  id: string;
  currentVersionId: string | null;
  name: string;
  visibility: Visibility;
  ownerUserId: string | null;
  visibilityUserIds: string[] | null;
}

interface PreviewVersion {
  id: string;
  documentId: string;
  version: number;
  objectKey: string;
  contentType: string | null;
}

async function withScopeOrError() {
  const session = await auth();
  if (!session?.user) return { error: 'Not signed in' as const };
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) return { error: 'No active team' as const };
  const scope = withTeam(db, active.teamId, session.user.id);
  return { scope, teamId: active.teamId, userId: session.user.id };
}

const createFolderSchema = z.object({
  name: z.string().trim().min(1).max(200),
  parentFolderId: folderIdSchema.nullable().optional(),
  visibility: visibilitySchema.default('team'),
  visibilityUserIds: z.array(z.string().regex(UUID_RE)).optional(),
});

function bestEffortRevalidateDocuments(): void {
  try {
    revalidatePath('/app/documents');
  } catch (err) {
    log.error({ err }, 'document revalidation failed');
    reportCaughtError(err, { surface: 'server_action', operation: 'revalidate_documents' });
  }
}

function bestEffortRevalidateDocumentPath(path: string, operation: string): void {
  try {
    revalidatePath(path);
  } catch (err) {
    log.error({ err, path }, 'document path revalidation failed');
    reportCaughtError(err, { surface: 'server_action', operation });
  }
}

export async function createFolderAction(
  input: z.input<typeof createFolderSchema>,
): Promise<CreateFolderResult> {
  return runSentryServerAction('create_folder', async () => {
    const got = await withScopeOrError();
    if ('error' in got) return { ok: false, error: got.error };
    const parsed = createFolderSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid' };
    let folder: { id: string };
    try {
      folder = await got.scope.documents.createFolder({
        name: parsed.data.name,
        parentFolderId: parsed.data.parentFolderId ?? null,
        visibility: parsed.data.visibility,
        visibilityUserIds: parsed.data.visibilityUserIds ?? null,
      });
    } catch (err) {
      log.error({ err }, 'createFolder failed');
      reportCaughtError(err, { surface: 'server_action', operation: 'create_folder' });
      return { ok: false, error: err instanceof Error ? err.message : 'Failed' };
    }
    bestEffortRevalidateDocuments();
    return { ok: true, id: folder.id };
  });
}

// NOTE: renameFolderAction + moveFolderAction are deferred until the
// document-drive UI gains rename / move dialogs. The underlying scope
// methods exist on @timeline/shared and are tested in scope.test.ts;
// re-adding the action wrappers is a one-file change when the UI ships.

export async function deleteFolderAction(id: string): Promise<Result> {
  return runSentryServerAction('delete_folder', async () => {
    const got = await withScopeOrError();
    if ('error' in got) return { ok: false, error: got.error };
    if (!UUID_RE.test(id)) return { ok: false, error: 'Invalid id' };
    try {
      await got.scope.documents.softDeleteFolder(id);
    } catch (err) {
      reportCaughtError(err, { surface: 'server_action', operation: 'delete_folder' });
      return { ok: false, error: err instanceof Error ? err.message : 'Failed' };
    }
    bestEffortRevalidateDocuments();
    return { ok: true };
  });
}

const requestUploadSchema = z.object({
  documentId: documentIdSchema.optional(),
  folderId: folderIdSchema.nullable().optional(),
  name: z.string().trim().min(1).max(400),
  filename: z.string().trim().min(1).max(400),
  contentType: z.string().trim().min(1).max(200),
  visibility: visibilitySchema.default('team'),
  visibilityUserIds: z.array(z.string().regex(UUID_RE)).optional(),
});

interface RequestUploadResult {
  ok: boolean;
  error?: string;
  url?: string;
  documentId?: string;
  versionId?: string;
  objectKey?: string;
  maxBytes?: number;
}

/**
 * Two paths:
 *   - new document: omit `documentId`, pass `name` + `folderId` →
 *     creates documents row + version 1, returns presigned PUT.
 *   - new version of existing document: pass `documentId` + `filename` →
 *     allocates version N+1, returns presigned PUT.
 *
 * The bytes are still in transit when this returns; finalize on
 * completion. If the client abandons the upload, the document/version
 * row stays in 'pending' processing status with no source_event_id —
 * downstream tools (timeline, search, agent) never see it because there
 * is no upload event yet. A future cleanup script can prune abandoned
 * pending rows older than N days.
 */
export async function requestDocumentUploadAction(
  input: z.input<typeof requestUploadSchema>,
): Promise<RequestUploadResult> {
  return runSentryServerAction('request_document_upload', async () => {
    const got = await withScopeOrError();
    if ('error' in got) return { ok: false, error: got.error };
    const env = getEnv();
    if (env.NODE_ENV === 'production' && !env.S3_PUBLIC_ENDPOINT) {
      return {
        ok: false,
        error:
          'Document uploads are not configured: set S3_PUBLIC_ENDPOINT to the public HTTPS RustFS URL.',
      };
    }
    const rl = await rateLimit.checkRateLimit({
      key: rateLimit.rateLimitKey('document_upload', 'user', got.userId),
      ...rateLimit.RATE_LIMITS.documentUpload,
    });
    if (!rl.ok) {
      return {
        ok: false,
        error: `Too many upload attempts. Try again in ${Math.ceil(rl.retryAfterMs / 1000)} seconds.`,
      };
    }
    const parsed = requestUploadSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid' };
    try {
      let documentId: string;
      let versionId: string;
      let objectKey: string;
      if (parsed.data.documentId) {
        const v = await got.scope.documents.addDocumentVersion({
          documentId: parsed.data.documentId,
          filename: parsed.data.filename,
          contentType: parsed.data.contentType,
        });
        documentId = parsed.data.documentId;
        versionId = v.id;
        objectKey = v.objectKey;
      } else {
        const created = await got.scope.documents.createDocument({
          name: parsed.data.name,
          folderId: parsed.data.folderId ?? null,
          filename: parsed.data.filename,
          contentType: parsed.data.contentType,
          visibility: parsed.data.visibility,
          visibilityUserIds: parsed.data.visibilityUserIds ?? null,
        });
        documentId = created.document.id;
        versionId = created.version.id;
        objectKey = created.version.objectKey;
      }
      const url = await getSignedPutObjectUrl(
        getS3PresignClient(),
        getDocumentsBucket(),
        objectKey,
        parsed.data.contentType,
      );
      return {
        ok: true,
        url,
        documentId,
        versionId,
        objectKey,
        maxBytes: MAX_UPLOAD_BYTES,
      };
    } catch (err) {
      log.error({ err }, 'requestDocumentUpload failed');
      reportCaughtError(err, { surface: 'server_action', operation: 'request_document_upload' });
      return { ok: false, error: err instanceof Error ? err.message : 'Failed' };
    }
  });
}

const finalizeSchema = z.object({
  versionId: versionIdSchema,
});

export async function finalizeDocumentVersionAction(
  input: z.input<typeof finalizeSchema>,
): Promise<Result & { documentId?: string; processingStatus?: string }> {
  return runSentryServerAction('finalize_document_version', async () => {
    const got = await withScopeOrError();
    if ('error' in got) return { ok: false, error: got.error };
    const rl = await rateLimit.checkRateLimit({
      key: rateLimit.rateLimitKey('document_finalize', 'user', got.userId),
      ...rateLimit.RATE_LIMITS.documentFinalize,
    });
    if (!rl.ok) {
      return {
        ok: false,
        error: `Too many finalize attempts. Try again in ${Math.ceil(rl.retryAfterMs / 1000)} seconds.`,
      };
    }
    const parsed = finalizeSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid' };

    try {
      // Confirm RustFS actually received the bytes before we finalize the
      // row + write the timeline event. Without this, an abandoned PUT
      // could still produce a 'upload' raw_events row pointing at a
      // missing object.
      const version = await got.scope.documents.getDocumentVersion(parsed.data.versionId);
      if (!version) return { ok: false, error: 'Version not found' };
      const head = await headObject(getS3Client(), getDocumentsBucket(), version.objectKey);
      if (head.contentLength === undefined) {
        return { ok: false, error: 'Upload not confirmed' };
      }
      if (head.contentLength > MAX_UPLOAD_BYTES) {
        return { ok: false, error: 'File exceeds size limit' };
      }
      const [finalized, queue] = await Promise.all([
        got.scope.documents.finalizeDocumentVersion({
          versionId: parsed.data.versionId,
          byteSize: head.contentLength,
          contentType: head.contentType ?? version.contentType ?? 'application/octet-stream',
        }),
        requireRedisQueue(),
      ]);
      await queue.enqueueDocumentExtractJob({
        documentVersionId: finalized.version.id,
        teamId: got.teamId,
      });
      // Do not parallelize with enqueue: the checklist advances only after
      // the extraction job is safely queued.
      const completedFirstDocument = await safeMarkOnboardingStep(got.scope, 'first_document');
      trackProductEventBestEffort(got.userId, 'document_uploaded', {
        teamId: got.teamId,
        userId: got.userId,
        documentId: finalized.document.id,
        versionId: finalized.version.id,
        byteSize: head.contentLength,
        contentType: head.contentType ?? version.contentType ?? 'application/octet-stream',
        visibility: finalized.document.visibility,
      });
      if (completedFirstDocument) {
        trackProductEventBestEffort(got.userId, 'onboarding_step_completed', {
          teamId: got.teamId,
          userId: got.userId,
          step: 'first_document',
          source: 'automatic',
        });
      }
      bestEffortRevalidateDocuments();
      bestEffortRevalidateDocumentPath(
        `/app/documents/${finalized.document.id}`,
        'revalidate_document_detail',
      );
      bestEffortRevalidateDocumentPath('/app/timeline', 'revalidate_document_timeline');
      return {
        ok: true,
        documentId: finalized.document.id,
        processingStatus: finalized.version.processingStatus,
      };
    } catch (err) {
      log.error({ err }, 'finalizeDocumentVersion failed');
      reportCaughtError(err, { surface: 'server_action', operation: 'finalize_document_version' });
      return { ok: false, error: err instanceof Error ? err.message : 'Failed' };
    }
  });
}

const renameDocumentSchema = z.object({
  id: documentIdSchema,
  name: z.string().trim().min(1).max(400),
});

const promoteCapturedFileSchema = z.object({
  id: documentIdSchema,
  name: z.string().trim().min(1).max(400).optional(),
  folderId: folderIdSchema.nullable().optional(),
  visibility: visibilitySchema.optional(),
  visibilityUserIds: z.array(z.string().regex(UUID_RE)).optional(),
});

export async function renameDocumentAction(
  input: z.input<typeof renameDocumentSchema>,
): Promise<Result> {
  return runSentryServerAction('rename_document', async () => {
    const got = await withScopeOrError();
    if ('error' in got) return { ok: false, error: got.error };
    const parsed = renameDocumentSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid' };
    try {
      await got.scope.documents.renameDocument(parsed.data);
    } catch (err) {
      reportCaughtError(err, { surface: 'server_action', operation: 'rename_document' });
      return { ok: false, error: err instanceof Error ? err.message : 'Failed' };
    }
    bestEffortRevalidateDocuments();
    bestEffortRevalidateDocumentPath(
      `/app/documents/${parsed.data.id}`,
      'revalidate_document_detail',
    );
    return { ok: true };
  });
}

// NOTE: moveDocumentAction is deferred until the document-drive UI gains
// a move dialog. The scope.moveDocument method exists on @timeline/shared
// and is tested in scope.test.ts.

export async function deleteDocumentAction(id: string): Promise<Result> {
  return runSentryServerAction('delete_document', async () => {
    const got = await withScopeOrError();
    if ('error' in got) return { ok: false, error: got.error };
    if (!UUID_RE.test(id)) return { ok: false, error: 'Invalid id' };
    try {
      await got.scope.documents.softDeleteDocument(id);
    } catch (err) {
      reportCaughtError(err, { surface: 'server_action', operation: 'delete_document' });
      return { ok: false, error: err instanceof Error ? err.message : 'Failed' };
    }
    bestEffortRevalidateDocuments();
    return { ok: true };
  });
}

export async function promoteCapturedFileAction(
  input: z.input<typeof promoteCapturedFileSchema>,
): Promise<Result & { documentId?: string }> {
  return runSentryServerAction('promote_captured_file', async () => {
    const got = await withScopeOrError();
    if ('error' in got) return { ok: false, error: got.error };
    const parsed = promoteCapturedFileSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid' };
    try {
      const promoted = await got.scope.documents.promoteCapturedFile({
        id: parsed.data.id,
        name: parsed.data.name,
        folderId: parsed.data.folderId ?? null,
        visibility: parsed.data.visibility,
        visibilityUserIds: parsed.data.visibilityUserIds ?? null,
      });
      if (promoted.reprocessVersionId) {
        const queue = await requireRedisQueue();
        await queue.enqueueDocumentExtractJob({
          documentVersionId: promoted.reprocessVersionId,
          teamId: got.teamId,
        });
      }
      const document = promoted.document;
      bestEffortRevalidateDocuments();
      bestEffortRevalidateDocumentPath('/app/documents/captured', 'revalidate_captured_documents');
      bestEffortRevalidateDocumentPath(
        `/app/documents/${document.id}`,
        'revalidate_document_detail',
      );
      bestEffortRevalidateDocumentPath('/app/timeline', 'revalidate_document_timeline');
      return { ok: true, documentId: document.id };
    } catch (err) {
      reportCaughtError(err, { surface: 'server_action', operation: 'promote_captured_file' });
      return { ok: false, error: err instanceof Error ? err.message : 'Failed' };
    }
  });
}

// NOTE: restoreDocumentAction + setDocumentVisibilityAction are deferred
// until the UI surfaces deleted-documents (for restore) and a share
// dialog (for visibility). Underlying scope methods exist on
// @timeline/shared and are exercised by scope.test.ts.

/**
 * Return a short-lived signed GET URL for a specific document version's
 * blob. The download is gated by team membership AND the same visibility
 * predicate as the document tools — non-visible documents can't be
 * fetched even with a guessed version id.
 */
export async function getDocumentDownloadUrlAction(input: {
  versionId: string;
}): Promise<{ ok: boolean; error?: string; url?: string; filename?: string }> {
  return runSentryServerAction('get_document_download_url', async () => {
    const got = await withScopeOrError();
    if ('error' in got) return { ok: false, error: got.error };
    if (!UUID_RE.test(input.versionId)) return { ok: false, error: 'Invalid id' };
    const version = await got.scope.documents.getDocumentVersion(input.versionId);
    if (!version) return { ok: false, error: 'Version not found' };
    // Re-check the parent document's visibility.
    const document = await got.scope.documents.getDocument(version.documentId, {
      auditDetailRead: false,
    });
    if (!document) return { ok: false, error: 'Document not found' };
    const url = await getSignedGetObjectUrl(
      getS3PresignClient(),
      getDocumentsBucket(),
      version.objectKey,
    );
    await got.scope.audit.record({
      action: 'document.signed_url',
      targetType: 'document',
      targetId: document.id,
      targetVisibility: document.visibility,
      targetOwnerUserId: document.ownerUserId,
      targetVisibilityUserIds: document.visibilityUserIds,
      metadata: { version: version.version, purpose: 'download' },
    });
    return { ok: true, url, filename: document.name };
  });
}

function previewKind(contentType: string | null): 'image' | 'audio' | null {
  const base = contentType?.toLowerCase().split(';')[0]?.trim() ?? '';
  if (base.startsWith('image/')) return 'image';
  if (base.startsWith('audio/')) return 'audio';
  return null;
}

const documentPreviewSchema = z
  .object({
    documentId: documentIdSchema.optional(),
    versionId: versionIdSchema.optional(),
    versionNumber: z.number().int().positive().optional(),
  })
  .refine((input) => (input.documentId ?? input.versionId) !== undefined, {
    message: 'documentId or versionId is required',
  })
  .refine((input) => input.versionNumber === undefined || input.documentId !== undefined, {
    message: 'documentId is required with versionNumber',
  });

/**
 * Return a short-lived signed GET URL for media previews. Accepts either an
 * exact version id, a document id plus version number from source metadata, or
 * a document id alone. The document-id fallback uses the current version only
 * for old events that did not record a version.
 */
export async function getDocumentPreviewUrlAction(input: {
  documentId?: string;
  versionId?: string;
  versionNumber?: number;
}): Promise<{
  ok: boolean;
  error?: string;
  url?: string;
  filename?: string;
  contentType?: string | null;
  mediaKind?: 'image' | 'audio';
}> {
  return runSentryServerAction('get_document_preview_url', async () => {
    const got = await withScopeOrError();
    if ('error' in got) return { ok: false, error: got.error };
    const parsed = documentPreviewSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid id' };
    }

    let version: PreviewVersion | null = null;
    let document: PreviewDocument | null = null;
    if (parsed.data.versionId) {
      version = await got.scope.documents.getDocumentVersion(parsed.data.versionId);
      if (!version) return { ok: false, error: 'Version not found' };
      document = await got.scope.documents.getDocument(version.documentId, {
        auditDetailRead: false,
      });
    } else if (parsed.data.documentId) {
      document = await got.scope.documents.getDocument(parsed.data.documentId, {
        auditDetailRead: false,
      });
      if (!document) return { ok: false, error: 'Document not found' };
      if (parsed.data.versionNumber !== undefined) {
        const versions = await got.scope.documents.listDocumentVersions(document.id);
        version =
          versions.find((candidate) => candidate.version === parsed.data.versionNumber) ?? null;
      } else {
        if (!document.currentVersionId) return { ok: false, error: 'No current version' };
        version = await got.scope.documents.getDocumentVersion(document.currentVersionId);
      }
    }

    if (!document) return { ok: false, error: 'Document not found' };
    if (version?.documentId !== document.id) {
      return { ok: false, error: 'Version not found' };
    }
    const mediaKind = previewKind(version.contentType);
    if (!mediaKind) return { ok: false, error: 'Preview is not available for this file type' };

    const url = await getSignedGetObjectUrl(
      getS3PresignClient(),
      getDocumentsBucket(),
      version.objectKey,
      3600,
    );
    await got.scope.audit.record({
      action: 'document.signed_url',
      targetType: 'document',
      targetId: document.id,
      targetVisibility: document.visibility,
      targetOwnerUserId: document.ownerUserId,
      targetVisibilityUserIds: document.visibilityUserIds,
      metadata: { version: version.version, purpose: 'preview' },
    });
    return {
      ok: true,
      url,
      filename: document.name,
      contentType: version.contentType,
      mediaKind,
    };
  });
}

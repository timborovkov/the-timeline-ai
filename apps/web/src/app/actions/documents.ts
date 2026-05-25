'use server';

import {
  childLogger,
  getDocumentsBucket,
  getS3Client,
  getS3PresignClient,
  getSignedGetObjectUrl,
  getSignedPutObjectUrl,
  headObject,
  queue,
  withTeam,
} from '@timeline/shared';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

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
  visibility: z.enum(['team', 'private', 'specific_users']).default('team'),
  visibilityUserIds: z.array(z.string().regex(UUID_RE)).optional(),
});

export async function createFolderAction(
  input: z.input<typeof createFolderSchema>,
): Promise<Result> {
  const got = await withScopeOrError();
  if ('error' in got) return { ok: false, error: got.error };
  const parsed = createFolderSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid' };
  try {
    await got.scope.createFolder({
      name: parsed.data.name,
      parentFolderId: parsed.data.parentFolderId ?? null,
      visibility: parsed.data.visibility,
      visibilityUserIds: parsed.data.visibilityUserIds ?? null,
    });
  } catch (err) {
    log.error({ err }, 'createFolder failed');
    return { ok: false, error: err instanceof Error ? err.message : 'Failed' };
  }
  revalidatePath('/app/documents');
  return { ok: true };
}

const renameFolderSchema = z.object({
  id: folderIdSchema,
  name: z.string().trim().min(1).max(200),
});

export async function renameFolderAction(
  input: z.input<typeof renameFolderSchema>,
): Promise<Result> {
  const got = await withScopeOrError();
  if ('error' in got) return { ok: false, error: got.error };
  const parsed = renameFolderSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid' };
  try {
    await got.scope.renameFolder(parsed.data);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Failed' };
  }
  revalidatePath('/app/documents');
  return { ok: true };
}

const moveFolderSchema = z.object({
  id: folderIdSchema,
  parentFolderId: folderIdSchema.nullable(),
});

export async function moveFolderAction(
  input: z.input<typeof moveFolderSchema>,
): Promise<Result> {
  const got = await withScopeOrError();
  if ('error' in got) return { ok: false, error: got.error };
  const parsed = moveFolderSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid' };
  try {
    await got.scope.moveFolder(parsed.data);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Failed' };
  }
  revalidatePath('/app/documents');
  return { ok: true };
}

export async function deleteFolderAction(id: string): Promise<Result> {
  const got = await withScopeOrError();
  if ('error' in got) return { ok: false, error: got.error };
  if (!UUID_RE.test(id)) return { ok: false, error: 'Invalid id' };
  try {
    await got.scope.softDeleteFolder(id);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Failed' };
  }
  revalidatePath('/app/documents');
  return { ok: true };
}

const requestUploadSchema = z.object({
  documentId: documentIdSchema.optional(),
  folderId: folderIdSchema.nullable().optional(),
  name: z.string().trim().min(1).max(400),
  filename: z.string().trim().min(1).max(400),
  contentType: z.string().trim().min(1).max(200),
  visibility: z.enum(['team', 'private', 'specific_users']).default('team'),
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
  const got = await withScopeOrError();
  if ('error' in got) return { ok: false, error: got.error };
  const parsed = requestUploadSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid' };
  try {
    let documentId: string;
    let versionId: string;
    let objectKey: string;
    if (parsed.data.documentId) {
      const v = await got.scope.addDocumentVersion({
        documentId: parsed.data.documentId,
        filename: parsed.data.filename,
        contentType: parsed.data.contentType,
      });
      documentId = parsed.data.documentId;
      versionId = v.id;
      objectKey = v.objectKey;
    } else {
      const created = await got.scope.createDocument({
        name: parsed.data.name,
        folderId: parsed.data.folderId ?? null,
        filename: parsed.data.filename,
        contentType: parsed.data.contentType,
        visibility: parsed.data.visibility,
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
    return { ok: false, error: err instanceof Error ? err.message : 'Failed' };
  }
}

const finalizeSchema = z.object({
  versionId: versionIdSchema,
});

export async function finalizeDocumentVersionAction(
  input: z.input<typeof finalizeSchema>,
): Promise<Result & { documentId?: string; processingStatus?: string }> {
  const got = await withScopeOrError();
  if ('error' in got) return { ok: false, error: got.error };
  const parsed = finalizeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid' };

  try {
    // Confirm RustFS actually received the bytes before we finalize the
    // row + write the timeline event. Without this, an abandoned PUT
    // could still produce a 'upload' raw_events row pointing at a
    // missing object.
    const version = await got.scope.getDocumentVersion(parsed.data.versionId);
    if (!version) return { ok: false, error: 'Version not found' };
    const head = await headObject(getS3Client(), getDocumentsBucket(), version.objectKey);
    if (head.contentLength === undefined) {
      return { ok: false, error: 'Upload not confirmed' };
    }
    if (head.contentLength > MAX_UPLOAD_BYTES) {
      return { ok: false, error: 'File exceeds size limit' };
    }
    const finalized = await got.scope.finalizeDocumentVersion({
      versionId: parsed.data.versionId,
      byteSize: head.contentLength,
      contentType: head.contentType ?? version.contentType ?? 'application/octet-stream',
    });
    await queue.enqueueDocumentExtractJob({
      documentVersionId: finalized.version.id,
      teamId: got.teamId,
    });
    revalidatePath('/app/documents');
    revalidatePath(`/app/documents/${finalized.document.id}`);
    revalidatePath('/app/timeline');
    return {
      ok: true,
      documentId: finalized.document.id,
      processingStatus: finalized.version.processingStatus,
    };
  } catch (err) {
    log.error({ err }, 'finalizeDocumentVersion failed');
    return { ok: false, error: err instanceof Error ? err.message : 'Failed' };
  }
}

const renameDocumentSchema = z.object({
  id: documentIdSchema,
  name: z.string().trim().min(1).max(400),
});

export async function renameDocumentAction(
  input: z.input<typeof renameDocumentSchema>,
): Promise<Result> {
  const got = await withScopeOrError();
  if ('error' in got) return { ok: false, error: got.error };
  const parsed = renameDocumentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid' };
  try {
    await got.scope.renameDocument(parsed.data);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Failed' };
  }
  revalidatePath('/app/documents');
  revalidatePath(`/app/documents/${parsed.data.id}`);
  return { ok: true };
}

const moveDocumentSchema = z.object({
  id: documentIdSchema,
  folderId: folderIdSchema.nullable(),
});

export async function moveDocumentAction(
  input: z.input<typeof moveDocumentSchema>,
): Promise<Result> {
  const got = await withScopeOrError();
  if ('error' in got) return { ok: false, error: got.error };
  const parsed = moveDocumentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid' };
  try {
    await got.scope.moveDocument(parsed.data);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Failed' };
  }
  revalidatePath('/app/documents');
  return { ok: true };
}

export async function deleteDocumentAction(id: string): Promise<Result> {
  const got = await withScopeOrError();
  if ('error' in got) return { ok: false, error: got.error };
  if (!UUID_RE.test(id)) return { ok: false, error: 'Invalid id' };
  try {
    await got.scope.softDeleteDocument(id);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Failed' };
  }
  revalidatePath('/app/documents');
  return { ok: true };
}

export async function restoreDocumentAction(id: string): Promise<Result> {
  const got = await withScopeOrError();
  if ('error' in got) return { ok: false, error: got.error };
  if (!UUID_RE.test(id)) return { ok: false, error: 'Invalid id' };
  try {
    await got.scope.restoreDocument(id);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Failed' };
  }
  revalidatePath('/app/documents');
  return { ok: true };
}

const setVisibilitySchema = z.object({
  id: documentIdSchema,
  visibility: z.enum(['team', 'private', 'specific_users']),
  visibilityUserIds: z.array(z.string().regex(UUID_RE)).optional(),
});

export async function setDocumentVisibilityAction(
  input: z.input<typeof setVisibilitySchema>,
): Promise<Result> {
  const got = await withScopeOrError();
  if ('error' in got) return { ok: false, error: got.error };
  const parsed = setVisibilitySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid' };
  try {
    await got.scope.setDocumentVisibility({
      id: parsed.data.id,
      visibility: parsed.data.visibility,
      visibilityUserIds: parsed.data.visibilityUserIds ?? null,
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Failed' };
  }
  revalidatePath('/app/documents');
  revalidatePath(`/app/documents/${parsed.data.id}`);
  return { ok: true };
}

/**
 * Return a short-lived signed GET URL for a specific document version's
 * blob. The download is gated by team membership AND the same visibility
 * predicate as the document tools — non-visible documents can't be
 * fetched even with a guessed version id.
 */
export async function getDocumentDownloadUrlAction(input: {
  versionId: string;
}): Promise<{ ok: boolean; error?: string; url?: string; filename?: string }> {
  const got = await withScopeOrError();
  if ('error' in got) return { ok: false, error: got.error };
  if (!UUID_RE.test(input.versionId)) return { ok: false, error: 'Invalid id' };
  const version = await got.scope.getDocumentVersion(input.versionId);
  if (!version) return { ok: false, error: 'Version not found' };
  // Re-check the parent document's visibility.
  const document = await got.scope.getDocument(version.documentId);
  if (!document) return { ok: false, error: 'Document not found' };
  const url = await getSignedGetObjectUrl(
    getS3PresignClient(),
    getDocumentsBucket(),
    version.objectKey,
  );
  return { ok: true, url, filename: document.name };
}

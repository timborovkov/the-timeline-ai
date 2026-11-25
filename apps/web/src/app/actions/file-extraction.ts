'use server';

import { TIMELINE_MODELS } from '@timeline/shared/llm';
import { getQdrantClient } from '@timeline/shared/qdrant';
import { withTeam } from '@timeline/shared/team-scope';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { requireRedisQueue } from '@/lib/queue';
import { runSentryServerAction } from '@/lib/sentry-action';

async function activeScope() {
  const session = await auth();
  if (!session?.user) return null;
  const { active } = await resolveActiveTeam(session.user.id);
  return active ? withTeam(db, active.teamId, session.user.id) : null;
}

async function queueCorrection(
  scope: NonNullable<Awaited<ReturnType<typeof activeScope>>>,
  id: string,
) {
  const queue = await requireRedisQueue();
  const correction = await scope.documents.requestExtractionCorrection(id);
  if (!correction) return false;
  await queue.enqueueDocumentExtractJob({
    teamId: scope.teamId,
    documentVersionId: correction.versionId,
    correctionAttemptId: correction.attemptId,
  });
  return true;
}

export async function requestFileCorrection(id: string) {
  return runSentryServerAction('request_file_correction', async () => {
    const scope = await activeScope();
    if (!scope || !z.uuid().safeParse(id).success || !(await queueCorrection(scope, id))) {
      return { ok: false, error: 'This file isn’t available for another extraction.' };
    }
    revalidatePath('/app/documents/captured');
    return { ok: true };
  });
}

export async function resumeFileOcr(id: string) {
  return runSentryServerAction('resume_file_ocr', async () => {
    const scope = await activeScope();
    if (!scope || !z.uuid().safeParse(id).success) return { ok: false, error: 'File unavailable.' };
    const versionId = await scope.documents.getDeferredVisionVersion(id);
    if (!versionId) return { ok: false, error: 'This file is no longer waiting for OCR.' };
    const queue = await requireRedisQueue();
    await queue.enqueueDocumentExtractJob({ teamId: scope.teamId, documentVersionId: versionId });
    return { ok: true };
  });
}

export async function applyFileCorrection(id: string, attemptId: string) {
  return runSentryServerAction('apply_file_correction', async () => {
    const scope = await activeScope();
    if (!scope || !z.uuid().safeParse(id).success || !z.uuid().safeParse(attemptId).success) {
      return { ok: false, error: 'Correction unavailable.' };
    }
    const queue = await requireRedisQueue();
    const correction = await scope.documents.applyExtractionCorrection(id, attemptId);
    if (!correction) return { ok: false, error: 'This correction is unavailable.' };
    const additions = new Set(correction.chunkIds);
    const changedIds = [...additions, ...correction.replacedIds];
    let failed = false;
    for (let offset = 0; offset < changedIds.length; offset += 20) {
      // react-doctor-disable-next-line react-doctor/async-await-in-loop -- Bound concurrent writes to the queue and index.
      const results = await Promise.allSettled(
        changedIds.slice(offset, offset + 20).map(async (chunkId) => {
          if (additions.has(chunkId)) {
            await queue.enqueueEmbedJob({
              scope: 'doc_chunk',
              teamId: scope.teamId,
              documentChunkId: chunkId,
            });
          } else {
            await getQdrantClient().deletePointsForSource({
              teamId: scope.teamId,
              scope: 'doc_chunk',
              sourceId: chunkId,
              model: TIMELINE_MODELS.embedding.id,
            });
          }
        }),
      );
      failed ||= results.some((result) => result.status === 'rejected');
    }
    if (!failed) await scope.documents.confirmExtractionCorrectionIndex(attemptId);
    revalidatePath('/app/documents');
    if (failed)
      return { ok: false, error: 'Extraction applied. Retry indexing from extraction history.' };
    return { ok: true };
  });
}

export async function bulkCapturedFileAction(ids: string[], action: 'promote' | 'extract') {
  return runSentryServerAction('bulk_captured_file_action', async () => {
    const parsed = z.array(z.uuid()).min(1).max(50).safeParse(ids);
    const scope = await activeScope();
    if (!scope || !parsed.success || !['promote', 'extract'].includes(action)) {
      return { ok: false, error: 'Select up to 50 available files.' };
    }
    const failedItemIds: string[] = [];
    const queue = await requireRedisQueue();
    // Apply shared workspace limits in selection order.
    for (const id of new Set(parsed.data)) {
      try {
        // react-doctor-disable-next-line react-doctor/async-await-in-loop -- Each action can change shared workspace capacity.
        const succeeded = await (async () => {
          if (action === 'extract') return queueCorrection(scope, id);
          const result = await scope.documents.promoteCapturedFile({ id });
          if (result.reprocessVersionId) {
            await queue.enqueueDocumentExtractJob({
              teamId: scope.teamId,
              documentVersionId: result.reprocessVersionId,
            });
          }
          return true;
        })();
        if (!succeeded) failedItemIds.push(id);
      } catch {
        failedItemIds.push(id);
      }
    }
    revalidatePath('/app/documents');
    return {
      ok: failedItemIds.length === 0,
      failedItemIds,
      ...(failedItemIds.length
        ? { error: `${failedItemIds.length} selected files could not be processed.` }
        : {}),
    };
  });
}

export async function updateOcrBudget(form: FormData) {
  return runSentryServerAction('update_ocr_budget', async () => {
    const scope = await activeScope();
    if (!scope) return;
    const input = form.get('dollars');
    if (typeof input !== 'string' || !/^(?:|[0-9]{1,7}(?:\.[0-9]{1,2})?)$/.test(input)) {
      throw new Error('Enter a budget in US dollars.');
    }
    await scope.billing.setVisionBudget(input === '' ? null : Math.round(Number(input) * 100));
    revalidatePath('/app/team/ocr');
  });
}

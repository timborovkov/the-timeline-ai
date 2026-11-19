'use server';

import { withTeam } from '@timeline/shared/team-scope';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { requireRedisQueue } from '@/lib/queue';

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
  const scope = await activeScope();
  if (!scope || !z.uuid().safeParse(id).success || !(await queueCorrection(scope, id))) {
    return { ok: false, error: 'This file isn’t available for another extraction.' };
  }
  revalidatePath('/app/documents/captured');
  return { ok: true };
}

export async function resumeFileOcr(id: string) {
  const scope = await activeScope();
  if (!scope || !z.uuid().safeParse(id).success) return { ok: false, error: 'File unavailable.' };
  const versionId = await scope.documents.getDeferredVisionVersion(id);
  if (!versionId) return { ok: false, error: 'This file is no longer waiting for OCR.' };
  const queue = await requireRedisQueue();
  await queue.enqueueDocumentExtractJob({ teamId: scope.teamId, documentVersionId: versionId });
  return { ok: true };
}

export async function applyFileCorrection(id: string, attemptId: string) {
  const scope = await activeScope();
  if (!scope || !z.uuid().safeParse(id).success || !z.uuid().safeParse(attemptId).success) {
    return { ok: false, error: 'Correction unavailable.' };
  }
  const queue = await requireRedisQueue();
  const chunks = await scope.documents.applyExtractionCorrection(id, attemptId);
  if (!chunks) return { ok: false, error: 'This correction is unavailable.' };
  for (const documentChunkId of chunks) {
    await queue.enqueueEmbedJob({ scope: 'doc_chunk', teamId: scope.teamId, documentChunkId });
  }
  revalidatePath('/app/documents');
  return { ok: true };
}

export async function bulkCapturedFileAction(ids: string[], action: 'promote' | 'extract') {
  const parsed = z.array(z.uuid()).min(1).max(50).safeParse(ids);
  const scope = await activeScope();
  if (!scope || !parsed.success || !['promote', 'extract'].includes(action)) {
    return { ok: false, error: 'Select up to 50 available files.' };
  }
  const failedItemIds: string[] = [];
  for (const id of new Set(parsed.data)) {
    try {
      if (action === 'extract') {
        if (!(await queueCorrection(scope, id))) failedItemIds.push(id);
      } else {
        const queue = await requireRedisQueue();
        const result = await scope.documents.promoteCapturedFile({ id });
        if (result.reprocessVersionId) {
          await queue.enqueueDocumentExtractJob({
            teamId: scope.teamId,
            documentVersionId: result.reprocessVersionId,
          });
        }
      }
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
}

export async function updateOcrBudget(form: FormData) {
  const scope = await activeScope();
  if (!scope) return;
  const input = form.get('dollars');
  if (typeof input !== 'string' || !/^(?:|[0-9]{1,7}(?:\.[0-9]{1,2})?)$/.test(input)) {
    throw new Error('Enter a budget in US dollars.');
  }
  await scope.billing.setVisionBudget(input === '' ? null : Math.round(Number(input) * 100));
  revalidatePath('/app/team/ocr');
}

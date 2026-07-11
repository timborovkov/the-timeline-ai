import { type Db, documentVersions, entities, meetings } from '@timeline/db';
import { childLogger, queue } from '@timeline/shared';
import { getEnv } from '@timeline/shared/env';
import { Worker, type Job } from 'bullmq';
import { and, asc, eq, gt, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';

import { captureWorkerException, captureWorkerJobFailure } from '#src/monitoring.js';

// Keyset paging by id keeps memory bounded on a backlog that hasn't been
// swept in a while. UUIDs sort lexicographically — total + stable, which
// is all keyset needs.
const PAGE_SIZE = 500;
// Per-tick cap. Each requeue is a Redis write (not a single SQL upsert
// like overdue's notification insert), so we cap lower than overdue. A
// cap hit just rolls to the next tick — workers are idempotent.
const MAX_REQUEUES_PER_KIND = 5_000;

// Stuck-row thresholds. Picked to be generous multiples of the normal
// happy-path latency so a fast-but-legitimate run never gets a duplicate
// job. The duplicate would be harmless (worker advisory locks bail under
// the status re-check) but unnecessary log noise.
const PENDING_DOC_MIN_AGE_MS = 5 * 60 * 1000;
// 60min, not 30, because `documentVersions.createdAt` is set at
// presigned-PUT allocation time — not when extract starts. A slow user
// upload + a slow vision-OCR pass can legitimately leave the row in
// 'extracting' 30min+ from createdAt. Worker idempotency would bail any
// duplicate (advisory lock + under-lock status re-check) so the cost of
// being wrong is noise, not corruption, but 60min keeps the noise to
// genuinely-dead workers.
const EXTRACTING_DOC_MIN_AGE_MS = 60 * 60 * 1000;
const PROCESSING_MEETING_MIN_AGE_MS = 30 * 60 * 1000;
const PENDING_TASK_CATEGORY_MIN_AGE_MS = 5 * 60 * 1000;

const log = childLogger('worker:janitor');

interface JanitorDeps {
  db: Db;
  // Injectable for tests so we can assert what got re-enqueued without
  // touching Redis. Production binds these to the real queue helpers.
  enqueueDocumentExtractJob?: (data: queue.DocumentExtractJobData) => Promise<void>;
  enqueueMeetingFinalizeJob?: (data: queue.MeetingFinalizeJobData) => Promise<void>;
  enqueueTaskCategoryJob?: (data: queue.TaskCategoryJobData) => Promise<unknown>;
  taskCategoryEnabled?: boolean;
}

interface JanitorTickResult {
  documentVersionsRequeued: number;
  meetingsRequeued: number;
  taskCategoriesRequeued: number;
}

/**
 * Single janitor tick. Walks two tables paged by id, re-enqueues rows that
 * are still in an intermediate processing state past a sanity threshold.
 *
 * Why this exists: `finalizeDocumentVersionAction` (apps/web) commits the
 * DB row at `pending`, then `enqueueDocumentExtractJob` writes to Redis as
 * a separate step. If the Redis call throws after the DB commit, the row
 * is stuck — no scan, no retry. Same shape on the meeting finalize path.
 *
 * The downstream workers are already idempotent: they take an advisory
 * lock on the row id and re-check status under the lock before doing work,
 * so a duplicate enqueue is a cheap no-op. That lets us re-enqueue freely
 * without coordinating with whatever job may already be in Redis.
 */
export async function processJanitorTick(deps: JanitorDeps): Promise<JanitorTickResult> {
  const enqueueDoc = deps.enqueueDocumentExtractJob ?? queue.enqueueDocumentExtractJob;
  const enqueueMeeting = deps.enqueueMeetingFinalizeJob ?? queue.enqueueMeetingFinalizeJob;
  const enqueueTaskCategory = deps.enqueueTaskCategoryJob ?? queue.enqueueTaskCategoryJob;

  const documentVersionsRequeued = await sweepDocumentVersions(deps.db, enqueueDoc);
  const meetingsRequeued = await sweepMeetings(deps.db, enqueueMeeting);
  const taskCategoriesRequeued =
    (deps.taskCategoryEnabled ??
    (getEnv().TASK_CATEGORY_CLASSIFICATION_ENABLED &&
      getEnv().TASK_CATEGORY_AUTO_ENQUEUE_ENABLED &&
      getEnv().TASK_CATEGORY_WORKER_ENABLED))
      ? await sweepTaskCategories(deps.db, enqueueTaskCategory)
      : 0;

  return { documentVersionsRequeued, meetingsRequeued, taskCategoriesRequeued };
}

async function sweepTaskCategories(
  db: Db,
  enqueue: (data: queue.TaskCategoryJobData) => Promise<unknown>,
): Promise<number> {
  let cursor: string | null = null;
  let total = 0;
  while (total < MAX_REQUEUES_PER_KIND) {
    const rows = await db
      .select({
        id: entities.id,
        teamId: entities.teamId,
        inputHash: entities.taskCategoryRequestedInputHash,
      })
      .from(entities)
      .where(
        and(
          eq(entities.type, 'task'),
          eq(entities.taskCategoryMode, 'automatic'),
          eq(entities.taskCategoryStatus, 'pending'),
          isNotNull(entities.taskCategoryRequestedInputHash),
          isNull(entities.archivedAt),
          isNull(entities.mergedIntoId),
          sql`${entities.taskCategoryUpdatedAt} < now() - make_interval(secs => ${PENDING_TASK_CATEGORY_MIN_AGE_MS / 1000})`,
          cursor ? gt(entities.id, cursor) : undefined,
        ),
      )
      .orderBy(asc(entities.id))
      .limit(PAGE_SIZE);
    if (rows.length === 0) break;
    cursor = rows[rows.length - 1]?.id ?? null;
    for (const row of rows) {
      if (total >= MAX_REQUEUES_PER_KIND || !row.inputHash) break;
      try {
        await enqueue({
          teamId: row.teamId,
          taskId: row.id,
          inputHash: row.inputHash,
          trigger: 'retry',
        });
        total += 1;
      } catch (err: unknown) {
        log.warn({ err, taskId: row.id }, 'janitor: failed to re-enqueue task category');
        captureWorkerException(err, {
          component: 'worker_handoff',
          queueName: queue.QUEUE_NAMES.taskCategory,
          operation: 'janitor_reenqueue_task_category',
        });
      }
    }
    if (rows.length < PAGE_SIZE) break;
  }
  return total;
}

async function sweepDocumentVersions(
  db: Db,
  enqueue: (data: queue.DocumentExtractJobData) => Promise<void>,
): Promise<number> {
  let cursor: string | null = null;
  let total = 0;

  while (total < MAX_REQUEUES_PER_KIND) {
    // Two stuck-state predicates OR'd:
    //  - pending older than 5min  → enqueue almost certainly dropped
    //  - extracting older than 30min → worker died mid-job; lock is gone
    // `byteSize IS NOT NULL` filters out abandoned pre-finalize rows
    // (rows allocated by requestDocumentUploadAction whose user never
    // PUT bytes). Those have no object to extract; re-enqueuing them
    // would just stamp 'failed' on the RustFS HEAD miss — wasted work.
    const rows: {
      id: string;
      teamId: string;
      status: 'pending' | 'extracting' | 'chunked' | 'embedded' | 'failed' | 'deferred';
    }[] = await db
      .select({
        id: documentVersions.id,
        teamId: documentVersions.teamId,
        status: documentVersions.processingStatus,
      })
      .from(documentVersions)
      .where(
        and(
          isNotNull(documentVersions.byteSize),
          or(
            and(
              eq(documentVersions.processingStatus, 'pending'),
              sql`${documentVersions.createdAt} < now() - make_interval(secs => ${PENDING_DOC_MIN_AGE_MS / 1000})`,
            ),
            and(
              eq(documentVersions.processingStatus, 'extracting'),
              sql`${documentVersions.createdAt} < now() - make_interval(secs => ${EXTRACTING_DOC_MIN_AGE_MS / 1000})`,
            ),
          ),
          cursor ? gt(documentVersions.id, cursor) : undefined,
        ),
      )
      .orderBy(asc(documentVersions.id))
      .limit(PAGE_SIZE);

    if (rows.length === 0) break;
    cursor = rows[rows.length - 1]?.id ?? null;

    // Stuck `extracting` rows need a CAS flip back to `pending` BEFORE the
    // re-enqueue, otherwise the worker's under-lock status re-check sees
    // status='extracting' and bails as `already_processed`
    // (documentExtract.ts:196). The `WHERE status='extracting'` guard on
    // the UPDATE is the CAS: if a worker legitimately just finished
    // (status now 'chunked' or 'failed'), the UPDATE skips that row and
    // the subsequent enqueue is a cheap no-op via the same gate.
    const extractingIds = rows.filter((r) => r.status === 'extracting').map((r) => r.id);
    if (extractingIds.length > 0) {
      await db
        .update(documentVersions)
        .set({ processingStatus: 'pending', processingError: null })
        .where(
          and(
            inArray(documentVersions.id, extractingIds),
            eq(documentVersions.processingStatus, 'extracting'),
          ),
        );
    }

    for (const r of rows) {
      if (total >= MAX_REQUEUES_PER_KIND) break;
      try {
        await enqueue({ documentVersionId: r.id, teamId: r.teamId });
        total += 1;
      } catch (err: unknown) {
        // Don't let one bad enqueue abort the whole sweep — the next tick
        // will pick up whatever this one missed. Log and keep going.
        log.warn(
          { err, documentVersionId: r.id },
          'janitor: failed to re-enqueue document extract',
        );
        captureWorkerException(err, {
          component: 'worker_handoff',
          queueName: queue.QUEUE_NAMES.documentExtract,
          operation: 'janitor_reenqueue_document_extract',
        });
      }
    }

    if (rows.length < PAGE_SIZE) break;
  }

  if (total >= MAX_REQUEUES_PER_KIND) {
    log.warn({ cap: MAX_REQUEUES_PER_KIND }, 'janitor: hit document_versions per-tick cap');
  }
  return total;
}

async function sweepMeetings(
  db: Db,
  enqueue: (data: queue.MeetingFinalizeJobData) => Promise<void>,
): Promise<number> {
  let cursor: string | null = null;
  let total = 0;

  while (total < MAX_REQUEUES_PER_KIND) {
    // Only `processing` is swept. `pending`/`joining`/`active` are driven
    // by the Recall webhook lifecycle; a janitor can't make a bot join a
    // call that didn't fire. `processing` means the finalize webhook
    // arrived and our worker either started and died, or never started.
    const rows: { id: string; teamId: string }[] = await db
      .select({ id: meetings.id, teamId: meetings.teamId })
      .from(meetings)
      .where(
        and(
          eq(meetings.status, 'processing'),
          sql`${meetings.updatedAt} < now() - make_interval(secs => ${PROCESSING_MEETING_MIN_AGE_MS / 1000})`,
          cursor ? gt(meetings.id, cursor) : undefined,
        ),
      )
      .orderBy(asc(meetings.id))
      .limit(PAGE_SIZE);

    if (rows.length === 0) break;
    cursor = rows[rows.length - 1]?.id ?? null;

    for (const r of rows) {
      if (total >= MAX_REQUEUES_PER_KIND) break;
      try {
        await enqueue({ meetingId: r.id, teamId: r.teamId });
        total += 1;
      } catch (err: unknown) {
        log.warn({ err, meetingId: r.id }, 'janitor: failed to re-enqueue meeting finalize');
        captureWorkerException(err, {
          component: 'worker_handoff',
          queueName: queue.QUEUE_NAMES.meetingFinalize,
          operation: 'janitor_reenqueue_meeting_finalize',
        });
      }
    }

    if (rows.length < PAGE_SIZE) break;
  }

  if (total >= MAX_REQUEUES_PER_KIND) {
    log.warn({ cap: MAX_REQUEUES_PER_KIND }, 'janitor: hit meetings per-tick cap');
  }
  return total;
}

export function startJanitorWorker(deps: { db: Db }): Worker<queue.JanitorJobData> {
  const worker = new Worker<queue.JanitorJobData>(
    queue.QUEUE_NAMES.janitor,
    async (job: Job<queue.JanitorJobData>) => {
      const startedAt = Date.now();
      const result = await processJanitorTick({ db: deps.db });
      const durationMs = Date.now() - startedAt;
      if (
        result.documentVersionsRequeued === 0 &&
        result.meetingsRequeued === 0 &&
        result.taskCategoriesRequeued === 0
      ) {
        log.info({ jobId: job.id, durationMs }, 'janitor: nothing stuck');
      } else {
        log.info({ jobId: job.id, ...result, durationMs }, 'janitor: requeued stuck rows');
      }
      return { ...result, durationMs };
    },
    {
      connection: queue.getRedisConnection(),
      // Singleton — the sweep is cheap and concurrent runs would just
      // duplicate enqueues. Idempotency saves us if it ever happened
      // anyway, but no point provoking it.
      concurrency: 1,
    },
  );

  worker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, err }, 'janitor tick failed');
    captureWorkerJobFailure(err, job);
  });

  return worker;
}

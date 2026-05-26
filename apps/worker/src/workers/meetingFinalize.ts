import {
  type Db,
  meetings as meetingsTable,
  meetingTranscriptChunks,
  meetingUsage,
  rawEvents,
} from '@timeline/db';
import { childLogger, getEnv, llm, queue } from '@timeline/shared';
import { UnrecoverableError, Worker, type Job } from 'bullmq';
import { and, asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';

const log = childLogger('worker:meeting-finalize');

interface MeetingFinalizeDeps {
  db: Db;
}

// Phase 10 — end-of-meeting finalisation.
//   1. Load meeting + all transcript chunks.
//   2. Generate a structured summary + action items via llm.chat.
//   3. Stamp `meetings.metadata.summary` and append `action_items`.
//   4. Record meeting minutes in `meeting_usage` (idempotent).
//   5. Flip status → 'completed'.
//
// Per-chunk extraction (turning each utterance into facts / entity mentions)
// already happened via the standard extract worker — we don't duplicate
// that here. This worker's job is the *meeting-level* output: one summary,
// one action-item list, one usage row.

const finalizeSchema = z.object({
  summary: z.string().min(1).max(2000),
  action_items: z
    .array(
      z.object({
        text: z.string().min(1).max(400),
        owner: z.string().nullable().optional(),
      }),
    )
    .max(50),
});

interface MeetingFinalizeIO {
  /** Inject the LLM call so tests can run without OpenRouter. Defaults to
   *  the real `llm.chatStructured` in production. */
  chatStructured?: typeof llm.chatStructured;
  /** Override the model id passed to the LLM. */
  modelId?: string;
}

interface ProcessResult {
  skipped?: 'already_completed';
  meetingId?: string;
  minutes?: number;
  actionItems?: number;
}

type TranscriptChunk = typeof meetingTranscriptChunks.$inferSelect;

function formatTranscript(chunks: TranscriptChunk[]): string {
  return chunks
    .map((c) => `[${String(Math.floor(c.startMs / 1000))}s] ${c.speaker ?? 'Unknown'}: ${c.text}`)
    .join('\n');
}

async function loadMeetingChunks(db: Db, meetingId: string, teamId: string) {
  return db
    .select()
    .from(meetingTranscriptChunks)
    .where(
      and(
        eq(meetingTranscriptChunks.meetingId, meetingId),
        eq(meetingTranscriptChunks.teamId, teamId),
      ),
    )
    .orderBy(asc(meetingTranscriptChunks.startMs));
}

/**
 * Pure processing function. Exported separately from the BullMQ worker so
 * tests can call it directly with an injected DB + LLM stub.
 */
export async function processMeetingFinalizeJob(
  deps: MeetingFinalizeDeps,
  data: queue.MeetingFinalizeJobData,
  io: MeetingFinalizeIO = {},
): Promise<ProcessResult> {
  const { meetingId, teamId } = data;
  const env = getEnv();
  if (!env.OPENROUTER_API_KEY && !io.chatStructured) {
    throw new UnrecoverableError('meeting-finalize: OPENROUTER_API_KEY not configured');
  }

  const rows = await deps.db
    .select()
    .from(meetingsTable)
    .where(eq(meetingsTable.id, meetingId))
    .limit(1);
  const meeting = rows[0];
  if (!meeting) {
    throw new UnrecoverableError(`meeting ${meetingId} not found`);
  }
  if (meeting.teamId !== teamId) {
    throw new UnrecoverableError(`meeting ${meetingId} team mismatch`);
  }
  if (meeting.status === 'completed') {
    // Already finalised — re-run is a no-op. Usage row is also
    // protected by its unique index.
    return { skipped: 'already_completed' };
  }

  const chunks = await loadMeetingChunks(deps.db, meetingId, teamId);

  // No transcript captured — mark completed without summary so the UI
  // stops showing "processing", but skip the LLM call.
  let summary: string | null = null;
  let actionItems: { text: string; owner: string | null }[] = [];
  let modelUsed: string | null = null;
  if (chunks.length > 0) {
    const transcriptText = formatTranscript(chunks);
    try {
      const chat = io.chatStructured ?? llm.chatStructured;
      const result = await chat({
        schema: finalizeSchema,
        ...(io.modelId ? { model: io.modelId } : {}),
        system:
          'You are summarising a meeting transcript. Produce a concise summary (3-5 sentences) and an array of concrete action items mentioned during the meeting. If no action items are present, return an empty array. Do NOT invent owners — only set "owner" when the transcript clearly attributes the task to a named person.',
        prompt: `Meeting${meeting.title ? ` "${meeting.title}"` : ''} transcript:\n\n${transcriptText.slice(0, 60000)}`,
      });
      summary = result.object.summary;
      actionItems = result.object.action_items.map(
        (a: { text: string; owner?: string | null | undefined }) => ({
          text: a.text,
          owner: a.owner ?? null,
        }),
      );
      modelUsed = result.model;
    } catch (err) {
      log.error({ err, meetingId }, 'finalize_llm_failed');
      throw err;
    }
  }

  const dedupKey = `meeting-finalized:${meetingId}`;
  const finalized = await deps.db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${meetingId}, 0))`);
    const finalChunks = await loadMeetingChunks(tx as never, meetingId, teamId);

    // Compute minutes used from the freshest chunk set. Use meeting
    // duration if available, else fall back to last chunk end_ms.
    let minutes = 0;
    if (meeting.startedAt && meeting.endedAt) {
      minutes = Math.max(
        1,
        Math.ceil((meeting.endedAt.getTime() - meeting.startedAt.getTime()) / 60000),
      );
    } else if (finalChunks.length > 0) {
      const last = finalChunks[finalChunks.length - 1];
      if (last) minutes = Math.max(1, Math.ceil(last.endMs / 60000));
    }

    // Patch meeting metadata first, but do NOT flip status yet. Status
    // only moves to 'completed' after the raw_event + backfill succeed so
    // a crash mid-way causes a retry instead of silently skipping.
    const metadataPatch: Record<string, unknown> = {
      finalized_at: new Date().toISOString(),
    };
    if (summary) metadataPatch.summary = summary;
    if (modelUsed) metadataPatch.summary_model = modelUsed;
    if (actionItems.length > 0) metadataPatch.action_items = actionItems;
    const patchJson = JSON.stringify(metadataPatch);
    await tx
      .update(meetingsTable)
      .set({
        updatedAt: new Date(),
        metadata: sql`COALESCE(${meetingsTable.metadata}, '{}'::jsonb) || ${patchJson}::jsonb`,
      })
      .where(eq(meetingsTable.id, meetingId));

    // Create ONE consolidated raw_events row so the meeting appears as a
    // single timeline entry. contentText is the full speaker-attributed
    // transcript (the raw source); the LLM summary lives in sourceMetadata
    // so it's clearly tagged as derived.
    const speakers = [...new Set(finalChunks.map((c) => c.speaker).filter(Boolean))];
    const fullTranscript = finalChunks.length > 0 ? formatTranscript(finalChunks) : null;
    const contentText = fullTranscript ?? 'Meeting (no transcript)';
    const sourceMetadata: Record<string, unknown> = {
      meeting_id: meetingId,
      platform: meeting.platform,
      speakers,
      duration_minutes: minutes,
      chunk_count: finalChunks.length,
      meeting_chunk_provider_id: dedupKey,
    };
    if (meeting.title) sourceMetadata.title = meeting.title;
    if (summary) sourceMetadata.summary = summary;
    if (actionItems.length > 0) sourceMetadata.action_items = actionItems;

    const eventInsert = await tx
      .insert(rawEvents)
      .values({
        teamId,
        authorUserId: meeting.createdByUserId,
        source: 'meeting',
        contentText,
        occurredAt: meeting.startedAt ?? meeting.createdAt,
        visibility: meeting.defaultVisibility,
        visibilityUserIds: meeting.visibilityUserIds,
        sourceMetadata,
      })
      .onConflictDoNothing()
      .returning({ id: rawEvents.id });

    let rawEventId = eventInsert[0]?.id;

    // On dedup conflict (prior run inserted but crashed before completing),
    // look up the existing row so backfill + enqueue still run.
    if (!rawEventId) {
      const existing = await tx
        .select({ id: rawEvents.id })
        .from(rawEvents)
        .where(
          and(
            eq(rawEvents.teamId, teamId),
            sql`(${rawEvents.sourceMetadata} ->> 'meeting_chunk_provider_id') = ${dedupKey}`,
          ),
        )
        .limit(1);
      rawEventId = existing[0]?.id;
    }

    if (rawEventId) {
      // Backfill rawEventId on all chunks so Qdrant meeting_chunk points
      // link back to the consolidated parent event for search attribution.
      await tx
        .update(meetingTranscriptChunks)
        .set({ rawEventId })
        .where(
          and(
            eq(meetingTranscriptChunks.meetingId, meetingId),
            eq(meetingTranscriptChunks.teamId, teamId),
          ),
        );
    }

    // Usage. Idempotent via unique index on meeting_id.
    if (minutes > 0) {
      await tx.insert(meetingUsage).values({ teamId, meetingId, minutes }).onConflictDoNothing();
    }

    // Status flip is last — a crash anywhere above means the retry will
    // re-enter and complete the remaining steps.
    await tx
      .update(meetingsTable)
      .set({ status: 'completed', updatedAt: new Date() })
      .where(eq(meetingsTable.id, meetingId));

    return { minutes, rawEventId };
  });

  if (finalized.rawEventId && env.REDIS_URL) {
    await Promise.all([
      queue.enqueueExtractJob({ rawEventId: finalized.rawEventId, teamId }),
      queue.enqueueEmbedJob({ scope: 'raw_event', rawEventId: finalized.rawEventId, teamId }),
    ]);
  }

  return { meetingId, minutes: finalized.minutes, actionItems: actionItems.length };
}

export function startMeetingFinalizeWorker(
  deps: MeetingFinalizeDeps,
): Worker<queue.MeetingFinalizeJobData> {
  const worker = new Worker<queue.MeetingFinalizeJobData>(
    queue.QUEUE_NAMES.meetingFinalize,
    async (job: Job<queue.MeetingFinalizeJobData>) => processMeetingFinalizeJob(deps, job.data),
    {
      connection: queue.getRedisConnection(),
      // Single concurrency per process — meeting summarisation is rare
      // (one per meeting end) and a big context call benefits from not
      // contending with other workers' OpenRouter rate budget.
      concurrency: 2,
    },
  );

  worker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, err }, 'meeting_finalize_failed');
  });
  worker.on('completed', (job) => {
    log.info({ jobId: job.id }, 'meeting_finalize_completed');
  });

  return worker;
}

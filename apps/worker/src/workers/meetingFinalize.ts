import {
  calendarEvents,
  type Db,
  meetings as meetingsTable,
  meetingTranscriptChunks,
  meetingUsage,
  rawEvents,
} from '@timeline/db';
import { childLogger, formatMeetingTranscript, getEnv, llm, queue } from '@timeline/shared';
import { currentExtractionModelVersion } from '@timeline/shared/extraction-model-version';
import { participantNames } from '@timeline/shared/meetings';
import { UnrecoverableError, Worker, type Job } from 'bullmq';
import { and, asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import { trackProductEventBestEffort } from '#src/analytics.js';
import { captureWorkerJobFailure } from '#src/monitoring.js';

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
  /** Inject queue producers so tests can prove recovery behavior without Redis. */
  enqueueExtractJob?: typeof queue.enqueueExtractJob;
  enqueueEmbedJob?: typeof queue.enqueueEmbedJob;
  /** Override the model id passed to the LLM. */
  modelId?: string;
}

interface ProcessResult {
  skipped?: 'already_completed' | 'failed';
  meetingId?: string;
  minutes?: number;
  actionItems?: number;
}

type TranscriptChunk = typeof meetingTranscriptChunks.$inferSelect;
type MeetingRow = typeof meetingsTable.$inferSelect;

interface MeetingSummaryFailure {
  at: string;
  message: string;
  causeName: string | null;
  model: string;
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

function meetingDedupKey(meetingId: string): string {
  return `meeting-finalized:${meetingId}`;
}

async function findFinalizedRawEventId(db: Db, meetingId: string, teamId: string) {
  const dedupKey = meetingDedupKey(meetingId);
  const existing = await db
    .select({ id: rawEvents.id })
    .from(rawEvents)
    .where(
      and(
        eq(rawEvents.teamId, teamId),
        sql`(${rawEvents.sourceMetadata} ->> 'meeting_chunk_provider_id') = ${dedupKey}`,
      ),
    )
    .limit(1);
  return existing[0]?.id;
}

async function findMeetingCalendarEventId(db: Db, meetingId: string, teamId: string) {
  const existing = await db
    .select({ id: calendarEvents.id })
    .from(calendarEvents)
    .where(
      and(
        eq(calendarEvents.teamId, teamId),
        sql`(${calendarEvents.metadata} ->> 'meeting_id') = ${meetingId}`,
      ),
    )
    .limit(1);
  return existing[0]?.id;
}

async function enqueueRawEventPipeline(
  env: ReturnType<typeof getEnv>,
  io: MeetingFinalizeIO,
  rawEventId: string,
  teamId: string,
) {
  const injectedQueue = io.enqueueExtractJob && io.enqueueEmbedJob;
  if (!env.REDIS_URL && !injectedQueue) return;

  const enqueueExtractJob = io.enqueueExtractJob ?? queue.enqueueExtractJob;
  const enqueueEmbedJob = io.enqueueEmbedJob ?? queue.enqueueEmbedJob;
  await Promise.all([
    enqueueExtractJob({ rawEventId, teamId }),
    enqueueEmbedJob({ scope: 'raw_event', rawEventId, teamId }),
  ]);
}

async function enqueueCalendarEventPipeline(
  env: ReturnType<typeof getEnv>,
  io: MeetingFinalizeIO,
  calendarEventId: string | null | undefined,
  teamId: string,
) {
  if (!calendarEventId) return;
  if (!env.REDIS_URL && !io.enqueueEmbedJob) return;

  const enqueueEmbedJob = io.enqueueEmbedJob ?? queue.enqueueEmbedJob;
  await enqueueEmbedJob({ scope: 'calendar_event', calendarEventId, teamId });
}

async function enqueueMeetingChunkEmbeds(
  env: ReturnType<typeof getEnv>,
  io: MeetingFinalizeIO,
  meetingChunkIds: string[],
  teamId: string,
) {
  if (meetingChunkIds.length === 0) return;
  if (!env.REDIS_URL && !io.enqueueEmbedJob) return;

  const enqueueEmbedJob = io.enqueueEmbedJob ?? queue.enqueueEmbedJob;
  await Promise.all(
    meetingChunkIds.map((meetingChunkId) =>
      enqueueEmbedJob({ scope: 'meeting_chunk', meetingChunkId, teamId }),
    ),
  );
}

function platformLabel(platform: MeetingRow['platform']): string {
  switch (platform) {
    case 'meet':
      return 'Google Meet';
    case 'teams':
      return 'Microsoft Teams';
    case 'zoom':
      return 'Zoom';
  }
}

function calendarTitleForMeeting(meeting: MeetingRow): string {
  const title = meeting.title?.trim() ? meeting.title.trim() : 'Untitled meeting';
  return `${platformLabel(meeting.platform)} with Meeting Bot: ${title}`;
}

function buildMeetingCalendarDescription(args: {
  meeting: MeetingRow;
  summary: string | null;
  actionItems: { text: string; owner: string | null }[];
}): string {
  const parts = [
    `Meeting: /app/meetings/${args.meeting.id}`,
    `Join URL: ${args.meeting.meetingUrl}`,
  ];
  const participants = participantNames(args.meeting.participants);
  if (participants.length > 0) parts.push(`Participants: ${participants.join(', ')}`);
  if (args.summary) parts.push(`Summary: ${args.summary}`);
  if (args.actionItems.length > 0) {
    parts.push(
      `Action items: ${args.actionItems
        .map((item) => (item.owner ? `${item.text} (${item.owner})` : item.text))
        .join('; ')}`,
    );
  }
  return parts.join('\n\n');
}

function buildMeetingCalendarRawText(args: {
  meeting: MeetingRow;
  title: string;
  startAt: Date;
  endAt: Date;
}): string {
  const parts = [
    args.title,
    `Meeting: /app/meetings/${args.meeting.id}`,
    `Join URL: ${args.meeting.meetingUrl}`,
  ];
  const participants = participantNames(args.meeting.participants);
  if (participants.length > 0) parts.push(`Participants: ${participants.join(', ')}`);
  parts.push(`${args.startAt.toISOString()} to ${args.endAt.toISOString()}`);
  return parts.join(' | ');
}

function generatedCalendarExtractionSkipMetadata() {
  const now = new Date().toISOString();
  return {
    extracted_at: now,
    extraction_skipped_at: now,
    extraction_skipped_reason: 'generated_from_meeting_bot',
    extraction_model_version: currentExtractionModelVersion(),
  };
}

function summaryFailureFromError(err: unknown, model: string): MeetingSummaryFailure {
  const causeName =
    err && typeof err === 'object' && 'causeName' in err && typeof err.causeName === 'string'
      ? err.causeName
      : err instanceof Error
        ? err.name
        : null;
  return {
    at: new Date().toISOString(),
    message: err instanceof Error ? err.message : String(err),
    causeName,
    model,
  };
}

async function createMeetingCalendarEvent(
  tx: Db,
  args: {
    meeting: MeetingRow;
    teamId: string;
    startAt: Date;
    endAt: Date;
    summary: string | null;
    actionItems: { text: string; owner: string | null }[];
    minutes: number;
  },
): Promise<string | null> {
  const existingCalendarEventId = await findMeetingCalendarEventId(
    tx,
    args.meeting.id,
    args.teamId,
  );
  if (existingCalendarEventId) return existingCalendarEventId;

  const title = calendarTitleForMeeting(args.meeting);
  const description = buildMeetingCalendarDescription({
    meeting: args.meeting,
    summary: args.summary,
    actionItems: args.actionItems,
  });
  const metadata = {
    source: 'meeting_bot',
    meeting_id: args.meeting.id,
    meeting_url: args.meeting.meetingUrl,
    platform: args.meeting.platform,
    duration_minutes: args.minutes,
    meeting_href: `/app/meetings/${args.meeting.id}`,
  };

  const [row] = await tx
    .insert(calendarEvents)
    .values({
      teamId: args.teamId,
      createdByUserId: args.meeting.createdByUserId,
      title,
      description,
      startAt: args.startAt,
      endAt: args.endAt,
      timezone: 'UTC',
      location: args.meeting.meetingUrl,
      visibility: args.meeting.defaultVisibility,
      visibilityUserIds: args.meeting.visibilityUserIds,
      metadata,
    })
    .returning({ id: calendarEvents.id });

  if (!row) return null;

  const [scheduledRow] = await tx
    .insert(rawEvents)
    .values({
      teamId: args.teamId,
      authorUserId: args.meeting.createdByUserId,
      source: 'calendar',
      contentText: `Scheduled: ${title}`,
      occurredAt: args.meeting.createdAt,
      visibility: args.meeting.defaultVisibility,
      visibilityUserIds: args.meeting.visibilityUserIds,
      visibilityOwnerUserId: args.meeting.createdByUserId,
      sourceMetadata: {
        calendar_event_id: row.id,
        action: 'scheduled',
        meeting_id: args.meeting.id,
        source: 'meeting_bot',
        ...generatedCalendarExtractionSkipMetadata(),
      },
    })
    .returning({ id: rawEvents.id });

  const [startAtRow] = await tx
    .insert(rawEvents)
    .values({
      teamId: args.teamId,
      authorUserId: args.meeting.createdByUserId,
      source: 'calendar',
      contentText: buildMeetingCalendarRawText({
        meeting: args.meeting,
        title,
        startAt: args.startAt,
        endAt: args.endAt,
      }),
      occurredAt: args.startAt,
      visibility: args.meeting.defaultVisibility,
      visibilityUserIds: args.meeting.visibilityUserIds,
      visibilityOwnerUserId: args.meeting.createdByUserId,
      sourceMetadata: {
        calendar_event_id: row.id,
        action: 'event',
        meeting_id: args.meeting.id,
        source: 'meeting_bot',
        ...generatedCalendarExtractionSkipMetadata(),
      },
    })
    .returning({ id: rawEvents.id });

  await tx
    .update(calendarEvents)
    .set({
      scheduledRawEventId: scheduledRow?.id ?? null,
      startAtRawEventId: startAtRow?.id ?? null,
    })
    .where(eq(calendarEvents.id, row.id));

  return row.id;
}

async function summarizeTranscript(
  meeting: typeof meetingsTable.$inferSelect,
  chunks: TranscriptChunk[],
  io: MeetingFinalizeIO,
) {
  if (chunks.length === 0) {
    return {
      transcriptText: '',
      summary: null,
      actionItems: [] as { text: string; owner: string | null }[],
      modelUsed: null,
      summaryFailure: null,
    };
  }

  const transcriptText = formatMeetingTranscript(chunks);
  const chat = io.chatStructured ?? llm.chatStructured;
  const modelId = io.modelId ?? llm.TIMELINE_MODELS.extraction.id;
  const transcriptPrompt = llm.truncateTextToTokenBudget(
    `Meeting${meeting.title ? ` "${meeting.title}"` : ''} transcript:\n\n${transcriptText}`,
    llm.inputTokenBudgetFor(llm.TIMELINE_MODELS.extraction, { reservedOutputTokens: 3_000 }),
  );
  try {
    const result = await chat({
      schema: finalizeSchema,
      model: modelId,
      system:
        'You are summarising a meeting transcript. Produce a concise summary (3-5 sentences) and an array of concrete action items mentioned during the meeting. If no action items are present, return an empty array. Do NOT invent owners — only set "owner" when the transcript clearly attributes the task to a named person.',
      prompt: transcriptPrompt,
    });
    return {
      transcriptText,
      summary: result.object.summary,
      actionItems: result.object.action_items.map(
        (a: { text: string; owner?: string | null | undefined }) => ({
          text: a.text,
          owner: a.owner ?? null,
        }),
      ),
      modelUsed: result.model,
      summaryFailure: null,
    };
  } catch (err) {
    log.warn({ err, meetingId: meeting.id }, 'meeting_summary_failed_transcript_only');
    return {
      transcriptText,
      summary: null,
      actionItems: [] as { text: string; owner: string | null }[],
      modelUsed: null,
      summaryFailure: summaryFailureFromError(err, modelId),
    };
  }
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
    // Already finalised. A previous attempt may have committed the DB
    // transaction and then died before enqueueing the post-commit pipeline,
    // so recover the consolidated event and enqueue again. Extract/embed are
    // worker-idempotent.
    const rawEventId = await findFinalizedRawEventId(deps.db, meetingId, teamId);
    const calendarEventId = await findMeetingCalendarEventId(deps.db, meetingId, teamId);
    if (rawEventId) {
      const chunks = await loadMeetingChunks(deps.db, meetingId, teamId);
      await Promise.all([
        enqueueRawEventPipeline(env, io, rawEventId, teamId),
        enqueueMeetingChunkEmbeds(
          env,
          io,
          chunks.map((c) => c.id),
          teamId,
        ),
        meeting.defaultVisibility === 'team'
          ? enqueueCalendarEventPipeline(env, io, calendarEventId, teamId)
          : Promise.resolve(),
      ]);
    }
    return { skipped: 'already_completed', meetingId };
  }
  if (meeting.status === 'failed') {
    return { skipped: 'failed', meetingId };
  }

  if (!env.OPENROUTER_API_KEY && !io.chatStructured) {
    throw new UnrecoverableError('meeting-finalize: OPENROUTER_API_KEY not configured');
  }

  let summarized = await summarizeTranscript(
    meeting,
    await loadMeetingChunks(deps.db, meetingId, teamId),
    io,
  );

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const dedupKey = meetingDedupKey(meetingId);
      const finalized = await deps.db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${meetingId}, 0))`);
        const finalChunks = await loadMeetingChunks(tx as never, meetingId, teamId);
        const fullTranscript = finalChunks.length > 0 ? formatMeetingTranscript(finalChunks) : null;
        if ((fullTranscript ?? '') !== summarized.transcriptText) {
          return { retryChunks: finalChunks };
        }

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
        if (summarized.summary) metadataPatch.summary = summarized.summary;
        if (summarized.modelUsed) metadataPatch.summary_model = summarized.modelUsed;
        if (summarized.summaryFailure) {
          metadataPatch.summary_failed_at = summarized.summaryFailure.at;
          metadataPatch.summary_error = summarized.summaryFailure.message;
          metadataPatch.summary_error_cause = summarized.summaryFailure.causeName;
          metadataPatch.summary_model = summarized.summaryFailure.model;
        }
        if (summarized.actionItems.length > 0) {
          metadataPatch.action_items = summarized.actionItems;
        }
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
        if (summarized.summary) sourceMetadata.summary = summarized.summary;
        if (summarized.summaryFailure) {
          sourceMetadata.summary_failed_at = summarized.summaryFailure.at;
          sourceMetadata.summary_error = summarized.summaryFailure.message;
          sourceMetadata.summary_error_cause = summarized.summaryFailure.causeName;
          sourceMetadata.summary_model = summarized.summaryFailure.model;
        }
        if (summarized.actionItems.length > 0) {
          sourceMetadata.action_items = summarized.actionItems;
        }

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
            visibilityOwnerUserId: meeting.createdByUserId,
            sourceMetadata,
          })
          .onConflictDoNothing()
          .returning({ id: rawEvents.id });

        let rawEventId = eventInsert[0]?.id;

        // On dedup conflict (prior run inserted but crashed before completing),
        // look up the existing row so backfill + enqueue still run.
        rawEventId ??= await findFinalizedRawEventId(tx as never, meetingId, teamId);

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
          await tx
            .insert(meetingUsage)
            .values({ teamId, meetingId, minutes })
            .onConflictDoNothing();
        }

        const calendarStartAt = meeting.startedAt ?? meeting.createdAt;
        let calendarEndAt =
          meeting.endedAt && meeting.endedAt > calendarStartAt
            ? meeting.endedAt
            : new Date(calendarStartAt.getTime() + Math.max(1, minutes) * 60_000);
        if (calendarEndAt <= calendarStartAt) {
          calendarEndAt = new Date(calendarStartAt.getTime() + 60_000);
        }
        const calendarEventId = await createMeetingCalendarEvent(tx as never, {
          meeting,
          teamId,
          startAt: calendarStartAt,
          endAt: calendarEndAt,
          summary: summarized.summary,
          actionItems: summarized.actionItems,
          minutes,
        });

        // Status flip is last — a crash anywhere above means the retry will
        // re-enter and complete the remaining steps.
        await tx
          .update(meetingsTable)
          .set({ status: 'completed', updatedAt: new Date() })
          .where(eq(meetingsTable.id, meetingId));

        return {
          minutes,
          rawEventId,
          calendarEventId,
          meetingChunkIds: finalChunks.map((c) => c.id),
        };
      });

      if ('retryChunks' in finalized) {
        summarized = await summarizeTranscript(meeting, finalized.retryChunks, io);
        continue;
      }

      if (finalized.rawEventId) {
        await Promise.all([
          enqueueRawEventPipeline(env, io, finalized.rawEventId, teamId),
          enqueueMeetingChunkEmbeds(env, io, finalized.meetingChunkIds, teamId),
          meeting.defaultVisibility === 'team'
            ? enqueueCalendarEventPipeline(env, io, finalized.calendarEventId, teamId)
            : Promise.resolve(),
        ]);
      }

      trackProductEventBestEffort(
        meeting.createdByUserId ?? `team:${teamId}`,
        'meeting_finalized',
        {
          teamId,
          userId: meeting.createdByUserId,
          meetingId,
          minutes: finalized.minutes,
          actionItems: summarized.actionItems.length,
        },
      );

      return {
        meetingId,
        minutes: finalized.minutes,
        actionItems: summarized.actionItems.length,
      };
    } catch (err) {
      log.error({ err, meetingId }, 'finalize_llm_failed');
      throw err;
    }
  }

  throw new Error(`meeting ${meetingId} transcript changed during finalization`);
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
    captureWorkerJobFailure(err, job);
  });
  worker.on('completed', (job) => {
    log.info({ jobId: job.id }, 'meeting_finalize_completed');
  });

  return worker;
}

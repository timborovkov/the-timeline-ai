import { Queue, type JobsOptions } from 'bullmq';

import { getEnv } from '#src/env.js';
import { defaultDigestWindow } from '#src/messaging/digest.js';
import { getRedisConnection } from '#src/queue/connection.js';

type TimelineQueue<TData> = Queue<TData, unknown, string, TData, unknown, string>;
interface LegacyRepeatableQueue {
  removeRepeatable(name: string, repeatOpts: { pattern: string }, jobId?: string): Promise<boolean>;
}

export const QUEUE_NAMES = {
  transcribe: 'transcribe',
  // Phase 4/5 consumers — names reserved here so producers compile cleanly.
  // No worker process is started for these until those phases land.
  extract: 'extract',
  embed: 'embed',
  // Phase 8: hourly scan of overdue tasks + follow_ups. Produced by the
  // worker process itself (BullMQ repeatable on startup); consumed by
  // startOverdueWorker.
  overdueScan: 'overdue-scan',
  // Phase 11 calendar recurrence materializer. Keeps a rolling window of
  // child occurrence rows warm for recurring calendar parents.
  calendarRecurrence: 'calendar-recurrence',
  // Phase 9: document upload → text extract → chunk → embed pipeline.
  // The `documentExtract` worker fans out to many `embed` jobs (one per
  // chunk) once chunking succeeds; embed shares the existing queue.
  documentExtract: 'document-extract',
  // Phase 10: end-of-meeting finalisation — summary, action-item
  // extraction, usage recording. Triggered by the Recall status webhook
  // on `bot.call_ended` / `transcript.done`.
  meetingFinalize: 'meeting-finalize',
  // Saved meetings: 2-minute cadence that materializes upcoming saved
  // meeting occurrences and starts due scheduled captures.
  meetingScheduler: 'meeting-scheduler',
  // Hourly janitor: re-enqueues async-pipeline rows stuck in intermediate
  // states (the enqueue-after-commit pattern in the upload action isn't
  // atomic — if Redis hiccups after the DB write, the job is lost). Mirrors
  // overdueScan: BullMQ repeatable, singleton consumer.
  janitor: 'janitor',
  // Phase 11: third-party integration backfill + incremental sync. The
  // worker walks the connected provider's API (Drive changes, Linear
  // issues, GitHub PRs/issues), writes integration events into
  // raw_events, and updates the per-resource cursor.
  integrationSync: 'integration-sync',
  // Native integration webhook delivery processing. Routes persist inbound
  // provider deliveries, then this worker normalizes per-target events and
  // schedules targeted sync work without making providers wait on that work.
  webhookDelivery: 'webhook-delivery',
  // Phase 11: 5-minute MCP server health ping. Sends a cheap initialize
  // request to every enabled MCP server, updates last_connected_at /
  // last_error so the settings UI can surface degraded servers without
  // needing a chat turn to discover them.
  mcpHealth: 'mcp-health',
  // Phase 13.4: owner/admin initiated team data export. The web app writes a
  // team_exports row, then this worker builds the expiring archive out of band.
  teamExport: 'team-export',
  // Autonomous commitment extraction. Runs after raw-event fact extraction
  // and writes proposal-only agent_suggestions rows for the approvals queue.
  suggestions: 'suggestions',
  // Daily personalized team digest. Tick fans out per active recipient;
  // recipient jobs generate one durable digest and send it through messaging.
  dailyDigest: 'daily-digest',
  // Generated object briefs. Produced by canonical object-memory writes and
  // manual object-page requests; consumed by the object-summary worker.
  objectSummary: 'object-summary',
  // Derived functional category for canonical task objects.
  taskCategory: 'task-category',
  // Reconciliation replay/audit work. This makes evidence coverage repair a
  // first-class worker path instead of only an operator CLI.
  reconciliation: 'reconciliation',
  // AI-assisted presentation for timeline moments. Produced by timeline reads
  // when an eligible moment has no matching presentation cache; consumed by
  // the timeline-moment-presentation worker.
  timelineMomentPresentation: 'timeline-moment-presentation',
  // Durable direct-message agent work shared by Telegram, Slack, and future
  // conversational providers. The UUID job id matches the persisted turn.
  conversationAgent: 'conversation-agent',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

function createTimelineQueue<TData>(
  name: QueueName,
  defaultJobOptions: JobsOptions,
): TimelineQueue<TData> {
  return new Queue<TData, unknown, string, TData, unknown, string>(name, {
    connection: getRedisConnection(),
    defaultJobOptions,
  });
}

async function closeQueue<TData>(
  queue: TimelineQueue<TData> | undefined,
  reset: () => void,
): Promise<void> {
  if (!queue) return;
  reset();
  await queue.close().catch(() => undefined);
}

export interface TranscribeJobData {
  rawEventId: string;
  teamId: string;
  audioKey: string;
}

let _transcribeQueue: TimelineQueue<TranscribeJobData> | undefined;

export function getTranscribeQueue(): TimelineQueue<TranscribeJobData> {
  if (_transcribeQueue) return _transcribeQueue;
  _transcribeQueue = createTimelineQueue<TranscribeJobData>(QUEUE_NAMES.transcribe, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: { age: 3600, count: 1000 },
    removeOnFail: { age: 24 * 3600 },
  });
  return _transcribeQueue;
}

export async function enqueueTranscribeJob(data: TranscribeJobData): Promise<void> {
  // Intentionally NO jobId-based dedup. BullMQ blocks re-adds for unknown
  // existing job, including ones already in the failed-and-retained state
  // (`removeOnFail: { age: ... }`). That breaks two important paths:
  //   1. The Telegram webhook self-heal — when the prior job exhausted its
  //      retries and is still in failed state, the next retry would be
  //      silently dropped.
  //   2. A future reconciler that re-enqueues audio rows with no transcript
  //      would hit the same wall.
  // Idempotency lives at two other layers, which is enough:
  //   - The raw_events row is unique per Telegram update (partial unique
  //     index on tg_update_id), so the same physical message can produce
  //     at most one row.
  //   - The worker's UPDATE on raw_events.content_text is deterministic in
  //     audio bytes, so a duplicate job overwrites with the same value.
  // The only real cost of an accidental duplicate enqueue is one extra
  // OpenRouter call. Acceptable.
  await getTranscribeQueue().add('transcribe', data);
}

export async function closeTranscribeQueue(): Promise<void> {
  await closeQueue(_transcribeQueue, () => {
    _transcribeQueue = undefined;
  });
}

export interface ExtractJobData {
  rawEventId: string;
  teamId: string;
}

let _extractQueue: TimelineQueue<ExtractJobData> | undefined;

export function getExtractQueue(): TimelineQueue<ExtractJobData> {
  if (_extractQueue) return _extractQueue;
  _extractQueue = createTimelineQueue<ExtractJobData>(QUEUE_NAMES.extract, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: { age: 3600, count: 1000 },
    removeOnFail: { age: 24 * 3600 },
  });
  return _extractQueue;
}

export async function enqueueExtractJob(
  data: ExtractJobData,
  opts: { delayMs?: number } = {},
): Promise<void> {
  // Same no-jobId-dedup rationale as transcribe: row-level idempotency lives
  // in the worker, which skips when facts for (rawEventId, modelVersion)
  // already exist. A duplicate enqueue costs at most one extra DB lookup.
  await getExtractQueue().add('extract', data, {
    ...(opts.delayMs && opts.delayMs > 0 ? { delay: opts.delayMs } : {}),
  });
}

export async function closeExtractQueue(): Promise<void> {
  await closeQueue(_extractQueue, () => {
    _extractQueue = undefined;
  });
}

export type SuggestionJobData =
  | SuggestionRawEventJobData
  | SuggestionConversationReviewJobData
  | SuggestionObjectCleanupJobData
  | SuggestionGithubTaskProposalJobData;

export interface SuggestionRawEventJobData {
  rawEventId: string;
  teamId: string;
}

export interface SuggestionConversationReviewJobData {
  scope: 'conversation_review';
  conversationReviewId: string;
  teamId: string;
}

export interface SuggestionObjectCleanupJobData {
  scope: 'object_cleanup';
  teamId: string;
  triggeredBy?: string;
  objectId?: string;
}

export interface SuggestionGithubTaskProposalJobData {
  scope: 'github_task_proposal';
  teamId: string;
  integrationId: string;
  externalObjectId: string;
}

let _suggestionQueue: TimelineQueue<SuggestionJobData> | undefined;

function bullmqCustomJobId(parts: string[]): string {
  return parts.map((part) => encodeURIComponent(part)).join('|');
}

function suggestionJobId(data: SuggestionJobData, jobIdSuffix?: string): string | undefined {
  if ('scope' in data) {
    if (data.scope === 'conversation_review') {
      return bullmqCustomJobId([
        'conversation-review',
        data.conversationReviewId,
        ...(jobIdSuffix ? [jobIdSuffix] : []),
      ]);
    }
    if (data.scope === 'github_task_proposal') {
      return bullmqCustomJobId([
        'github-task-proposal',
        data.teamId,
        data.externalObjectId,
        ...(jobIdSuffix ? [jobIdSuffix] : []),
      ]);
    }
    return bullmqCustomJobId([
      'object-cleanup',
      data.teamId,
      data.objectId ?? 'team',
      data.triggeredBy ?? 'manual',
      ...(jobIdSuffix ? [jobIdSuffix] : []),
    ]);
  }
  return jobIdSuffix ? bullmqCustomJobId(['raw-event', data.rawEventId, jobIdSuffix]) : undefined;
}

function legacySuggestionJobIds(data: SuggestionJobData, jobIdSuffix?: string): string[] {
  if (!('scope' in data) || data.scope !== 'conversation_review') return [];
  return [
    `conversation-review:${data.conversationReviewId}${jobIdSuffix ? `:${jobIdSuffix}` : ''}`,
  ];
}

function suggestionJobIdCandidates(data: SuggestionJobData, jobIdSuffix?: string): string[] {
  const current = suggestionJobId(data, jobIdSuffix);
  if (!current) return [];
  return [current, ...legacySuggestionJobIds(data, jobIdSuffix).filter((id) => id !== current)];
}

interface ExistingJobLike {
  getState?: () => Promise<string>;
  remove?: () => Promise<void>;
}

const SUGGESTION_JOB_DEDUPE_STATES = new Set([
  'active',
  'delayed',
  'paused',
  'prioritized',
  'waiting',
  'waiting-children',
]);

const SUGGESTION_JOB_REPLACEABLE_STATES = new Set(['completed', 'failed']);

export function getSuggestionQueue(): TimelineQueue<SuggestionJobData> {
  if (_suggestionQueue) return _suggestionQueue;
  _suggestionQueue = createTimelineQueue<SuggestionJobData>(QUEUE_NAMES.suggestions, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 3000 },
    removeOnComplete: { age: 3600, count: 1000 },
    removeOnFail: { age: 24 * 3600 },
  });
  return _suggestionQueue;
}

export async function enqueueSuggestionJob(
  data: SuggestionJobData,
  opts: { delayMs?: number; jobIdSuffix?: string } = {},
): Promise<{ enqueued: boolean; jobId: string | null }> {
  const jobId = suggestionJobId(data, opts.jobIdSuffix);
  const q = getSuggestionQueue();
  const jobIds = suggestionJobIdCandidates(data, opts.jobIdSuffix);
  for (const existingJobId of jobIds) {
    const existing = (await q.getJob(existingJobId)) as ExistingJobLike | null;
    if (!existing) continue;
    const state = await existing.getState?.().catch(() => null);
    if (!state || SUGGESTION_JOB_DEDUPE_STATES.has(state)) {
      return { enqueued: false, jobId: existingJobId };
    }
    if (SUGGESTION_JOB_REPLACEABLE_STATES.has(state)) {
      if (!existing.remove) return { enqueued: false, jobId: existingJobId };
      const removed = await existing.remove().then(
        () => true,
        () => false,
      );
      if (!removed) return { enqueued: false, jobId: existingJobId };
    } else {
      return { enqueued: false, jobId: existingJobId };
    }
  }
  await q.add('suggestions', data, {
    ...(jobId ? { jobId } : {}),
    ...(opts.delayMs ? { delay: opts.delayMs } : {}),
  });
  return { enqueued: true, jobId: jobId ?? null };
}

export async function removeSuggestionJob(
  data: SuggestionJobData,
  opts: { jobIdSuffix: string },
): Promise<{ removed: boolean; jobId: string }> {
  const jobId = suggestionJobId(data, opts.jobIdSuffix);
  if (!jobId) throw new Error('suggestion job id suffix required');
  const q = getSuggestionQueue();
  for (const candidateJobId of suggestionJobIdCandidates(data, opts.jobIdSuffix)) {
    const job = (await q.getJob(candidateJobId)) as ExistingJobLike | null;
    if (!job?.remove) continue;
    const removed = await job.remove().then(
      () => true,
      () => false,
    );
    if (removed) return { removed: true, jobId: candidateJobId };
  }
  return { removed: false, jobId };
}

export async function scheduleObjectCleanupSuggestions(): Promise<void> {
  await getSuggestionQueue().add(
    'object-cleanup-daily',
    { scope: 'object_cleanup', teamId: '__all__', triggeredBy: 'daily' },
    {
      repeat: { pattern: '0 3 * * *' },
      jobId: 'object-cleanup-daily',
    },
  );
}

export async function closeSuggestionQueue(): Promise<void> {
  await closeQueue(_suggestionQueue, () => {
    _suggestionQueue = undefined;
  });
}

/**
 * Discriminated union of embed scopes. Phase 5 only had {raw_event, fact},
 * both anchored to a raw_events row. Phase 8 follow-ups add {object,
 * object_note, object_change, entity} anchored to the workspace object graph.
 *
 * Back-compat: jobs without an explicit `scope` field are treated as
 * `raw_event` (if `factId` is unset) or `fact` (if set) — see the worker
 * dispatch in apps/worker/src/workers/embed.ts.
 */
export type EmbedJobData =
  | EmbedRawEventJobData
  | EmbedFactJobData
  | EmbedObjectJobData
  | EmbedObjectNoteJobData
  | EmbedObjectChangeJobData
  | EmbedEntityJobData
  | EmbedDocChunkJobData
  | EmbedMeetingChunkJobData
  | EmbedCalendarEventJobData;

interface EmbedJobBase {
  teamId: string;
  /** Optional override used by the re-embed script to write into a new
   *  collection during a model migration. When unset, the worker writes to
   *  `QDRANT_COLLECTION`. */
  targetCollection?: string;
  /**
   * Internal continuation cursor for oversized source text. The first job
   * chunks the hydrated source, writes a bounded batch, then enqueues the same
   * source with the next chunk index until all chunks land.
   */
  embeddingStartChunk?: number;
  /**
   * Internal source-text fingerprint carried by continuation jobs. If the
   * source changes between batches, the continuation restarts at chunk 0 so
   * chunk indices never mix embeddings from two different rendered texts.
   */
  embeddingSourceHash?: string;
  /**
   * Internal chunk-layout version carried by continuation jobs. A worker
   * restarts continuations created by a different algorithm so numeric chunk
   * cursors never mix point layouts across deployments.
   */
  embeddingChunkingVersion?: string;
  /**
   * Internal model id carried by continuation jobs so an orphaned continuation
   * can still prune stale tail chunks even when it has no new chunk to embed.
   */
  embeddingModel?: string;
}

export interface EmbedRawEventJobData extends EmbedJobBase {
  scope?: 'raw_event';
  rawEventId: string;
  /** Legacy: when present without an explicit `scope='fact'`, the worker
   *  still treats this as fact-scope. New code should set scope explicitly. */
  factId?: string;
}

export interface EmbedFactJobData extends EmbedJobBase {
  scope: 'fact';
  rawEventId: string;
  factId: string;
}

export interface EmbedObjectJobData extends EmbedJobBase {
  scope: 'object';
  objectId: string;
}

export interface EmbedObjectNoteJobData extends EmbedJobBase {
  scope: 'object_note';
  noteId: string;
}

export interface EmbedObjectChangeJobData extends EmbedJobBase {
  scope: 'object_change';
  changeId: string;
}

export interface EmbedEntityJobData extends EmbedJobBase {
  scope: 'entity';
  entityId: string;
}

/**
 * Phase 9: one job per chunk of a finalised `document_versions` row.
 * The worker hydrates the chunk + document + version, stamps a
 * `source_kind='doc_chunk'` payload, and upserts a deterministic point
 * via `(doc_chunk, chunkId, model, chunk_index)`. Idempotent under duplicate
 * enqueue; oversized chunk text continues through bounded child jobs.
 */
export interface EmbedDocChunkJobData extends EmbedJobBase {
  scope: 'doc_chunk';
  documentChunkId: string;
}

/**
 * Phase 10: one job per `meeting_transcript_chunks` row. The worker
 * hydrates chunk + parent meeting, stamps a `source_kind='meeting_chunk'`
 * payload, and upserts via `(meeting_chunk, chunkId, model, chunk_index)`.
 * Idempotent under duplicate enqueue; oversized chunk text continues through
 * bounded child jobs. The parent raw_event (per-utterance) is embedded by the
 * standard raw_event job; this is the second, utterance-granular point.
 */
export interface EmbedMeetingChunkJobData extends EmbedJobBase {
  scope: 'meeting_chunk';
  meetingChunkId: string;
}

export interface EmbedCalendarEventJobData extends EmbedJobBase {
  scope: 'calendar_event';
  calendarEventId: string;
}

let _embedQueue: TimelineQueue<EmbedJobData> | undefined;

export function getEmbedQueue(): TimelineQueue<EmbedJobData> {
  if (_embedQueue) return _embedQueue;
  _embedQueue = createTimelineQueue<EmbedJobData>(QUEUE_NAMES.embed, {
    attempts: 6,
    backoff: { type: 'exponential', delay: 10_000 },
    removeOnComplete: { age: 3600, count: 1000 },
    removeOnFail: { age: 24 * 3600 },
  });
  return _embedQueue;
}

export async function enqueueEmbedJob(
  data: EmbedJobData,
  opts: { delayMs?: number } = {},
): Promise<void> {
  // Same no-jobId-dedup rationale as the other queues. Worker-side idempotency
  // is provided by deterministic Qdrant point ids derived from
  // (scope, sourceId, embedding_model, chunk_index) — duplicate enqueues upsert
  // the same point(s). Oversized sources continue through bounded child jobs.
  await getEmbedQueue().add('embed', data, {
    ...(opts.delayMs && opts.delayMs > 0 ? { delay: opts.delayMs } : {}),
  });
}

export async function enqueueObjectEmbedJob(
  teamId: string,
  objectId: string,
  opts: { targetCollection?: string } = {},
): Promise<void> {
  await enqueueEmbedJob({ scope: 'object', teamId, objectId, ...opts });
}

export async function enqueueObjectNoteEmbedJob(
  teamId: string,
  noteId: string,
  opts: { targetCollection?: string } = {},
): Promise<void> {
  await enqueueEmbedJob({ scope: 'object_note', teamId, noteId, ...opts });
}

export async function enqueueObjectChangeEmbedJob(
  teamId: string,
  changeId: string,
  opts: { targetCollection?: string } = {},
): Promise<void> {
  await enqueueEmbedJob({ scope: 'object_change', teamId, changeId, ...opts });
}

export async function enqueueEntityEmbedJob(
  teamId: string,
  entityId: string,
  opts: { targetCollection?: string } = {},
): Promise<void> {
  await enqueueEmbedJob({ scope: 'entity', teamId, entityId, ...opts });
}

export async function enqueueDocChunkEmbedJob(
  teamId: string,
  documentChunkId: string,
  opts: { targetCollection?: string } = {},
): Promise<void> {
  await enqueueEmbedJob({ scope: 'doc_chunk', teamId, documentChunkId, ...opts });
}

export async function enqueueMeetingChunkEmbedJob(
  teamId: string,
  meetingChunkId: string,
  opts: { targetCollection?: string } = {},
): Promise<void> {
  await enqueueEmbedJob({ scope: 'meeting_chunk', teamId, meetingChunkId, ...opts });
}

export async function enqueueCalendarEventEmbedJob(
  teamId: string,
  calendarEventId: string,
  opts: { targetCollection?: string } = {},
): Promise<void> {
  await enqueueEmbedJob({ scope: 'calendar_event', teamId, calendarEventId, ...opts });
}

export async function closeEmbedQueue(): Promise<void> {
  await closeQueue(_embedQueue, () => {
    _embedQueue = undefined;
  });
}

export interface OverdueScanJobData {
  /** Empty payload: the scan walks every team's entities in one pass. */
  triggeredAt?: string;
}

let _overdueScanQueue: TimelineQueue<OverdueScanJobData> | undefined;

export function getOverdueScanQueue(): TimelineQueue<OverdueScanJobData> {
  if (_overdueScanQueue) return _overdueScanQueue;
  _overdueScanQueue = createTimelineQueue<OverdueScanJobData>(QUEUE_NAMES.overdueScan, {
    // One retry — if the scan fails, the next hourly tick will pick up
    // whatever it missed. No exponential backoff to avoid pile-up.
    attempts: 2,
    backoff: { type: 'fixed', delay: 60_000 },
    removeOnComplete: { age: 3600, count: 24 },
    removeOnFail: { age: 24 * 3600 },
  });
  return _overdueScanQueue;
}

/**
 * Register the hourly repeatable. Safe to call on every worker boot — BullMQ
 * keys repeatables by `jobId`, so duplicate calls are no-ops.
 */
export async function scheduleOverdueScan(): Promise<void> {
  await getOverdueScanQueue().add(
    'scan',
    {},
    {
      // Every hour on the hour. The dedup index on notifications keys by
      // (team, user, entity, kind, date) so repeated runs within the same
      // calendar day are no-ops.
      repeat: { pattern: '0 * * * *' },
      jobId: 'overdue-scan-hourly',
    },
  );
}

export async function closeOverdueScanQueue(): Promise<void> {
  await closeQueue(_overdueScanQueue, () => {
    _overdueScanQueue = undefined;
  });
}

export interface CalendarRecurrenceJobData {
  triggeredAt?: string;
}

let _calendarRecurrenceQueue: TimelineQueue<CalendarRecurrenceJobData> | undefined;

export function getCalendarRecurrenceQueue(): TimelineQueue<CalendarRecurrenceJobData> {
  if (_calendarRecurrenceQueue) return _calendarRecurrenceQueue;
  _calendarRecurrenceQueue = createTimelineQueue<CalendarRecurrenceJobData>(
    QUEUE_NAMES.calendarRecurrence,
    {
      attempts: 2,
      backoff: { type: 'fixed', delay: 60_000 },
      removeOnComplete: { age: 3600, count: 24 },
      removeOnFail: { age: 24 * 3600 },
    },
  );
  return _calendarRecurrenceQueue;
}

export async function scheduleCalendarRecurrenceMaterialization(): Promise<void> {
  await getCalendarRecurrenceQueue().add(
    'materialize',
    {},
    {
      repeat: { pattern: '0 * * * *' },
      jobId: 'calendar-recurrence-hourly',
    },
  );
}

export async function closeCalendarRecurrenceQueue(): Promise<void> {
  await closeQueue(_calendarRecurrenceQueue, () => {
    _calendarRecurrenceQueue = undefined;
  });
}

export interface DocumentExtractJobData {
  documentVersionId: string;
  teamId: string;
  /** Override target Qdrant collection for the embed fan-out — used by the
   *  redocument-embed migration script. Threaded into each chunk's embed
   *  job verbatim. */
  targetCollection?: string;
}

let _documentExtractQueue: TimelineQueue<DocumentExtractJobData> | undefined;

export function getDocumentExtractQueue(): TimelineQueue<DocumentExtractJobData> {
  if (_documentExtractQueue) return _documentExtractQueue;
  _documentExtractQueue = createTimelineQueue<DocumentExtractJobData>(QUEUE_NAMES.documentExtract, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { age: 3600, count: 1000 },
    removeOnFail: { age: 24 * 3600 },
  });
  return _documentExtractQueue;
}

export async function enqueueDocumentExtractJob(data: DocumentExtractJobData): Promise<void> {
  // No jobId-based dedup for the same reasons as the other queues:
  // worker-side idempotency comes from advisory locks on
  // `document_versions.id` plus the deterministic chunk-embed point ids.
  await getDocumentExtractQueue().add('document-extract', data);
}

export async function closeDocumentExtractQueue(): Promise<void> {
  await closeQueue(_documentExtractQueue, () => {
    _documentExtractQueue = undefined;
  });
}

// Phase 10 — Meeting finalize. Triggered by the status webhook when the
// bot reports call_ended or transcript.done. Worker generates summary,
// extracts action items, records minutes.
export interface MeetingFinalizeJobData {
  meetingId: string;
  teamId: string;
}

let _meetingFinalizeQueue: TimelineQueue<MeetingFinalizeJobData> | undefined;

export function getMeetingFinalizeQueue(): TimelineQueue<MeetingFinalizeJobData> {
  if (_meetingFinalizeQueue) return _meetingFinalizeQueue;
  _meetingFinalizeQueue = createTimelineQueue<MeetingFinalizeJobData>(QUEUE_NAMES.meetingFinalize, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { age: 3600, count: 1000 },
    removeOnFail: { age: 24 * 3600 },
  });
  return _meetingFinalizeQueue;
}

export async function enqueueMeetingFinalizeJob(data: MeetingFinalizeJobData): Promise<void> {
  // Worker-side idempotency: a finalised meeting is a no-op on re-run,
  // and the `meeting_usage` unique index protects minute double-counting.
  await getMeetingFinalizeQueue().add('meeting-finalize', data);
}

export async function closeMeetingFinalizeQueue(): Promise<void> {
  await closeQueue(_meetingFinalizeQueue, () => {
    _meetingFinalizeQueue = undefined;
  });
}

export interface MeetingSchedulerJobData {
  triggeredAt?: string;
}

let _meetingSchedulerQueue: TimelineQueue<MeetingSchedulerJobData> | undefined;

export function getMeetingSchedulerQueue(): TimelineQueue<MeetingSchedulerJobData> {
  if (_meetingSchedulerQueue) return _meetingSchedulerQueue;
  _meetingSchedulerQueue = createTimelineQueue<MeetingSchedulerJobData>(
    QUEUE_NAMES.meetingScheduler,
    {
      attempts: 2,
      backoff: { type: 'fixed', delay: 30_000 },
      removeOnComplete: { age: 3600, count: 1000 },
      removeOnFail: { age: 24 * 3600 },
    },
  );
  return _meetingSchedulerQueue;
}

export async function scheduleMeetingSchedulerTick(): Promise<void> {
  await getMeetingSchedulerQueue().add(
    'meeting-scheduler-tick',
    {},
    {
      repeat: { pattern: '*/2 * * * *' },
      jobId: 'meeting-scheduler-tick-2min',
    },
  );
}

export async function enqueueMeetingSchedulerTick(): Promise<void> {
  await getMeetingSchedulerQueue().add('meeting-scheduler-tick', {
    triggeredAt: new Date().toISOString(),
  });
}

export async function closeMeetingSchedulerQueue(): Promise<void> {
  await closeQueue(_meetingSchedulerQueue, () => {
    _meetingSchedulerQueue = undefined;
  });
}

export interface JanitorJobData {
  /** Empty payload: the sweep walks every team's stuck rows in one pass. */
  triggeredAt?: string;
}

let _janitorQueue: TimelineQueue<JanitorJobData> | undefined;

export function getJanitorQueue(): TimelineQueue<JanitorJobData> {
  if (_janitorQueue) return _janitorQueue;
  _janitorQueue = createTimelineQueue<JanitorJobData>(QUEUE_NAMES.janitor, {
    // One retry — the next hourly tick covers a missed sweep, and the
    // re-enqueue actions are themselves idempotent (worker advisory
    // locks bail under-lock).
    attempts: 2,
    backoff: { type: 'fixed', delay: 60_000 },
    removeOnComplete: { age: 3600, count: 24 },
    removeOnFail: { age: 24 * 3600 },
  });
  return _janitorQueue;
}

/**
 * Register the hourly janitor repeatable. Safe to call on every worker
 * boot — BullMQ keys repeatables by `jobId`, so duplicate calls are no-ops.
 */
export async function scheduleJanitorSweep(): Promise<void> {
  await getJanitorQueue().add(
    'sweep',
    {},
    {
      // Every 5 minutes. Each tick is two indexed SELECTs on small result
      // sets; cost is negligible. 5min cadence gives ~7.5min recovery for
      // a stuck `pending` row (5min threshold + up to 5min for next tick),
      // which beats the 30-60min you'd get from an hourly sweep without
      // adding noticeable DB load.
      repeat: { pattern: '*/5 * * * *' },
      jobId: 'janitor-tick',
    },
  );
}

export async function closeJanitorQueue(): Promise<void> {
  await closeQueue(_janitorQueue, () => {
    _janitorQueue = undefined;
  });
}

// Phase 11 — Integration sync. Job data is a discriminated union of
// backfill (one-shot full walk) and incremental (delta from cursor).
// Both run per (integration_id, resource_type or empty); the worker
// resolves the provider and dispatches.
export type IntegrationSyncJobData =
  | {
      kind: 'backfill';
      integrationId: string;
      teamId: string;
      triggeredBy?: string;
    }
  | {
      kind: 'incremental';
      integrationId: string;
      teamId: string;
      triggeredBy?: string;
    }
  | {
      kind: 'targeted';
      integrationId: string;
      teamId: string;
      triggeredBy?: string;
      resourceType: string;
      externalId: string;
      surface?: string;
      reason?: string;
      /** Bounded handoff count used when a continuation finds its integration lock busy. */
      continuationAttempt?: number;
      /**
       * Durable Postgres outbox identity. Unlike ordinary pagination jobs,
       * retries of this exact handoff must be idempotent after an ambiguous
       * Redis/BullMQ response.
       */
      continuationHandoffId?: string;
    };

export interface WebhookDeliveryJobData {
  deliveryId: string;
}

let _webhookDeliveryQueue: TimelineQueue<WebhookDeliveryJobData> | undefined;

export function getWebhookDeliveryQueue(): TimelineQueue<WebhookDeliveryJobData> {
  if (_webhookDeliveryQueue) return _webhookDeliveryQueue;
  _webhookDeliveryQueue = createTimelineQueue<WebhookDeliveryJobData>(QUEUE_NAMES.webhookDelivery, {
    attempts: 5,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: { age: 3600, count: 1000 },
    removeOnFail: { age: 24 * 3600 },
  });
  return _webhookDeliveryQueue;
}

export async function enqueueWebhookDeliveryJob(data: WebhookDeliveryJobData): Promise<void> {
  await getWebhookDeliveryQueue().add('webhook-delivery', data, {
    jobId: bullmqCustomJobId(['webhook-delivery', data.deliveryId]),
  });
}

export async function closeWebhookDeliveryQueue(): Promise<void> {
  await closeQueue(_webhookDeliveryQueue, () => {
    _webhookDeliveryQueue = undefined;
  });
}

let _integrationSyncQueue: TimelineQueue<IntegrationSyncJobData> | undefined;

export function getIntegrationSyncQueue(): TimelineQueue<IntegrationSyncJobData> {
  if (_integrationSyncQueue) return _integrationSyncQueue;
  _integrationSyncQueue = createTimelineQueue<IntegrationSyncJobData>(QUEUE_NAMES.integrationSync, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { age: 3600, count: 1000 },
    removeOnFail: { age: 24 * 3600 },
  });
  return _integrationSyncQueue;
}

const INTEGRATION_SYNC_JOB_DEDUPE_STATES = new Set([
  'active',
  'delayed',
  'paused',
  'prioritized',
  'waiting',
  'waiting-children',
]);

const INTEGRATION_SYNC_JOB_REPLACEABLE_STATES = new Set(['completed', 'failed']);

function integrationSyncJobId(data: IntegrationSyncJobData): string | undefined {
  if (data.kind === 'incremental' && data.triggeredBy === 'reconcile') {
    return bullmqCustomJobId(['integration-reconcile', data.integrationId]);
  }
  if (data.kind !== 'targeted') return undefined;
  if (data.reason === 'provider_pagination_continuation') {
    return data.continuationHandoffId
      ? bullmqCustomJobId(['integration-pagination-continuation', data.continuationHandoffId])
      : undefined;
  }
  return bullmqCustomJobId([
    'integration-targeted',
    data.integrationId,
    data.resourceType,
    data.externalId,
    data.surface ?? 'all',
  ]);
}

export async function enqueueIntegrationSyncJob(
  data: IntegrationSyncJobData,
  opts: { delayMs?: number } = {},
): Promise<void> {
  // Backfill and broad incremental jobs intentionally avoid jobId dedupe:
  // idempotency lives in raw_event dedup keys, per-resource cursors, and the
  // worker's advisory lock. Provider-policy reconciliation and targeted webhook
  // hydration are different: due broad reconciliation should not stack while a
  // prior run is pending, and a burst of provider deliveries for the same
  // repo/board/project should collapse while a job is waiting or running. A
  // later delivery/reconciliation must be able to enqueue once the retained
  // completed/failed BullMQ job is removed.
  const q = getIntegrationSyncQueue();
  const jobId = integrationSyncJobId(data);
  if (jobId) {
    const existing = (await q.getJob(jobId)) as ExistingJobLike | null;
    if (existing) {
      // A durable outbox handoff is acknowledged only after this function
      // returns. Any retained job state proves BullMQ already accepted its
      // stable handoff id, including a completed job after an "accepted then
      // Redis connection dropped" error. Do not recycle it into a duplicate.
      if (data.kind === 'targeted' && data.continuationHandoffId) return;
      const state = await existing.getState?.().catch(() => null);
      if (!state || INTEGRATION_SYNC_JOB_DEDUPE_STATES.has(state)) return;
      if (INTEGRATION_SYNC_JOB_REPLACEABLE_STATES.has(state)) {
        if (!existing.remove) return;
        const removed = await existing.remove().then(
          () => true,
          () => false,
        );
        if (!removed) return;
      } else {
        return;
      }
    }
  }
  const addOptions = {
    ...(jobId ? { jobId } : {}),
    ...(opts.delayMs && opts.delayMs > 0 ? { delay: opts.delayMs } : {}),
  };
  await q.add(
    'integration-sync',
    data,
    Object.keys(addOptions).length > 0 ? addOptions : undefined,
  );
}

/**
 * Register the 5-minute reconciliation heartbeat. Cheap when no integrations
 * are configured; one synthetic job is enqueued per tick whose worker consults
 * provider policies and budgets before fanning out due reconciliation work.
 */
export async function scheduleIntegrationIncrementalSync(): Promise<void> {
  await getIntegrationSyncQueue().add(
    'integration-tick',
    { kind: 'incremental', integrationId: '__tick__', teamId: '__tick__' },
    {
      repeat: { pattern: '*/5 * * * *' },
      jobId: 'integration-sync-tick-5min',
    },
  );
}

export async function closeIntegrationSyncQueue(): Promise<void> {
  await closeQueue(_integrationSyncQueue, () => {
    _integrationSyncQueue = undefined;
  });
}

// Phase 11 — MCP health ping. Single synthetic tick fans out to every
// enabled MCP server; the worker sweeps in one pass and updates
// last_connected_at / last_error so the UI can show health without
// waiting for a chat turn to surface a broken server.
export interface McpHealthJobData {
  triggeredAt?: string;
}

let _mcpHealthQueue: TimelineQueue<McpHealthJobData> | undefined;

export function getMcpHealthQueue(): TimelineQueue<McpHealthJobData> {
  if (_mcpHealthQueue) return _mcpHealthQueue;
  _mcpHealthQueue = createTimelineQueue<McpHealthJobData>(QUEUE_NAMES.mcpHealth, {
    attempts: 2,
    backoff: { type: 'fixed', delay: 30_000 },
    removeOnComplete: { age: 3600, count: 24 },
    removeOnFail: { age: 24 * 3600 },
  });
  return _mcpHealthQueue;
}

export async function scheduleMcpHealthPing(): Promise<void> {
  await getMcpHealthQueue().add(
    'mcp-health-tick',
    {},
    {
      repeat: { pattern: '*/5 * * * *' },
      jobId: 'mcp-health-tick-5min',
    },
  );
}

export async function closeMcpHealthQueue(): Promise<void> {
  await closeQueue(_mcpHealthQueue, () => {
    _mcpHealthQueue = undefined;
  });
}

export interface TeamExportJobData {
  teamExportId: string;
  teamId: string;
  requestedByUserId: string;
}

let _teamExportQueue: TimelineQueue<TeamExportJobData> | undefined;

export function getTeamExportQueue(): TimelineQueue<TeamExportJobData> {
  if (_teamExportQueue) return _teamExportQueue;
  _teamExportQueue = createTimelineQueue<TeamExportJobData>(QUEUE_NAMES.teamExport, {
    attempts: 2,
    backoff: { type: 'exponential', delay: 10_000 },
    removeOnComplete: { age: 3600, count: 1000 },
    removeOnFail: { age: 24 * 3600 },
  });
  return _teamExportQueue;
}

export async function enqueueTeamExportJob(data: TeamExportJobData): Promise<void> {
  await getTeamExportQueue().add('team-export', data, { jobId: data.teamExportId });
}

export async function closeTeamExportQueue(): Promise<void> {
  await closeQueue(_teamExportQueue, () => {
    _teamExportQueue = undefined;
  });
}

export type DailyDigestJobData =
  | { kind: 'tick'; windowStart?: string; windowEnd?: string; reason?: 'scheduled' | 'catchup' }
  | {
      kind: 'recipient';
      teamId: string;
      userId: string;
      email: string;
      windowStart: string;
      windowEnd: string;
    }
  | { kind: 'send'; digestId: string; email: string };

let _dailyDigestQueue: TimelineQueue<DailyDigestJobData> | undefined;

export function getDailyDigestQueue(): TimelineQueue<DailyDigestJobData> {
  if (_dailyDigestQueue) return _dailyDigestQueue;
  _dailyDigestQueue = createTimelineQueue<DailyDigestJobData>(QUEUE_NAMES.dailyDigest, {
    attempts: 2,
    backoff: { type: 'exponential', delay: 60_000 },
    removeOnComplete: { age: 24 * 3600, count: 1000 },
    removeOnFail: { age: 7 * 24 * 3600 },
  });
  return _dailyDigestQueue;
}

export async function scheduleDailyDigest(): Promise<void> {
  const queue = getDailyDigestQueue();
  // BullMQ v5 keeps legacy repeatables separate from Job Schedulers. The legacy
  // cleanup API is deprecated for new code, but it is still the migration path.
  await (queue as LegacyRepeatableQueue).removeRepeatable(
    'tick',
    { pattern: '0 12 * * *' },
    'daily-digest-1200-utc',
  );
  await queue.upsertJobScheduler(
    'daily-digest-1200-utc',
    { pattern: '0 12 * * *' },
    { name: 'tick', data: { kind: 'tick', reason: 'scheduled' } },
  );
  await enqueueDailyDigestCatchupJob();
}

export async function enqueueDailyDigestCatchupJob(now: Date = new Date()): Promise<void> {
  const window = defaultDigestWindow(now);
  await getDailyDigestQueue().add(
    'tick',
    {
      kind: 'tick',
      reason: 'catchup',
    },
    {
      jobId: bullmqCustomJobId([
        'daily-digest-catchup',
        window.start.toISOString(),
        window.end.toISOString(),
      ]),
    },
  );
}

export async function enqueueDailyDigestRecipientJob(
  data: Extract<DailyDigestJobData, { kind: 'recipient' }>,
): Promise<void> {
  await getDailyDigestQueue().add('recipient', data, {
    jobId: bullmqCustomJobId([
      'daily-digest',
      data.teamId,
      data.userId,
      data.windowStart,
      data.windowEnd,
    ]),
  });
}

export async function enqueueDailyDigestSendJob(
  data: Extract<DailyDigestJobData, { kind: 'send' }>,
): Promise<void> {
  await getDailyDigestQueue().add('send', data, {
    jobId: bullmqCustomJobId(['daily-digest-send', data.digestId]),
  });
}

export async function closeDailyDigestQueue(): Promise<void> {
  await closeQueue(_dailyDigestQueue, () => {
    _dailyDigestQueue = undefined;
  });
}

export interface ObjectSummaryJobData {
  teamId: string;
  objectId: string;
  trigger?: 'manual' | 'auto' | 'retry';
}

let _objectSummaryQueue: TimelineQueue<ObjectSummaryJobData> | undefined;

export function getObjectSummaryQueue(): TimelineQueue<ObjectSummaryJobData> {
  if (_objectSummaryQueue) return _objectSummaryQueue;
  _objectSummaryQueue = createTimelineQueue<ObjectSummaryJobData>(QUEUE_NAMES.objectSummary, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { age: 3600, count: 1000 },
    removeOnFail: { age: 24 * 3600 },
  });
  return _objectSummaryQueue;
}

export async function enqueueObjectSummaryJob(
  data: ObjectSummaryJobData,
  opts: { delayMs?: number } = {},
): Promise<{ enqueued: boolean; jobId: string }> {
  const jobId = bullmqCustomJobId(['object-summary', data.teamId, data.objectId]);
  const q = getObjectSummaryQueue();
  const existing = (await q.getJob(jobId)) as ExistingJobLike | null;
  if (existing) {
    const state = await existing.getState?.().catch(() => null);
    if (data.trigger === 'manual' && state === 'delayed' && existing.remove) {
      await existing.remove().catch(() => undefined);
    } else if ((data.trigger === 'auto' || data.trigger === 'manual') && state === 'active') {
      const followupJobId = bullmqCustomJobId([
        'object-summary',
        data.teamId,
        data.objectId,
        'followup',
      ]);
      const followup = (await q.getJob(followupJobId)) as ExistingJobLike | null;
      if (followup) {
        const followupState = await followup.getState?.().catch(() => null);
        if (!followupState || SUGGESTION_JOB_DEDUPE_STATES.has(followupState)) {
          return { enqueued: false, jobId: followupJobId };
        }
        if (SUGGESTION_JOB_REPLACEABLE_STATES.has(followupState) && followup.remove) {
          await followup.remove().catch(() => undefined);
        } else {
          return { enqueued: false, jobId: followupJobId };
        }
      }
      await q.add('object-summary', data, {
        jobId: followupJobId,
        ...(opts.delayMs ? { delay: opts.delayMs } : {}),
      });
      return { enqueued: true, jobId: followupJobId };
    } else if (!state || SUGGESTION_JOB_DEDUPE_STATES.has(state)) {
      return { enqueued: false, jobId };
    } else if (SUGGESTION_JOB_REPLACEABLE_STATES.has(state) && existing.remove) {
      await existing.remove().catch(() => undefined);
    } else {
      return { enqueued: false, jobId };
    }
  }
  await q.add('object-summary', data, {
    jobId,
    ...(opts.delayMs ? { delay: opts.delayMs } : {}),
  });
  return { enqueued: true, jobId };
}

export async function closeObjectSummaryQueue(): Promise<void> {
  await closeQueue(_objectSummaryQueue, () => {
    _objectSummaryQueue = undefined;
  });
}

export interface TaskCategoryClassificationJobData {
  kind?: 'classify';
  teamId: string;
  taskId: string;
  inputHash: string;
  trigger: 'create' | 'context_change' | 'project_change' | 'retry' | 'backfill';
}

export interface TaskCategoryProjectFanoutJobData {
  kind: 'project_fanout';
  teamId: string;
  projectId: string;
  projectVersion: string;
  afterTaskId: string | null;
}

export type TaskCategoryJobData =
  | TaskCategoryClassificationJobData
  | TaskCategoryProjectFanoutJobData;

let _taskCategoryQueue: TimelineQueue<TaskCategoryJobData> | undefined;

export function getTaskCategoryQueue(): TimelineQueue<TaskCategoryJobData> {
  if (_taskCategoryQueue) return _taskCategoryQueue;
  _taskCategoryQueue = createTimelineQueue<TaskCategoryJobData>(QUEUE_NAMES.taskCategory, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { age: 3600, count: 2000 },
    removeOnFail: { age: 24 * 3600 },
  });
  return _taskCategoryQueue;
}

export async function enqueueTaskCategoryJob(
  data: TaskCategoryJobData,
): Promise<{ enqueued: boolean; jobId: string }> {
  const jobId =
    data.kind === 'project_fanout'
      ? bullmqCustomJobId([
          'task-category-project-fanout',
          data.teamId,
          data.projectId,
          data.projectVersion,
          data.afterTaskId ?? 'start',
        ])
      : bullmqCustomJobId(['task-category', data.teamId, data.taskId, data.inputHash]);
  const env = getEnv();
  const isBackfill = data.kind !== 'project_fanout' && data.trigger === 'backfill';
  if (
    !env.TASK_CATEGORY_CLASSIFICATION_ENABLED ||
    (isBackfill ? !env.TASK_CATEGORY_BACKFILL_ENABLED : !env.TASK_CATEGORY_AUTO_ENQUEUE_ENABLED)
  ) {
    return { enqueued: false, jobId };
  }
  const q = getTaskCategoryQueue();
  const existing = (await q.getJob(jobId)) as ExistingJobLike | null;
  if (existing) {
    if (!existing.getState) throw new Error(`Task category job state is unavailable: ${jobId}`);
    const state = await existing.getState();
    if (SUGGESTION_JOB_DEDUPE_STATES.has(state)) return { enqueued: false, jobId };
    if (SUGGESTION_JOB_REPLACEABLE_STATES.has(state) && existing.remove) {
      await existing.remove();
    } else {
      throw new Error(`Task category job is in unsupported state "${state}": ${jobId}`);
    }
  }
  await q.add('task-category', data, { jobId });
  return { enqueued: true, jobId };
}

export async function closeTaskCategoryQueue(): Promise<void> {
  await closeQueue(_taskCategoryQueue, () => {
    _taskCategoryQueue = undefined;
  });
}

export type ReconciliationJobData =
  | {
      kind: 'evidence_audit';
      teamId: string;
      source?: string;
      limit?: number;
      pageSize?: number;
      triggeredBy?: string;
    }
  | {
      kind: 'evidence_backfill';
      teamId: string;
      source?: string;
      limit?: number;
      pageSize?: number;
      dryRun?: boolean;
      missingOnly?: boolean;
      triggeredBy?: string;
    }
  | {
      kind: 'scope_reconcile';
      teamId: string;
      scope: 'team' | 'object' | 'cluster';
      targetId?: string;
      triggeredBy?: string;
      reason?: string;
      plannerReplayLimit?: number;
      plannerReplayMode?: 'missing' | 'all';
      plannerReplaySource?: string;
      plannerReplayOccurredAfter?: string;
      plannerReplayOccurredBefore?: string;
    };

let _reconciliationQueue: TimelineQueue<ReconciliationJobData> | undefined;

export function getReconciliationQueue(): TimelineQueue<ReconciliationJobData> {
  if (_reconciliationQueue) return _reconciliationQueue;
  _reconciliationQueue = createTimelineQueue<ReconciliationJobData>(QUEUE_NAMES.reconciliation, {
    attempts: 2,
    backoff: { type: 'exponential', delay: 10_000 },
    removeOnComplete: { age: 24 * 3600, count: 1000 },
    removeOnFail: { age: 7 * 24 * 3600 },
  });
  return _reconciliationQueue;
}

function reconciliationJobId(data: ReconciliationJobData): string {
  if (data.kind === 'scope_reconcile') {
    return bullmqCustomJobId([
      data.kind,
      data.teamId,
      data.scope,
      data.targetId ?? 'team',
      data.triggeredBy ?? 'manual',
      data.reason ?? 'manual',
      data.plannerReplayLimit === undefined
        ? 'default-planner-replay'
        : String(data.plannerReplayLimit),
      data.plannerReplayMode ?? 'missing',
      data.plannerReplaySource ?? 'all-sources',
      data.plannerReplayOccurredAfter ?? 'unbounded-start',
      data.plannerReplayOccurredBefore ?? 'unbounded-end',
    ]);
  }

  return bullmqCustomJobId([
    data.kind,
    data.teamId,
    data.source ?? 'all',
    data.limit === undefined ? 'all' : String(data.limit),
    data.pageSize === undefined ? 'default-page' : String(data.pageSize),
    'dryRun' in data ? String(data.dryRun ?? false) : 'audit',
    'missingOnly' in data ? String(data.missingOnly ?? true) : 'audit',
    data.triggeredBy ?? 'manual',
  ]);
}

export async function enqueueReconciliationJob(data: ReconciliationJobData): Promise<void> {
  const q = getReconciliationQueue();
  const jobId = reconciliationJobId(data);
  const existing = (await q.getJob(jobId)) as ExistingJobLike | null;
  if (existing) {
    const state = await existing.getState?.().catch(() => null);
    if (!state || SUGGESTION_JOB_DEDUPE_STATES.has(state)) return;
    if (SUGGESTION_JOB_REPLACEABLE_STATES.has(state)) {
      if (!existing.remove) return;
      const removed = await existing.remove().then(
        () => true,
        () => false,
      );
      if (!removed) return;
    } else {
      return;
    }
  }
  await q.add('reconciliation', data, { jobId });
}

export async function closeReconciliationQueue(): Promise<void> {
  await closeQueue(_reconciliationQueue, () => {
    _reconciliationQueue = undefined;
  });
}

export interface TimelineMomentPresentationJobData {
  teamId: string;
  userId: string;
  rawEventIds: string[];
  cacheKey: {
    teamId: string;
    momentKey: string;
    visibilityScopeHash: string;
    visibleSourceEventIdsHash: string;
    visibleSourceContentHash: string;
    impactHydrationHash: string;
    artifactClusterHash: string;
    promptVersion: string;
    model: string;
  };
}

let _timelineMomentPresentationQueue: TimelineQueue<TimelineMomentPresentationJobData> | undefined;

export function getTimelineMomentPresentationQueue(): TimelineQueue<TimelineMomentPresentationJobData> {
  if (_timelineMomentPresentationQueue) return _timelineMomentPresentationQueue;
  _timelineMomentPresentationQueue = createTimelineQueue<TimelineMomentPresentationJobData>(
    QUEUE_NAMES.timelineMomentPresentation,
    {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: { age: 3600, count: 1000 },
      removeOnFail: { age: 24 * 3600 },
    },
  );
  return _timelineMomentPresentationQueue;
}

export async function enqueueTimelineMomentPresentationJob(
  data: TimelineMomentPresentationJobData,
  opts: { delayMs?: number } = {},
): Promise<{ enqueued: boolean; jobId: string }> {
  const jobId = bullmqCustomJobId([
    'timeline-moment-presentation',
    data.teamId,
    data.cacheKey.momentKey,
    data.cacheKey.visibleSourceEventIdsHash,
    data.cacheKey.visibleSourceContentHash,
    data.cacheKey.visibilityScopeHash,
    data.cacheKey.promptVersion,
    data.cacheKey.model,
  ]);
  const q = getTimelineMomentPresentationQueue();
  const existing = (await q.getJob(jobId)) as ExistingJobLike | null;
  if (existing) {
    const state = await existing.getState?.().catch(() => null);
    if (!state || SUGGESTION_JOB_DEDUPE_STATES.has(state)) {
      return { enqueued: false, jobId };
    }
    if (SUGGESTION_JOB_REPLACEABLE_STATES.has(state) && existing.remove) {
      await existing.remove().catch(() => undefined);
    } else {
      return { enqueued: false, jobId };
    }
  }
  await q.add('timeline-moment-presentation', data, {
    jobId,
    ...(opts.delayMs ? { delay: opts.delayMs } : {}),
  });
  return { enqueued: true, jobId };
}

export async function closeTimelineMomentPresentationQueue(): Promise<void> {
  await closeQueue(_timelineMomentPresentationQueue, () => {
    _timelineMomentPresentationQueue = undefined;
  });
}

export interface ConversationAgentJobData {
  turnId: string;
  teamId: string;
  userId: string;
}

let _conversationAgentQueue: TimelineQueue<ConversationAgentJobData> | undefined;

export function getConversationAgentQueue(): TimelineQueue<ConversationAgentJobData> {
  if (_conversationAgentQueue) return _conversationAgentQueue;
  _conversationAgentQueue = createTimelineQueue<ConversationAgentJobData>(
    QUEUE_NAMES.conversationAgent,
    {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: { age: 3600, count: 1000 },
      removeOnFail: { age: 24 * 3600 },
    },
  );
  return _conversationAgentQueue;
}

export async function enqueueConversationAgentJob(
  data: ConversationAgentJobData,
): Promise<{ enqueued: boolean; jobId: string }> {
  const queue = getConversationAgentQueue();
  const existing = (await queue.getJob(data.turnId)) as ExistingJobLike | null;
  if (existing) {
    const state = await existing.getState?.().catch(() => null);
    if (state !== 'failed' || !existing.remove) {
      return { enqueued: false, jobId: data.turnId };
    }
    const removed = await existing.remove().then(
      () => true,
      () => false,
    );
    if (!removed) return { enqueued: false, jobId: data.turnId };
  }
  await queue.add('conversation-agent', data, { jobId: data.turnId });
  return { enqueued: true, jobId: data.turnId };
}

export async function closeConversationAgentQueue(): Promise<void> {
  await closeQueue(_conversationAgentQueue, () => {
    _conversationAgentQueue = undefined;
  });
}

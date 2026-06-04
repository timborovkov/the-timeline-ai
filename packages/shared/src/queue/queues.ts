import { Queue } from 'bullmq';

import { getRedisConnection } from '#src/queue/connection.js';

type TimelineQueue<TData> = Queue<TData, unknown, string, TData, unknown, string>;

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
  // Phase 9: document upload → text extract → chunk → embed pipeline.
  // The `documentExtract` worker fans out to many `embed` jobs (one per
  // chunk) once chunking succeeds; embed shares the existing queue.
  documentExtract: 'document-extract',
  // Phase 10: end-of-meeting finalisation — summary, action-item
  // extraction, usage recording. Triggered by the Recall status webhook
  // on `bot.call_ended` / `transcript.done`.
  meetingFinalize: 'meeting-finalize',
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
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

export interface TranscribeJobData {
  rawEventId: string;
  teamId: string;
  audioKey: string;
}

let _transcribeQueue: TimelineQueue<TranscribeJobData> | undefined;

export function getTranscribeQueue(): TimelineQueue<TranscribeJobData> {
  if (_transcribeQueue) return _transcribeQueue;
  _transcribeQueue = new Queue<
    TranscribeJobData,
    unknown,
    string,
    TranscribeJobData,
    unknown,
    string
  >(QUEUE_NAMES.transcribe, {
    connection: getRedisConnection(),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: { age: 3600, count: 1000 },
      removeOnFail: { age: 24 * 3600 },
    },
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
  if (!_transcribeQueue) return;
  const q = _transcribeQueue;
  _transcribeQueue = undefined;
  await q.close().catch(() => undefined);
}

export interface ExtractJobData {
  rawEventId: string;
  teamId: string;
}

let _extractQueue: TimelineQueue<ExtractJobData> | undefined;

export function getExtractQueue(): TimelineQueue<ExtractJobData> {
  if (_extractQueue) return _extractQueue;
  _extractQueue = new Queue<ExtractJobData, unknown, string, ExtractJobData, unknown, string>(
    QUEUE_NAMES.extract,
    {
      connection: getRedisConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: { age: 3600, count: 1000 },
        removeOnFail: { age: 24 * 3600 },
      },
    },
  );
  return _extractQueue;
}

export async function enqueueExtractJob(data: ExtractJobData): Promise<void> {
  // Same no-jobId-dedup rationale as transcribe: row-level idempotency lives
  // in the worker, which skips when facts for (rawEventId, modelVersion)
  // already exist. A duplicate enqueue costs at most one extra DB lookup.
  await getExtractQueue().add('extract', data);
}

export async function closeExtractQueue(): Promise<void> {
  if (!_extractQueue) return;
  const q = _extractQueue;
  _extractQueue = undefined;
  await q.close().catch(() => undefined);
}

export type SuggestionJobData = SuggestionRawEventJobData | SuggestionConversationReviewJobData;

export interface SuggestionRawEventJobData {
  rawEventId: string;
  teamId: string;
}

export interface SuggestionConversationReviewJobData {
  scope: 'conversation_review';
  conversationReviewId: string;
  teamId: string;
}

let _suggestionQueue: TimelineQueue<SuggestionJobData> | undefined;

function bullmqCustomJobId(parts: string[]): string {
  return parts.map((part) => encodeURIComponent(part)).join('|');
}

export function getSuggestionQueue(): TimelineQueue<SuggestionJobData> {
  if (_suggestionQueue) return _suggestionQueue;
  _suggestionQueue = new Queue<
    SuggestionJobData,
    unknown,
    string,
    SuggestionJobData,
    unknown,
    string
  >(QUEUE_NAMES.suggestions, {
    connection: getRedisConnection(),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 3000 },
      removeOnComplete: { age: 3600, count: 1000 },
      removeOnFail: { age: 24 * 3600 },
    },
  });
  return _suggestionQueue;
}

export async function enqueueSuggestionJob(
  data: SuggestionJobData,
  opts: { delayMs?: number; jobIdSuffix?: string } = {},
): Promise<{ enqueued: boolean; jobId: string | null }> {
  const jobId =
    'scope' in data
      ? bullmqCustomJobId([
          'conversation-review',
          data.conversationReviewId,
          ...(opts.jobIdSuffix ? [opts.jobIdSuffix] : []),
        ])
      : opts.jobIdSuffix
        ? bullmqCustomJobId(['raw-event', data.rawEventId, opts.jobIdSuffix])
        : undefined;
  const q = getSuggestionQueue();
  if (jobId && (await q.getJob(jobId))) return { enqueued: false, jobId };
  await q.add('suggestions', data, {
    ...(jobId ? { jobId } : {}),
    ...(opts.delayMs ? { delay: opts.delayMs } : {}),
  });
  return { enqueued: true, jobId: jobId ?? null };
}

export async function closeSuggestionQueue(): Promise<void> {
  if (!_suggestionQueue) return;
  const q = _suggestionQueue;
  _suggestionQueue = undefined;
  await q.close().catch(() => undefined);
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
  _embedQueue = new Queue<EmbedJobData, unknown, string, EmbedJobData, unknown, string>(
    QUEUE_NAMES.embed,
    {
      connection: getRedisConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: { age: 3600, count: 1000 },
        removeOnFail: { age: 24 * 3600 },
      },
    },
  );
  return _embedQueue;
}

export async function enqueueEmbedJob(data: EmbedJobData): Promise<void> {
  // Same no-jobId-dedup rationale as the other queues. Worker-side idempotency
  // is provided by deterministic Qdrant point ids derived from
  // (scope, sourceId, embedding_model, chunk_index) — duplicate enqueues upsert
  // the same point(s). Oversized sources continue through bounded child jobs.
  await getEmbedQueue().add('embed', data);
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
  if (!_embedQueue) return;
  const q = _embedQueue;
  _embedQueue = undefined;
  await q.close().catch(() => undefined);
}

export interface OverdueScanJobData {
  /** Empty payload: the scan walks every team's entities in one pass. */
  triggeredAt?: string;
}

let _overdueScanQueue: TimelineQueue<OverdueScanJobData> | undefined;

export function getOverdueScanQueue(): TimelineQueue<OverdueScanJobData> {
  if (_overdueScanQueue) return _overdueScanQueue;
  _overdueScanQueue = new Queue<
    OverdueScanJobData,
    unknown,
    string,
    OverdueScanJobData,
    unknown,
    string
  >(QUEUE_NAMES.overdueScan, {
    connection: getRedisConnection(),
    defaultJobOptions: {
      // One retry — if the scan fails, the next hourly tick will pick up
      // whatever it missed. No exponential backoff to avoid pile-up.
      attempts: 2,
      backoff: { type: 'fixed', delay: 60_000 },
      removeOnComplete: { age: 3600, count: 24 },
      removeOnFail: { age: 24 * 3600 },
    },
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
  if (!_overdueScanQueue) return;
  const q = _overdueScanQueue;
  _overdueScanQueue = undefined;
  await q.close().catch(() => undefined);
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
  _documentExtractQueue = new Queue<
    DocumentExtractJobData,
    unknown,
    string,
    DocumentExtractJobData,
    unknown,
    string
  >(QUEUE_NAMES.documentExtract, {
    connection: getRedisConnection(),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: { age: 3600, count: 1000 },
      removeOnFail: { age: 24 * 3600 },
    },
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
  if (!_documentExtractQueue) return;
  const q = _documentExtractQueue;
  _documentExtractQueue = undefined;
  await q.close().catch(() => undefined);
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
  _meetingFinalizeQueue = new Queue<
    MeetingFinalizeJobData,
    unknown,
    string,
    MeetingFinalizeJobData,
    unknown,
    string
  >(QUEUE_NAMES.meetingFinalize, {
    connection: getRedisConnection(),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: { age: 3600, count: 1000 },
      removeOnFail: { age: 24 * 3600 },
    },
  });
  return _meetingFinalizeQueue;
}

export async function enqueueMeetingFinalizeJob(data: MeetingFinalizeJobData): Promise<void> {
  // Worker-side idempotency: a finalised meeting is a no-op on re-run,
  // and the `meeting_usage` unique index protects minute double-counting.
  await getMeetingFinalizeQueue().add('meeting-finalize', data);
}

export async function closeMeetingFinalizeQueue(): Promise<void> {
  if (!_meetingFinalizeQueue) return;
  const q = _meetingFinalizeQueue;
  _meetingFinalizeQueue = undefined;
  await q.close().catch(() => undefined);
}

export interface JanitorJobData {
  /** Empty payload: the sweep walks every team's stuck rows in one pass. */
  triggeredAt?: string;
}

let _janitorQueue: TimelineQueue<JanitorJobData> | undefined;

export function getJanitorQueue(): TimelineQueue<JanitorJobData> {
  if (_janitorQueue) return _janitorQueue;
  _janitorQueue = new Queue<JanitorJobData, unknown, string, JanitorJobData, unknown, string>(
    QUEUE_NAMES.janitor,
    {
      connection: getRedisConnection(),
      defaultJobOptions: {
        // One retry — the next hourly tick covers a missed sweep, and the
        // re-enqueue actions are themselves idempotent (worker advisory
        // locks bail under-lock).
        attempts: 2,
        backoff: { type: 'fixed', delay: 60_000 },
        removeOnComplete: { age: 3600, count: 24 },
        removeOnFail: { age: 24 * 3600 },
      },
    },
  );
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
  if (!_janitorQueue) return;
  const q = _janitorQueue;
  _janitorQueue = undefined;
  await q.close().catch(() => undefined);
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
    };

let _integrationSyncQueue: TimelineQueue<IntegrationSyncJobData> | undefined;

export function getIntegrationSyncQueue(): TimelineQueue<IntegrationSyncJobData> {
  if (_integrationSyncQueue) return _integrationSyncQueue;
  _integrationSyncQueue = new Queue<
    IntegrationSyncJobData,
    unknown,
    string,
    IntegrationSyncJobData,
    unknown,
    string
  >(QUEUE_NAMES.integrationSync, {
    connection: getRedisConnection(),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: { age: 3600, count: 1000 },
      removeOnFail: { age: 24 * 3600 },
    },
  });
  return _integrationSyncQueue;
}

export async function enqueueIntegrationSyncJob(data: IntegrationSyncJobData): Promise<void> {
  // No jobId-based dedup: idempotency lives in the raw_events
  // dedup_key partial unique index and the per-resource cursor in
  // integration_sync_state. A duplicate enqueue costs one extra API
  // page fetch + a no-op DB upsert.
  await getIntegrationSyncQueue().add('integration-sync', data);
}

/**
 * Register the 5-minute repeatable that fans out incremental syncs to
 * every enabled integration. Cheap when no integrations are configured;
 * one synthetic job is enqueued per tick whose worker fans out.
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
  if (!_integrationSyncQueue) return;
  const q = _integrationSyncQueue;
  _integrationSyncQueue = undefined;
  await q.close().catch(() => undefined);
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
  _mcpHealthQueue = new Queue<McpHealthJobData, unknown, string, McpHealthJobData, unknown, string>(
    QUEUE_NAMES.mcpHealth,
    {
      connection: getRedisConnection(),
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: 'fixed', delay: 30_000 },
        removeOnComplete: { age: 3600, count: 24 },
        removeOnFail: { age: 24 * 3600 },
      },
    },
  );
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
  if (!_mcpHealthQueue) return;
  const q = _mcpHealthQueue;
  _mcpHealthQueue = undefined;
  await q.close().catch(() => undefined);
}

export interface TeamExportJobData {
  teamExportId: string;
  teamId: string;
  requestedByUserId: string;
}

let _teamExportQueue: TimelineQueue<TeamExportJobData> | undefined;

export function getTeamExportQueue(): TimelineQueue<TeamExportJobData> {
  if (_teamExportQueue) return _teamExportQueue;
  _teamExportQueue = new Queue<
    TeamExportJobData,
    unknown,
    string,
    TeamExportJobData,
    unknown,
    string
  >(QUEUE_NAMES.teamExport, {
    connection: getRedisConnection(),
    defaultJobOptions: {
      attempts: 2,
      backoff: { type: 'exponential', delay: 10_000 },
      removeOnComplete: { age: 3600, count: 1000 },
      removeOnFail: { age: 24 * 3600 },
    },
  });
  return _teamExportQueue;
}

export async function enqueueTeamExportJob(data: TeamExportJobData): Promise<void> {
  await getTeamExportQueue().add('team-export', data, { jobId: data.teamExportId });
}

export async function closeTeamExportQueue(): Promise<void> {
  if (!_teamExportQueue) return;
  const q = _teamExportQueue;
  _teamExportQueue = undefined;
  await q.close().catch(() => undefined);
}

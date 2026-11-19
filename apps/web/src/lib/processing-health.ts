import { getEnv } from '@timeline/shared/env';
import { getQdrantClient } from '@timeline/shared/qdrant';
import { sql } from 'drizzle-orm';

import { db } from '@/lib/db';
import { boundedProbe } from '@/lib/operator-probe';
import { requireRedisQueue } from '@/lib/queue';
import { reportHandledEvent } from '@/lib/sentry-report';

export const PROCESSING_LAG_MS = 30 * 60_000;
const DIGEST_GRACE_MS = 60 * 60_000;
const DAY_MS = 24 * 60 * 60_000;
const FAILURE_THRESHOLD = 5;
const ACTIVE_SAMPLE = 100;

export function lastExpectedDigestTick(now: number): number {
  const today = new Date(now);
  today.setUTCHours(12, 0, 0, 0);
  return now >= today.getTime() + DIGEST_GRACE_MS ? today.getTime() : today.getTime() - DAY_MS;
}

async function durableProgress(now: number) {
  const observedSince = new Date(now - DAY_MS);
  const staleBefore = new Date(now - PROCESSING_LAG_MS);
  const asOf = new Date(now);
  // Cross-workspace operator inventory. The query projects aggregates only.
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL statement_timeout = '3500ms'`);
    const [row] = await tx.execute<{
      capture_completed: number;
      capture_p95_ms: number | null;
      capture_overdue: number;
      index_overdue: number;
      extract_overdue: number;
      extract_failed: number;
      digest_pending: number;
      digest_failed: number;
    }>(sql`
      WITH live_teams AS (
        SELECT id FROM teams
         WHERE disabled_at IS NULL AND deletion_started_at IS NULL AND deleted_at IS NULL
      ), captures AS (
        SELECT e.created_at, e.content_text,
          CASE WHEN pg_input_is_valid(e.source_metadata ->> 'embedded_at', 'timestamptz')
            THEN (e.source_metadata ->> 'embedded_at')::timestamptz END AS indexed_at
        FROM raw_events e JOIN live_teams t ON t.id = e.team_id
        WHERE e.created_at >= ${observedSince}
          AND (NULLIF(btrim(e.content_text), '') IS NOT NULL OR e.content_audio_url IS NOT NULL)
          AND e.visibility = 'team'
          AND e.source NOT IN ('calendar', 'system', 'document')
          AND NOT (e.source_metadata ?| array['deleted_at', 'embedding_skipped_at'])
          AND COALESCE(e.source_metadata ->> 'billing_enrichment_deferred', '') <> 'true'
          AND COALESCE(e.source_metadata ->> 'transcription_deferred', '') <> 'true'
      ), versions AS (
        SELECT v.created_at, v.processing_status,
          COALESCE(e.source_metadata ?| array['websiteId', 'websiteScanId'], false) AS website_page
        FROM document_versions v JOIN documents d ON d.id = v.document_id AND d.team_id = v.team_id
        JOIN live_teams t ON t.id = v.team_id
        LEFT JOIN raw_events e ON e.id = v.source_event_id AND e.team_id = v.team_id
        WHERE v.created_at >= ${observedSince} AND v.byte_size IS NOT NULL AND d.deleted_at IS NULL
      ), deliveries AS (
        SELECT m.created_at, m.status FROM message_deliveries m JOIN live_teams t ON t.id = m.team_id
        WHERE m.created_at >= ${observedSince} AND m.intent = 'daily_digest'
      )
      SELECT
        (SELECT count(indexed_at)::int FROM captures) AS capture_completed,
        (SELECT percentile_cont(0.95) WITHIN GROUP (
          ORDER BY greatest(0, extract(epoch FROM (indexed_at - created_at)) * 1000)
        ) FILTER (WHERE indexed_at IS NOT NULL) FROM captures) AS capture_p95_ms,
        (SELECT count(*)::int FROM captures WHERE indexed_at IS NULL AND created_at < ${staleBefore}) AS capture_overdue,
        (SELECT count(*)::int FROM captures WHERE indexed_at IS NULL AND created_at < ${staleBefore}
           AND NULLIF(btrim(content_text), '') IS NOT NULL)
          + (SELECT count(*)::int FROM versions WHERE website_page AND processing_status = 'chunked' AND created_at < ${staleBefore}) AS index_overdue,
        (SELECT count(*)::int FROM versions WHERE processing_status IN ('pending','extracting')
           AND created_at < ${staleBefore}) AS extract_overdue,
        (SELECT count(*)::int FROM versions WHERE processing_status = 'failed') AS extract_failed,
        (SELECT count(*)::int FROM deliveries WHERE status = 'pending'
           AND created_at < ${new Date(asOf.getTime() - DIGEST_GRACE_MS)}) AS digest_pending,
        (SELECT count(*)::int FROM deliveries WHERE status = 'failed') AS digest_failed
    `);
    if (!row) throw new Error('processing_summary_unavailable');
    return row;
  });
}

type QueueSource = {
  name: string;
  getJobs: (
    types: ('active' | 'waiting' | 'failed')[],
    start: number,
    end: number,
    asc: boolean,
  ) => Promise<{ timestamp: number; processedOn?: number; finishedOn?: number }[]>;
};

async function inspectQueue(queue: QueueSource, now: number) {
  const [waiting, active, failed] = await Promise.all([
    queue.getJobs(['waiting'], 0, 0, true),
    queue.getJobs(['active'], 0, ACTIVE_SAMPLE - 1, true),
    queue.getJobs(['failed'], 0, ACTIVE_SAMPLE - 1, false),
  ]);
  return {
    queue: queue.name,
    oldestWaitingMs: Math.max(0, now - (waiting[0]?.timestamp ?? now)),
    oldestActiveMs: active.reduce(
      (oldest, job) => Math.max(oldest, now - (job.processedOn ?? job.timestamp)),
      0,
    ),
    failedLastDay: failed.filter((job) => (job.finishedOn ?? job.timestamp) >= now - DAY_MS).length,
  };
}

export function queueNeedsAttention(queue: Awaited<ReturnType<typeof inspectQueue>>) {
  return (
    Math.max(queue.oldestWaitingMs, queue.oldestActiveMs) >= PROCESSING_LAG_MS ||
    queue.failedLastDay >= FAILURE_THRESHOLD
  );
}

export async function processingHealth(now = Date.now()) {
  const queue = await requireRedisQueue();
  const redis = queue.getRedisConnection();
  const env = getEnv();
  const watched = [
    queue.getTranscribeQueue(),
    queue.getExtractQueue(),
    queue.getEmbedQueue(),
    queue.getIntegrationSyncQueue(),
    queue.getWebhookDeliveryQueue(),
    queue.getSuggestionQueue(),
    queue.getReconciliationQueue(),
    queue.getDailyDigestQueue(),
    ...(env.DOCUMENT_EXTRACT_ENABLED ? [queue.getDocumentExtractQueue()] : []),
  ];
  const [durable, tick, index, ...queueProbes] = await Promise.allSettled([
    boundedProbe(() => durableProgress(now)),
    boundedProbe(() => redis.get(queue.DAILY_DIGEST_TICK_HEARTBEAT)),
    boundedProbe(() => getQdrantClient({ requireExisting: true }).collectionInfo()),
    ...watched.map((source) => boundedProbe(() => inspectQueue(source, now))),
  ] as const);
  const progress = durable.status === 'fulfilled' ? durable.value : null;
  const queues = queueProbes.flatMap((probe) =>
    probe.status === 'fulfilled' ? [probe.value] : [],
  );
  const digestMissed =
    tick.status === 'fulfilled' && Number(tick.value) < lastExpectedDigestTick(now);
  const signals = {
    capture_latency: Boolean(
      progress &&
      (progress.capture_overdue > 0 || (progress.capture_p95_ms ?? 0) >= PROCESSING_LAG_MS),
    ),
    document_extraction:
      env.DOCUMENT_EXTRACT_ENABLED &&
      Boolean(
        (progress &&
          (progress.extract_overdue > 0 || progress.extract_failed >= FAILURE_THRESHOLD)) ||
        queues.some(
          (item) => item.queue === queue.QUEUE_NAMES.documentExtract && queueNeedsAttention(item),
        ),
      ),
    proposal_jobs: queues.some(
      (item) =>
        (item.queue === queue.QUEUE_NAMES.suggestions ||
          item.queue === queue.QUEUE_NAMES.reconciliation) &&
        queueNeedsAttention(item),
    ),
    missed_digests:
      digestMissed ||
      Boolean(
        progress && (progress.digest_pending > 0 || progress.digest_failed >= FAILURE_THRESHOLD),
      ) ||
      queues.some(
        (item) => item.queue === queue.QUEUE_NAMES.dailyDigest && queueNeedsAttention(item),
      ),
    index_freshness:
      index.status === 'rejected' ||
      Boolean(progress && progress.index_overdue > 0) ||
      queues.some((item) => item.queue === queue.QUEUE_NAMES.embed && queueNeedsAttention(item)),
    integration_sync: queues.some(
      (item) => item.queue === queue.QUEUE_NAMES.integrationSync && queueNeedsAttention(item),
    ),
    webhook_delivery: queues.some(
      (item) => item.queue === queue.QUEUE_NAMES.webhookDelivery && queueNeedsAttention(item),
    ),
    processing_probe: !progress || tick.status === 'rejected' || queues.length !== watched.length,
  };
  const activeSignals = Object.entries(signals).flatMap(([signal, active]) =>
    active ? [signal] : [],
  );
  await boundedProbe(() =>
    Promise.all(
      activeSignals.map(async (signal) => {
        const key = `timeline:processing-alert:${signal}`;
        if (await redis.set(key, '1', 'EX', 3600, 'NX')) {
          reportHandledEvent({
            message: `processing_health_${signal}`,
            operation: 'processing_health',
            surface: 'api',
            level: 'error',
            tags: { signal },
            measurements: {
              ...progress,
              oldest_queue_wait_ms: Math.max(0, ...queues.map((item) => item.oldestWaitingMs)),
              oldest_queue_active_ms: Math.max(0, ...queues.map((item) => item.oldestActiveMs)),
            },
          });
        }
      }),
    ),
  );
  return {
    ok: activeSignals.length === 0,
    signals,
    progress,
    queues,
    lastDigestTickAt: tick.status === 'fulfilled' && tick.value ? Number(tick.value) : null,
  };
}

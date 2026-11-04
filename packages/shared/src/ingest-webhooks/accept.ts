import { createHash } from 'node:crypto';

import { type Db, rawEvents } from '@timeline/db';
import { and, eq, sql } from 'drizzle-orm';

import { admitAcceptedSourceEnrichment } from '#src/billing/runtime.js';
import { sourceMetadataWithConversationArtifacts } from '#src/conversational/contact-artifacts.js';
import { reconcileLinkArtifactsForRawEvent } from '#src/conversational/link-artifacts.js';
import { type TimelineEventClass } from '#src/event-class.js';
import { childLogger } from '#src/logger.js';
import { enqueueEmbedJob, enqueueExtractJob, enqueueSuggestionJob } from '#src/queue/queues.js';
import { normalizeRawEventsToEvidence } from '#src/reconciliation/normalization.js';
import { inlineSourceSnapshotMetadata } from '#src/reconciliation/source-snapshot.js';

const log = childLogger('ingest-webhooks');
const INGEST_WEBHOOK_SOURCE_SNAPSHOT_VERSION = 'ingest-webhook-source-snapshot-2026-07';

export type IngestEvidenceVisibility = 'private' | 'team' | 'specific_users';

export interface IngestEvidenceEnqueue {
  enqueueExtractJob: typeof enqueueExtractJob;
  enqueueEmbedJob: typeof enqueueEmbedJob;
  enqueueSuggestionJob: typeof enqueueSuggestionJob;
}

export interface AcceptIngestWebhookEvidenceInput {
  db: Db;
  teamId: string;
  webhookId: string;
  webhookName: string;
  credentialId: string | null;
  contentType: string;
  body: string;
  eventClass: TimelineEventClass;
  visibility: IngestEvidenceVisibility;
  visibilityOwnerUserId: string | null;
  authorUserId: string | null;
  proposalGenerationEnabled: boolean;
  receivedAt?: Date;
  requestHeaders?: Record<string, string>;
  extraMetadata?: Record<string, unknown>;
  enqueue?: IngestEvidenceEnqueue;
  /** When Redis/queue setup failed before enqueue, stamp `queue` failure and skip jobs. */
  queueUnavailable?: unknown;
}

export interface AcceptIngestWebhookEvidenceResult {
  status: 'accepted' | 'duplicate';
  rawEventId: string | null;
  evidenceIds: string[];
  billingDeferred: boolean;
  proposalsEnqueued: boolean;
}

function defaultEnqueue(): IngestEvidenceEnqueue {
  return { enqueueExtractJob, enqueueEmbedJob, enqueueSuggestionJob };
}

export function ingestWebhookDedupKey(
  webhookId: string,
  bodyHash: string,
  receivedAt: Date,
): string {
  return `${webhookId}:${receivedAt.toISOString().slice(0, 10)}:${bodyHash}`;
}

export function renderIngestWebhookContent(input: {
  webhookName: string;
  contentType: string;
  body: string;
}): string {
  return [
    `Ingest webhook: ${input.webhookName}`,
    `Content-Type: ${input.contentType}`,
    '',
    input.body.length > 0 ? input.body : '[empty payload]',
  ].join('\n');
}

export function hashIngestWebhookBody(body: string): string {
  return createHash('sha256').update(body).digest('hex');
}

/**
 * Persist generic ingest-webhook evidence, normalize it, and enqueue the same
 * extract/embed/suggestion jobs as POST /api/webhooks/ingest. Callers must
 * already have authenticated a team (webhook credential or withTeam). This
 * never updates canonical workspace records.
 */
export async function acceptIngestWebhookEvidence(
  input: AcceptIngestWebhookEvidenceInput,
): Promise<AcceptIngestWebhookEvidenceResult> {
  const receivedAt = input.receivedAt ?? new Date();
  const bodyHash = hashIngestWebhookBody(input.body);
  const dedupKey = ingestWebhookDedupKey(input.webhookId, bodyHash, receivedAt);
  const contentText = renderIngestWebhookContent({
    webhookName: input.webhookName,
    contentType: input.contentType,
    body: input.body,
  });
  const requestHeaders = input.requestHeaders ?? {};
  const sourceMetadata = sourceMetadataWithConversationArtifacts(
    {
      ingest_webhook_id: input.webhookId,
      ingest_webhook_credential_id: input.credentialId,
      ingest_webhook_name: input.webhookName,
      ingest_webhook_body_sha256: bodyHash,
      ingest_webhook_dedup_key: dedupKey,
      content_type: input.contentType,
      method: 'POST',
      received_at: receivedAt.toISOString(),
      request_headers: requestHeaders,
      proposal_generation_enabled: input.proposalGenerationEnabled,
      ...ingestWebhookSourcePayloadMetadata({
        webhookId: input.webhookId,
        credentialId: input.credentialId,
        webhookName: input.webhookName,
        contentType: input.contentType,
        method: 'POST',
        receivedAt,
        body: input.body,
        bodyHash,
        dedupKey,
        requestHeaders,
        proposalGenerationEnabled: input.proposalGenerationEnabled,
      }),
      event_class: input.eventClass,
      ...(input.extraMetadata ?? {}),
    },
    contentText,
  );

  const rows = await input.db
    .insert(rawEvents)
    .values({
      teamId: input.teamId,
      authorUserId: input.authorUserId,
      visibilityOwnerUserId: input.visibilityOwnerUserId,
      source: 'ingest_webhook',
      contentText,
      occurredAt: receivedAt,
      visibility: input.visibility,
      sourceMetadata,
    })
    .onConflictDoNothing()
    .returning({ id: rawEvents.id, teamId: rawEvents.teamId });
  const event = rows[0];
  if (!event) {
    const duplicate = await findDedupedEvent(input.db, input.teamId, dedupKey);
    if (duplicate) {
      const followUp = await processAcceptedIngestEvent({
        db: input.db,
        event: duplicate,
        contentText,
        receivedAt,
        proposalGenerationEnabled: input.proposalGenerationEnabled,
        authorUserId: input.authorUserId,
        ...(input.enqueue ? { enqueue: input.enqueue } : {}),
        ...(input.queueUnavailable !== undefined
          ? { queueUnavailable: input.queueUnavailable }
          : {}),
      });
      return {
        status: 'duplicate',
        rawEventId: duplicate.id,
        evidenceIds: followUp.evidenceIds,
        billingDeferred: followUp.billingDeferred,
        proposalsEnqueued: followUp.proposalsEnqueued,
      };
    }
    return {
      status: 'duplicate',
      rawEventId: null,
      evidenceIds: [],
      billingDeferred: false,
      proposalsEnqueued: false,
    };
  }

  const followUp = await processAcceptedIngestEvent({
    db: input.db,
    event,
    contentText,
    receivedAt,
    proposalGenerationEnabled: input.proposalGenerationEnabled,
    authorUserId: input.authorUserId,
    ...(input.enqueue ? { enqueue: input.enqueue } : {}),
    ...(input.queueUnavailable !== undefined ? { queueUnavailable: input.queueUnavailable } : {}),
  });
  return {
    status: 'accepted',
    rawEventId: event.id,
    evidenceIds: followUp.evidenceIds,
    billingDeferred: followUp.billingDeferred,
    proposalsEnqueued: followUp.proposalsEnqueued,
  };
}

function ingestWebhookSourcePayloadMetadata(input: {
  webhookId: string;
  credentialId: string | null;
  webhookName: string;
  contentType: string;
  method: string;
  receivedAt: Date;
  body: string;
  bodyHash: string;
  dedupKey: string;
  requestHeaders: Record<string, string>;
  proposalGenerationEnabled: boolean;
}): Record<string, unknown> {
  const snapshot = {
    provider: 'ingest_webhook',
    webhook_id: input.webhookId,
    credential_id: input.credentialId,
    webhook_name: input.webhookName,
    content_type: input.contentType,
    method: input.method,
    received_at: input.receivedAt.toISOString(),
    body_sha256: input.bodyHash,
    body: input.body,
    dedup_key: input.dedupKey,
    request_headers: input.requestHeaders,
    proposal_generation_enabled: input.proposalGenerationEnabled,
  };
  return inlineSourceSnapshotMetadata({
    snapshot,
    kind: 'ingest_webhook_payload',
    version: INGEST_WEBHOOK_SOURCE_SNAPSHOT_VERSION,
    ref: () => `inline://timeline/ingest-webhook/${input.webhookId}/${input.bodyHash}`,
  });
}

async function processAcceptedIngestEvent(input: {
  db: Db;
  event: { id: string; teamId: string };
  contentText: string;
  receivedAt: Date;
  proposalGenerationEnabled: boolean;
  authorUserId: string | null;
  enqueue?: IngestEvidenceEnqueue;
  queueUnavailable?: unknown;
}): Promise<{ evidenceIds: string[]; billingDeferred: boolean; proposalsEnqueued: boolean }> {
  const evidenceIds = await normalizeRawEventEvidence(input.db, input.event);
  await reconcileIngestWebhookLinks(input.db, input.event, input.contentText, input.receivedAt);
  const processing = await enqueueIngestProcessing({
    db: input.db,
    event: input.event,
    proposalGenerationEnabled: input.proposalGenerationEnabled,
    authorUserId: input.authorUserId,
    ...(input.enqueue ? { enqueue: input.enqueue } : {}),
    ...(input.queueUnavailable !== undefined ? { queueUnavailable: input.queueUnavailable } : {}),
  });
  return { evidenceIds, ...processing };
}

async function normalizeRawEventEvidence(
  db: Db,
  event: { id: string; teamId: string },
): Promise<string[]> {
  try {
    return await normalizeRawEventsToEvidence({
      db,
      teamId: event.teamId,
      rawEventIds: [event.id],
    });
  } catch (err) {
    log.warn(
      { err, teamId: event.teamId, rawEventId: event.id },
      'ingest webhook reconciliation evidence normalization failed',
    );
    return [];
  }
}

async function reconcileIngestWebhookLinks(
  db: Db,
  event: { id: string; teamId: string },
  contentText: string,
  occurredAt: Date,
): Promise<void> {
  await reconcileLinkArtifactsForRawEvent(db, {
    teamId: event.teamId,
    rawEventId: event.id,
    text: contentText,
    occurredAt,
  }).catch((err: unknown) => {
    log.error({ err, rawEventId: event.id }, 'ingest webhook link artifact reconciliation failed');
  });
}

async function findDedupedEvent(
  db: Db,
  teamId: string,
  dedupKey: string,
): Promise<{ id: string; teamId: string } | null> {
  const rows = await db
    .select({ id: rawEvents.id, teamId: rawEvents.teamId })
    .from(rawEvents)
    .where(
      and(
        eq(rawEvents.teamId, teamId),
        eq(rawEvents.source, 'ingest_webhook'),
        sql`${rawEvents.sourceMetadata} ->> 'ingest_webhook_dedup_key' = ${dedupKey}`,
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

async function enqueueIngestProcessing(input: {
  db: Db;
  event: { id: string; teamId: string };
  proposalGenerationEnabled: boolean;
  authorUserId: string | null;
  enqueue?: IngestEvidenceEnqueue;
  queueUnavailable?: unknown;
}): Promise<{ billingDeferred: boolean; proposalsEnqueued: boolean }> {
  const admitted = await admitAcceptedSourceEnrichment({
    db: input.db,
    teamId: input.event.teamId,
    ...(input.authorUserId ? { userId: input.authorUserId } : {}),
    rawEventId: input.event.id,
  });
  if (!admitted) return { billingDeferred: true, proposalsEnqueued: false };
  if (input.queueUnavailable !== undefined) {
    await markProcessingFailure(input.db, input.event.id, 'queue', input.queueUnavailable);
    return { billingDeferred: false, proposalsEnqueued: false };
  }

  let enqueue = input.enqueue;
  if (!enqueue) {
    try {
      enqueue = defaultEnqueue();
    } catch (err) {
      await markProcessingFailure(input.db, input.event.id, 'queue', err);
      return { billingDeferred: false, proposalsEnqueued: false };
    }
  }

  const jobs: Promise<void>[] = [
    enqueue
      .enqueueExtractJob({ rawEventId: input.event.id, teamId: input.event.teamId })
      .catch((err: unknown) => markProcessingFailure(input.db, input.event.id, 'extraction', err)),
    enqueue
      .enqueueEmbedJob({ rawEventId: input.event.id, teamId: input.event.teamId })
      .catch((err: unknown) => markProcessingFailure(input.db, input.event.id, 'embedding', err)),
  ];
  let proposalsEnqueued = false;
  if (input.proposalGenerationEnabled) {
    jobs.push(
      enqueue
        .enqueueSuggestionJob({ rawEventId: input.event.id, teamId: input.event.teamId })
        .then(() => {
          proposalsEnqueued = true;
        })
        .catch((err: unknown) =>
          markProcessingFailure(input.db, input.event.id, 'suggestions', err),
        ),
    );
  }
  await Promise.all(jobs);
  return { billingDeferred: false, proposalsEnqueued };
}

async function markProcessingFailure(
  db: Db,
  rawEventId: string,
  stage: 'queue' | 'extraction' | 'embedding' | 'suggestions',
  err: unknown,
): Promise<void> {
  log.error({ err, rawEventId, stage }, 'ingest webhook processing enqueue failed');
  const patch = JSON.stringify({
    [`${stage}_failed_at`]: new Date().toISOString(),
    [`${stage}_error`]: `enqueue failed: ${
      err instanceof Error ? err.message.slice(0, 480) : 'unknown'
    }`,
  });
  await db
    .update(rawEvents)
    .set({
      sourceMetadata: sql`COALESCE(${rawEvents.sourceMetadata}, '{}'::jsonb) || ${patch}::jsonb`,
    })
    .where(sql`${rawEvents.id} = ${rawEventId}`)
    .catch((markErr: unknown) => {
      log.error({ err: markErr, rawEventId, stage }, 'failed to mark ingest webhook failure');
    });
}

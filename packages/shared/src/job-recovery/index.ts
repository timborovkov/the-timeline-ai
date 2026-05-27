import {
  calendarEvents,
  documentChunks,
  documents,
  documentVersions,
  entities,
  facts,
  integrations,
  integrationSyncState,
  jobRecoveryDismissals,
  meetings,
  rawEvents,
  type Db,
} from '@timeline/db';
import { and, desc, eq, isNotNull, isNull, lt, notExists, or, sql } from 'drizzle-orm';

import * as queue from '../queue/index.js';

import type { JobType } from 'bullmq';

type TeamRole = 'owner' | 'admin' | 'member';

export type JobRecoveryKind =
  | 'transcription'
  | 'extraction'
  | 'embedding'
  | 'document_processing'
  | 'meeting_finalization'
  | 'integration_sync';

export type JobRecoveryArtifactKind =
  | 'raw_event'
  | 'fact'
  | 'object'
  | 'document_version'
  | 'document_chunk'
  | 'meeting'
  | 'integration'
  | 'calendar_event';

export type JobRecoveryStatus = 'failed' | 'stuck' | 'dismissed';

export interface JobRecoveryItem {
  id: string;
  kind: JobRecoveryKind;
  artifactKind: JobRecoveryArtifactKind;
  artifactId: string;
  label: string;
  status: JobRecoveryStatus;
  error: string | null;
  retryable: boolean;
  detectedAt: Date;
}

interface JobRecoveryScopeDeps {
  db: Db;
  teamId: string;
  userId: string;
  ensureMember: (minRole?: TeamRole) => Promise<TeamRole>;
  queues?: RecoveryQueues;
}

interface RecoveryQueues {
  enqueueTranscribeJob?: typeof queue.enqueueTranscribeJob;
  enqueueExtractJob?: typeof queue.enqueueExtractJob;
  enqueueEmbedJob?: typeof queue.enqueueEmbedJob;
  enqueueDocumentExtractJob?: typeof queue.enqueueDocumentExtractJob;
  enqueueMeetingFinalizeJob?: typeof queue.enqueueMeetingFinalizeJob;
  enqueueIntegrationSyncJob?: typeof queue.enqueueIntegrationSyncJob;
  getEmbedQueue?: () => FailedQueueLike;
  getMeetingFinalizeQueue?: () => FailedQueueLike;
  getIntegrationSyncQueue?: () => FailedQueueLike;
}

interface FailedQueueLike {
  getJobs: (types?: JobType | JobType[], start?: number, end?: number) => Promise<unknown[]>;
}

interface RecoveryIdentity {
  kind: JobRecoveryKind;
  artifactKind: JobRecoveryArtifactKind;
  artifactId: string;
}

interface EncodedRecoveryId extends RecoveryIdentity {
  embedScope?: 'object' | 'entity';
  syncKind?: 'backfill' | 'incremental';
}

const STALE_MS = 15 * 60 * 1000;
const DOCUMENT_PENDING_MS = 5 * 60 * 1000;
const DOCUMENT_EXTRACTING_MS = 60 * 60 * 1000;
const MEETING_PROCESSING_MS = 30 * 60 * 1000;
const LIMIT = 200;

const KIND_LABELS: Record<JobRecoveryKind, string> = {
  transcription: 'Transcription',
  extraction: 'Extraction',
  embedding: 'Embedding',
  document_processing: 'Document processing',
  meeting_finalization: 'Meeting finalization',
  integration_sync: 'Integration sync',
};

const queuesDefault: Required<RecoveryQueues> = {
  enqueueTranscribeJob: queue.enqueueTranscribeJob,
  enqueueExtractJob: queue.enqueueExtractJob,
  enqueueEmbedJob: queue.enqueueEmbedJob,
  enqueueDocumentExtractJob: queue.enqueueDocumentExtractJob,
  enqueueMeetingFinalizeJob: queue.enqueueMeetingFinalizeJob,
  enqueueIntegrationSyncJob: queue.enqueueIntegrationSyncJob,
  getEmbedQueue: queue.getEmbedQueue,
  getMeetingFinalizeQueue: queue.getMeetingFinalizeQueue,
  getIntegrationSyncQueue: queue.getIntegrationSyncQueue,
};

export function createJobRecoveryScope(deps: JobRecoveryScopeDeps) {
  const q = { ...queuesDefault, ...(deps.queues ?? {}) };

  async function requireAdmin() {
    await deps.ensureMember('admin');
  }

  async function listRecoverableJobs(): Promise<JobRecoveryItem[]> {
    await requireAdmin();
    const candidates = await collectCandidates(deps.db, deps.teamId, deps.userId, q);
    const dismissals = await deps.db
      .select({
        jobKind: jobRecoveryDismissals.jobKind,
        artifactKind: jobRecoveryDismissals.artifactKind,
        artifactId: jobRecoveryDismissals.artifactId,
      })
      .from(jobRecoveryDismissals)
      .where(eq(jobRecoveryDismissals.teamId, deps.teamId));
    const dismissed = new Set(
      dismissals.map((d) =>
        dismissalKey(
          d.jobKind as JobRecoveryKind,
          d.artifactKind as JobRecoveryArtifactKind,
          d.artifactId,
        ),
      ),
    );
    return dedupe(candidates)
      .filter((item) => !dismissed.has(dismissalKey(item.kind, item.artifactKind, item.artifactId)))
      .sort((a, b) => b.detectedAt.getTime() - a.detectedAt.getTime());
  }

  async function dismissRecoverableJob(id: string, reason?: string): Promise<void> {
    await requireAdmin();
    const parsed = decodeRecoveryId(id);
    await assertArtifactVisible(deps.db, deps.teamId, deps.userId, parsed);
    await deps.db
      .insert(jobRecoveryDismissals)
      .values({
        teamId: deps.teamId,
        jobKind: parsed.kind,
        artifactKind: parsed.artifactKind,
        artifactId: parsed.artifactId,
        dismissedByUserId: deps.userId,
        reason: reason?.trim() ? reason.trim().slice(0, 500) : null,
      })
      .onConflictDoUpdate({
        target: [
          jobRecoveryDismissals.teamId,
          jobRecoveryDismissals.jobKind,
          jobRecoveryDismissals.artifactKind,
          jobRecoveryDismissals.artifactId,
        ],
        set: {
          dismissedByUserId: deps.userId,
          reason: reason?.trim() ? reason.trim().slice(0, 500) : null,
          createdAt: new Date(),
        },
      });
  }

  async function retryRecoverableJob(id: string): Promise<void> {
    await requireAdmin();
    const parsed = decodeRecoveryId(id);
    await assertArtifactVisible(deps.db, deps.teamId, deps.userId, parsed);
    await clearDismissal(deps.db, deps.teamId, parsed);
    await retryParsed(deps.db, deps.teamId, parsed, q);
  }

  return { listRecoverableJobs, dismissRecoverableJob, retryRecoverableJob };
}

async function collectCandidates(
  db: Db,
  teamId: string,
  userId: string,
  q: Required<RecoveryQueues>,
): Promise<JobRecoveryItem[]> {
  const now = new Date();
  const staleCutoff = new Date(now.getTime() - STALE_MS);
  const [raw, docs, meetingRows, integrationRows, queueRows] = await Promise.all([
    collectRawEventCandidates(db, teamId, userId, staleCutoff),
    collectDocumentCandidates(db, teamId, staleCutoff),
    collectMeetingCandidates(db, teamId, userId),
    collectIntegrationCandidates(db, teamId),
    collectQueueCandidates(db, teamId, userId, q),
  ]);
  return [...raw, ...docs, ...meetingRows, ...integrationRows, ...queueRows];
}

async function collectRawEventCandidates(
  db: Db,
  teamId: string,
  userId: string,
  staleCutoff: Date,
): Promise<JobRecoveryItem[]> {
  const rows = await db
    .select({
      id: rawEvents.id,
      source: rawEvents.source,
      contentText: rawEvents.contentText,
      contentAudioUrl: rawEvents.contentAudioUrl,
      occurredAt: rawEvents.occurredAt,
      createdAt: rawEvents.createdAt,
      sourceMetadata: rawEvents.sourceMetadata,
      visibility: rawEvents.visibility,
    })
    .from(rawEvents)
    .where(and(eq(rawEvents.teamId, teamId), visibleRawEvent(userId), activeRawEvent()))
    .orderBy(desc(rawEvents.createdAt))
    .limit(LIMIT * 2);

  const items: JobRecoveryItem[] = [];
  for (const row of rows) {
    const meta = objectMeta(row.sourceMetadata);
    const label = rawEventLabel(row);
    if (
      row.contentAudioUrl &&
      !row.contentText &&
      (meta.transcription_failed_at ||
        meta.reconcile_giveup_transcribe ||
        row.createdAt < staleCutoff)
    ) {
      items.push(
        item('transcription', 'raw_event', row.id, label, {
          status:
            meta.transcription_failed_at || meta.reconcile_giveup_transcribe ? 'failed' : 'stuck',
          error: textValue(meta.transcription_error) ?? textValue(meta.reconcile_giveup_transcribe),
          detectedAt: dateValue(meta.transcription_failed_at) ?? row.createdAt,
        }),
      );
    }
    if (
      row.visibility === 'team' &&
      row.contentText &&
      (meta.extraction_failed_at || meta.reconcile_giveup_extract)
    ) {
      items.push(
        item('extraction', 'raw_event', row.id, label, {
          error: textValue(meta.extraction_error) ?? textValue(meta.reconcile_giveup_extract),
          detectedAt: dateValue(meta.extraction_failed_at) ?? row.createdAt,
        }),
      );
    }
    if (
      row.visibility === 'team' &&
      row.contentText &&
      (meta.embedding_failed_at ||
        meta.reconcile_giveup_embed ||
        (!meta.embedded_at && row.createdAt < staleCutoff))
    ) {
      items.push(
        item('embedding', 'raw_event', row.id, label, {
          status: meta.embedding_failed_at || meta.reconcile_giveup_embed ? 'failed' : 'stuck',
          error: textValue(meta.embedding_error) ?? textValue(meta.reconcile_giveup_embed),
          detectedAt: dateValue(meta.embedding_failed_at) ?? row.createdAt,
        }),
      );
    }
  }

  const extractionStuck = await db
    .select({
      id: rawEvents.id,
      source: rawEvents.source,
      occurredAt: rawEvents.occurredAt,
      createdAt: rawEvents.createdAt,
    })
    .from(rawEvents)
    .where(
      and(
        eq(rawEvents.teamId, teamId),
        eq(rawEvents.visibility, 'team'),
        activeRawEvent(),
        isNotNull(rawEvents.contentText),
        lt(rawEvents.createdAt, staleCutoff),
        sql`${rawEvents.sourceMetadata} ->> 'extracted_at' IS NULL`,
        sql`${rawEvents.sourceMetadata} ->> 'extraction_model_version' IS NULL`,
        notExists(
          db
            .select({ one: sql`1` })
            .from(facts)
            .where(eq(facts.rawEventId, rawEvents.id)),
        ),
      ),
    )
    .limit(LIMIT);
  for (const row of extractionStuck) {
    items.push(
      item('extraction', 'raw_event', row.id, rawEventLabel(row), {
        status: 'stuck',
        error: null,
        detectedAt: row.createdAt,
      }),
    );
  }

  return items;
}

async function collectDocumentCandidates(
  db: Db,
  teamId: string,
  staleCutoff: Date,
): Promise<JobRecoveryItem[]> {
  const pendingCutoff = new Date(Date.now() - DOCUMENT_PENDING_MS);
  const extractingCutoff = new Date(Date.now() - DOCUMENT_EXTRACTING_MS);
  const rows = await db
    .select({ version: documentVersions, document: documents })
    .from(documentVersions)
    .innerJoin(documents, eq(documents.id, documentVersions.documentId))
    .where(
      and(
        eq(documentVersions.teamId, teamId),
        eq(documents.visibility, 'team'),
        isNull(documents.deletedAt),
        or(
          eq(documentVersions.processingStatus, 'failed'),
          and(
            eq(documentVersions.processingStatus, 'pending'),
            isNotNull(documentVersions.byteSize),
            lt(documentVersions.createdAt, pendingCutoff),
          ),
          and(
            eq(documentVersions.processingStatus, 'extracting'),
            lt(documentVersions.createdAt, extractingCutoff),
          ),
        ),
      ),
    )
    .orderBy(desc(documentVersions.createdAt))
    .limit(LIMIT);
  void staleCutoff;
  return rows.map(({ version, document }) =>
    item(
      'document_processing',
      'document_version',
      version.id,
      `${document.name} v${String(version.version)}`,
      {
        status: version.processingStatus === 'failed' ? 'failed' : 'stuck',
        error: version.processingError,
        detectedAt: version.createdAt,
      },
    ),
  );
}

async function collectMeetingCandidates(
  db: Db,
  teamId: string,
  userId: string,
): Promise<JobRecoveryItem[]> {
  const cutoff = new Date(Date.now() - MEETING_PROCESSING_MS);
  const rows = await db
    .select()
    .from(meetings)
    .where(
      and(
        eq(meetings.teamId, teamId),
        visibleMeeting(userId),
        eq(meetings.status, 'processing'),
        lt(meetings.updatedAt, cutoff),
      ),
    )
    .orderBy(desc(meetings.updatedAt))
    .limit(LIMIT);
  return rows.map((m) =>
    item('meeting_finalization', 'meeting', m.id, m.title ?? `${m.platform} meeting`, {
      status: 'stuck',
      error: textValue(objectMeta(m.metadata).failure_code),
      detectedAt: m.updatedAt,
    }),
  );
}

async function collectIntegrationCandidates(db: Db, teamId: string): Promise<JobRecoveryItem[]> {
  const rows = await db
    .select({
      integration: integrations,
      stateError: integrationSyncState.lastError,
      stateUpdatedAt: integrationSyncState.updatedAt,
    })
    .from(integrations)
    .leftJoin(integrationSyncState, eq(integrationSyncState.integrationId, integrations.id))
    .where(
      and(
        eq(integrations.teamId, teamId),
        or(isNotNull(integrations.lastError), isNotNull(integrationSyncState.lastError)),
      ),
    )
    .orderBy(desc(integrations.updatedAt))
    .limit(LIMIT);

  const byId = new Map<string, JobRecoveryItem>();
  for (const row of rows) {
    const error = row.integration.lastError ?? row.stateError;
    const detectedAt = row.stateUpdatedAt ?? row.integration.updatedAt;
    const existing = byId.get(row.integration.id);
    if (existing && existing.detectedAt >= detectedAt) continue;
    byId.set(
      row.integration.id,
      item('integration_sync', 'integration', row.integration.id, row.integration.displayName, {
        error,
        detectedAt,
      }),
    );
  }
  return [...byId.values()];
}

async function collectQueueCandidates(
  db: Db,
  teamId: string,
  userId: string,
  q: Required<RecoveryQueues>,
): Promise<JobRecoveryItem[]> {
  const out: JobRecoveryItem[] = [];
  const [embed, meetingsFailed, integrationsFailed] = await Promise.all([
    failedJobs(q.getEmbedQueue).catch(() => []),
    failedJobs(q.getMeetingFinalizeQueue).catch(() => []),
    failedJobs(q.getIntegrationSyncQueue).catch(() => []),
  ]);

  for (const j of embed) {
    const candidate = await embedJobToItem(
      db,
      teamId,
      userId,
      j.data,
      j.failedReason ?? null,
      j.finishedOn,
    );
    if (candidate) out.push(candidate);
  }
  for (const j of meetingsFailed) {
    const data = objectMeta(j.data);
    if (data.teamId !== teamId || typeof data.meetingId !== 'string') continue;
    const visible = await visibleMeetingById(db, teamId, userId, data.meetingId);
    if (!visible) continue;
    out.push(
      item('meeting_finalization', 'meeting', data.meetingId, visible, {
        error: j.failedReason ?? null,
        detectedAt: j.finishedOn ? new Date(j.finishedOn) : new Date(),
      }),
    );
  }
  for (const j of integrationsFailed) {
    const data = objectMeta(j.data);
    if (
      data.teamId !== teamId ||
      data.integrationId === '__tick__' ||
      typeof data.integrationId !== 'string'
    ) {
      continue;
    }
    const rows = await db
      .select({ displayName: integrations.displayName })
      .from(integrations)
      .where(and(eq(integrations.teamId, teamId), eq(integrations.id, data.integrationId)))
      .limit(1);
    const integration = rows[0];
    if (!integration) continue;
    out.push(
      item('integration_sync', 'integration', data.integrationId, integration.displayName, {
        error: j.failedReason ?? null,
        detectedAt: j.finishedOn ? new Date(j.finishedOn) : new Date(),
        syncKind: data.kind === 'backfill' ? 'backfill' : 'incremental',
      }),
    );
  }
  return out;
}

async function embedJobToItem(
  db: Db,
  teamId: string,
  userId: string,
  data: unknown,
  error: string | null,
  finishedOn?: number,
): Promise<JobRecoveryItem | null> {
  const meta = objectMeta(data);
  if (meta.teamId !== teamId) return null;
  const detectedAt = finishedOn ? new Date(finishedOn) : new Date();
  if (
    (meta.scope === undefined || meta.scope === 'raw_event') &&
    typeof meta.rawEventId === 'string'
  ) {
    const label = await visibleRawEventLabelById(db, teamId, userId, meta.rawEventId, true);
    if (!label) return null;
    return item('embedding', 'raw_event', meta.rawEventId, label, { error, detectedAt });
  }
  if (meta.scope === 'fact' && typeof meta.factId === 'string') {
    const rows = await db
      .select({ statement: facts.statement, rawEventId: facts.rawEventId })
      .from(facts)
      .innerJoin(rawEvents, eq(rawEvents.id, facts.rawEventId))
      .where(
        and(
          eq(facts.teamId, teamId),
          eq(facts.id, meta.factId),
          visibleRawEvent(userId),
          eq(rawEvents.visibility, 'team'),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return item('embedding', 'fact', meta.factId, `Fact: ${row.statement}`, { error, detectedAt });
  }
  if (
    (meta.scope === 'object' || meta.scope === 'entity') &&
    typeof (meta.objectId ?? meta.entityId) === 'string'
  ) {
    const id = String(meta.objectId ?? meta.entityId);
    const rows = await db
      .select({ name: entities.canonicalName })
      .from(entities)
      .where(and(eq(entities.teamId, teamId), eq(entities.id, id), isNull(entities.mergedIntoId)))
      .limit(1);
    if (!rows[0]) return null;
    return item('embedding', 'object', id, `Object: ${rows[0].name}`, {
      embedScope: meta.scope,
      error,
      detectedAt,
    });
  }
  if (meta.scope === 'doc_chunk' && typeof meta.documentChunkId === 'string') {
    const label = await visibleDocumentChunkLabelById(db, teamId, meta.documentChunkId);
    if (!label) return null;
    return item('embedding', 'document_chunk', meta.documentChunkId, label, { error, detectedAt });
  }
  if (meta.scope === 'calendar_event' && typeof meta.calendarEventId === 'string') {
    const label = await visibleCalendarLabelById(db, teamId, userId, meta.calendarEventId, true);
    if (!label) return null;
    return item('embedding', 'calendar_event', meta.calendarEventId, label, { error, detectedAt });
  }
  return null;
}

async function retryParsed(
  db: Db,
  teamId: string,
  parsed: EncodedRecoveryId,
  q: Required<RecoveryQueues>,
): Promise<void> {
  if (parsed.kind === 'transcription' && parsed.artifactKind === 'raw_event') {
    const rows = await db
      .select({ audioKey: rawEvents.contentAudioUrl })
      .from(rawEvents)
      .where(and(eq(rawEvents.teamId, teamId), eq(rawEvents.id, parsed.artifactId)))
      .limit(1);
    const audioKey = rows[0]?.audioKey;
    if (!audioKey) throw new Error('not_retryable');
    await clearRawEventStage(db, parsed.artifactId, 'transcription');
    await q.enqueueTranscribeJob({ rawEventId: parsed.artifactId, teamId, audioKey });
    return;
  }
  if (parsed.kind === 'extraction' && parsed.artifactKind === 'raw_event') {
    await clearRawEventStage(db, parsed.artifactId, 'extraction');
    await q.enqueueExtractJob({ rawEventId: parsed.artifactId, teamId });
    return;
  }
  if (parsed.kind === 'embedding') {
    await retryEmbedding(db, teamId, parsed, q);
    return;
  }
  if (parsed.kind === 'document_processing' && parsed.artifactKind === 'document_version') {
    await db
      .update(documentVersions)
      .set({ processingStatus: 'pending', processingError: null })
      .where(and(eq(documentVersions.teamId, teamId), eq(documentVersions.id, parsed.artifactId)));
    await q.enqueueDocumentExtractJob({ documentVersionId: parsed.artifactId, teamId });
    return;
  }
  if (parsed.kind === 'meeting_finalization' && parsed.artifactKind === 'meeting') {
    await q.enqueueMeetingFinalizeJob({ meetingId: parsed.artifactId, teamId });
    return;
  }
  if (parsed.kind === 'integration_sync' && parsed.artifactKind === 'integration') {
    await db
      .update(integrations)
      .set({ lastError: null, updatedAt: new Date() })
      .where(and(eq(integrations.teamId, teamId), eq(integrations.id, parsed.artifactId)));
    await q.enqueueIntegrationSyncJob({
      kind: parsed.syncKind ?? 'incremental',
      integrationId: parsed.artifactId,
      teamId,
    });
    return;
  }
  throw new Error('not_retryable');
}

async function retryEmbedding(
  db: Db,
  teamId: string,
  parsed: EncodedRecoveryId,
  q: Required<RecoveryQueues>,
): Promise<void> {
  if (parsed.artifactKind === 'raw_event') {
    await clearRawEventStage(db, parsed.artifactId, 'embedding');
    await q.enqueueEmbedJob({ rawEventId: parsed.artifactId, teamId });
  } else if (parsed.artifactKind === 'fact') {
    const rows = await db
      .select({ rawEventId: facts.rawEventId })
      .from(facts)
      .where(and(eq(facts.teamId, teamId), eq(facts.id, parsed.artifactId)))
      .limit(1);
    const rawEventId = rows[0]?.rawEventId;
    if (!rawEventId) throw new Error('not_found');
    await q.enqueueEmbedJob({ scope: 'fact', rawEventId, factId: parsed.artifactId, teamId });
  } else if (parsed.artifactKind === 'object') {
    if (parsed.embedScope === 'object') {
      await q.enqueueEmbedJob({ scope: 'object', objectId: parsed.artifactId, teamId });
    } else {
      await q.enqueueEmbedJob({ scope: 'entity', entityId: parsed.artifactId, teamId });
    }
  } else if (parsed.artifactKind === 'document_chunk') {
    await q.enqueueEmbedJob({ scope: 'doc_chunk', documentChunkId: parsed.artifactId, teamId });
  } else if (parsed.artifactKind === 'calendar_event') {
    await q.enqueueEmbedJob({
      scope: 'calendar_event',
      calendarEventId: parsed.artifactId,
      teamId,
    });
  } else {
    throw new Error('not_retryable');
  }
}

async function assertArtifactVisible(
  db: Db,
  teamId: string,
  userId: string,
  parsed: RecoveryIdentity,
): Promise<void> {
  if (parsed.artifactKind === 'raw_event') {
    const needsTeamVisibility = parsed.kind === 'extraction' || parsed.kind === 'embedding';
    const label = await visibleRawEventLabelById(
      db,
      teamId,
      userId,
      parsed.artifactId,
      needsTeamVisibility,
    );
    if (!label) throw new Error('not_found');
    return;
  }
  if (parsed.artifactKind === 'fact') {
    const rows = await db
      .select({ id: facts.id })
      .from(facts)
      .innerJoin(rawEvents, eq(rawEvents.id, facts.rawEventId))
      .where(
        and(
          eq(facts.teamId, teamId),
          eq(facts.id, parsed.artifactId),
          visibleRawEvent(userId),
          eq(rawEvents.visibility, 'team'),
        ),
      )
      .limit(1);
    if (!rows[0]) throw new Error('not_found');
    return;
  }
  if (parsed.artifactKind === 'object') {
    const rows = await db
      .select({ id: entities.id })
      .from(entities)
      .where(and(eq(entities.teamId, teamId), eq(entities.id, parsed.artifactId)))
      .limit(1);
    if (!rows[0]) throw new Error('not_found');
    return;
  }
  if (parsed.artifactKind === 'document_version') {
    const rows = await db
      .select({ id: documentVersions.id })
      .from(documentVersions)
      .innerJoin(documents, eq(documents.id, documentVersions.documentId))
      .where(
        and(
          eq(documentVersions.teamId, teamId),
          eq(documentVersions.id, parsed.artifactId),
          eq(documents.visibility, 'team'),
          isNull(documents.deletedAt),
        ),
      )
      .limit(1);
    if (!rows[0]) throw new Error('not_found');
    return;
  }
  if (parsed.artifactKind === 'document_chunk') {
    if (!(await visibleDocumentChunkLabelById(db, teamId, parsed.artifactId)))
      throw new Error('not_found');
    return;
  }
  if (parsed.artifactKind === 'meeting') {
    if (!(await visibleMeetingById(db, teamId, userId, parsed.artifactId)))
      throw new Error('not_found');
    return;
  }
  if (parsed.artifactKind === 'integration') {
    const rows = await db
      .select({ id: integrations.id })
      .from(integrations)
      .where(and(eq(integrations.teamId, teamId), eq(integrations.id, parsed.artifactId)))
      .limit(1);
    if (!rows[0]) throw new Error('not_found');
    return;
  }
  const needsTeamVisibility = parsed.kind === 'embedding';
  if (
    !(await visibleCalendarLabelById(db, teamId, userId, parsed.artifactId, needsTeamVisibility))
  ) {
    throw new Error('not_found');
  }
}

async function clearDismissal(db: Db, teamId: string, parsed: RecoveryIdentity): Promise<void> {
  await db
    .delete(jobRecoveryDismissals)
    .where(
      and(
        eq(jobRecoveryDismissals.teamId, teamId),
        eq(jobRecoveryDismissals.jobKind, parsed.kind),
        eq(jobRecoveryDismissals.artifactKind, parsed.artifactKind),
        eq(jobRecoveryDismissals.artifactId, parsed.artifactId),
      ),
    );
}

async function clearRawEventStage(
  db: Db,
  rawEventId: string,
  stage: 'transcription' | 'extraction' | 'embedding',
): Promise<void> {
  const map: Record<'transcription' | 'extraction' | 'embedding', string[]> = {
    transcription: [
      'transcription_failed_at',
      'transcription_error',
      'reconcile_attempts_transcribe',
      'reconcile_giveup_transcribe',
    ],
    extraction: [
      'extraction_failed_at',
      'extraction_error',
      'reconcile_attempts_extract',
      'reconcile_giveup_extract',
    ],
    embedding: [
      'embedding_failed_at',
      'embedding_error',
      'reconcile_attempts_embed',
      'reconcile_giveup_embed',
    ],
  } satisfies Record<typeof stage, string[]>;
  const keys = map[stage];
  await db
    .update(rawEvents)
    .set({
      sourceMetadata: sql`COALESCE(${rawEvents.sourceMetadata}, '{}'::jsonb) - ${keys[0]} - ${keys[1]} - ${keys[2]} - ${keys[3]}`,
    })
    .where(eq(rawEvents.id, rawEventId));
}

function item(
  kind: JobRecoveryKind,
  artifactKind: JobRecoveryArtifactKind,
  artifactId: string,
  label: string,
  opts: {
    status?: JobRecoveryStatus;
    error?: string | null;
    detectedAt: Date;
    embedScope?: 'object' | 'entity';
    syncKind?: 'backfill' | 'incremental';
  },
): JobRecoveryItem {
  return {
    id: encodeRecoveryId({
      kind,
      artifactKind,
      artifactId,
      ...(opts.embedScope ? { embedScope: opts.embedScope } : {}),
      ...(opts.syncKind ? { syncKind: opts.syncKind } : {}),
    }),
    kind,
    artifactKind,
    artifactId,
    label: `${KIND_LABELS[kind]} · ${label}`,
    status: opts.status ?? 'failed',
    error: opts.error ?? null,
    retryable: true,
    detectedAt: opts.detectedAt,
  };
}

function encodeRecoveryId(input: EncodedRecoveryId): string {
  return Buffer.from(JSON.stringify(input), 'utf8').toString('base64url');
}

function decodeRecoveryId(id: string): EncodedRecoveryId {
  const parsed = JSON.parse(
    Buffer.from(id, 'base64url').toString('utf8'),
  ) as Partial<EncodedRecoveryId>;
  if (
    !isKind(parsed.kind) ||
    !isArtifactKind(parsed.artifactKind) ||
    typeof parsed.artifactId !== 'string'
  ) {
    throw new Error('invalid_recovery_id');
  }
  return {
    kind: parsed.kind,
    artifactKind: parsed.artifactKind,
    artifactId: parsed.artifactId,
    ...(parsed.embedScope === 'object' || parsed.embedScope === 'entity'
      ? { embedScope: parsed.embedScope }
      : {}),
    ...(parsed.syncKind === 'backfill' || parsed.syncKind === 'incremental'
      ? { syncKind: parsed.syncKind }
      : {}),
  };
}

function isKind(v: unknown): v is JobRecoveryKind {
  return (
    v === 'transcription' ||
    v === 'extraction' ||
    v === 'embedding' ||
    v === 'document_processing' ||
    v === 'meeting_finalization' ||
    v === 'integration_sync'
  );
}

function isArtifactKind(v: unknown): v is JobRecoveryArtifactKind {
  return (
    v === 'raw_event' ||
    v === 'fact' ||
    v === 'object' ||
    v === 'document_version' ||
    v === 'document_chunk' ||
    v === 'meeting' ||
    v === 'integration' ||
    v === 'calendar_event'
  );
}

function dedupe(items: JobRecoveryItem[]): JobRecoveryItem[] {
  const byKey = new Map<string, JobRecoveryItem>();
  for (const item of items) {
    const key = dismissalKey(item.kind, item.artifactKind, item.artifactId);
    const existing = byKey.get(key);
    if (!existing || item.detectedAt > existing.detectedAt) byKey.set(key, item);
  }
  return [...byKey.values()];
}

function dismissalKey(
  kind: JobRecoveryKind,
  artifactKind: JobRecoveryArtifactKind,
  artifactId: string,
): string {
  return `${kind}:${artifactKind}:${artifactId}`;
}

function visibleRawEvent(userId: string) {
  return or(
    eq(rawEvents.visibility, 'team'),
    and(eq(rawEvents.visibility, 'private'), eq(rawEvents.authorUserId, userId)),
    and(
      eq(rawEvents.visibility, 'specific_users'),
      sql`${userId}::uuid = ANY(${rawEvents.visibilityUserIds})`,
    ),
  );
}

function visibleMeeting(userId: string) {
  return or(
    eq(meetings.defaultVisibility, 'team'),
    and(eq(meetings.defaultVisibility, 'private'), eq(meetings.createdByUserId, userId)),
    and(
      eq(meetings.defaultVisibility, 'specific_users'),
      sql`${userId}::uuid = ANY(${meetings.visibilityUserIds})`,
    ),
  );
}

function visibleCalendar(userId: string) {
  return or(
    eq(calendarEvents.visibility, 'team'),
    and(eq(calendarEvents.visibility, 'private'), eq(calendarEvents.createdByUserId, userId)),
    and(
      eq(calendarEvents.visibility, 'specific_users'),
      sql`${userId}::uuid = ANY(${calendarEvents.visibilityUserIds})`,
    ),
  );
}

function activeRawEvent() {
  return sql`COALESCE(${rawEvents.sourceMetadata} ->> 'deleted', 'false') <> 'true'`;
}

async function visibleRawEventLabelById(
  db: Db,
  teamId: string,
  userId: string,
  id: string,
  requireTeamVisibility: boolean,
): Promise<string | null> {
  const rows = await db
    .select({
      id: rawEvents.id,
      source: rawEvents.source,
      occurredAt: rawEvents.occurredAt,
      visibility: rawEvents.visibility,
    })
    .from(rawEvents)
    .where(
      and(
        eq(rawEvents.teamId, teamId),
        eq(rawEvents.id, id),
        activeRawEvent(),
        requireTeamVisibility ? eq(rawEvents.visibility, 'team') : visibleRawEvent(userId),
      ),
    )
    .limit(1);
  return rows[0] ? rawEventLabel(rows[0]) : null;
}

async function visibleDocumentChunkLabelById(
  db: Db,
  teamId: string,
  id: string,
): Promise<string | null> {
  const rows = await db
    .select({ name: documents.name, chunkIndex: documentChunks.chunkIndex })
    .from(documentChunks)
    .innerJoin(documents, eq(documents.id, documentChunks.documentId))
    .where(
      and(
        eq(documentChunks.teamId, teamId),
        eq(documentChunks.id, id),
        eq(documents.visibility, 'team'),
        isNull(documents.deletedAt),
      ),
    )
    .limit(1);
  const row = rows[0];
  return row ? `${row.name} chunk ${String(row.chunkIndex + 1)}` : null;
}

async function visibleMeetingById(
  db: Db,
  teamId: string,
  userId: string,
  id: string,
): Promise<string | null> {
  const rows = await db
    .select({ title: meetings.title, platform: meetings.platform })
    .from(meetings)
    .where(and(eq(meetings.teamId, teamId), eq(meetings.id, id), visibleMeeting(userId)))
    .limit(1);
  const row = rows[0];
  return row ? (row.title ?? `${row.platform} meeting`) : null;
}

async function visibleCalendarLabelById(
  db: Db,
  teamId: string,
  userId: string,
  id: string,
  requireTeamVisibility: boolean,
): Promise<string | null> {
  const rows = await db
    .select({ title: calendarEvents.title })
    .from(calendarEvents)
    .where(
      and(
        eq(calendarEvents.teamId, teamId),
        eq(calendarEvents.id, id),
        isNull(calendarEvents.deletedAt),
        requireTeamVisibility ? eq(calendarEvents.visibility, 'team') : visibleCalendar(userId),
      ),
    )
    .limit(1);
  return rows[0]?.title ?? null;
}

async function failedJobs(getQueue: () => FailedQueueLike): Promise<FailedJob[]> {
  const q = getQueue();
  const jobs = await q.getJobs(['failed'], 0, LIMIT);
  return jobs
    .map((job) => objectMeta(job))
    .map((job) => ({
      data: job.data,
      failedReason: typeof job.failedReason === 'string' ? job.failedReason : undefined,
      finishedOn: typeof job.finishedOn === 'number' ? job.finishedOn : undefined,
    }));
}

interface FailedJob {
  data: unknown;
  failedReason: string | undefined;
  finishedOn: number | undefined;
}

function rawEventLabel(row: { source: string; occurredAt: Date }): string {
  return `${row.source} event from ${row.occurredAt.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}`;
}

function objectMeta(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function textValue(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v : null;
}

function dateValue(v: unknown): Date | null {
  if (typeof v !== 'string') return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

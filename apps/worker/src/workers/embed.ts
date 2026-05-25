import {
  type Db,
  documentChunks,
  documents,
  documentVersions,
  entities as entitiesTable,
  facts as factsTable,
  factEntities,
  objectChanges as objectChangesTable,
  objectNotes as objectNotesTable,
  rawEvents,
} from '@timeline/db';
import { childLogger, getEnv, llm, qdrant, queue } from '@timeline/shared';
import { UnrecoverableError, Worker, type Job } from 'bullmq';
import { eq, sql } from 'drizzle-orm';

const log = childLogger('worker:embed');

interface EmbedWorkerDeps {
  db: Db;
}

interface RawEventRow {
  id: string;
  teamId: string;
  contentText: string | null;
  occurredAt: Date;
  authorUserId: string | null;
  source: 'web' | 'telegram' | 'email' | 'system' | 'document';
  visibility: 'private' | 'team' | 'specific_users';
  visibilityUserIds: string[] | null;
  sourceMetadata: unknown;
}

interface FactRow {
  id: string;
  teamId: string;
  rawEventId: string;
  statement: string;
}

/**
 * Resolve the effective scope from a job. Phase 5 jobs may omit `scope`;
 * we infer raw_event (factId unset) or fact (factId set) for back-compat.
 */
function resolveScope(data: queue.EmbedJobData): qdrant.PointScope {
  const scope = 'scope' in data ? data.scope : undefined;
  if (scope) {
    // Payload uses 'event' (PointScope), but the queue's union calls it
    // 'raw_event' (SourceKind). Map the queue tag onto the point scope.
    if (scope === 'raw_event') return 'event';
    return scope;
  }
  if ('factId' in data && data.factId) return 'fact';
  return 'event';
}

/**
 * Build the empty/default payload used by non-event-anchored points
 * (object, object_note, object_change, entity). All workspace-graph points
 * are stamped visibility='team' per the Phase 8 follow-ups design decision.
 */
function blankNonEventPayload(args: {
  teamId: string;
  occurredAt: Date;
  authorUserId: string | null;
  model: string;
  sourceKind: qdrant.SourceKind;
}): qdrant.QdrantPayload {
  return {
    team_id: args.teamId,
    source_kind: args.sourceKind,
    event_id: null,
    fact_id: null,
    object_id: null,
    note_id: null,
    change_id: null,
    entity_id: null,
    entity_ids: [],
    occurred_at: args.occurredAt.toISOString(),
    author_user_id: args.authorUserId,
    source: 'system',
    visibility: 'team',
    visibility_user_ids: null,
    embedding_model: args.model,
    // Phase 9 per-kind doc fields — null on non-doc_chunk points; the
    // buildDocChunkPlan overrides these on top of this base.
    document_id: null,
    document_version_id: null,
    document_chunk_id: null,
    folder_id: null,
    owner_user_id: null,
    updated_at: null,
  };
}

interface EmbedPlan {
  text: string;
  scope: qdrant.PointScope;
  sourceKind: qdrant.SourceKind;
  sourceId: string;
  payloadOverrides: Partial<qdrant.QdrantPayload>;
  occurredAt: Date;
  authorUserId: string | null;
}

/**
 * Embed worker: writes one Qdrant point per source row using the pinned
 * embedding model. Phase 5 covers {raw_event, fact}; Phase 8 follow-ups
 * add {object, object_note, object_change, entity}.
 *
 * Idempotency comes from deterministic Qdrant point ids derived from
 * (scope, sourceId, embedding_model). A duplicate enqueue upserts the same
 * point and costs at most one embedding call.
 *
 * Failure modes:
 *   - `OPENROUTER_API_KEY` or `QDRANT_URL` unset → UnrecoverableError.
 *   - Source row missing / wrong team → UnrecoverableError.
 *   - Non-team visibility raw event → stamp skip reason, return success.
 *   - Empty text (e.g. object_change with no narrative) → success no-op.
 *   - LLM or Qdrant transient errors → BullMQ retries.
 */
export function startEmbedWorker(deps: EmbedWorkerDeps): Worker<queue.EmbedJobData> {
  const worker = new Worker<queue.EmbedJobData>(
    queue.QUEUE_NAMES.embed,
    async (job: Job<queue.EmbedJobData>) => {
      const env = getEnv();
      if (!env.OPENROUTER_API_KEY) {
        throw new UnrecoverableError('embed: OPENROUTER_API_KEY not configured');
      }
      if (!env.QDRANT_URL) {
        throw new UnrecoverableError('embed: QDRANT_URL not configured');
      }

      const scope = resolveScope(job.data);
      const plan = await buildPlan(deps.db, job.data, scope);
      if (!plan) {
        // No-op (e.g. visibility-skipped raw event already stamped,
        // object_change with empty summary, or doc-chunk whose parent
        // document was soft-deleted between enqueue and process).
        // Success path with no Qdrant write.
        return { skipped: true };
      }

      // LLM call BEFORE Qdrant write so a transient embedding failure
      // retries cleanly. No DB transaction is open during the network call.
      const { vector, model } = await llm.embed({ text: plan.text });
      const client = qdrant.getQdrantClient(
        job.data.targetCollection
          ? { collection: job.data.targetCollection, requireExisting: true }
          : {},
      );
      const pointId = qdrant.buildPointId(plan.scope, plan.sourceId, model);
      const basePayload = blankNonEventPayload({
        teamId: job.data.teamId,
        occurredAt: plan.occurredAt,
        authorUserId: plan.authorUserId,
        model,
        sourceKind: plan.sourceKind,
      });
      const payload: qdrant.QdrantPayload = {
        ...basePayload,
        ...plan.payloadOverrides,
        embedding_model: model,
      };
      await client.upsertVector(pointId, vector, payload);

      // Only event-scope raw_events.source_metadata gets stamped — see Phase 5
      // rationale below. Non-event scopes don't have a single canonical row to
      // stamp; their freshness is tracked by the coverage audit script.
      if (plan.scope === 'event' && 'rawEventId' in job.data) {
        const successPatch = JSON.stringify({
          embedded_at: new Date().toISOString(),
          embedding_model: model,
        });
        await deps.db
          .update(rawEvents)
          .set({
            sourceMetadata: sql`(COALESCE(${rawEvents.sourceMetadata}, '{}'::jsonb) - 'embedding_failed_at' - 'embedding_error') || ${successPatch}::jsonb`,
          })
          .where(eq(rawEvents.id, job.data.rawEventId));
      }

      return { scope: plan.scope, sourceId: plan.sourceId, model, pointId };
    },
    {
      connection: queue.getRedisConnection(),
      // Embedding is light on CPU per job but bound by OpenRouter latency.
      // Modest parallelism keeps throughput reasonable without hammering the
      // provider. Tune once we have real numbers.
      concurrency: 4,
    },
  );

  worker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, err }, 'job failed');
    if (!job) return;
    const maxAttempts = job.opts.attempts ?? 1;
    const unrecoverable = err instanceof UnrecoverableError;
    if (!unrecoverable && job.attemptsMade < maxAttempts) return;
    // Symmetric with Phase 5: only raw-event-scope failures land on
    // raw_events.source_metadata (UI surfaces it). Fact-scope failures and
    // the new non-event scopes are operational — visible in worker logs and
    // recoverable via the reembed script + coverage audit.
    const scope = resolveScope(job.data);
    if (scope !== 'event') return;
    if (!('rawEventId' in job.data) || !job.data.rawEventId) return;
    const patch = JSON.stringify({
      embedding_failed_at: new Date().toISOString(),
      embedding_error: err.message.slice(0, 500),
    });
    void deps.db
      .update(rawEvents)
      .set({
        sourceMetadata: sql`COALESCE(${rawEvents.sourceMetadata}, '{}'::jsonb) || ${patch}::jsonb`,
      })
      .where(
        sql`${rawEvents.id} = ${job.data.rawEventId} AND NOT (COALESCE(${rawEvents.sourceMetadata}, '{}'::jsonb) ? 'embedded_at')`,
      )
      .catch((updateErr: unknown) => {
        log.error({ err: updateErr }, 'failed to mark row failure');
      });
  });
  worker.on('completed', (job) => {
    log.info({ jobId: job.id }, 'job completed');
  });

  return worker;
}

/**
 * Translate a job into a fully-resolved embedding plan. Returns null when the
 * job is a successful no-op (visibility-skipped event, empty change summary).
 * Throws UnrecoverableError when the source row is missing or off-team.
 */
async function buildPlan(
  db: Db,
  data: queue.EmbedJobData,
  scope: qdrant.PointScope,
): Promise<EmbedPlan | null> {
  switch (scope) {
    case 'event':
    case 'fact':
      return buildEventOrFactPlan(db, data, scope);
    case 'object':
      return buildObjectPlan(db, data);
    case 'object_note':
      return buildObjectNotePlan(db, data);
    case 'object_change':
      return buildObjectChangePlan(db, data);
    case 'entity':
      return buildEntityPlan(db, data);
    case 'doc_chunk':
      return buildDocChunkPlan(db, data);
  }
}

async function buildEventOrFactPlan(
  db: Db,
  data: queue.EmbedJobData,
  scope: 'event' | 'fact',
): Promise<EmbedPlan | null> {
  if (!('rawEventId' in data) || !data.rawEventId) {
    throw new UnrecoverableError('embed: raw event scope job missing rawEventId');
  }
  const rawEventId = data.rawEventId;
  const teamId = data.teamId;
  const env = getEnv();

  const rows = (await db
    .select({
      id: rawEvents.id,
      teamId: rawEvents.teamId,
      contentText: rawEvents.contentText,
      occurredAt: rawEvents.occurredAt,
      authorUserId: rawEvents.authorUserId,
      source: rawEvents.source,
      visibility: rawEvents.visibility,
      visibilityUserIds: rawEvents.visibilityUserIds,
      sourceMetadata: rawEvents.sourceMetadata,
    })
    .from(rawEvents)
    .where(eq(rawEvents.id, rawEventId))
    .limit(1)) as RawEventRow[];
  const row = rows[0];
  if (!row) throw new UnrecoverableError(`raw event ${rawEventId} not found`);
  if (row.teamId !== teamId) {
    throw new UnrecoverableError(
      `raw event ${rawEventId} team mismatch (job=${teamId}, row=${row.teamId})`,
    );
  }

  // Hard privacy gate — same rationale as Phase 5. Non-team events never have
  // their text or derived statements sent to OpenRouter, and they never land
  // in Qdrant. Stamp the skip reason so the reembed script does not re-enqueue.
  if (row.visibility !== 'team') {
    const skipPatch = JSON.stringify({
      embedding_skipped_at: new Date().toISOString(),
      embedding_skipped_reason: `visibility=${row.visibility}`,
      embedding_model: env.EMBEDDING_MODEL ?? 'openai/text-embedding-3-small',
    });
    await db
      .update(rawEvents)
      .set({
        sourceMetadata: sql`(COALESCE(${rawEvents.sourceMetadata}, '{}'::jsonb) - 'embedding_failed_at' - 'embedding_error') || ${skipPatch}::jsonb`,
      })
      .where(eq(rawEvents.id, rawEventId));
    return null;
  }

  const payloadOverrides: Partial<qdrant.QdrantPayload> = {
    event_id: row.id,
    occurred_at: row.occurredAt.toISOString(),
    author_user_id: row.authorUserId,
    source: row.source,
    visibility: row.visibility,
    visibility_user_ids: row.visibilityUserIds,
  };

  if (scope === 'fact') {
    if (!('factId' in data) || !data.factId) {
      throw new UnrecoverableError('embed: fact scope job missing factId');
    }
    const factId = data.factId;
    const factRows = (await db
      .select({
        id: factsTable.id,
        teamId: factsTable.teamId,
        rawEventId: factsTable.rawEventId,
        statement: factsTable.statement,
      })
      .from(factsTable)
      .where(eq(factsTable.id, factId))
      .limit(1)) as FactRow[];
    const fact = factRows[0];
    if (!fact) throw new UnrecoverableError(`fact ${factId} not found`);
    if (fact.teamId !== teamId || fact.rawEventId !== rawEventId) {
      throw new UnrecoverableError(
        `fact ${factId} does not belong to (team=${teamId}, rawEvent=${rawEventId})`,
      );
    }
    const links = await db
      .select({ entityId: factEntities.entityId })
      .from(factEntities)
      .where(eq(factEntities.factId, fact.id));
    return {
      text: fact.statement.trim(),
      scope: 'fact',
      sourceKind: 'fact',
      sourceId: fact.id,
      occurredAt: row.occurredAt,
      authorUserId: row.authorUserId,
      payloadOverrides: {
        ...payloadOverrides,
        fact_id: fact.id,
        entity_ids: links.map((l) => l.entityId),
      },
    };
  }

  const eventText = row.contentText?.trim();
  if (!eventText) {
    throw new UnrecoverableError(`raw event ${rawEventId} has no content_text; nothing to embed`);
  }
  return {
    text: eventText,
    scope: 'event',
    sourceKind: 'raw_event',
    sourceId: row.id,
    occurredAt: row.occurredAt,
    authorUserId: row.authorUserId,
    payloadOverrides,
  };
}

function renderObjectNarrative(row: {
  type: string;
  canonicalName: string;
  status: string;
  stage: string | null;
  priority: number | null;
  aliases: unknown;
  dueAt: Date | null;
}): string {
  const aliases = Array.isArray(row.aliases)
    ? (row.aliases as unknown[]).filter((v): v is string => typeof v === 'string')
    : [];
  const parts = [
    `${row.type}: ${row.canonicalName}`,
    aliases.length > 0 ? `aka ${aliases.join(', ')}` : '',
    `status=${row.status}`,
    row.stage ? `stage=${row.stage}` : '',
    row.priority !== null ? `priority=${String(row.priority)}` : '',
    row.dueAt ? `due ${row.dueAt.toISOString()}` : '',
  ];
  return parts.filter((p) => p.length > 0).join(' | ');
}

async function buildObjectPlan(db: Db, data: queue.EmbedJobData): Promise<EmbedPlan | null> {
  if (!('objectId' in data) || !data.objectId) {
    throw new UnrecoverableError('embed: object scope job missing objectId');
  }
  const rows = await db
    .select()
    .from(entitiesTable)
    .where(eq(entitiesTable.id, data.objectId))
    .limit(1);
  const row = rows[0];
  if (!row) throw new UnrecoverableError(`object ${data.objectId} not found`);
  if (row.teamId !== data.teamId) {
    throw new UnrecoverableError(`object ${data.objectId} team mismatch`);
  }
  if (row.mergedIntoId) {
    // Soft-deleted via merge — skip, the survivor will be embedded separately.
    return null;
  }
  return {
    text: renderObjectNarrative(row),
    scope: 'object',
    sourceKind: 'object',
    sourceId: row.id,
    occurredAt: row.updatedAt,
    authorUserId: row.ownerUserId,
    payloadOverrides: {
      object_id: row.id,
      entity_id: row.id,
    },
  };
}

async function buildObjectNotePlan(db: Db, data: queue.EmbedJobData): Promise<EmbedPlan | null> {
  if (!('noteId' in data) || !data.noteId) {
    throw new UnrecoverableError('embed: object_note scope job missing noteId');
  }
  const rows = await db
    .select()
    .from(objectNotesTable)
    .where(eq(objectNotesTable.id, data.noteId))
    .limit(1);
  const row = rows[0];
  if (!row) throw new UnrecoverableError(`object_note ${data.noteId} not found`);
  if (row.teamId !== data.teamId) {
    throw new UnrecoverableError(`object_note ${data.noteId} team mismatch`);
  }
  if (row.deletedAt) {
    // Author soft-deleted the note. Skip embed; deletion of any existing
    // point is tracked separately (out of scope here).
    return null;
  }
  const text = row.body.trim();
  if (!text) return null;
  return {
    text,
    scope: 'object_note',
    sourceKind: 'object_note',
    sourceId: row.id,
    occurredAt: row.updatedAt,
    authorUserId: row.authorUserId,
    payloadOverrides: {
      object_id: row.entityId,
      note_id: row.id,
    },
  };
}

async function buildObjectChangePlan(db: Db, data: queue.EmbedJobData): Promise<EmbedPlan | null> {
  if (!('changeId' in data) || !data.changeId) {
    throw new UnrecoverableError('embed: object_change scope job missing changeId');
  }
  const rows = await db
    .select()
    .from(objectChangesTable)
    .where(eq(objectChangesTable.id, data.changeId))
    .limit(1);
  const row = rows[0];
  if (!row) throw new UnrecoverableError(`object_change ${data.changeId} not found`);
  if (row.teamId !== data.teamId) {
    throw new UnrecoverableError(`object_change ${data.changeId} team mismatch`);
  }
  // Prefer the operator's prose `note`. Fall back to a compact field diff so
  // changes are still searchable by field name. Skip pure no-op rows.
  const note = row.note?.trim();
  let text: string;
  if (note) {
    text = note;
  } else if (row.field.startsWith('__')) {
    // Internal markers (__create__, __note_create__, ...). The accompanying
    // raw_events row carries the human-readable narrative, so skip the change
    // itself to avoid embedding low-signal text.
    return null;
  } else {
    // Cap each side of the diff so a metadata change with a multi-KB jsonb
    // value can't blow past the embedding model's token budget. 1500 chars
    // each leaves room for the field name + arrow within typical 8k-token
    // embedding inputs.
    const stringifyCapped = (v: unknown): string => {
      if (v === null) return 'null';
      const s = JSON.stringify(v);
      return s.length > 1500 ? `${s.slice(0, 1500)}…` : s;
    };
    text = `${row.field}: ${stringifyCapped(row.previousValue)} → ${stringifyCapped(row.newValue)}`;
  }
  return {
    text,
    scope: 'object_change',
    sourceKind: 'object_change',
    sourceId: row.id,
    occurredAt: row.changedAt,
    authorUserId: row.actorUserId,
    payloadOverrides: {
      object_id: row.entityId,
      change_id: row.id,
    },
  };
}

/**
 * Phase 9: doc-chunk plan. One Qdrant point per chunk of a finalised
 * `document_versions` row. Visibility gate lives on the parent document
 * row (not raw_events); soft-deleted documents return null so the embed
 * is a clean no-op rather than a stamped failure (the deleteDocument
 * scope path separately issues deletePoints to flush any prior points).
 */
async function buildDocChunkPlan(
  db: Db,
  data: queue.EmbedJobData,
): Promise<EmbedPlan | null> {
  if (!('documentChunkId' in data) || !data.documentChunkId) {
    throw new UnrecoverableError('embed: doc_chunk scope job missing documentChunkId');
  }
  const rows = await db
    .select({
      chunk: documentChunks,
      document: documents,
      version: documentVersions,
    })
    .from(documentChunks)
    .innerJoin(documents, eq(documents.id, documentChunks.documentId))
    .innerJoin(documentVersions, eq(documentVersions.id, documentChunks.documentVersionId))
    .where(eq(documentChunks.id, data.documentChunkId))
    .limit(1);
  const hit = rows[0];
  if (!hit) {
    throw new UnrecoverableError(`document chunk ${data.documentChunkId} not found`);
  }
  if (hit.chunk.teamId !== data.teamId) {
    throw new UnrecoverableError(
      `chunk ${data.documentChunkId} team mismatch (job=${data.teamId}, row=${hit.chunk.teamId})`,
    );
  }
  // Soft-deleted documents: skip without stamping a failure. The
  // deleteDocument path flushes prior Qdrant points separately. A
  // mid-flight delete races the embed job; bail cleanly so the audit
  // stays tidy.
  if (hit.document.deletedAt) return null;
  // Non-team visibility documents follow the same hard privacy gate as
  // the event/fact path. Future relaxation needs a per-chunk privacy-
  // aware payload write, not just removing this check.
  if (hit.document.visibility !== 'team') return null;
  const text = hit.chunk.text.trim();
  if (!text) {
    throw new UnrecoverableError(`chunk ${data.documentChunkId} has empty text`);
  }
  return {
    text,
    scope: 'doc_chunk',
    sourceKind: 'doc_chunk',
    sourceId: hit.chunk.id,
    occurredAt: hit.version.createdAt,
    authorUserId: hit.version.uploadedByUserId,
    payloadOverrides: {
      // Source enum value 'document' (not 'system') so source-filtered
      // searches that target documents resolve correctly.
      source: 'document',
      // Carry the upload-event id so any caller that keys on event_id
      // (timeline rendering, ev:<id> citation expansion) still has a
      // stable target for the doc-chunk's originating event.
      event_id: hit.version.sourceEventId,
      visibility: hit.document.visibility,
      visibility_user_ids: hit.document.visibilityUserIds,
      document_id: hit.document.id,
      document_version_id: hit.version.id,
      document_chunk_id: hit.chunk.id,
      folder_id: hit.document.folderId,
      owner_user_id: hit.document.ownerUserId,
      updated_at: hit.version.createdAt.toISOString(),
    },
  };
}

async function buildEntityPlan(db: Db, data: queue.EmbedJobData): Promise<EmbedPlan | null> {
  if (!('entityId' in data) || !data.entityId) {
    throw new UnrecoverableError('embed: entity scope job missing entityId');
  }
  const rows = await db
    .select()
    .from(entitiesTable)
    .where(eq(entitiesTable.id, data.entityId))
    .limit(1);
  const row = rows[0];
  if (!row) throw new UnrecoverableError(`entity ${data.entityId} not found`);
  if (row.teamId !== data.teamId) {
    throw new UnrecoverableError(`entity ${data.entityId} team mismatch`);
  }
  if (row.mergedIntoId) return null;
  const aliases = Array.isArray(row.aliases)
    ? (row.aliases as unknown[]).filter((v): v is string => typeof v === 'string')
    : [];
  const aliasPart = aliases.length > 0 ? ` / ${aliases.join(' / ')}` : '';
  const text = `${row.type}: ${row.canonicalName}${aliasPart}`;
  return {
    text,
    scope: 'entity',
    sourceKind: 'entity',
    sourceId: row.id,
    occurredAt: row.createdAt,
    authorUserId: null,
    payloadOverrides: {
      entity_id: row.id,
      object_id: row.id,
    },
  };
}

import {
  calendarEvents as calendarEventsTable,
  type Db,
  documentChunks,
  documents,
  documentVersions,
  entities as entitiesTable,
  facts as factsTable,
  factEntities,
  meetings as meetingsTable,
  meetingTranscriptChunks,
  objectChanges as objectChangesTable,
  objectNotes as objectNotesTable,
  objectSummaries as objectSummariesTable,
  rawEvents,
} from '@timeline/db';
import { UnrecoverableError } from 'bullmq';
import { and, eq, inArray, sql } from 'drizzle-orm';

import { renderRawEventForAi } from '#src/embedding/raw-event-renderer.js';
import { TIMELINE_MODELS } from '#src/llm/models.js';
import { type PointScope, type QdrantPayload, type SourceKind } from '#src/qdrant/client.js';
import { type EmbedJobData } from '#src/queue/queues.js';

interface RawEventRow {
  id: string;
  teamId: string;
  contentText: string | null;
  occurredAt: Date;
  authorUserId: string | null;
  visibilityOwnerUserId: string | null;
  source:
    | 'web'
    | 'telegram'
    | 'email'
    | 'system'
    | 'document'
    | 'meeting'
    | 'integration'
    | 'calendar'
    | 'slack';
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

export interface EmbeddingPlan {
  text: string;
  scope: PointScope;
  sourceKind: SourceKind;
  sourceId: string;
  payloadOverrides: Partial<QdrantPayload>;
  occurredAt: Date;
  authorUserId: string | null;
}

export function resolveEmbeddingScope(data: EmbedJobData): PointScope {
  const scope = 'scope' in data ? data.scope : undefined;
  if (scope) {
    if (scope === 'raw_event') return 'event';
    return scope;
  }
  if ('factId' in data && data.factId) return 'fact';
  return 'event';
}

export function blankEmbeddingPayload(args: {
  teamId: string;
  occurredAt: Date;
  authorUserId: string | null;
  model: string;
  sourceKind: SourceKind;
}): QdrantPayload {
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
    visibility_owner_user_id: null,
    source: 'system',
    visibility: 'team',
    visibility_user_ids: null,
    embedding_model: args.model,
    source_scope: 'event',
    source_id: '',
    chunk_index: 0,
    document_id: null,
    document_version_id: null,
    document_chunk_id: null,
    folder_id: null,
    file_kind: null,
    representation_kind: null,
    owner_user_id: null,
    updated_at: null,
    meeting_id: null,
    meeting_chunk_id: null,
    speaker: null,
  };
}

export async function buildEmbeddingPlan(
  db: Db,
  data: EmbedJobData,
  scope: PointScope,
): Promise<EmbeddingPlan | null> {
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
    case 'meeting_chunk':
      return buildMeetingChunkPlan(db, data);
    case 'calendar_event':
      return buildCalendarEventPlan(db, data);
  }
}

export function objectChangeEmbeddable(row: { field: string; note: string | null }): boolean {
  return Boolean(row.note?.trim()) || !row.field.startsWith('__');
}

export function documentChunkEmbeddable(row: {
  documentDeletedAt: Date | null;
  documentVisibility: 'private' | 'team' | 'specific_users';
  text: string;
}): boolean {
  return !row.documentDeletedAt && row.text.trim().length > 0;
}

export function meetingChunkEmbeddable(row: {
  meetingVisibility: 'private' | 'team' | 'specific_users';
  text: string;
}): boolean {
  return row.meetingVisibility === 'team' && row.text.trim().length > 0;
}

export function calendarEventEmbeddable(row: {
  deletedAt: Date | null;
  visibility: 'private' | 'team' | 'specific_users';
}): boolean {
  return !row.deletedAt && row.visibility === 'team';
}

async function buildEventOrFactPlan(
  db: Db,
  data: EmbedJobData,
  scope: 'event' | 'fact',
): Promise<EmbeddingPlan | null> {
  if (!('rawEventId' in data) || !data.rawEventId) {
    throw new UnrecoverableError('embed: raw event scope job missing rawEventId');
  }
  const rawEventId = data.rawEventId;
  const teamId = data.teamId;
  const rows = (await db
    .select({
      id: rawEvents.id,
      teamId: rawEvents.teamId,
      contentText: rawEvents.contentText,
      occurredAt: rawEvents.occurredAt,
      authorUserId: rawEvents.authorUserId,
      visibilityOwnerUserId: rawEvents.visibilityOwnerUserId,
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

  if (row.visibility !== 'team') {
    const skipPatch = JSON.stringify({
      embedding_skipped_at: new Date().toISOString(),
      embedding_skipped_reason: `visibility=${row.visibility}`,
      embedding_model: TIMELINE_MODELS.embedding.id,
    });
    await db
      .update(rawEvents)
      .set({
        sourceMetadata: sql`(COALESCE(${rawEvents.sourceMetadata}, '{}'::jsonb) - 'embedding_failed_at' - 'embedding_error') || ${skipPatch}::jsonb`,
      })
      .where(eq(rawEvents.id, rawEventId));
    return null;
  }

  const payloadOverrides: Partial<QdrantPayload> = {
    event_id: row.id,
    occurred_at: row.occurredAt.toISOString(),
    author_user_id: row.authorUserId,
    visibility_owner_user_id: row.visibilityOwnerUserId,
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

  const eventText = renderRawEventForAi({
    source: row.source,
    contentText: row.contentText,
    sourceMetadata: row.sourceMetadata,
  });
  if (!eventText) {
    throw new UnrecoverableError(`raw event ${rawEventId} has no content_text; nothing to embed`);
  }
  const sourceKind: SourceKind = row.source === 'integration' ? 'integration_event' : 'raw_event';
  return {
    text: eventText,
    scope: 'event',
    sourceKind,
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
  summaryText?: string | null;
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
    row.summaryText ? `summary=${row.summaryText}` : '',
  ];
  return parts.filter((p) => p.length > 0).join(' | ');
}

async function buildObjectPlan(db: Db, data: EmbedJobData): Promise<EmbeddingPlan | null> {
  if (!('objectId' in data) || !data.objectId) {
    throw new UnrecoverableError('embed: object scope job missing objectId');
  }
  const rows = await db
    .select({
      id: entitiesTable.id,
      teamId: entitiesTable.teamId,
      type: entitiesTable.type,
      canonicalName: entitiesTable.canonicalName,
      status: entitiesTable.status,
      stage: entitiesTable.stage,
      priority: entitiesTable.priority,
      aliases: entitiesTable.aliases,
      dueAt: entitiesTable.dueAt,
      updatedAt: entitiesTable.updatedAt,
      ownerUserId: entitiesTable.ownerUserId,
      mergedIntoId: entitiesTable.mergedIntoId,
      summaryText: objectSummariesTable.plainText,
    })
    .from(entitiesTable)
    .leftJoin(
      objectSummariesTable,
      and(
        eq(objectSummariesTable.teamId, data.teamId),
        eq(objectSummariesTable.entityId, entitiesTable.id),
        inArray(objectSummariesTable.status, ['ready', 'stale']),
      ),
    )
    .where(eq(entitiesTable.id, data.objectId))
    .limit(1);
  const row = rows[0];
  if (!row) throw new UnrecoverableError(`object ${data.objectId} not found`);
  if (row.teamId !== data.teamId)
    throw new UnrecoverableError(`object ${data.objectId} team mismatch`);
  if (row.mergedIntoId) return null;
  return {
    text: renderObjectNarrative(row),
    scope: 'object',
    sourceKind: 'object',
    sourceId: row.id,
    occurredAt: row.updatedAt,
    authorUserId: row.ownerUserId,
    payloadOverrides: { object_id: row.id, entity_id: row.id },
  };
}

async function buildObjectNotePlan(db: Db, data: EmbedJobData): Promise<EmbeddingPlan | null> {
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
  if (row.teamId !== data.teamId)
    throw new UnrecoverableError(`object_note ${data.noteId} team mismatch`);
  if (row.deletedAt) return null;
  const text = row.body.trim();
  if (!text) return null;
  return {
    text,
    scope: 'object_note',
    sourceKind: 'object_note',
    sourceId: row.id,
    occurredAt: row.updatedAt,
    authorUserId: row.authorUserId,
    payloadOverrides: { object_id: row.entityId, note_id: row.id },
  };
}

async function buildObjectChangePlan(db: Db, data: EmbedJobData): Promise<EmbeddingPlan | null> {
  if (!('changeId' in data) || !data.changeId) {
    throw new UnrecoverableError('embed: object_change scope job missing changeId');
  }
  const rows = await db
    .select()
    .from(objectChangesTable)
    .where(eq(objectChangesTable.id, data.changeId))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  if (row.teamId !== data.teamId)
    throw new UnrecoverableError(`object_change ${data.changeId} team mismatch`);
  const note = row.note?.trim();
  let text: string;
  if (note) {
    text = note;
  } else if (!objectChangeEmbeddable(row)) {
    return null;
  } else {
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
    payloadOverrides: { object_id: row.entityId, change_id: row.id },
  };
}

async function buildDocChunkPlan(db: Db, data: EmbedJobData): Promise<EmbeddingPlan | null> {
  if (!('documentChunkId' in data) || !data.documentChunkId) {
    throw new UnrecoverableError('embed: doc_chunk scope job missing documentChunkId');
  }
  const rows = await db
    .select({ chunk: documentChunks, document: documents, version: documentVersions })
    .from(documentChunks)
    .innerJoin(documents, eq(documents.id, documentChunks.documentId))
    .innerJoin(documentVersions, eq(documentVersions.id, documentChunks.documentVersionId))
    .where(eq(documentChunks.id, data.documentChunkId))
    .limit(1);
  const hit = rows[0];
  if (!hit) throw new UnrecoverableError(`document chunk ${data.documentChunkId} not found`);
  if (hit.chunk.teamId !== data.teamId) {
    throw new UnrecoverableError(
      `chunk ${data.documentChunkId} team mismatch (job=${data.teamId}, row=${hit.chunk.teamId})`,
    );
  }
  if (
    !documentChunkEmbeddable({
      documentDeletedAt: hit.document.deletedAt,
      documentVisibility: hit.document.visibility,
      text: hit.chunk.text,
    })
  ) {
    return null;
  }
  const text = hit.chunk.text.trim();
  return {
    text,
    scope: 'doc_chunk',
    sourceKind: 'doc_chunk',
    sourceId: hit.chunk.id,
    occurredAt: hit.version.createdAt,
    authorUserId: hit.version.uploadedByUserId,
    payloadOverrides: {
      source: 'document',
      event_id: hit.version.sourceEventId,
      visibility: hit.document.visibility,
      visibility_user_ids: hit.document.visibilityUserIds,
      visibility_owner_user_id: hit.document.ownerUserId,
      document_id: hit.document.id,
      document_version_id: hit.version.id,
      document_chunk_id: hit.chunk.id,
      folder_id: hit.document.folderId,
      file_kind: hit.document.fileKind,
      representation_kind: hit.chunk.representationKind,
      owner_user_id: hit.document.ownerUserId,
      updated_at: hit.version.createdAt.toISOString(),
    },
  };
}

async function buildEntityPlan(db: Db, data: EmbedJobData): Promise<EmbeddingPlan | null> {
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
  if (row.teamId !== data.teamId)
    throw new UnrecoverableError(`entity ${data.entityId} team mismatch`);
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
    payloadOverrides: { entity_id: row.id, object_id: row.id },
  };
}

async function buildMeetingChunkPlan(db: Db, data: EmbedJobData): Promise<EmbeddingPlan | null> {
  if (!('meetingChunkId' in data) || !data.meetingChunkId) {
    throw new UnrecoverableError('embed: meeting_chunk scope job missing meetingChunkId');
  }
  const rows = await db
    .select({ chunk: meetingTranscriptChunks, meeting: meetingsTable })
    .from(meetingTranscriptChunks)
    .innerJoin(meetingsTable, eq(meetingsTable.id, meetingTranscriptChunks.meetingId))
    .where(eq(meetingTranscriptChunks.id, data.meetingChunkId))
    .limit(1);
  const hit = rows[0];
  if (!hit) throw new UnrecoverableError(`meeting chunk ${data.meetingChunkId} not found`);
  if (hit.chunk.teamId !== data.teamId) {
    throw new UnrecoverableError(
      `meeting chunk ${data.meetingChunkId} team mismatch (job=${data.teamId}, row=${hit.chunk.teamId})`,
    );
  }
  if (
    !meetingChunkEmbeddable({
      meetingVisibility: hit.meeting.defaultVisibility,
      text: hit.chunk.text,
    })
  ) {
    return null;
  }
  return {
    text: hit.chunk.text.trim(),
    scope: 'meeting_chunk',
    sourceKind: 'meeting_chunk',
    sourceId: hit.chunk.id,
    occurredAt: hit.meeting.startedAt ?? hit.chunk.createdAt,
    authorUserId: hit.meeting.createdByUserId,
    payloadOverrides: {
      source: 'meeting',
      event_id: hit.chunk.rawEventId,
      visibility: hit.meeting.defaultVisibility,
      visibility_user_ids: hit.meeting.visibilityUserIds,
      meeting_id: hit.meeting.id,
      meeting_chunk_id: hit.chunk.id,
      speaker: hit.chunk.speaker,
    },
  };
}

async function buildCalendarEventPlan(db: Db, data: EmbedJobData): Promise<EmbeddingPlan | null> {
  if (!('calendarEventId' in data) || !data.calendarEventId) {
    throw new UnrecoverableError('embed: calendar_event scope job missing calendarEventId');
  }
  const rows = await db
    .select()
    .from(calendarEventsTable)
    .where(eq(calendarEventsTable.id, data.calendarEventId))
    .limit(1);
  const row = rows[0];
  if (!row) throw new UnrecoverableError(`calendar event ${data.calendarEventId} not found`);
  if (row.teamId !== data.teamId) {
    throw new UnrecoverableError(
      `calendar event ${data.calendarEventId} team mismatch (job=${data.teamId}, row=${row.teamId})`,
    );
  }
  if (!calendarEventEmbeddable(row)) return null;
  const parts = [
    row.title,
    row.description ?? '',
    row.location ? `at ${row.location}` : '',
    `${row.startAt.toISOString()} to ${row.endAt.toISOString()}`,
    row.timezone !== 'UTC' ? `(${row.timezone})` : '',
  ];
  const text = parts.filter((p) => p.length > 0).join(' | ');
  if (!text.trim()) return null;
  return {
    text,
    scope: 'calendar_event',
    sourceKind: 'calendar_event',
    sourceId: row.id,
    occurredAt: row.startAt,
    authorUserId: row.createdByUserId,
    payloadOverrides: {
      source: 'calendar',
      event_id: row.startAtRawEventId ?? row.scheduledRawEventId,
      visibility: row.visibility,
      visibility_user_ids: row.visibilityUserIds,
    },
  };
}

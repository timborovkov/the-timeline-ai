import type { TeamScope } from '#src/team-scope.js';

import { searchAppGuide } from '#src/app-guide.js';
import { artifactRefCitation } from '#src/citation.js';

export type RetrievalRecipe =
  | 'auto'
  | 'object_profile'
  | 'timeline_evidence'
  | 'task_status'
  | 'calendar'
  | 'board_state'
  | 'document_knowledge'
  | 'product_guide';

export interface RetrieveWorkspaceContextInput {
  query: string;
  recipe?: RetrievalRecipe;
  objectId?: string;
  limit?: number;
  includeDocuments?: boolean;
  includeCalendar?: boolean;
}

export interface WorkspaceContextResult {
  recipe: Exclude<RetrievalRecipe, 'auto'>;
  query: string;
  refs: string[];
  objects: unknown[];
  notes: unknown[];
  events: unknown[];
  tasks: unknown[];
  boards: unknown[];
  calendarEvents: unknown[];
  documents: unknown[];
  routes: unknown[];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MILLIS_PER_DAY = 24 * 60 * 60 * 1000;

export async function retrieveWorkspaceContext(
  scope: TeamScope,
  input: RetrieveWorkspaceContextInput,
): Promise<WorkspaceContextResult> {
  const query = input.query.trim();
  const recipe = input.recipe === 'auto' || !input.recipe ? classifyRecipe(query) : input.recipe;
  const limit = Math.min(Math.max(input.limit ?? 5, 1), 10);
  const routes =
    recipe === 'product_guide' ? searchAppGuide(query, limit) : searchAppGuide(query, 2);

  const objectCandidates = input.objectId
    ? []
    : await scope.objects.searchObjects({ query, limit, archived: false }).catch(() => []);
  const primaryObjectId = input.objectId ?? objectCandidates[0]?.id;

  const [objectDetail, entityProfile, notes, events, boardContext, documents, calendarEvents] =
    await Promise.all([
      primaryObjectId ? scope.objects.getObject(primaryObjectId).catch(() => null) : null,
      primaryObjectId
        ? scope.timeline
            .getEntity(primaryObjectId, { factLimit: 12, coOccurringLimit: 8 })
            .catch(() => null)
        : null,
      primaryObjectId
        ? scope.timeline
            .searchObjectNotes({ query, objectId: primaryObjectId, limit })
            .catch(() => [])
        : scope.timeline.searchObjectNotes({ query, limit: Math.min(limit, 5) }).catch(() => []),
      scope.timeline
        .searchEvents({
          query,
          ...(primaryObjectId ? { entityIds: [primaryObjectId] } : {}),
          limit: Math.min(limit, 8),
        })
        .catch(() => []),
      primaryObjectId ? scope.boards.listObjectBoardContext(primaryObjectId).catch(() => []) : [],
      input.includeDocuments || recipe === 'document_knowledge'
        ? scope.documents.searchDocumentChunks({ query, limit: Math.min(limit, 5) }).catch(() => [])
        : [],
      input.includeCalendar || recipe === 'calendar'
        ? scope.calendar
            .listCalendarEvents({
              from: new Date(Date.now() - 14 * MILLIS_PER_DAY),
              to: new Date(Date.now() + 30 * MILLIS_PER_DAY),
              limit: Math.min(limit, 10),
            })
            .catch(() => [])
        : [],
    ]);

  const objects = [
    ...objectCandidates.map((object) => ({
      id: object.id,
      citation: objectCitation(object.type, object.id),
      name: object.canonicalName,
      type: object.type,
      status: object.status,
      stage: object.stage,
      due_at: object.dueAt?.toISOString() ?? null,
    })),
    ...(objectDetail && !objectCandidates.some((object) => object.id === objectDetail.id)
      ? [
          {
            id: objectDetail.id,
            citation: objectCitation(objectDetail.type, objectDetail.id),
            name: objectDetail.canonicalName,
            type: objectDetail.type,
            status: objectDetail.status,
            stage: objectDetail.stage,
            due_at: objectDetail.dueAt?.toISOString() ?? null,
          },
        ]
      : []),
  ];

  const facts =
    entityProfile?.facts.slice(0, 12).map((fact) => ({
      fact_id: fact.id,
      statement: fact.statement,
      confidence: fact.confidence,
      event_citation: artifactRefCitation({ kind: 'timeline_event', id: fact.rawEventId }),
    })) ?? [];

  const result: WorkspaceContextResult = {
    recipe,
    query,
    refs: [],
    objects,
    notes: notes.map((note) => ({
      note_id: note.noteId,
      citation: artifactRefCitation({ kind: 'object_note', id: note.noteId }),
      object_id: note.objectId,
      object_citation: artifactRefCitation({ kind: 'object', id: note.objectId }),
      body: note.body,
      score: note.score,
    })),
    events: [
      ...events.map((event) => ({
        event_id: event.eventId,
        citation: artifactRefCitation({ kind: 'timeline_event', id: event.eventId }),
        source: event.source,
        occurred_at: event.occurredAt,
        score: event.score,
        snippet: event.snippet,
      })),
      ...facts,
    ],
    tasks:
      objectDetail?.openTasks.slice(0, 10).map((task) => ({
        id: task.id,
        citation: artifactRefCitation({ kind: 'task', id: task.id }),
        name: task.canonicalName,
        status: task.status,
        due_at: task.dueAt?.toISOString() ?? null,
      })) ?? [],
    boards: boardContext.slice(0, 10).map((board) => ({
      board_id: board.boardId,
      board_citation: artifactRefCitation({ kind: 'board', id: board.boardId }),
      board_name: board.boardName,
      item_id: board.itemId,
      item_citation: artifactRefCitation({ kind: 'board_item', id: board.itemId }),
      lane_name: board.laneName,
      next_due_at: board.dueAt?.toISOString() ?? null,
      priority: board.priority,
    })),
    calendarEvents: calendarEvents.map((event) => ({
      id: event.id,
      citation: artifactRefCitation({ kind: 'calendar_event', id: event.id }),
      title: event.title,
      start_at: event.startAt.toISOString(),
      end_at: event.endAt.toISOString(),
      redacted: event.redacted,
    })),
    documents: documents.map((doc) => ({
      document_id: doc.documentId,
      chunk_id: doc.documentChunkId,
      citation: artifactRefCitation({
        kind: 'document_chunk',
        id: doc.documentChunkId,
        documentId: doc.documentId,
        version: doc.version,
        chunkId: doc.documentChunkId,
      }),
      document_name: doc.documentName,
      snippet: doc.summary ?? doc.text.slice(0, 500),
      score: doc.score,
    })),
    routes: routes.map((route) => ({
      route_id: route.id,
      citation: route.citation,
      title: route.title,
      href: route.href,
      guide: route.guide,
      minimum_role: route.minRole,
      score: route.score,
    })),
  };
  result.refs = collectRefs(result);
  return result;
}

function classifyRecipe(query: string): Exclude<RetrievalRecipe, 'auto'> {
  const q = query.toLowerCase();
  if (/\b(where|how do i|how can i|invite|settings|guide|use timeline)\b/.test(q)) {
    return 'product_guide';
  }
  if (
    /\b(what happened|who said|what did|where did|timeline|events?|activity|mentioned|mentioned by|log|history|recent)\b/.test(
      q,
    )
  ) {
    return 'timeline_evidence';
  }
  if (/\b(calendar|schedule|meeting|tomorrow|today|week)\b/.test(q)) return 'calendar';
  if (/\b(board|kanban|lane|pipeline)\b/.test(q)) return 'board_state';
  if (/\b(task|follow[- ]?up|todo|blocked|due)\b/.test(q)) return 'task_status';
  if (/\b(document|file|contract|pdf|doc)\b/.test(q)) return 'document_knowledge';
  if (UUID_RE.test(query)) return 'object_profile';
  return 'object_profile';
}

function objectCitation(type: string, id: string): string {
  return artifactRefCitation({
    kind: type === 'task' || type === 'follow_up' ? 'task' : 'object',
    id,
  });
}

function collectRefs(result: Omit<WorkspaceContextResult, 'refs'>): string[] {
  const refs = new Set<string>();
  for (const group of [
    result.objects,
    result.notes,
    result.events,
    result.tasks,
    result.boards,
    result.calendarEvents,
    result.documents,
    result.routes,
  ]) {
    for (const item of group as Record<string, unknown>[]) {
      for (const value of Object.values(item)) {
        if (
          typeof value === 'string' &&
          /^\[(?:ev|ent|note|doc|cal|board|board-item|task|route):/.test(value)
        ) {
          refs.add(value);
        }
      }
    }
  }
  return [...refs].slice(0, 50);
}

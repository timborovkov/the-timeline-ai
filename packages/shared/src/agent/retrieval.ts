import type { TeamScope } from '#src/team-scope.js';

import { fenceExternalContent } from '#src/agent/external-content.js';
import { searchAppGuide } from '#src/app-guide.js';
import { artifactRefCitation, parseCitations } from '#src/citation.js';
import {
  buildEvidencePack,
  evidenceSourceContextForPrompt,
  type EvidencePackMetrics,
} from '#src/evidence-pack/index.js';
import { type ObjectSummarySourceRef, sourceRefCitation } from '#src/objects/summaries.js';

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
  adapterFailures: WorkspaceContextAdapterFailure[];
  evidencePack:
    | {
        status: 'complete';
        version: string;
        policyVersion: string;
        fingerprint: string;
        items: unknown[];
        metrics: EvidencePackMetrics;
      }
    | { status: 'failed'; errorReason: string }
    | null;
}

export interface WorkspaceContextAdapterFailure {
  adapter:
    | 'object_search'
    | 'object_detail'
    | 'entity_profile'
    | 'notes'
    | 'timeline_events'
    | 'evidence_pack'
    | 'boards'
    | 'documents'
    | 'calendar';
  errorReason: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MILLIS_PER_DAY = 24 * 60 * 60 * 1000;

async function recoverAdapter<T>(
  failures: WorkspaceContextAdapterFailure[],
  adapter: WorkspaceContextAdapterFailure['adapter'],
  promise: Promise<T>,
  fallback: T,
): Promise<T> {
  try {
    return await promise;
  } catch (error) {
    failures.push({
      adapter,
      errorReason: error instanceof Error ? error.name : 'unknown_error',
    });
    return fallback;
  }
}

export async function retrieveWorkspaceContext(
  scope: TeamScope,
  input: RetrieveWorkspaceContextInput,
): Promise<WorkspaceContextResult> {
  const query = input.query.trim();
  const recipe = input.recipe === 'auto' || !input.recipe ? classifyRecipe(query) : input.recipe;
  const limit = Math.min(Math.max(input.limit ?? 5, 1), 10);
  const routes =
    recipe === 'product_guide' ? searchAppGuide(query, limit) : searchAppGuide(query, 2);
  const adapterFailures: WorkspaceContextAdapterFailure[] = [];

  const objectCandidates = input.objectId
    ? []
    : await recoverAdapter(
        adapterFailures,
        'object_search',
        scope.objects.searchObjects({ query, limit, archived: false }),
        [],
      );
  const primaryObjectId = input.objectId ?? objectCandidates[0]?.id;

  const [objectDetail, entityProfile, notes, events, boardContext, documents, calendarEvents] =
    await Promise.all([
      primaryObjectId
        ? recoverAdapter(
            adapterFailures,
            'object_detail',
            scope.objects.getObject(primaryObjectId),
            null,
          )
        : null,
      primaryObjectId
        ? recoverAdapter(
            adapterFailures,
            'entity_profile',
            scope.timeline.getEntity(primaryObjectId, { factLimit: 12, coOccurringLimit: 8 }),
            null,
          )
        : null,
      primaryObjectId
        ? recoverAdapter(
            adapterFailures,
            'notes',
            scope.timeline.searchObjectNotes({ query, objectId: primaryObjectId, limit }),
            [],
          )
        : recoverAdapter(
            adapterFailures,
            'notes',
            scope.timeline.searchObjectNotes({ query, limit: Math.min(limit, 5) }),
            [],
          ),
      recoverAdapter(
        adapterFailures,
        'timeline_events',
        scope.timeline.searchEvents({
          query,
          ...(primaryObjectId ? { entityIds: [primaryObjectId] } : {}),
          limit: Math.min(limit, 8),
        }),
        [],
      ),
      primaryObjectId
        ? recoverAdapter(
            adapterFailures,
            'boards',
            scope.boards.listObjectBoardContext(primaryObjectId),
            [],
          )
        : [],
      input.includeDocuments || recipe === 'document_knowledge'
        ? recoverAdapter(
            adapterFailures,
            'documents',
            scope.documents.searchDocumentChunks({ query, limit: Math.min(limit, 5) }),
            [],
          )
        : [],
      input.includeCalendar || recipe === 'calendar'
        ? recoverAdapter(
            adapterFailures,
            'calendar',
            scope.calendar.listCalendarEvents({
              from: new Date(Date.now() - 14 * MILLIS_PER_DAY),
              to: new Date(Date.now() + 30 * MILLIS_PER_DAY),
              limit: Math.min(limit, 10),
            }),
            [],
          )
        : [],
    ]);

  const objectDetailSummary = objectDetail?.summary?.summary
    ? {
        overview: objectDetail.summary.summary.overview,
        current_state: objectDetail.summary.summary.currentState.map((item) => ({
          label: item.label,
          text: item.text,
          citations: item.sourceRefs.flatMap(summarySourceRefCitationForChat),
        })),
        source_citations: objectDetail.summary.sourceRefs.flatMap(summarySourceRefCitationForChat),
        updated_at: objectDetail.summary.generatedAt?.toISOString() ?? null,
      }
    : null;
  let evidencePack: WorkspaceContextResult['evidencePack'] = null;
  if (events.length > 0) {
    try {
      const pack = await buildEvidencePack(scope, {
        purpose: 'answer',
        anchorRawEventIds: events.map((event) => event.eventId),
        semanticRawEventIds: events.map((event) => event.eventId),
      });
      evidencePack = {
        status: 'complete',
        version: pack.version,
        policyVersion: pack.policyVersion,
        fingerprint: pack.fingerprint,
        items: pack.items.map((item) => ({
          rawEventId: item.rawEventId,
          citation: artifactRefCitation({ kind: 'timeline_event', id: item.rawEventId }),
          surface: item.surface,
          source: item.source,
          role: item.role,
          occurredAt: item.occurredAt.toISOString(),
          senderContext: evidenceSourceContextForPrompt(
            item.source,
            item.sourceMetadata,
            item.authorUserId,
            [],
            item.rawEventId,
          ),
          snippet:
            fenceExternalContent(item.contentText, {
              source: item.source,
              eventId: item.rawEventId,
            }) ?? '',
          relationshipSignals: item.relationshipSignals,
        })),
        metrics: pack.metrics,
      };
    } catch (error) {
      const errorReason = error instanceof Error ? error.name : 'evidence_pack_failure';
      adapterFailures.push({ adapter: 'evidence_pack', errorReason });
      evidencePack = { status: 'failed', errorReason };
    }
  }
  const objects = [
    ...objectCandidates.map((object) => ({
      id: object.id,
      citation: objectCitation(object.type, object.id),
      name: object.canonicalName,
      type: object.type,
      status: object.status,
      stage: object.stage,
      due_at: object.dueAt?.toISOString() ?? null,
      ...(objectDetail?.id === object.id ? { summary: objectDetailSummary } : {}),
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
            summary: objectDetailSummary,
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
        sender: event.sender,
        resolved_sender_object: event.resolvedSenderObject,
        sender_resolution_status: event.senderResolutionStatus,
        occurred_at: event.occurredAt,
        score: event.score,
        snippet: event.snippet,
        artifact_cluster: event.artifactCluster
          ? {
              id: event.artifactCluster.id,
              type: event.artifactCluster.artifactType,
              name: event.artifactCluster.canonicalName,
              status: event.artifactCluster.status,
              related_evidence: event.artifactCluster.relatedEvidence.map((evidence) => ({
                event_citation: evidence.rawEventId
                  ? artifactRefCitation({ kind: 'timeline_event', id: evidence.rawEventId })
                  : null,
                provider: evidence.provider,
                external_object_id: evidence.externalObjectId,
                role: evidence.role,
                strength: evidence.strength,
                authoritative: evidence.authoritative,
                occurred_at: evidence.occurredAt,
                snippet: evidence.snippet,
              })),
            }
          : null,
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
    adapterFailures: adapterFailures.sort((left, right) =>
      left.adapter.localeCompare(right.adapter),
    ),
    evidencePack,
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
      collectRefsFromValue(item, refs);
    }
  }
  return [...refs].slice(0, 50);
}

function collectRefsFromValue(value: unknown, refs: Set<string>): void {
  if (typeof value === 'string') {
    if (isExactSupportedCitation(value)) refs.add(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectRefsFromValue(item, refs);
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const nested of Object.values(value)) collectRefsFromValue(nested, refs);
}

function summarySourceRefCitationForChat(ref: ObjectSummarySourceRef): string[] {
  return ref.kind === 'field' ? [] : [sourceRefCitation(ref)];
}

function isExactSupportedCitation(value: string): boolean {
  const parts = parseCitations(value);
  return parts.length === 1 && parts[0]?.type !== 'text';
}

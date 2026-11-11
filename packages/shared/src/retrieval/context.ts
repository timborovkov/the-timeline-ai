import { fenceExternalContent } from '#src/agent/external-content.js';
import { artifactRefCitation } from '#src/citation.js';
import {
  buildEvidencePack,
  EVIDENCE_PACK_POLICIES,
  evidenceSourceContextForPrompt,
} from '#src/evidence-pack/index.js';
import { buildTimelineMoments, timelineMomentLookupPlan } from '#src/timeline-moments/index.js';

import type { TeamScope } from '#src/team-scope.js';

/** Expand only scoped moments, never arbitrary semantic neighbors. */
export async function expandEvidenceConversations(scope: TeamScope, eventIds: string[]) {
  const anchors = await scope.timeline.getEventsByIds([...new Set(eventIds)].slice(0, 20));
  const inputOrder = new Map(eventIds.map((id, index) => [id, index]));
  const momentRank = (moment: ReturnType<typeof buildTimelineMoments>[number]) =>
    Math.min(...moment.rawEvents.map((event) => inputOrder.get(event.id) ?? Infinity));
  const moments = buildTimelineMoments(anchors, new Map(), { groupingMode: 'moments' }).sort(
    (a, b) => momentRank(a) - momentRank(b),
  );
  const ids = new Set(anchors.map((event) => event.id));
  const adapterFailures: { adapter: 'conversation_context'; errorReason: string }[] = [];
  let truncated = moments.length > 5 || eventIds.length > 20;
  for (const moment of moments.slice(0, 5)) {
    const plan = timelineMomentLookupPlan(moment.id);
    if (!plan) continue;
    const limit = Math.min(plan.limit, 40);
    try {
      const related = await scope.timeline.listEventsForMomentLookup({ ...plan, limit });
      truncated ||= related.length >= limit;
      for (const event of related) {
        // Optional attachments awaiting transcription must not invalidate text anchors.
        if (!event.contentText?.trim()) continue;
        if (ids.size >= 100 && !ids.has(event.id)) {
          truncated = true;
          continue;
        }
        ids.add(event.id);
      }
    } catch (error) {
      adapterFailures.push({
        adapter: 'conversation_context',
        errorReason: error instanceof Error ? error.name : 'unknown_error',
      });
    }
  }
  // The downstream pack has a smaller core budget than conversation discovery.
  truncated ||= new Set([...eventIds, ...ids]).size > EVIDENCE_PACK_POLICIES.answer.maxCoreEvents;
  return { eventIds: [...ids], truncated, adapterFailures };
}

/** Read-time context only: never resolves contradictions or creates proposals. */
export async function enrichEvidenceContext(
  scope: TeamScope,
  input: { eventIds?: string[]; objectIds?: string[]; includeConversation?: boolean },
) {
  const failures: { adapter: string; errorReason: string }[] = [];
  const safe = async <T>(adapter: string, read: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await read();
    } catch (error) {
      failures.push({
        adapter,
        errorReason: error instanceof Error ? error.name : 'unknown_error',
      });
      return fallback;
    }
  };
  const eventIds = [...new Set(input.eventIds ?? [])];
  const linked = eventIds.length
    ? await safe('source_identity', () => scope.timeline.resolveEvidenceObjectIds(eventIds), {
        objectIds: [],
        truncated: false,
      })
    : { objectIds: [], truncated: false };
  const ids = new Set([...(input.objectIds ?? []), ...linked.objectIds]);
  // SQL-hydrated fact associations, never vector payload entity IDs or a semantic top match.
  const details = await Promise.all(
    eventIds
      .slice(0, 20)
      .map((id) => safe('event_identity', () => scope.timeline.getEventWithFacts(id), null)),
  );
  for (const detail of details) {
    for (const entity of detail?.entities ?? []) ids.add(entity.id);
  }
  const objects = [];
  let truncated = linked.truncated || ids.size > 5 || eventIds.length > 20;
  for (const id of [...ids].slice(0, 5)) {
    const current = await safe('current_record', () => scope.objects.getObject(id), null);
    if (!current) continue;
    const bundles = await safe(
      'pending_proposals',
      () => scope.suggestions.listPendingSuggestionsForObject(id),
      [],
    );
    // A bundle can contain unrelated items. Match exact IDs, never substring/name similarity.
    const refersTo = (value: unknown): boolean =>
      value !== null &&
      typeof value === 'object' &&
      Object.entries(value).some(
        ([key, field]) =>
          [
            'objectId',
            'entityId',
            'fromEntityId',
            'toEntityId',
            'fromObjectId',
            'toObjectId',
            'parentId',
            'projectId',
            'objectIds',
          ].includes(key) &&
          (field === id || (Array.isArray(field) && field.includes(id))),
      );
    const boardContext = bundles.some((bundle) =>
      bundle.items.some(
        (item) => item.status === 'pending' && item.targetKind === 'board_item_update',
      ),
    )
      ? await safe('board_item_identity', () => scope.boards.listObjectBoardContext(id), [])
      : [];
    const boardItemIds = new Set(boardContext.map((item) => item.itemId));
    const boardItemMatches = (item: (typeof bundles)[number]['items'][number]) => {
      if (item.targetKind !== 'board_item_update') return false;
      const boardItemId = item.proposedPayload.boardItemId;
      return (
        (typeof boardItemId === 'string' && boardItemIds.has(boardItemId)) ||
        (item.targetId !== null && boardItemIds.has(item.targetId))
      );
    };
    const pending = bundles.flatMap((bundle) =>
      bundle.items
        .filter(
          (item) =>
            item.status === 'pending' &&
            (item.targetId === id || refersTo(item.proposedPayload) || boardItemMatches(item)),
        )
        .map((item) => ({
          id: item.id,
          proposalId: bundle.id,
          canonical: false as const,
          status: item.status,
          operation: item.operation,
          targetKind: item.targetKind,
          targetId: item.targetId,
          proposedChanges: fenceExternalContent(JSON.stringify(item.proposedPayload), {
            source: 'pending-proposal',
            eventId: item.id,
          }),
          createdAt: bundle.createdAt.toISOString(),
          updatedAt: bundle.updatedAt.toISOString(),
          evidence: (item.evidence?.length ? item.evidence : bundle.evidence).map((ev) => ({
            citation: artifactRefCitation({ kind: 'timeline_event', id: ev.rawEventId }),
            occurredAt: ev.occurredAt?.toISOString() ?? null,
            source: ev.source,
            quote: fenceExternalContent(ev.quote, {
              source: 'proposal-evidence',
              eventId: ev.rawEventId,
            }),
          })),
        })),
    );
    truncated ||= pending.length > 5 || bundles.length >= 100;
    objects.push({
      objectId: current.id,
      citation: artifactRefCitation({ kind: 'object', id: current.id }),
      current: {
        canonical: true,
        name: fenceExternalContent(current.canonicalName, {
          source: 'object',
          eventId: current.id,
        }),
        type: current.type,
        priority: current.priority,
        archivedAt: current.archivedAt?.toISOString() ?? null,
        updatedAt: current.updatedAt.toISOString(),
        metadata: fenceExternalContent(JSON.stringify(current.metadata), {
          source: 'object',
          eventId: current.id,
        }),
        status: current.status,
        stage: current.stage,
        dueAt: current.dueAt?.toISOString() ?? null,
        ownerUserId: current.ownerUserId,
        assigneeUserId: current.assigneeUserId,
      },
      currentBoardItems: boardContext.map((item) => ({
        itemId: item.itemId,
        boardId: item.boardId,
        canonical: true,
        values: fenceExternalContent(JSON.stringify(item), {
          source: 'board-item',
          eventId: item.itemId,
        }),
      })),
      currentEvidence: [...current.provenance.whyThisExists, ...current.provenance.whatChangedIt]
        .slice(0, 5)
        .map((entry) => ({
          operation: entry.operation,
          createdAt: entry.createdAt.toISOString(),
          evidence: entry.evidence.map((ev) => ({
            citation: artifactRefCitation({ kind: 'timeline_event', id: ev.rawEventId }),
            source: ev.source,
            occurredAt: ev.occurredAt.toISOString(),
            quote: fenceExternalContent(ev.quote ?? ev.contentText, {
              source: ev.source,
              eventId: ev.rawEventId,
            }),
          })),
        })),
      pending: pending.slice(0, 5),
    });
  }
  const conversation =
    eventIds.length && input.includeConversation !== false
      ? await safe('conversation_context', () => expandEvidenceConversations(scope, eventIds), {
          eventIds: [],
          truncated: false,
          adapterFailures: [],
        })
      : { eventIds: [], truncated: false, adapterFailures: [] };
  failures.push(...conversation.adapterFailures);
  truncated ||= conversation.truncated;
  const pack =
    eventIds.length && input.includeConversation !== false
      ? await safe(
          'conversation_context',
          () =>
            buildEvidencePack(scope, {
              purpose: 'answer',
              anchorRawEventIds: eventIds.slice(0, 20),
              semanticRawEventIds: eventIds.slice(0, 20),
              coreRawEventIds: conversation.eventIds,
            }),
          null,
        )
      : null;
  truncated ||= pack?.metrics.truncated ?? false;
  return {
    objects,
    truncated,
    adapterFailures: failures,
    note: 'Current records and pending proposals are distinct. Freshness is not authority. Missing context does not prove agreement. Cite disagreements; never invent a resolution.',
    evidence:
      pack?.items
        .slice()
        .sort(
          (a, b) =>
            a.occurredAt.getTime() - b.occurredAt.getTime() ||
            a.rawEventId.localeCompare(b.rawEventId),
        )
        .map((item) => ({
          eventId: item.rawEventId,
          citation: artifactRefCitation({ kind: 'timeline_event', id: item.rawEventId }),
          source: item.source,
          occurredAt: item.occurredAt.toISOString(),
          role: item.role,
          sourceContext: evidenceSourceContextForPrompt(
            item.source,
            item.sourceMetadata,
            item.authorUserId,
            [],
            item.rawEventId,
          ),
          content: fenceExternalContent(item.contentText, {
            source: item.source,
            eventId: item.rawEventId,
          }),
        })) ?? [],
  };
}

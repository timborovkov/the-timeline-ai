/**
 * Phase 8 — workspace object helpers.
 *
 * All public functions take a `TeamScopeCore` constructed via `withTeam`, so
 * team isolation + membership are already enforced upstream. The helpers
 * never read the team_id off the function argument — they read it off the
 * scope. That's the chokepoint that keeps a typo in a caller from leaking
 * across teams.
 */
import { createHash, randomUUID } from 'node:crypto';

import {
  type Db,
  agentSuggestionEvidence,
  agentSuggestionItems,
  agentSuggestions,
  artifactClusters,
  artifactEvidenceAssociations,
  boardLanes,
  boardItemChanges,
  boardItems,
  boards,
  calendarEventEntities,
  calendarEvents,
  chatMessages,
  chatSessions,
  documentChunks,
  documentVersions,
  documents,
  entities,
  entityRelationships,
  entityType,
  factEntities,
  facts as factsTable,
  notifications,
  objectChanges,
  objectIdentityFacets,
  objectNotes,
  objectSummaries,
  objectViews,
  rawEvents,
  relationshipKind,
  reconciliationEvidence,
  reconciliationOutputs,
  reconciliationRuns,
  taskCategoryAssignments,
} from '@timeline/db';
import {
  type SQL,
  and,
  asc,
  desc,
  eq,
  exists,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  ne,
  notInArray,
  or,
  sql,
} from 'drizzle-orm';

import type {
  TaskCategory,
  TaskCategoryMode,
  TaskCategorySource,
  TaskCategoryStatus,
} from '#src/task-categories/types.js';
import type { TeamScopeCore } from '#src/team-scope.js';

import {
  deleteDueDateCalendarEventEmbeddings,
  enqueueDueDateCalendarEventEmbeddings,
  mergeDueDateCalendarSyncResults,
  notifyObjectDueDate,
  notifyBoardItemDueDate,
  syncBoardItemDueDateCalendarEvent,
  syncObjectDueDateCalendarEvent,
  tombstoneObjectDueDateCalendarEventsForEntities,
  type DueDateCalendarSyncResult,
} from '#src/calendar/due-dates.js';
import { reconcileLinkArtifactsForRawEvent } from '#src/conversational/link-artifacts.js';
import { TIMELINE_MODELS } from '#src/llm/models.js';
import { childLogger } from '#src/logger.js';
import {
  normalizeIdentityFacet,
  validateIdentityFacetValue,
  type ActorKind,
  type IdentityFacetInput,
  type IdentityFacetKind,
  type IdentityFacetRow,
} from '#src/objects/identity-facets.js';
import {
  enqueueObjectSummaryRefresh,
  fireAndForgetObjectSummaryRefresh,
  getObjectSummary,
  getObjectSummaryFromSnapshot,
  objectSummarySourceSnapshot,
  type ObjectSummaryView,
} from '#src/objects/summaries.js';
import { decodeCursor, pageWindow } from '#src/pagination.js';
import { getQdrantClient } from '#src/qdrant/client.js';
import { buildPointId } from '#src/qdrant/point-id.js';
import * as embedQueue from '#src/queue/queues.js';
import { AUTHORITY_POLICY_VERSION } from '#src/reconciliation/authority.js';
import { buildOutputDedupeKey, reconciliationDedupeKey } from '#src/reconciliation/index.js';
import { normalizeRawEventsToEvidence } from '#src/reconciliation/normalization.js';
import { sourcePayloadRefFromMetadata } from '#src/reconciliation/source-snapshot.js';
import { likeMentionCondition, likePattern, textMentionsAnyValue } from '#src/sql-like.js';
import {
  buildTaskCategoryPacket,
  TASK_CATEGORY_PROMPT_VERSION,
  taskCategoryInputHash,
} from '#src/task-categories/classifier.js';
import {
  TASK_CATEGORY_TAXONOMY_VERSION,
  taskCategoryModeSchema,
  taskCategorySchema,
  taskCategorySourceSchema,
  taskCategoryStatusSchema,
} from '#src/task-categories/types.js';
import { rawEventVisibleToUser } from '#src/visibility.js';

export {
  fireAndForgetObjectSummaryRefresh,
  generateAndStoreObjectSummary,
  sourceRefCitation,
} from '#src/objects/summaries.js';
export type { ObjectSummarySourceRef } from '#src/objects/summaries.js';
export {
  normalizeIdentityFacet,
  type ActorKind,
  type IdentityFacetInput,
  type IdentityFacetKind,
  type IdentityFacetRow,
} from '#src/objects/identity-facets.js';

const embedLog = childLogger('objects:embed');
const summaryRefreshLog = childLogger('objects:summary-refresh');
const reconciliationLog = childLogger('objects:reconciliation');
const OBJECT_QUERY_LIMIT_MAX = 50_000;
const NOTIFICATION_QUERY_LIMIT_MAX = 50_000;
const OBJECT_DIRECT_WRITE_RUN_VERSION = 'object-direct-write-2026-06';
const OBJECT_DIRECT_WRITE_PLANNER_VERSION = 'object-direct-write-planner-2026-06';
const SYSTEM_DIRECT_WRITE_SOURCE_SNAPSHOT_VERSION = 'system-direct-write-source-snapshot-2026-06';
type DbTx = Parameters<Parameters<Db['transaction']>[0]>[0];
type DbOrTx = Db | DbTx;
type DirectWriteVisibility = 'private' | 'team' | 'specific_users';

interface DirectWriteSourceContext {
  sourceRefs: {
    source: string;
    rawEventId: string;
    sourcePayloadRef?: string;
  }[];
  sourcePayloadRefs: string[];
  visibility: DirectWriteVisibility;
  visibilityOwnerUserId: string | null;
  visibilityUserIds: string[] | null;
}

function directWriteSourceEnvelope(sourceContext: DirectWriteSourceContext) {
  return {
    sourceRefs: sourceContext.sourceRefs,
    sourcePayloadRefs: sourceContext.sourcePayloadRefs,
    visibility: sourceContext.visibility,
    visibilityOwnerUserId: sourceContext.visibilityOwnerUserId,
    visibilityUserIds: sourceContext.visibilityUserIds,
    visibilityFloor: sourceContext.visibility,
    visibilityFloorOwnerUserId: sourceContext.visibilityOwnerUserId,
    visibilityFloorUserIds: sourceContext.visibilityUserIds,
  };
}

function systemDirectWriteSourceMetadata(input: {
  rawEventId: string;
  kind: string;
  metadata: Record<string, unknown>;
  snapshot: Record<string, unknown>;
}): Record<string, unknown> {
  const sourceSnapshot = {
    event_kind: input.kind,
    raw_event_id: input.rawEventId,
    ...input.snapshot,
  };
  const digest = `sha256:${createHash('sha256').update(stableStringify(sourceSnapshot)).digest('hex')}`;
  return {
    ...input.metadata,
    kind: input.kind,
    source_payload_ref: `inline://timeline/system/${input.kind}/${input.rawEventId}`,
    payload_digest: digest,
    source_snapshot_kind: 'system_direct_write_event',
    source_snapshot_version: SYSTEM_DIRECT_WRITE_SOURCE_SNAPSHOT_VERSION,
    source_snapshot: sourceSnapshot,
  };
}

async function reconcileObjectAuditLinks(
  tx: DbOrTx,
  args: { teamId: string; rawEventId: string | null; text: string },
): Promise<void> {
  if (!args.rawEventId) return;
  await reconcileLinkArtifactsForRawEvent(tx, {
    teamId: args.teamId,
    rawEventId: args.rawEventId,
    text: args.text,
  });
}

/**
 * Best-effort enqueue of a workspace-object embed job. Failures are logged
 * and swallowed — the coverage audit script (apps/worker/src/scripts/
 * embed-coverage.ts) catches drift and the reembed script repairs it. We
 * deliberately do not surface enqueue failures to the caller because the
 * write has already committed; the user shouldn't see an "object created
 * but search is offline" error for a transient Redis hiccup.
 */
function fireAndForgetEmbed(fn: () => Promise<void>, context: Record<string, unknown>): void {
  void fn().catch((err: unknown) => {
    embedLog.error({ err, ...context }, 'failed to enqueue embed job');
  });
}

async function normalizeSystemRawEventEvidence(input: {
  db: DbOrTx;
  teamId: string;
  rawEventId: string | null | undefined;
}): Promise<void> {
  if (!input.rawEventId) return;
  try {
    await normalizeRawEventsToEvidence({
      db: input.db,
      teamId: input.teamId,
      rawEventIds: [input.rawEventId],
    });
  } catch (err) {
    reconciliationLog.warn(
      { err, teamId: input.teamId, rawEventId: input.rawEventId },
      'system raw event reconciliation evidence normalization failed',
    );
  }
}

export async function buildObjectDirectWriteSourceContext(input: {
  db: DbOrTx;
  teamId: string;
  sourceRawEventId: string;
}): Promise<DirectWriteSourceContext> {
  const [raw] = await input.db
    .select({
      source: rawEvents.source,
      sourceMetadata: rawEvents.sourceMetadata,
      visibility: rawEvents.visibility,
      visibilityOwnerUserId: rawEvents.visibilityOwnerUserId,
      visibilityUserIds: rawEvents.visibilityUserIds,
    })
    .from(rawEvents)
    .where(and(eq(rawEvents.teamId, input.teamId), eq(rawEvents.id, input.sourceRawEventId)))
    .limit(1);
  if (!raw) throw new Error('Source raw event not found for team');

  const [evidence] = await input.db
    .select({
      id: reconciliationEvidence.id,
      sourcePayloadRef: reconciliationEvidence.sourcePayloadRef,
      visibility: reconciliationEvidence.visibility,
      visibilityOwnerUserId: reconciliationEvidence.visibilityOwnerUserId,
      visibilityUserIds: reconciliationEvidence.visibilityUserIds,
    })
    .from(reconciliationEvidence)
    .where(
      and(
        eq(reconciliationEvidence.teamId, input.teamId),
        eq(reconciliationEvidence.rawEventId, input.sourceRawEventId),
      ),
    )
    .orderBy(desc(reconciliationEvidence.createdAt), desc(reconciliationEvidence.id))
    .limit(1);
  const sourcePayloadRef =
    sourcePayloadRefFromMetadata(raw.sourceMetadata) ?? evidence?.sourcePayloadRef ?? null;
  if (!sourcePayloadRef) {
    throw new Error('Source raw event is missing a replay payload ref');
  }
  const sourcePayloadRefs = [
    ...new Set(
      [evidence?.sourcePayloadRef, sourcePayloadRef].filter((ref): ref is string => !!ref),
    ),
  ];
  const visibility = evidence?.visibility ?? raw.visibility;
  const visibilityOwnerUserId = evidence?.visibilityOwnerUserId ?? raw.visibilityOwnerUserId;
  const visibilityUserIds = evidence?.visibilityUserIds ?? raw.visibilityUserIds;
  return {
    sourceRefs: [
      {
        source: raw.source,
        rawEventId: input.sourceRawEventId,
        ...(sourcePayloadRef ? { sourcePayloadRef } : {}),
      },
    ],
    sourcePayloadRefs,
    visibility,
    visibilityOwnerUserId,
    visibilityUserIds,
  };
}

async function emitObjectDirectWriteOutput(input: {
  db: DbTx;
  teamId: string;
  entityId: string;
  objectType: ObjectType;
  canonicalName: string;
  actor: { kind: ActorKind; userId?: string | null };
  sourceEventId: string | null;
  operation: 'create' | 'update' | 'archive_or_cancel' | 'merge';
  systemEventKind: 'object_create' | 'object_update' | 'object_merge';
  changedFields?: string[];
  changes?: { field: string; previousValue: unknown; newValue: unknown }[];
  merge?: {
    mergedEntityIds: string[];
    mergedObjects: { id: string; canonicalName: string; type: ObjectType }[];
    aliases: string[];
  };
}): Promise<void> {
  if (!input.sourceEventId) return;
  const sourceContext = await buildObjectDirectWriteSourceContext({
    db: input.db,
    teamId: input.teamId,
    sourceRawEventId: input.sourceEventId,
  });
  const metrics = {
    target_kind: 'object',
    operation: input.operation,
    object_type: input.objectType,
    actor_kind: input.actor.kind,
    ...(input.changedFields ? { changed_fields: input.changedFields } : {}),
    ...(input.merge ? { merged_entity_count: input.merge.mergedEntityIds.length } : {}),
  };
  const [run] = await input.db
    .insert(reconciliationRuns)
    .values({
      teamId: input.teamId,
      trigger: 'raw_event',
      scope: 'object_direct_write',
      status: 'completed',
      inputFingerprint: reconciliationDedupeKey('object-direct-write-run', {
        teamId: input.teamId,
        entityId: input.entityId,
        rawEventId: input.sourceEventId,
        operation: input.operation,
        policyVersion: AUTHORITY_POLICY_VERSION,
      }),
      engineVersion: OBJECT_DIRECT_WRITE_RUN_VERSION,
      completedAt: new Date(),
      metrics,
    })
    .onConflictDoUpdate({
      target: [
        reconciliationRuns.teamId,
        reconciliationRuns.inputFingerprint,
        reconciliationRuns.engineVersion,
      ],
      set: {
        status: 'completed',
        completedAt: new Date(),
        metrics,
      },
    })
    .returning({ id: reconciliationRuns.id });
  if (!run) return;

  await input.db
    .insert(reconciliationOutputs)
    .values({
      teamId: input.teamId,
      runId: run.id,
      outputKind: 'direct_write',
      targetKind: 'object',
      operation: input.operation,
      targetId: input.entityId,
      payload: {
        source: 'system',
        system_event_kind: input.systemEventKind,
        object_type: input.objectType,
        canonical_name: input.canonicalName,
        actor_kind: input.actor.kind,
        actor_user_id: input.actor.userId ?? null,
        ...(input.changedFields ? { changed_fields: input.changedFields } : {}),
        ...(input.changes ? { changes: input.changes } : {}),
        ...(input.merge
          ? {
              merged_entity_ids: input.merge.mergedEntityIds,
              merged_objects: input.merge.mergedObjects,
              aliases: input.merge.aliases,
            }
          : {}),
      },
      authorityDecision: {
        decision: 'direct_write',
        authority_decision: 'direct',
        reason: 'user_or_agent_confirmed_workspace_write',
        source: 'system',
        provider: null,
        target_kind: 'object',
        target_field:
          input.operation === 'create'
            ? '__create__'
            : input.operation === 'merge'
              ? '__merge__'
              : input.operation === 'archive_or_cancel'
                ? '__archive__'
                : '__update__',
        ...(input.changedFields ? { changed_fields: input.changedFields } : {}),
        policy_version: AUTHORITY_POLICY_VERSION,
      },
      confidence: 'high',
      requiresApproval: false,
      ...directWriteSourceEnvelope(sourceContext),
      dedupeKey: buildOutputDedupeKey({
        teamId: input.teamId,
        targetKind: 'object',
        operation: input.operation,
        targetId: input.entityId,
        sourceRefs: sourceContext.sourceRefs,
        authorityPolicyVersion: AUTHORITY_POLICY_VERSION,
        plannerVersion: OBJECT_DIRECT_WRITE_PLANNER_VERSION,
      }),
      status: 'applied',
    })
    .onConflictDoUpdate({
      target: [reconciliationOutputs.teamId, reconciliationOutputs.dedupeKey],
      set: {
        runId: run.id,
        ...directWriteSourceEnvelope(sourceContext),
        status: 'applied',
        updatedAt: new Date(),
      },
    });
}

async function emitRelationshipDirectWriteOutput(input: {
  db: DbTx;
  teamId: string;
  relationshipId: string;
  fromEntityId: string;
  toEntityId: string;
  relationshipKind: RelationshipKind;
  actor: { kind: ActorKind; userId?: string | null };
  sourceEventId: string | null;
  operation: 'link' | 'unlink';
  systemEventKind: 'relationship_create' | 'relationship_delete';
}): Promise<void> {
  if (!input.sourceEventId) return;
  const sourceContext = await buildObjectDirectWriteSourceContext({
    db: input.db,
    teamId: input.teamId,
    sourceRawEventId: input.sourceEventId,
  });
  const metrics = {
    target_kind: 'object_relationship',
    operation: input.operation,
    relationship_kind: input.relationshipKind,
    actor_kind: input.actor.kind,
  };
  const [run] = await input.db
    .insert(reconciliationRuns)
    .values({
      teamId: input.teamId,
      trigger: 'raw_event',
      scope: 'relationship_direct_write',
      status: 'completed',
      inputFingerprint: reconciliationDedupeKey('relationship-direct-write-run', {
        teamId: input.teamId,
        relationshipId: input.relationshipId,
        rawEventId: input.sourceEventId,
        operation: input.operation,
        policyVersion: AUTHORITY_POLICY_VERSION,
      }),
      engineVersion: OBJECT_DIRECT_WRITE_RUN_VERSION,
      completedAt: new Date(),
      metrics,
    })
    .onConflictDoUpdate({
      target: [
        reconciliationRuns.teamId,
        reconciliationRuns.inputFingerprint,
        reconciliationRuns.engineVersion,
      ],
      set: {
        status: 'completed',
        completedAt: new Date(),
        metrics,
      },
    })
    .returning({ id: reconciliationRuns.id });
  if (!run) return;

  await input.db
    .insert(reconciliationOutputs)
    .values({
      teamId: input.teamId,
      runId: run.id,
      outputKind: 'direct_write',
      targetKind: 'object_relationship',
      operation: input.operation,
      targetId: input.relationshipId,
      payload: {
        source: 'system',
        system_event_kind: input.systemEventKind,
        relationship_id: input.relationshipId,
        from_entity_id: input.fromEntityId,
        to_entity_id: input.toEntityId,
        relationship_kind: input.relationshipKind,
        actor_kind: input.actor.kind,
        actor_user_id: input.actor.userId ?? null,
      },
      authorityDecision: {
        decision: 'direct_write',
        authority_decision: 'direct',
        reason: 'user_or_agent_confirmed_workspace_write',
        source: 'system',
        provider: null,
        target_kind: 'object_relationship',
        target_field:
          input.operation === 'link' ? '__relationship_create__' : '__relationship_delete__',
        policy_version: AUTHORITY_POLICY_VERSION,
      },
      confidence: 'high',
      requiresApproval: false,
      ...directWriteSourceEnvelope(sourceContext),
      dedupeKey: buildOutputDedupeKey({
        teamId: input.teamId,
        targetKind: 'object_relationship',
        operation: input.operation,
        targetId: input.relationshipId,
        sourceRefs: sourceContext.sourceRefs,
        authorityPolicyVersion: AUTHORITY_POLICY_VERSION,
        plannerVersion: OBJECT_DIRECT_WRITE_PLANNER_VERSION,
      }),
      status: 'applied',
    })
    .onConflictDoUpdate({
      target: [reconciliationOutputs.teamId, reconciliationOutputs.dedupeKey],
      set: {
        runId: run.id,
        ...directWriteSourceEnvelope(sourceContext),
        status: 'applied',
        updatedAt: new Date(),
      },
    });
}

async function emitNoteDirectWriteOutput(input: {
  db: DbTx;
  teamId: string;
  entityId: string;
  noteId: string;
  actor: { kind: ActorKind; userId?: string | null };
  sourceEventId: string | null;
  operation: 'create' | 'update' | 'archive_or_cancel';
  systemEventKind: 'object_note_create' | 'object_note_update' | 'object_note_delete';
  body?: string | null;
  previousBody?: string | null;
}): Promise<void> {
  if (!input.sourceEventId) return;
  const sourceContext = await buildObjectDirectWriteSourceContext({
    db: input.db,
    teamId: input.teamId,
    sourceRawEventId: input.sourceEventId,
  });
  const metrics = {
    target_kind: 'object_note',
    operation: input.operation,
    actor_kind: input.actor.kind,
  };
  const [run] = await input.db
    .insert(reconciliationRuns)
    .values({
      teamId: input.teamId,
      trigger: 'raw_event',
      scope: 'note_direct_write',
      status: 'completed',
      inputFingerprint: reconciliationDedupeKey('note-direct-write-run', {
        teamId: input.teamId,
        noteId: input.noteId,
        rawEventId: input.sourceEventId,
        operation: input.operation,
        policyVersion: AUTHORITY_POLICY_VERSION,
      }),
      engineVersion: OBJECT_DIRECT_WRITE_RUN_VERSION,
      completedAt: new Date(),
      metrics,
    })
    .onConflictDoUpdate({
      target: [
        reconciliationRuns.teamId,
        reconciliationRuns.inputFingerprint,
        reconciliationRuns.engineVersion,
      ],
      set: {
        status: 'completed',
        completedAt: new Date(),
        metrics,
      },
    })
    .returning({ id: reconciliationRuns.id });
  if (!run) return;

  const targetField =
    input.operation === 'create'
      ? '__note_create__'
      : input.operation === 'update'
        ? '__note_update__'
        : '__note_delete__';

  await input.db
    .insert(reconciliationOutputs)
    .values({
      teamId: input.teamId,
      runId: run.id,
      outputKind: 'direct_write',
      targetKind: 'object_note',
      operation: input.operation,
      targetId: input.noteId,
      payload: {
        source: 'system',
        system_event_kind: input.systemEventKind,
        entity_id: input.entityId,
        note_id: input.noteId,
        actor_kind: input.actor.kind,
        actor_user_id: input.actor.userId ?? null,
        ...(input.body !== undefined ? { body: input.body } : {}),
        ...(input.previousBody !== undefined ? { previous_body: input.previousBody } : {}),
      },
      authorityDecision: {
        decision: 'direct_write',
        authority_decision: 'direct',
        reason: 'user_or_agent_confirmed_workspace_write',
        source: 'system',
        provider: null,
        target_kind: 'object_note',
        target_field: targetField,
        policy_version: AUTHORITY_POLICY_VERSION,
      },
      confidence: 'high',
      requiresApproval: false,
      ...directWriteSourceEnvelope(sourceContext),
      dedupeKey: buildOutputDedupeKey({
        teamId: input.teamId,
        targetKind: 'object_note',
        operation: input.operation,
        targetId: input.noteId,
        sourceRefs: sourceContext.sourceRefs,
        authorityPolicyVersion: AUTHORITY_POLICY_VERSION,
        plannerVersion: OBJECT_DIRECT_WRITE_PLANNER_VERSION,
      }),
      status: 'applied',
    })
    .onConflictDoUpdate({
      target: [reconciliationOutputs.teamId, reconciliationOutputs.dedupeKey],
      set: {
        runId: run.id,
        ...directWriteSourceEnvelope(sourceContext),
        status: 'applied',
        updatedAt: new Date(),
      },
    });
}

async function emitIdentityFacetDirectWriteOutput(input: {
  db: DbTx;
  teamId: string;
  entityId: string;
  identityFacetId: string;
  identityFacetKind: IdentityFacetKind;
  actor: { kind: ActorKind; userId?: string | null };
  sourceEventId: string | null;
  operation: 'create' | 'update';
  systemEventKind: 'identity_facet_create' | 'identity_facet_update';
  value: string;
  normalizedValue: string;
  provider: string | null;
  externalId: string | null;
  linkedUserId: string | null;
  previous?: {
    value: string;
    normalizedValue: string;
    provider: string | null;
    externalId: string | null;
    linkedUserId: string | null;
  };
}): Promise<void> {
  if (!input.sourceEventId) return;
  const sourceContext = await buildObjectDirectWriteSourceContext({
    db: input.db,
    teamId: input.teamId,
    sourceRawEventId: input.sourceEventId,
  });
  const metrics = {
    target_kind: 'identity_facet',
    operation: input.operation,
    identity_facet_kind: input.identityFacetKind,
    actor_kind: input.actor.kind,
  };
  const [run] = await input.db
    .insert(reconciliationRuns)
    .values({
      teamId: input.teamId,
      trigger: 'raw_event',
      scope: 'identity_facet_direct_write',
      status: 'completed',
      inputFingerprint: reconciliationDedupeKey('identity-facet-direct-write-run', {
        teamId: input.teamId,
        identityFacetId: input.identityFacetId,
        rawEventId: input.sourceEventId,
        operation: input.operation,
        policyVersion: AUTHORITY_POLICY_VERSION,
      }),
      engineVersion: OBJECT_DIRECT_WRITE_RUN_VERSION,
      completedAt: new Date(),
      metrics,
    })
    .onConflictDoUpdate({
      target: [
        reconciliationRuns.teamId,
        reconciliationRuns.inputFingerprint,
        reconciliationRuns.engineVersion,
      ],
      set: {
        status: 'completed',
        completedAt: new Date(),
        metrics,
      },
    })
    .returning({ id: reconciliationRuns.id });
  if (!run) return;

  const targetField =
    input.operation === 'create' ? '__identity_facet_create__' : '__identity_facet_update__';
  await input.db
    .insert(reconciliationOutputs)
    .values({
      teamId: input.teamId,
      runId: run.id,
      outputKind: 'direct_write',
      targetKind: 'identity_facet',
      operation: input.operation,
      targetId: input.identityFacetId,
      payload: {
        source: 'system',
        system_event_kind: input.systemEventKind,
        entity_id: input.entityId,
        identity_facet_id: input.identityFacetId,
        identity_facet_kind: input.identityFacetKind,
        value: input.value,
        normalized_value: input.normalizedValue,
        provider: input.provider,
        external_id: input.externalId,
        linked_user_id: input.linkedUserId,
        actor_kind: input.actor.kind,
        actor_user_id: input.actor.userId ?? null,
        ...(input.previous
          ? {
              previous: {
                value: input.previous.value,
                normalized_value: input.previous.normalizedValue,
                provider: input.previous.provider,
                external_id: input.previous.externalId,
                linked_user_id: input.previous.linkedUserId,
              },
            }
          : {}),
      },
      authorityDecision: {
        decision: 'direct_write',
        authority_decision: 'direct',
        reason: 'user_or_agent_confirmed_workspace_write',
        source: 'system',
        provider: null,
        target_kind: 'identity_facet',
        target_field: targetField,
        policy_version: AUTHORITY_POLICY_VERSION,
      },
      confidence: 'high',
      requiresApproval: false,
      ...directWriteSourceEnvelope(sourceContext),
      dedupeKey: buildOutputDedupeKey({
        teamId: input.teamId,
        targetKind: 'identity_facet',
        operation: input.operation,
        targetId: input.identityFacetId,
        sourceRefs: sourceContext.sourceRefs,
        authorityPolicyVersion: AUTHORITY_POLICY_VERSION,
        plannerVersion: OBJECT_DIRECT_WRITE_PLANNER_VERSION,
      }),
      status: 'applied',
    })
    .onConflictDoUpdate({
      target: [reconciliationOutputs.teamId, reconciliationOutputs.dedupeKey],
      set: {
        runId: run.id,
        ...directWriteSourceEnvelope(sourceContext),
        status: 'applied',
        updatedAt: new Date(),
      },
    });
}

async function objectSummaryRefreshTargetsForObject(
  db: Db,
  scope: TeamScopeCore,
  object: Pick<ObjectRow, 'id' | 'type'>,
): Promise<string[]> {
  const ids = new Set([object.id]);
  if (object.type !== 'task' && object.type !== 'follow_up') return [...ids];
  const relationships = await db
    .select({
      fromEntityId: entityRelationships.fromEntityId,
      toEntityId: entityRelationships.toEntityId,
      kind: entityRelationships.kind,
    })
    .from(entityRelationships)
    .where(
      and(
        eq(entityRelationships.teamId, scope.teamId),
        or(
          and(
            eq(entityRelationships.fromEntityId, object.id),
            eq(entityRelationships.kind, 'child'),
          ),
          and(
            eq(entityRelationships.toEntityId, object.id),
            eq(entityRelationships.kind, 'parent'),
          ),
        ),
      ),
    );
  for (const relationship of relationships) {
    ids.add(relationship.kind === 'child' ? relationship.toEntityId : relationship.fromEntityId);
  }
  return [...ids];
}

function refreshObjectAndLinkedParentSummaries(
  db: Db,
  scope: TeamScopeCore,
  object: Pick<ObjectRow, 'id' | 'type'>,
  context: Record<string, unknown>,
): void {
  void (async () => {
    const objectIds = await objectSummaryRefreshTargetsForObject(db, scope, object);
    await Promise.all(
      objectIds.map((objectId) =>
        fireAndForgetObjectSummaryRefresh(db, scope, objectId, {
          ...context,
          objectId,
          changedObjectId: object.id,
        }),
      ),
    );
  })().catch((err: unknown) => {
    summaryRefreshLog.error(
      { err, ...context, objectId: object.id },
      'failed to refresh summaries',
    );
  });
}

function uniqueIds(ids: string[]): string[] {
  return Array.from(new Set(ids));
}

function shouldNotifyObjectDueDateOnUpdate(
  changes: { field: string }[],
  current: Pick<typeof entities.$inferSelect, 'archivedAt' | 'status'>,
  updated: Pick<typeof entities.$inferSelect, 'archivedAt' | 'assigneeUserId' | 'dueAt' | 'status'>,
): boolean {
  if (!updated.dueAt) return false;
  if (
    changes.some((change) => ['canonicalName', 'dueAt', 'assigneeUserId'].includes(change.field))
  ) {
    return true;
  }
  if (changes.some((change) => change.field === 'ownerUserId') && !updated.assigneeUserId) {
    return true;
  }
  if (
    changes.some((change) => change.field === 'archivedAt') &&
    current.archivedAt !== null &&
    updated.archivedAt === null
  ) {
    return true;
  }
  return (
    current.status === 'suggested' &&
    updated.status !== 'suggested' &&
    changes.some((change) => change.field === 'status')
  );
}

async function syncBoardItemDueDatesForObject(
  db: DbOrTx,
  scope: TeamScopeCore,
  object: Pick<typeof entities.$inferSelect, 'id' | 'canonicalName' | 'type' | 'archivedAt'>,
  opts: { actor?: UpdateActor; notifyActive?: boolean } = {},
): Promise<DueDateCalendarSyncResult> {
  const rows = await db
    .select({ item: boardItems, board: boards })
    .from(boardItems)
    .innerJoin(boards, eq(boardItems.boardId, boards.id))
    .where(
      and(
        eq(boardItems.teamId, scope.teamId),
        eq(boardItems.entityId, object.id),
        isNull(boardItems.archivedAt),
      ),
    );
  const results: DueDateCalendarSyncResult[] = [];
  for (const row of rows) {
    results.push(await syncBoardItemDueDateCalendarEvent(db, row.item, object, row.board));
    if (opts.notifyActive && opts.actor) {
      await notifyBoardItemDueDate(db, row.item, object, row.board, opts.actor);
    }
  }
  return mergeDueDateCalendarSyncResults(results);
}

async function afterDueDateCalendarSync(
  teamId: string,
  result: DueDateCalendarSyncResult,
): Promise<void> {
  await Promise.all([
    enqueueDueDateCalendarEventEmbeddings(teamId, result.embedEventIds),
    deleteDueDateCalendarEventEmbeddings(teamId, result.deleteEventIds),
  ]);
}

async function deleteMergedObjectEmbeddingPoints(teamId: string, entityId: string): Promise<void> {
  try {
    const client = getQdrantClient();
    const models = uniqueIds([TIMELINE_MODELS.embedding.id, 'openai/text-embedding-3-small']);
    for (const model of models) {
      await client.deletePointsForSource({ teamId, scope: 'object', sourceId: entityId, model });
      await client.deletePointsForSource({ teamId, scope: 'entity', sourceId: entityId, model });
    }
    await client.deletePoints(
      models.flatMap((model) => [
        buildPointId('object', entityId, model),
        buildPointId('entity', entityId, model),
      ]),
    );
  } catch (err) {
    embedLog.error({ err, teamId, entityId }, 'failed to delete merged object embed points');
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const RELATIONSHIP_KINDS = relationshipKind.enumValues;
export type RelationshipKind = (typeof RELATIONSHIP_KINDS)[number];

function canonicalRelationshipEndpoints(
  fromEntityId: string,
  toEntityId: string,
  kind: RelationshipKind,
): { fromEntityId: string; toEntityId: string } {
  if (kind !== 'related') return { fromEntityId, toEntityId };
  const [from, to] = [fromEntityId, toEntityId].sort();
  return { fromEntityId: from ?? fromEntityId, toEntityId: to ?? toEntityId };
}

/**
 * Order-stable JSON serialization. Used by `updateObject` to decide whether
 * a patch actually changes a jsonb column — without sorted keys, a form
 * that posts `{a:1,b:2}` and a backend that round-trips it as `{b:2,a:1}`
 * would register as a change on every save and write phantom audit rows.
 */
function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, val: unknown) => {
    if (val && typeof val === 'object' && !Array.isArray(val) && !(val instanceof Date)) {
      const record = val as Record<string, unknown>;
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(record).sort()) {
        sorted[k] = record[k];
      }
      return sorted;
    }
    return val;
  });
}

// Derive from the drizzle enum so DB-backed rows keep the full vocabulary.
export type ObjectType = (typeof entityType.enumValues)[number];

/** The exhaustive runtime list of user-facing workspace object types. */
export const OBJECT_TYPES = entityType.enumValues.filter(
  (type): type is ObjectType => type !== 'link',
);

export interface ObjectListFilter {
  id?: string | string[];
  query?: string;
  type?: ObjectType | ObjectType[];
  status?: string | string[];
  statusNot?: string | string[];
  stage?: string | string[];
  priority?: number | number[];
  priorityNull?: boolean;
  ownerUserId?: string | null | (string | null)[];
  assigneeUserId?: string | null | (string | null)[];
  taskCategory?: TaskCategory | TaskCategory[];
  taskCategoryNull?: boolean;
  /** Operator-only candidate selector; excludes manual, ready, and already-pending tasks. */
  taskCategoryBackfillEligible?: boolean;
  primaryProjectId?: string | string[];
  dueBefore?: Date;
  dueAfter?: Date;
  dueNull?: boolean;
  createdBefore?: Date;
  createdAfter?: Date;
  updatedBefore?: Date;
  updatedAfter?: Date;
  archived?: boolean;
  order?: 'updated' | 'due';
  limit?: number;
  offset?: number;
  cursor?: string | null;
}

export type ObjectCountFilter = Omit<ObjectListFilter, 'cursor' | 'limit' | 'offset'>;

export interface ObjectSearchFilter extends Omit<ObjectListFilter, 'cursor' | 'offset'> {
  query: string;
}

export interface ObjectRow {
  id: string;
  type: ObjectType;
  canonicalName: string;
  status: string;
  stage: string | null;
  priority: number | null;
  ownerUserId: string | null;
  assigneeUserId: string | null;
  dueAt: Date | null;
  taskCategory: TaskCategory | null;
  taskCategoryMode: TaskCategoryMode | null;
  taskCategorySource: TaskCategorySource | null;
  taskCategoryStatus: TaskCategoryStatus | null;
  taskCategoryUpdatedAt: Date | null;
  agentSuggested: boolean;
  archivedAt: Date | null;
  aliases: string[];
  metadata: Record<string, unknown>;
  updatedAt: Date;
  createdAt: Date;
}

export interface TaskPrimaryProjectRow {
  taskId: string;
  projectId: string;
  projectName: string;
  archivedAt: Date | null;
}

function metadataString(metadata: Record<string, unknown>, key: string): string | null {
  const value = metadata[key];
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value).replace(/\s+/g, ' ').trim();
  return text || null;
}

function recordFromUnknown(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function displayObjectTitle(row: Pick<ObjectRow, 'canonicalName' | 'metadata'>): string {
  const explicit = metadataString(row.metadata, 'display_title');
  const explicitSource = metadataString(row.metadata, 'display_title_canonical_name');
  if (explicit && explicitSource && row.canonicalName === explicitSource) return explicit;

  return row.canonicalName;
}

/** Mutable fields a caller may patch via `updateObject`. */
export interface ObjectPatch {
  canonicalName?: string;
  status?: string;
  stage?: string | null;
  priority?: number | null;
  ownerUserId?: string | null;
  assigneeUserId?: string | null;
  dueAt?: Date | null;
  aliases?: string[];
  metadata?: Record<string, unknown>;
  archivedAt?: Date | null;
  /** Allowed only on create or on agent-suggested rows that humans accept. */
  type?: ObjectType;
}

type EntityRow = typeof entities.$inferSelect;

function stringArrayFromUnknown(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function toObjectRow(row: EntityRow): ObjectRow {
  const aliases = stringArrayFromUnknown(row.aliases);
  const metadata =
    row.metadata && typeof row.metadata === 'object'
      ? (row.metadata as Record<string, unknown>)
      : {};
  return {
    id: row.id,
    type: row.type,
    canonicalName: row.canonicalName,
    status: row.status,
    stage: row.stage,
    priority: row.priority,
    ownerUserId: row.ownerUserId,
    assigneeUserId: row.assigneeUserId,
    dueAt: row.dueAt,
    taskCategory: row.taskCategory as TaskCategory | null,
    taskCategoryMode: row.taskCategoryMode as TaskCategoryMode | null,
    taskCategorySource: row.taskCategorySource as TaskCategorySource | null,
    taskCategoryStatus: row.taskCategoryStatus as TaskCategoryStatus | null,
    taskCategoryUpdatedAt: row.taskCategoryUpdatedAt,
    // `entities.agent_suggested` is legacy single-row provenance. Approval
    // state now lives in agent_suggestions projected from reconciliation outputs.
    agentSuggested: false,
    archivedAt: row.archivedAt,
    aliases,
    metadata,
    updatedAt: row.updatedAt,
    createdAt: row.createdAt,
  };
}

function toArray<T>(v: T | T[] | undefined): T[] | undefined {
  if (v === undefined) return undefined;
  return Array.isArray(v) ? v : [v];
}

function nullableUuidCondition(
  column: unknown,
  value: string | null | (string | null)[] | undefined,
): SQL | undefined {
  if (value === undefined) return undefined;
  if (value === null) return isNull(column as never);
  const values = toArray(value) ?? [];
  const uuidValues = values.filter(
    (candidate): candidate is string => typeof candidate === 'string' && UUID_RE.test(candidate),
  );
  const includesNull = values.some((candidate) => candidate === null);
  if (uuidValues.length === 0) return includesNull ? isNull(column as never) : sql`false`;
  const uuidCondition = inArray(column as never, uuidValues);
  return includesNull ? or(isNull(column as never), uuidCondition) : uuidCondition;
}

function taskCategoryCondition(filter: ObjectCountFilter): SQL | undefined {
  const categories = toArray(filter.taskCategory);
  if ((!categories || categories.length === 0) && !filter.taskCategoryNull) return undefined;
  const categoryCondition = categories?.length
    ? inArray(entities.taskCategory, categories)
    : undefined;
  if (categoryCondition && filter.taskCategoryNull) {
    return or(categoryCondition, isNull(entities.taskCategory));
  }
  return categoryCondition ?? isNull(entities.taskCategory);
}

function primaryProjectCondition(scope: TeamScopeCore, filter: ObjectCountFilter): SQL | undefined {
  const requestedIds = toArray(filter.primaryProjectId);
  if (!requestedIds || requestedIds.length === 0) return undefined;
  const projectIds = requestedIds.filter((id) => UUID_RE.test(id));
  if (projectIds.length === 0) return sql`false`;
  const idList = sql.join(
    projectIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  return sql`EXISTS (
    SELECT 1
    FROM entity_relationships AS task_project_rel
    INNER JOIN entities AS primary_project
      ON primary_project.id = task_project_rel.to_entity_id
      AND primary_project.team_id = task_project_rel.team_id
    WHERE task_project_rel.team_id = ${scope.teamId}
      AND task_project_rel.from_entity_id = ${entities.id}
      AND task_project_rel.kind = 'child'
      AND primary_project.type = 'project'
      AND primary_project.merged_into_id IS NULL
      AND primary_project.id IN (${idList})
  )`;
}

function objectSearchTokens(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/['"]/g, '')
    .split(/[^\p{L}\p{N}]+/u)
    .map((token) => token.trim())
    .filter(Boolean)
    .slice(0, 8);
}

function objectTokenSearchCondition(token: string): SQL {
  const exact = token.toLowerCase();
  const prefix = `${exact.replace(/[\\%_]/g, (match) => `\\${match}`)}%`;
  const contains = likePattern(exact);
  const tsPrefix = `${exact}:*`;
  return sql`(
    lower(${entities.canonicalName}) = ${exact}
    OR lower(${entities.canonicalName}) LIKE ${prefix} ESCAPE '\\'
    OR to_tsvector('simple', ${entities.canonicalName}) @@ to_tsquery('simple', ${tsPrefix})
    OR lower(${entities.type}::text) = ${exact}
    OR lower(${entities.status}) = ${exact}
    OR lower(coalesce(${entities.stage}, '')) = ${exact}
    OR lower(replace(coalesce(${entities.taskCategory}, ''), '_', ' ')) LIKE ${contains} ESCAPE '\\'
    OR EXISTS (
      SELECT 1
      FROM jsonb_array_elements_text(${entities.aliases}) AS alias(value)
      WHERE lower(alias.value) = ${exact}
        OR lower(alias.value) LIKE ${prefix} ESCAPE '\\'
        OR to_tsvector('simple', alias.value) @@ to_tsquery('simple', ${tsPrefix})
    )
    OR lower(${entities.metadata}::text) LIKE ${contains} ESCAPE '\\'
  )`;
}

function objectSearchCondition(query: string, tokens: string[]): SQL {
  const exact = query.toLowerCase();
  const exactAlias = sql`EXISTS (
    SELECT 1
    FROM jsonb_array_elements_text(${entities.aliases}) AS alias(value)
    WHERE lower(alias.value) = ${exact}
  )`;
  if (tokens.length === 1) return objectTokenSearchCondition(tokens[0] ?? query);
  return sql`(
    (${and(...tokens.map(objectTokenSearchCondition))})
    OR ${exactAlias}
  )`;
}

function objectListOrder(filter: Pick<ObjectListFilter, 'order'>): SQL[] {
  if (filter.order === 'due') {
    return [
      sql`(${entities.dueAt} IS NULL) ASC`,
      asc(entities.dueAt),
      desc(entities.updatedAt),
      desc(entities.id),
    ];
  }
  return [desc(entities.updatedAt), desc(entities.id)];
}

function objectListConditions(scope: TeamScopeCore, filter: ObjectCountFilter = {}): SQL[] {
  const conds = [eq(entities.teamId, scope.teamId), isNull(entities.mergedIntoId)];

  const ids = toArray(filter.id);
  if (ids && ids.length > 0) {
    const validIds = ids.filter((id) => UUID_RE.test(id));
    conds.push(validIds.length > 0 ? inArray(entities.id, validIds) : sql`false`);
  }

  const types = toArray(filter.type);
  if (types && types.length > 0) conds.push(inArray(entities.type, types));

  const statuses = toArray(filter.status);
  if (statuses && statuses.length > 0) conds.push(inArray(entities.status, statuses));

  const excludedStatuses = toArray(filter.statusNot);
  if (excludedStatuses && excludedStatuses.length > 0) {
    conds.push(notInArray(entities.status, excludedStatuses));
  }

  const stages = toArray(filter.stage);
  if (stages && stages.length > 0) {
    // `stage` is nullable — only filter when caller asked for non-null stages.
    conds.push(inArray(entities.stage, stages));
  }

  const priorities = toArray(filter.priority);
  if (filter.priorityNull) conds.push(isNull(entities.priority));
  else if (priorities && priorities.length > 0) conds.push(inArray(entities.priority, priorities));

  const ownerCondition = nullableUuidCondition(entities.ownerUserId, filter.ownerUserId);
  if (ownerCondition) conds.push(ownerCondition);

  const assigneeCondition = nullableUuidCondition(entities.assigneeUserId, filter.assigneeUserId);
  if (assigneeCondition) conds.push(assigneeCondition);

  const categoryCondition = taskCategoryCondition(filter);
  if (categoryCondition) {
    conds.push(eq(entities.type, 'task'));
    conds.push(categoryCondition);
  }
  if (filter.taskCategoryBackfillEligible) {
    conds.push(eq(entities.type, 'task'));
    conds.push(
      sql`(${entities.taskCategoryMode} is null or ${entities.taskCategoryMode} <> 'manual')`,
    );
    conds.push(
      sql`(${entities.taskCategoryStatus} is null or ${entities.taskCategoryStatus} = 'failed')`,
    );
  }

  const projectCondition = primaryProjectCondition(scope, filter);
  if (projectCondition) conds.push(projectCondition);

  if (filter.dueNull) conds.push(isNull(entities.dueAt));
  if (filter.dueBefore) conds.push(lt(entities.dueAt, filter.dueBefore));
  if (filter.dueAfter) conds.push(gte(entities.dueAt, filter.dueAfter));
  if (filter.createdBefore) conds.push(lt(entities.createdAt, filter.createdBefore));
  if (filter.createdAfter) conds.push(gte(entities.createdAt, filter.createdAfter));
  if (filter.updatedBefore) conds.push(lt(entities.updatedAt, filter.updatedBefore));
  if (filter.updatedAfter) conds.push(gte(entities.updatedAt, filter.updatedAfter));

  if (filter.archived === true) conds.push(isNotNull(entities.archivedAt));
  else if (filter.archived !== undefined) conds.push(isNull(entities.archivedAt));

  const query = filter.query?.trim();
  if (query) {
    const tokens = objectSearchTokens(query);
    if (tokens.length > 0) conds.push(objectSearchCondition(tokens.join(' '), tokens));
  }

  return conds;
}

export async function countObjects(
  db: Db,
  scope: TeamScopeCore,
  filter: ObjectCountFilter = {},
): Promise<number> {
  await scope.requireMembership();
  const rows = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(entities)
    .where(and(...objectListConditions(scope, filter)));
  return rows[0]?.total ?? 0;
}

export async function listObjects(
  db: Db,
  scope: TeamScopeCore,
  filter: ObjectListFilter = {},
): Promise<ObjectRow[]> {
  await scope.requireMembership();
  const conds = objectListConditions(scope, filter);

  const cursorSql = cursorCondition(filter.cursor, entities.updatedAt, entities.id);
  if (cursorSql) conds.push(cursorSql);

  const limit = Math.min(Math.max(filter.limit ?? 100, 1), OBJECT_QUERY_LIMIT_MAX);
  const offset = Math.max(filter.offset ?? 0, 0);

  const rows = await db
    .select()
    .from(entities)
    .where(and(...conds))
    .orderBy(...objectListOrder(filter))
    .limit(limit)
    .offset(offset);
  return rows.map(toObjectRow);
}

export async function searchObjects(
  db: Db,
  scope: TeamScopeCore,
  filter: ObjectSearchFilter,
): Promise<ObjectRow[]> {
  await scope.requireMembership();
  const conds = objectListConditions(scope, filter);

  const query = filter.query.trim();
  const tokens = objectSearchTokens(query);
  if (tokens.length === 0) return [];
  const searchText = tokens.join(' ');

  const limit = Math.min(Math.max(filter.limit ?? 100, 1), OBJECT_QUERY_LIMIT_MAX);
  const exact = searchText.toLowerCase();
  const prefix = `${exact.replace(/[\\%_]/g, (match) => `\\${match}`)}%`;
  const rows = await db
    .select()
    .from(entities)
    .where(and(...conds))
    .orderBy(
      sql`CASE
        WHEN lower(${entities.canonicalName}) = ${exact} THEN 0
        WHEN lower(${entities.canonicalName}) LIKE ${prefix} ESCAPE '\\' THEN 1
        ELSE 2
      END`,
      desc(entities.updatedAt),
    )
    .limit(limit);
  return rows.map(toObjectRow);
}

export interface ObjectDetail extends ObjectRow {
  notes: {
    id: string;
    body: string;
    authorUserId: string | null;
    createdAt: Date;
    updatedAt: Date;
  }[];
  relationships: {
    id: string;
    direction: 'out' | 'in';
    kind: string;
    otherId: string;
    otherName: string;
    otherType: ObjectType;
  }[];
  recentChanges: {
    id: string;
    field: string;
    actorKind: ActorKind;
    actorUserId: string | null;
    previousValue: unknown;
    newValue: unknown;
    status: 'applied' | 'suggested' | 'rejected';
    note: string | null;
    changedAt: Date;
  }[];
  identityFacets: IdentityFacetRow[];
  openTasks: ObjectRow[];
  connectedWork: {
    openTasks: ObjectRow[];
    recentTasks: ObjectRow[];
    calendarEvents: {
      id: string;
      title: string;
      startAt: Date;
      endAt: Date;
      showAs: string;
    }[];
    timelineEvents: {
      id: string;
      source: string;
      contentText: string | null;
      occurredAt: Date;
    }[];
    objects: {
      id: string;
      canonicalName: string;
      type: ObjectType;
      factCount: number;
    }[];
    boards: {
      boardId: string;
      boardName: string;
      itemId: string;
      laneName: string | null;
      dueAt: Date | null;
      priority: number | null;
      nextStep: string | null;
    }[];
    pendingApprovals: {
      suggestionId: string;
      itemId: string;
      title: string;
      operation: string;
      targetKind: string;
      createdAt: Date;
    }[];
    documents: {
      id: string;
      name: string;
      fileKind: string;
      updatedAt: Date;
    }[];
    links: {
      id: string;
      canonicalName: string;
      canonicalUrl: string | null;
      displayUrl: string | null;
      domain: string | null;
      provider: string | null;
      updatedAt: Date;
    }[];
    capturedFiles: {
      id: string;
      name: string;
      contentType: string | null;
      sourceRawEventId: string | null;
      updatedAt: Date;
    }[];
  };
  provenance: {
    whyThisExists: ObjectProvenanceEntry[];
    whatChangedIt: ObjectProvenanceEntry[];
    relatedEvidence: ObjectProvenanceEntry[];
  };
  summary: ObjectSummaryView | null;
  /** Count of object_changes and notes since the caller's last visit. */
  newSinceLastVisit: number;
  lastVisitedAt: Date | null;
}

export interface ObjectProvenanceEvidence {
  rawEventId: string;
  quote: string | null;
  source: string;
  contentText: string | null;
  occurredAt: Date;
}

export interface ObjectProvenanceEntry {
  id: string;
  title: string;
  reason: string | null;
  operation: string;
  targetKind: string;
  createdAt: Date;
  evidence: ObjectProvenanceEvidence[];
}

export interface ObjectNotePreview {
  id: string;
  body: string;
  authorUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
  object: ObjectRow;
}

export interface ObjectSummarySearchRow {
  entityId: string;
  plainText: string;
  updatedAt: Date;
}

const MERGE_COMPATIBLE_TYPES: readonly ObjectType[] = [
  'person',
  'company',
  'project',
  'topic',
  'deal',
  'vendor',
  'incident',
  'document',
  'decision',
  'hiring_loop',
  'other',
];

function canMergeTypes(rows: Pick<ObjectRow, 'type'>[]): boolean {
  if (rows.some((row) => row.type === 'task' || row.type === 'follow_up')) return false;
  if (rows.some((row) => !MERGE_COMPATIBLE_TYPES.includes(row.type))) return false;
  const types = new Set(rows.map((row) => row.type));
  if (types.size <= 1) return true;
  return types.size === 2 && types.has('company') && types.has('vendor');
}

function mergeAliases(survivor: ObjectRow, losers: ObjectRow[]): string[] {
  const seen = new Set<string>();
  const aliases: string[] = [];
  const push = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    const key = trimmed.toLowerCase();
    if (key === survivor.canonicalName.toLowerCase() || seen.has(key)) return;
    seen.add(key);
    aliases.push(trimmed);
  };
  for (const alias of survivor.aliases) push(alias);
  for (const loser of losers) {
    push(loser.canonicalName);
    for (const alias of loser.aliases) push(alias);
  }
  return aliases;
}

export interface ObjectMergePreview {
  objects: ObjectRow[];
  survivorId: string;
  aliasesToAdd: string[];
  factSamplesByObjectId: Record<
    string,
    {
      id: string;
      statement: string;
      confidence: number;
      rawEventId: string;
      extractedAt: Date;
    }[]
  >;
  counts: {
    facts: number;
    notes: number;
    relationships: number;
    openTasks: number;
  };
  countsBySurvivorId: Record<string, ObjectMergePreview['counts']>;
}

export type ObjectSection = 'events' | 'facts' | 'changes' | 'tasks' | 'relationships';

export interface ObjectSectionPage {
  items: unknown[];
  nextCursor: string | null;
}

function rawEventVisibility(scope: TeamScopeCore) {
  return rawEventVisibleToUser(scope.userId);
}

function objectNamesForMatching(object: Pick<ObjectRow, 'canonicalName' | 'aliases'>): string[] {
  return Array.from(new Set([object.canonicalName, ...object.aliases].map((name) => name.trim())))
    .filter((name) => name.length >= 2)
    .slice(0, 8);
}

const OBJECT_SEARCH_STOP_WORDS = new Set([
  'about',
  'after',
  'before',
  'board',
  'done',
  'follow',
  'from',
  'meeting',
  'object',
  'project',
  'status',
  'task',
  'that',
  'this',
  'todo',
  'with',
  'work',
]);

function objectEvidenceTokens(object: Pick<ObjectRow, 'canonicalName' | 'aliases'>): string[] {
  const tokens = new Set<string>();
  for (const value of [object.canonicalName, ...object.aliases]) {
    for (const token of value.toLowerCase().split(/[^a-z0-9]+/)) {
      if (token.length < 4) continue;
      if (/^\d+$/.test(token)) continue;
      if (OBJECT_SEARCH_STOP_WORDS.has(token)) continue;
      tokens.add(token);
    }
  }
  return [...tokens].slice(0, 10);
}

function objectContentMatchCondition(
  column: unknown,
  names: readonly string[],
  tokens: readonly string[],
): SQL | undefined {
  const exactMatch = likeMentionCondition(column, names);
  const tokenGroupMatches: SQL[] = [];
  for (let left = 0; left < tokens.length; left += 1) {
    const leftToken = tokens[left];
    if (!leftToken) continue;
    for (let middle = left + 1; middle < tokens.length; middle += 1) {
      const middleToken = tokens[middle];
      if (!middleToken) continue;
      for (let right = middle + 1; right < tokens.length; right += 1) {
        const rightToken = tokens[right];
        if (!rightToken) continue;
        const groupMatch = and(
          sql`lower(${column as never}) LIKE ${likePattern(leftToken)} ESCAPE '\\'`,
          sql`lower(${column as never}) LIKE ${likePattern(middleToken)} ESCAPE '\\'`,
          sql`lower(${column as never}) LIKE ${likePattern(rightToken)} ESCAPE '\\'`,
        );
        if (groupMatch) tokenGroupMatches.push(groupMatch);
      }
    }
  }
  if (exactMatch && tokenGroupMatches.length > 0) return or(exactMatch, ...tokenGroupMatches);
  if (exactMatch) return exactMatch;
  return tokenGroupMatches.length > 0 ? or(...tokenGroupMatches) : undefined;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function textMentionsToken(text: string, token: string): boolean {
  return new RegExp(`(^|[^a-z0-9])${escapeRegex(token)}([^a-z0-9]|$)`, 'i').test(text);
}

function textMatchesObjectSearch(
  text: string,
  names: readonly string[],
  tokens: readonly string[],
): boolean {
  if (textMentionsAnyValue(text, names)) return true;
  let matches = 0;
  for (const token of tokens) {
    if (!textMentionsToken(text, token)) continue;
    matches += 1;
    if (matches >= 3) return true;
  }
  return false;
}

function jsonishText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

function calendarVisibleToScope(scope: TeamScopeCore): SQL {
  return sql`(
    ${calendarEvents.visibility} = 'team'
    OR ${calendarEvents.createdByUserId} = ${scope.userId}
    OR (
      ${calendarEvents.visibility} = 'specific_users'
      AND ${scope.userId} = ANY(${calendarEvents.visibilityUserIds})
    )
  )`;
}

function documentVisibleToScope(scope: TeamScopeCore): SQL {
  return sql`(
    ${documents.visibility} = 'team'
    OR (${documents.visibility} = 'private' AND ${documents.ownerUserId} = ${scope.userId})
    OR (
      ${documents.visibility} = 'specific_users'
      AND ${scope.userId} = ANY(${documents.visibilityUserIds})
    )
  )`;
}

function suggestionVisibleToScope(scope: TeamScopeCore): SQL {
  return sql`(
    ${agentSuggestions.visibility} = 'team'
    OR (
      ${agentSuggestions.visibility} = 'private'
      AND ${agentSuggestions.visibilityOwnerUserId} = ${scope.userId}
    )
    OR (
      ${agentSuggestions.visibility} = 'specific_users'
      AND ${scope.userId} = ANY(${agentSuggestions.visibilityUserIds})
    )
  )`;
}

function artifactAssociationVisibleToScope(scope: TeamScopeCore): SQL {
  return sql`(
    (
      ${artifactEvidenceAssociations.visibility} = 'team'
      OR (
        ${artifactEvidenceAssociations.visibility} = 'private'
        AND ${artifactEvidenceAssociations.visibilityOwnerUserId} = ${scope.userId}
      )
      OR (
        ${artifactEvidenceAssociations.visibility} = 'specific_users'
        AND ${scope.userId} = ANY(${artifactEvidenceAssociations.visibilityUserIds})
      )
    )
    AND (
      ${artifactEvidenceAssociations.visibilityFloor} = 'team'
      OR (
        ${artifactEvidenceAssociations.visibilityFloor} = 'private'
        AND ${artifactEvidenceAssociations.visibilityFloorOwnerUserId} = ${scope.userId}
      )
      OR (
        ${artifactEvidenceAssociations.visibilityFloor} = 'specific_users'
        AND ${scope.userId} = ANY(${artifactEvidenceAssociations.visibilityFloorUserIds})
      )
    )
  )`;
}

async function artifactAssociatedRawEventIds(
  db: Db,
  scope: TeamScopeCore,
  entityId: string,
): Promise<string[]> {
  const rows = await db
    .select({
      rawEventId: sql<string>`COALESCE(${artifactEvidenceAssociations.rawEventId}, ${reconciliationEvidence.rawEventId})`,
    })
    .from(artifactEvidenceAssociations)
    .innerJoin(
      artifactClusters,
      and(
        eq(artifactClusters.id, artifactEvidenceAssociations.clusterId),
        eq(artifactClusters.teamId, scope.teamId),
      ),
    )
    .innerJoin(
      reconciliationEvidence,
      and(
        eq(reconciliationEvidence.id, artifactEvidenceAssociations.evidenceId),
        eq(reconciliationEvidence.teamId, scope.teamId),
      ),
    )
    .where(
      and(
        eq(artifactEvidenceAssociations.teamId, scope.teamId),
        eq(artifactClusters.canonicalEntityId, entityId),
        isNull(artifactClusters.archivedAt),
        artifactAssociationVisibleToScope(scope),
      ),
    )
    .orderBy(desc(artifactEvidenceAssociations.createdAt), desc(artifactEvidenceAssociations.id))
    .limit(100);
  return Array.from(new Set(rows.map((row) => row.rawEventId).filter(Boolean)));
}

function artifactAssociatedRawEventCondition(db: Db, scope: TeamScopeCore, entityId: string): SQL {
  return exists(
    db
      .select({ id: artifactEvidenceAssociations.id })
      .from(artifactEvidenceAssociations)
      .innerJoin(
        artifactClusters,
        and(
          eq(artifactClusters.id, artifactEvidenceAssociations.clusterId),
          eq(artifactClusters.teamId, scope.teamId),
        ),
      )
      .innerJoin(
        reconciliationEvidence,
        and(
          eq(reconciliationEvidence.id, artifactEvidenceAssociations.evidenceId),
          eq(reconciliationEvidence.teamId, scope.teamId),
        ),
      )
      .where(
        and(
          eq(artifactEvidenceAssociations.teamId, scope.teamId),
          eq(artifactClusters.canonicalEntityId, entityId),
          isNull(artifactClusters.archivedAt),
          artifactAssociationVisibleToScope(scope),
          sql`COALESCE(${artifactEvidenceAssociations.rawEventId}, ${reconciliationEvidence.rawEventId}) = ${rawEvents.id}`,
        ),
      ),
  );
}

function reconciliationOutputVisibleToScope(scope: TeamScopeCore): SQL {
  return sql`(
    (
      ${reconciliationOutputs.visibility} = 'team'
      OR (
        ${reconciliationOutputs.visibility} = 'private'
        AND ${reconciliationOutputs.visibilityOwnerUserId} = ${scope.userId}
      )
      OR (
        ${reconciliationOutputs.visibility} = 'specific_users'
        AND ${scope.userId} = ANY(${reconciliationOutputs.visibilityUserIds})
      )
    )
    AND (
      ${reconciliationOutputs.visibilityFloor} = 'team'
      OR (
        ${reconciliationOutputs.visibilityFloor} = 'private'
        AND ${reconciliationOutputs.visibilityFloorOwnerUserId} = ${scope.userId}
      )
      OR (
        ${reconciliationOutputs.visibilityFloor} = 'specific_users'
        AND ${scope.userId} = ANY(${reconciliationOutputs.visibilityFloorUserIds})
      )
    )
  )`;
}

function emptyObjectProvenance(): ObjectDetail['provenance'] {
  return { whyThisExists: [], whatChangedIt: [], relatedEvidence: [] };
}

function provenanceEntryKey(
  row: Pick<ObjectProvenanceEntry, 'id' | 'operation' | 'targetKind'>,
): string {
  return `${row.id}:${row.operation}:${row.targetKind}`;
}

async function getObjectProvenance(
  db: Db,
  scope: TeamScopeCore,
  object: Pick<ObjectRow, 'id' | 'metadata'>,
  connectedWork: ObjectDetail['connectedWork'],
): Promise<ObjectDetail['provenance']> {
  const agentSuggestionItemId = metadataString(object.metadata, 'agent_suggestion_item_id');
  const payloadMention = likePattern(object.id);
  const objectMatchConditions: SQL[] = [
    eq(agentSuggestionItems.targetId, object.id),
    eq(agentSuggestionItems.resultId, object.id),
    sql`${agentSuggestionItems.proposedPayload}::text LIKE ${payloadMention}`,
  ];
  if (agentSuggestionItemId) {
    objectMatchConditions.push(eq(agentSuggestionItems.id, agentSuggestionItemId));
  }
  const rows = await db
    .select({
      suggestionId: agentSuggestions.id,
      suggestionTitle: agentSuggestions.title,
      suggestionReason: agentSuggestions.reason,
      suggestionCreatedAt: agentSuggestions.createdAt,
      itemId: agentSuggestionItems.id,
      operation: agentSuggestionItems.operation,
      targetKind: agentSuggestionItems.targetKind,
      targetId: agentSuggestionItems.targetId,
      resultId: agentSuggestionItems.resultId,
      itemTitle: agentSuggestionItems.title,
      itemMetadata: agentSuggestionItems.metadata,
      proposedPayload: agentSuggestionItems.proposedPayload,
      bundleEvidenceCount: sql<number>`(
        SELECT COUNT(*)::int
        FROM agent_suggestion_evidence AS all_evidence
        WHERE all_evidence.suggestion_id = ${agentSuggestionItems.suggestionId}
          AND all_evidence.team_id = ${scope.teamId}
      )`,
      rawEventId: agentSuggestionEvidence.rawEventId,
      quote: agentSuggestionEvidence.quote,
      source: rawEvents.source,
      contentText: rawEvents.contentText,
      occurredAt: rawEvents.occurredAt,
    })
    .from(agentSuggestionItems)
    .innerJoin(agentSuggestions, eq(agentSuggestions.id, agentSuggestionItems.suggestionId))
    .innerJoin(
      agentSuggestionEvidence,
      eq(agentSuggestionEvidence.suggestionId, agentSuggestions.id),
    )
    .innerJoin(rawEvents, eq(rawEvents.id, agentSuggestionEvidence.rawEventId))
    .where(
      and(
        eq(agentSuggestions.teamId, scope.teamId),
        eq(agentSuggestionItems.teamId, scope.teamId),
        eq(agentSuggestionEvidence.teamId, scope.teamId),
        eq(rawEvents.teamId, scope.teamId),
        eq(agentSuggestionItems.status, 'accepted'),
        suggestionVisibleToScope(scope),
        rawEventVisibility(scope),
        sql`COALESCE(${rawEvents.sourceMetadata} ->> 'deleted', 'false') <> 'true'`,
        or(...objectMatchConditions),
      ),
    )
    .orderBy(desc(agentSuggestions.createdAt), desc(rawEvents.occurredAt), desc(rawEvents.id))
    .limit(80);

  const byItem = new Map<string, ObjectProvenanceEntry>();
  const rowsByItemId = new Map<string, typeof rows>();
  for (const row of rows) {
    rowsByItemId.set(row.itemId, [...(rowsByItemId.get(row.itemId) ?? []), row]);
  }
  const outputRawEventIdsByItemId = await sourceRefRawEventIdsBySuggestionItem(db, scope, rows);
  for (const itemRows of rowsByItemId.values()) {
    const firstRow = itemRows[0];
    const outputRawEventIds = firstRow ? outputRawEventIdsByItemId.get(firstRow.itemId) : undefined;
    const relevantRows = relevantSuggestionEvidenceRows(itemRows, outputRawEventIds);
    for (const row of relevantRows) {
      const id = row.itemId;
      const existing =
        byItem.get(id) ??
        ({
          id,
          title: row.itemTitle || row.suggestionTitle,
          reason: row.suggestionReason,
          operation: row.operation,
          targetKind: row.targetKind,
          createdAt: row.suggestionCreatedAt,
          evidence: [],
        } satisfies ObjectProvenanceEntry);
      if (!existing.evidence.some((ev) => ev.rawEventId === row.rawEventId)) {
        existing.evidence.push({
          rawEventId: row.rawEventId,
          quote: row.quote,
          source: row.source,
          contentText: row.contentText,
          occurredAt: row.occurredAt,
        });
      }
      byItem.set(id, existing);
    }
  }

  const provenance = emptyObjectProvenance();
  const usedRelated = new Set<string>();
  for (const entry of byItem.values()) {
    if (
      entry.operation === 'create' &&
      (entry.targetKind === 'object' || entry.targetKind === 'task')
    ) {
      provenance.whyThisExists.push(entry);
      continue;
    }
    provenance.whatChangedIt.push(entry);
    for (const evidence of entry.evidence) usedRelated.add(evidence.rawEventId);
  }
  for (const entry of provenance.whyThisExists) {
    for (const evidence of entry.evidence) usedRelated.add(evidence.rawEventId);
  }

  for (const event of connectedWork.timelineEvents) {
    if (usedRelated.has(event.id)) continue;
    provenance.relatedEvidence.push({
      id: `observed:${event.id}`,
      title: objectProvenancePreview(event.contentText),
      reason: 'Observed through connected work and concrete object evidence.',
      operation: 'observed',
      targetKind: 'raw_event',
      createdAt: event.occurredAt,
      evidence: [
        {
          rawEventId: event.id,
          quote: null,
          source: event.source,
          contentText: null,
          occurredAt: event.occurredAt,
        },
      ],
    });
  }

  const sortEntries = (entries: ObjectProvenanceEntry[]) =>
    entries
      .filter(
        (entry, index, list) =>
          list.findIndex((other) => provenanceEntryKey(other) === provenanceEntryKey(entry)) ===
          index,
      )
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
  return {
    whyThisExists: sortEntries(provenance.whyThisExists),
    whatChangedIt: sortEntries(provenance.whatChangedIt),
    relatedEvidence: sortEntries(provenance.relatedEvidence).slice(0, 8),
  };
}

function objectProvenancePreview(contentText: string | null): string {
  const cleaned = (contentText ?? 'Related source event').replace(/\s+/g, ' ').trim();
  if (cleaned.length === 0) return 'Related source event';
  if (cleaned.length <= 160) return cleaned;
  return `${cleaned.slice(0, 157)}...`;
}

async function sourceRefRawEventIdsBySuggestionItem(
  db: Db,
  scope: TeamScopeCore,
  rows: { itemId: string; itemMetadata: unknown }[],
): Promise<Map<string, Set<string>>> {
  const outputIdsByItemId = new Map<string, string[]>();
  for (const row of rows) {
    const outputIds = reconciliationOutputIdsFromMetadata(row.itemMetadata);
    if (outputIds.length === 0) continue;
    outputIdsByItemId.set(row.itemId, outputIds);
  }
  const outputIds = [...new Set([...outputIdsByItemId.values()].flat())];
  if (outputIds.length === 0) return new Map();

  const outputRows = await db
    .select({ id: reconciliationOutputs.id, sourceRefs: reconciliationOutputs.sourceRefs })
    .from(reconciliationOutputs)
    .where(
      and(
        eq(reconciliationOutputs.teamId, scope.teamId),
        inArray(reconciliationOutputs.id, outputIds),
        reconciliationOutputVisibleToScope(scope),
      ),
    );
  const rawIdsByOutputId = new Map(
    outputRows.map((row) => [row.id, sourceRefRawEventIds(row.sourceRefs)] as const),
  );
  const result = new Map<string, Set<string>>();
  for (const [itemId, ids] of outputIdsByItemId) {
    const rawEventIds = ids.flatMap((id) => rawIdsByOutputId.get(id) ?? []);
    result.set(itemId, new Set(rawEventIds));
  }
  return result;
}

function relevantSuggestionEvidenceRows<
  T extends { rawEventId: string; bundleEvidenceCount: number },
>(itemRows: T[], outputRawEventIds: Set<string> | undefined): T[] {
  if (outputRawEventIds !== undefined) {
    if (outputRawEventIds.size === 0) return [];
    const visibleRawEventIds = new Set(itemRows.map((row) => row.rawEventId));
    const allOutputRefsVisible = [...outputRawEventIds].every((id) => visibleRawEventIds.has(id));
    return allOutputRefsVisible
      ? itemRows.filter((row) => outputRawEventIds.has(row.rawEventId))
      : [];
  }

  return itemRows[0]?.bundleEvidenceCount === 1 && itemRows.length === 1 ? itemRows : [];
}

function reconciliationOutputIdsFromMetadata(metadata: unknown): string[] {
  const record = recordFromUnknown(metadata);
  const outputIds = Array.isArray(record.reconciliation_output_ids)
    ? record.reconciliation_output_ids.filter(
        (value): value is string => typeof value === 'string' && UUID_RE.test(value),
      )
    : [];
  const single =
    typeof record.reconciliation_output_id === 'string' &&
    UUID_RE.test(record.reconciliation_output_id)
      ? [record.reconciliation_output_id]
      : [];
  return [...new Set([...single, ...outputIds])];
}

function sourceRefRawEventIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value.flatMap((item) => {
        const ref = recordFromUnknown(item);
        const rawEventId = ref.rawEventId;
        return typeof rawEventId === 'string' && UUID_RE.test(rawEventId) ? [rawEventId] : [];
      }),
    ),
  ];
}

function reconciliationOutputCitesAnyRawEventId(rawEventIds: string[]): SQL {
  const sourceRefIdList = sql.join(
    rawEventIds.map((id) => sql`${id}`),
    sql`, `,
  );
  return sql`EXISTS (
    SELECT 1
    FROM jsonb_array_elements(${reconciliationOutputs.sourceRefs}) AS source_ref
    WHERE source_ref ->> 'rawEventId' IN (${sourceRefIdList})
  )`;
}

function cursorCondition(
  cursor: string | null | undefined,
  atColumn: unknown,
  idColumn: unknown,
): ReturnType<typeof or> | undefined {
  const decoded = decodeCursor(cursor);
  if (cursor && !decoded) throw new Error('Invalid cursor');
  if (!decoded) return undefined;
  const cursorDate = new Date(decoded.at);
  return or(
    lt(atColumn as never, cursorDate),
    and(eq(atColumn as never, cursorDate), lt(idColumn as never, decoded.id)),
  );
}

export async function getObjectSectionPage(
  db: Db,
  scope: TeamScopeCore,
  entityId: string,
  section: ObjectSection,
  args: { limit?: number; cursor?: string | null } = {},
): Promise<ObjectSectionPage | null> {
  await scope.requireMembership();
  if (!UUID_RE.test(entityId)) return null;
  const exists = await db
    .select({ id: entities.id, canonicalName: entities.canonicalName, aliases: entities.aliases })
    .from(entities)
    .where(
      and(
        eq(entities.id, entityId),
        eq(entities.teamId, scope.teamId),
        isNull(entities.mergedIntoId),
      ),
    )
    .limit(1);
  if (!exists[0]) return null;

  const limit = Math.min(Math.max(args.limit ?? 20, 1), 100);
  if (section === 'changes') {
    const cursorSql = cursorCondition(args.cursor, objectChanges.changedAt, objectChanges.id);
    const rows = await db
      .select({
        id: objectChanges.id,
        field: objectChanges.field,
        actorKind: objectChanges.actorKind,
        actorUserId: objectChanges.actorUserId,
        previousValue: objectChanges.previousValue,
        newValue: objectChanges.newValue,
        status: objectChanges.status,
        note: objectChanges.note,
        changedAt: objectChanges.changedAt,
      })
      .from(objectChanges)
      .where(
        and(
          eq(objectChanges.teamId, scope.teamId),
          eq(objectChanges.entityId, entityId),
          ...(cursorSql ? [cursorSql] : []),
        ),
      )
      .orderBy(desc(objectChanges.changedAt), desc(objectChanges.id))
      .limit(limit + 1);
    return pageWindow(rows, limit, (row) => ({ at: row.changedAt.toISOString(), id: row.id }));
  }
  if (section === 'tasks') {
    const relRows = await db
      .select({ taskId: entityRelationships.fromEntityId })
      .from(entityRelationships)
      .where(
        and(
          eq(entityRelationships.teamId, scope.teamId),
          eq(entityRelationships.toEntityId, entityId),
          eq(entityRelationships.kind, 'child'),
        ),
      )
      .limit(200);
    const taskIds = relRows.map((r) => r.taskId);
    if (taskIds.length === 0) return { items: [], nextCursor: null };
    const cursorSql = cursorCondition(args.cursor, entities.updatedAt, entities.id);
    const rows = await db
      .select()
      .from(entities)
      .where(
        and(
          eq(entities.teamId, scope.teamId),
          inArray(entities.id, taskIds),
          eq(entities.type, 'task'),
          isNull(entities.archivedAt),
          isNull(entities.mergedIntoId),
          ne(entities.status, 'done'),
          ne(entities.status, 'cancelled'),
          ...(cursorSql ? [cursorSql] : []),
        ),
      )
      .orderBy(desc(entities.updatedAt), desc(entities.id))
      .limit(limit + 1);
    return pageWindow(rows.map(toObjectRow), limit, (row) => ({
      at: row.updatedAt.toISOString(),
      id: row.id,
    }));
  }
  if (section === 'relationships') {
    const cursorSql = cursorCondition(
      args.cursor,
      entityRelationships.createdAt,
      entityRelationships.id,
    );
    const [outRows, inRows] = await Promise.all([
      db
        .select({
          id: entityRelationships.id,
          direction: sql<'out'>`'out'`,
          kind: entityRelationships.kind,
          otherId: entities.id,
          otherName: entities.canonicalName,
          otherType: entities.type,
          createdAt: entityRelationships.createdAt,
        })
        .from(entityRelationships)
        .innerJoin(entities, eq(entityRelationships.toEntityId, entities.id))
        .where(
          and(
            eq(entityRelationships.teamId, scope.teamId),
            eq(entityRelationships.fromEntityId, entityId),
            eq(entities.teamId, scope.teamId),
            isNull(entities.mergedIntoId),
            ...(cursorSql ? [cursorSql] : []),
          ),
        )
        .orderBy(desc(entityRelationships.createdAt), desc(entityRelationships.id))
        .limit(limit + 1),
      db
        .select({
          id: entityRelationships.id,
          direction: sql<'in'>`'in'`,
          kind: entityRelationships.kind,
          otherId: entities.id,
          otherName: entities.canonicalName,
          otherType: entities.type,
          createdAt: entityRelationships.createdAt,
        })
        .from(entityRelationships)
        .innerJoin(entities, eq(entityRelationships.fromEntityId, entities.id))
        .where(
          and(
            eq(entityRelationships.teamId, scope.teamId),
            eq(entityRelationships.toEntityId, entityId),
            eq(entities.teamId, scope.teamId),
            isNull(entities.mergedIntoId),
            ...(cursorSql ? [cursorSql] : []),
          ),
        )
        .orderBy(desc(entityRelationships.createdAt), desc(entityRelationships.id))
        .limit(limit + 1),
    ]);
    const rows = [...outRows, ...inRows]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id))
      .slice(0, limit + 1);
    return pageWindow(rows, limit, (row) => ({ at: row.createdAt.toISOString(), id: row.id }));
  }
  if (section === 'facts') {
    const cursorSql = cursorCondition(args.cursor, rawEvents.occurredAt, factsTable.id);
    const rows = await db
      .select({
        id: factsTable.id,
        statement: factsTable.statement,
        confidence: factsTable.confidence,
        rawEventId: factsTable.rawEventId,
        extractedAt: factsTable.extractedAt,
        occurredAt: rawEvents.occurredAt,
        source: rawEvents.source,
        sharedObjects: sql<
          { id: string; canonicalName: string; type: ObjectType; role: string }[]
        >`coalesce(
          (
            select json_agg(
              json_build_object(
                'id', shared_objects.id,
                'canonicalName', shared_objects.canonical_name,
                'type', shared_objects.type,
                'role', shared_objects.role
              )
              order by shared_objects.canonical_name, shared_objects.id
            )
            from (
              select
                shared_entities.id,
                shared_entities.canonical_name,
                shared_entities.type,
                string_agg(
                  distinct shared_fact_entities.role::text,
                  ', '
                  order by shared_fact_entities.role::text
                ) as role
              from fact_entities shared_fact_entities
              inner join entities shared_entities
                on shared_entities.id = shared_fact_entities.entity_id
              where shared_fact_entities.fact_id = ${factsTable.id}
                and shared_fact_entities.entity_id <> ${entityId}
                and shared_entities.team_id = ${scope.teamId}
                and shared_entities.merged_into_id is null
              group by shared_entities.id, shared_entities.canonical_name, shared_entities.type
            )
            shared_objects
          ),
          '[]'::json
        )`,
      })
      .from(factEntities)
      .innerJoin(factsTable, eq(factsTable.id, factEntities.factId))
      .innerJoin(rawEvents, eq(rawEvents.id, factsTable.rawEventId))
      .where(
        and(
          eq(factEntities.entityId, entityId),
          eq(factsTable.teamId, scope.teamId),
          eq(rawEvents.teamId, scope.teamId),
          rawEventVisibility(scope),
          ...(cursorSql ? [cursorSql] : []),
        ),
      )
      .orderBy(desc(rawEvents.occurredAt), desc(factsTable.id))
      .limit(limit + 1);
    return pageWindow(rows, limit, (row) => ({ at: row.occurredAt.toISOString(), id: row.id }));
  }

  const objectForMatching = exists[0];
  const names = objectNamesForMatching({
    canonicalName: objectForMatching.canonicalName,
    aliases: stringArrayFromUnknown(objectForMatching.aliases),
  });
  const tokens = objectEvidenceTokens({
    canonicalName: objectForMatching.canonicalName,
    aliases: stringArrayFromUnknown(objectForMatching.aliases),
  });
  const factRawEventRows = await db
    .select({ rawEventId: factsTable.rawEventId })
    .from(factEntities)
    .innerJoin(factsTable, eq(factsTable.id, factEntities.factId))
    .innerJoin(rawEvents, eq(rawEvents.id, factsTable.rawEventId))
    .where(
      and(
        eq(factEntities.entityId, entityId),
        eq(factsTable.teamId, scope.teamId),
        eq(rawEvents.teamId, scope.teamId),
        rawEventVisibility(scope),
      ),
    )
    .limit(300);
  const factRawEventIds = Array.from(new Set(factRawEventRows.map((row) => row.rawEventId)));
  const artifactEventMatch = artifactAssociatedRawEventCondition(db, scope, entityId);
  const eventConditions: SQL[] = [sql`${rawEvents.sourceMetadata} ->> 'entity_id' = ${entityId}`];
  if (factRawEventIds.length > 0) eventConditions.push(inArray(rawEvents.id, factRawEventIds));
  eventConditions.push(artifactEventMatch);
  const eventContentMatch = objectContentMatchCondition(rawEvents.contentText, names, tokens);
  if (eventContentMatch) eventConditions.push(eventContentMatch);
  const cursorSql = cursorCondition(args.cursor, rawEvents.occurredAt, rawEvents.id);
  const rows = await db
    .select({
      id: rawEvents.id,
      teamId: rawEvents.teamId,
      source: rawEvents.source,
      authorUserId: rawEvents.authorUserId,
      contentText: rawEvents.contentText,
      contentAudioUrl: rawEvents.contentAudioUrl,
      sourceMetadata: rawEvents.sourceMetadata,
      visibility: rawEvents.visibility,
      visibilityUserIds: rawEvents.visibilityUserIds,
      occurredAt: rawEvents.occurredAt,
      createdAt: rawEvents.createdAt,
      sourceEntityId: sql<string | null>`${rawEvents.sourceMetadata} ->> 'entity_id'`,
      artifactAssociated: artifactEventMatch,
    })
    .from(rawEvents)
    .where(
      and(
        eq(rawEvents.teamId, scope.teamId),
        ne(rawEvents.source, 'system'),
        rawEventVisibility(scope),
        sql`COALESCE(${rawEvents.sourceMetadata} ->> 'deleted', 'false') <> 'true'`,
        or(...eventConditions),
        ...(cursorSql ? [cursorSql] : []),
      ),
    )
    .orderBy(desc(rawEvents.occurredAt), desc(rawEvents.id))
    .limit(limit + 1);
  const factRawEventIdSet = new Set(factRawEventIds);
  const filteredRows = rows.filter((row) => {
    if (
      row.sourceEntityId === entityId ||
      factRawEventIdSet.has(row.id) ||
      row.artifactAssociated
    ) {
      return true;
    }
    return textMatchesObjectSearch(row.contentText ?? '', names, tokens);
  });
  return pageWindow(filteredRows, limit, (row) => ({
    at: row.occurredAt.toISOString(),
    id: row.id,
  }));
}

async function getConnectedWork(
  db: Db,
  scope: TeamScopeCore,
  object: ObjectRow,
): Promise<ObjectDetail['connectedWork']> {
  const names = objectNamesForMatching(object);
  const tokens = objectEvidenceTokens(object);
  const nameMatch = likeMentionCondition(entities.canonicalName, names);

  const factIdRows = await db
    .select({ factId: factEntities.factId, rawEventId: factsTable.rawEventId })
    .from(factEntities)
    .innerJoin(factsTable, eq(factsTable.id, factEntities.factId))
    .innerJoin(rawEvents, eq(rawEvents.id, factsTable.rawEventId))
    .where(
      and(
        eq(factEntities.entityId, object.id),
        eq(factsTable.teamId, scope.teamId),
        eq(rawEvents.teamId, scope.teamId),
        rawEventVisibility(scope),
      ),
    )
    .limit(300);
  const factIds = Array.from(new Set(factIdRows.map((row) => row.factId)));
  const factRawEventIds = Array.from(new Set(factIdRows.map((row) => row.rawEventId)));

  const [
    relationshipTaskRows,
    sharedObjectRows,
    titleTaskRows,
    linkedCalendarRows,
    artifactRawEventIds,
    boardRows,
    pendingApprovalRows,
    pendingReconciliationOutputRows,
    documentRows,
    noteRawEventRows,
  ] = await Promise.all([
    db
      .select({ taskId: entityRelationships.fromEntityId })
      .from(entityRelationships)
      .where(
        and(
          eq(entityRelationships.teamId, scope.teamId),
          eq(entityRelationships.toEntityId, object.id),
          eq(entityRelationships.kind, 'child'),
        ),
      )
      .limit(200),
    factIds.length > 0
      ? db
          .select({
            id: entities.id,
            canonicalName: entities.canonicalName,
            type: entities.type,
            factCount: sql<number>`count(distinct ${factEntities.factId})::int`,
          })
          .from(factEntities)
          .innerJoin(entities, eq(entities.id, factEntities.entityId))
          .where(
            and(
              inArray(factEntities.factId, factIds),
              ne(factEntities.entityId, object.id),
              eq(entities.teamId, scope.teamId),
              isNull(entities.archivedAt),
              isNull(entities.mergedIntoId),
            ),
          )
          .groupBy(entities.id, entities.canonicalName, entities.type)
          .orderBy(
            desc(sql<number>`count(distinct ${factEntities.factId})`),
            entities.canonicalName,
          )
          .limit(20)
      : Promise.resolve([]),
    nameMatch
      ? db
          .select({ id: entities.id, canonicalName: entities.canonicalName })
          .from(entities)
          .where(
            and(
              eq(entities.teamId, scope.teamId),
              inArray(entities.type, ['task', 'follow_up']),
              isNull(entities.archivedAt),
              isNull(entities.mergedIntoId),
              ne(entities.id, object.id),
              nameMatch,
            ),
          )
          .orderBy(desc(entities.updatedAt), desc(entities.id))
          .limit(50)
      : Promise.resolve([]),
    db
      .select({ calendarEventId: calendarEventEntities.calendarEventId })
      .from(calendarEventEntities)
      .where(
        and(
          eq(calendarEventEntities.teamId, scope.teamId),
          eq(calendarEventEntities.entityId, object.id),
        ),
      )
      .limit(100),
    artifactAssociatedRawEventIds(db, scope, object.id),
    db
      .select({
        boardId: boards.id,
        boardName: boards.name,
        itemId: boardItems.id,
        laneName: boardLanes.name,
        dueAt: boardItems.dueAt,
        priority: boardItems.priority,
        nextStep: boardItems.nextStep,
      })
      .from(boardItems)
      .innerJoin(boards, eq(boardItems.boardId, boards.id))
      .leftJoin(
        boardLanes,
        and(eq(boardItems.laneId, boardLanes.id), eq(boardLanes.teamId, scope.teamId)),
      )
      .where(
        and(
          eq(boardItems.teamId, scope.teamId),
          eq(boardItems.entityId, object.id),
          eq(boards.teamId, scope.teamId),
          isNull(boardItems.archivedAt),
          isNull(boards.archivedAt),
        ),
      )
      .orderBy(desc(boardItems.updatedAt), desc(boardItems.id))
      .limit(8),
    db
      .select({
        suggestionId: agentSuggestions.id,
        itemId: agentSuggestionItems.id,
        suggestionTitle: agentSuggestions.title,
        summary: agentSuggestions.summary,
        reason: agentSuggestions.reason,
        title: agentSuggestionItems.title,
        description: agentSuggestionItems.description,
        operation: agentSuggestionItems.operation,
        targetKind: agentSuggestionItems.targetKind,
        targetId: agentSuggestionItems.targetId,
        resultId: agentSuggestionItems.resultId,
        proposedPayload: agentSuggestionItems.proposedPayload,
        createdAt: agentSuggestions.createdAt,
      })
      .from(agentSuggestionItems)
      .innerJoin(agentSuggestions, eq(agentSuggestionItems.suggestionId, agentSuggestions.id))
      .where(
        and(
          eq(agentSuggestions.teamId, scope.teamId),
          eq(agentSuggestionItems.teamId, scope.teamId),
          eq(agentSuggestions.status, 'pending'),
          eq(agentSuggestionItems.status, 'pending'),
          suggestionVisibleToScope(scope),
          or(
            eq(agentSuggestionItems.targetId, object.id),
            eq(agentSuggestionItems.resultId, object.id),
            sql`${agentSuggestionItems.proposedPayload}::text LIKE ${likePattern(object.id)}`,
            ...(names.length > 0
              ? [
                  likeMentionCondition(agentSuggestions.title, names),
                  likeMentionCondition(agentSuggestions.summary, names),
                  likeMentionCondition(agentSuggestions.reason, names),
                  likeMentionCondition(agentSuggestionItems.title, names),
                  likeMentionCondition(agentSuggestionItems.description, names),
                  likeMentionCondition(sql`${agentSuggestionItems.proposedPayload}::text`, names),
                ].filter((condition): condition is SQL => Boolean(condition))
              : []),
          ),
        ),
      )
      .orderBy(desc(agentSuggestions.createdAt), desc(agentSuggestionItems.id))
      .limit(16),
    db
      .select({
        outputId: reconciliationOutputs.id,
        title: sql<string | null>`${reconciliationOutputs.payload} ->> 'title'`,
        operation: reconciliationOutputs.operation,
        targetKind: reconciliationOutputs.targetKind,
        targetId: reconciliationOutputs.targetId,
        payload: reconciliationOutputs.payload,
        createdAt: reconciliationOutputs.createdAt,
      })
      .from(reconciliationOutputs)
      .where(
        and(
          eq(reconciliationOutputs.teamId, scope.teamId),
          eq(reconciliationOutputs.status, 'pending'),
          eq(reconciliationOutputs.requiresApproval, true),
          reconciliationOutputVisibleToScope(scope),
          or(
            eq(reconciliationOutputs.targetId, object.id),
            sql`${reconciliationOutputs.payload}::text LIKE ${likePattern(object.id)}`,
            ...(names.length > 0
              ? [likeMentionCondition(sql`${reconciliationOutputs.payload}::text`, names)].filter(
                  (condition): condition is SQL => Boolean(condition),
                )
              : []),
          ),
        ),
      )
      .orderBy(desc(reconciliationOutputs.createdAt), desc(reconciliationOutputs.id))
      .limit(16),
    names.length > 0
      ? db
          .select({
            id: documents.id,
            name: documents.name,
            fileKind: documents.fileKind,
            metadata: documents.metadata,
            chunkText: documentChunks.text,
            updatedAt: documents.updatedAt,
          })
          .from(documents)
          .leftJoin(
            documentChunks,
            and(
              eq(documentChunks.teamId, scope.teamId),
              eq(documentChunks.documentId, documents.id),
            ),
          )
          .where(
            and(
              eq(documents.teamId, scope.teamId),
              eq(documents.fileKind, 'document'),
              isNull(documents.deletedAt),
              documentVisibleToScope(scope),
              or(
                likeMentionCondition(documents.name, names),
                likeMentionCondition(sql`${documents.metadata}::text`, names),
                likeMentionCondition(documentChunks.text, names),
              ),
            ),
          )
          .orderBy(desc(documents.updatedAt), desc(documents.id))
          .limit(40)
      : Promise.resolve([]),
    db
      .select({
        id: rawEvents.id,
        noteId: sql<string>`${rawEvents.sourceMetadata} ->> 'note_id'`,
      })
      .from(rawEvents)
      .innerJoin(
        objectNotes,
        and(
          eq(objectNotes.teamId, scope.teamId),
          eq(objectNotes.entityId, object.id),
          isNull(objectNotes.deletedAt),
          sql`${objectNotes.id}::text = ${rawEvents.sourceMetadata} ->> 'note_id'`,
        ),
      )
      .where(
        and(
          eq(rawEvents.teamId, scope.teamId),
          eq(rawEvents.source, 'system'),
          rawEventVisibility(scope),
          sql`COALESCE(${rawEvents.sourceMetadata} ->> 'deleted', 'false') <> 'true'`,
          sql`${rawEvents.sourceMetadata} ->> 'entity_id' = ${object.id}`,
          inArray(sql`${rawEvents.sourceMetadata} ->> 'kind'`, [
            'object_note_create',
            'object_note_update',
          ]),
        ),
      )
      .orderBy(desc(rawEvents.occurredAt), desc(rawEvents.id))
      .limit(100),
  ]);

  const currentNoteRawEventRows = Array.from(
    noteRawEventRows
      .reduce((rowsByNoteId, row) => {
        if (!rowsByNoteId.has(row.noteId)) rowsByNoteId.set(row.noteId, { id: row.id });
        return rowsByNoteId;
      }, new Map<string, { id: string }>())
      .values(),
  );

  const taskIds = new Set<string>();
  for (const row of relationshipTaskRows) taskIds.add(row.taskId);
  for (const row of sharedObjectRows) {
    if (row.type === 'task' || row.type === 'follow_up') taskIds.add(row.id);
  }
  for (const row of titleTaskRows) {
    if (textMentionsAnyValue(row.canonicalName, names)) taskIds.add(row.id);
  }

  const taskRows =
    taskIds.size > 0
      ? (
          await db
            .select()
            .from(entities)
            .where(
              and(
                eq(entities.teamId, scope.teamId),
                inArray(entities.id, Array.from(taskIds)),
                inArray(entities.type, ['task', 'follow_up']),
                isNull(entities.archivedAt),
                isNull(entities.mergedIntoId),
              ),
            )
            .orderBy(desc(entities.updatedAt), desc(entities.id))
            .limit(40)
        ).map(toObjectRow)
      : [];
  const openTasks = taskRows
    .filter((task) => task.status !== 'done' && task.status !== 'cancelled')
    .slice(0, 12);
  const recentTasks = taskRows
    .filter((task) => task.status === 'done' || task.status === 'cancelled')
    .slice(0, 8);

  const timelineConditions: SQL[] = [
    sql`${rawEvents.sourceMetadata} ->> 'entity_id' = ${object.id}`,
  ];
  if (factRawEventIds.length > 0) {
    timelineConditions.push(inArray(rawEvents.id, factRawEventIds));
  }
  const sourceRefLinkedPendingReconciliationOutputRows =
    artifactRawEventIds.length > 0
      ? await db
          .select({
            outputId: reconciliationOutputs.id,
            title: sql<string | null>`${reconciliationOutputs.payload} ->> 'title'`,
            operation: reconciliationOutputs.operation,
            targetKind: reconciliationOutputs.targetKind,
            targetId: reconciliationOutputs.targetId,
            payload: reconciliationOutputs.payload,
            createdAt: reconciliationOutputs.createdAt,
          })
          .from(reconciliationOutputs)
          .where(
            and(
              eq(reconciliationOutputs.teamId, scope.teamId),
              eq(reconciliationOutputs.status, 'pending'),
              eq(reconciliationOutputs.requiresApproval, true),
              reconciliationOutputVisibleToScope(scope),
              reconciliationOutputCitesAnyRawEventId(artifactRawEventIds),
            ),
          )
          .orderBy(desc(reconciliationOutputs.createdAt), desc(reconciliationOutputs.id))
          .limit(16)
      : [];
  const allPendingReconciliationOutputRows = Array.from(
    new Map(
      [...pendingReconciliationOutputRows, ...sourceRefLinkedPendingReconciliationOutputRows].map(
        (row) => [row.outputId, row],
      ),
    ).values(),
  );
  if (artifactRawEventIds.length > 0) {
    timelineConditions.push(inArray(rawEvents.id, artifactRawEventIds));
  }
  const eventContentMatch = objectContentMatchCondition(rawEvents.contentText, names, tokens);
  if (eventContentMatch) timelineConditions.push(eventContentMatch);
  const timelineRows =
    timelineConditions.length > 0
      ? await db
          .select({
            id: rawEvents.id,
            source: rawEvents.source,
            contentText: rawEvents.contentText,
            occurredAt: rawEvents.occurredAt,
            sourceEntityId: sql<string | null>`${rawEvents.sourceMetadata} ->> 'entity_id'`,
          })
          .from(rawEvents)
          .where(
            and(
              eq(rawEvents.teamId, scope.teamId),
              ne(rawEvents.source, 'system'),
              rawEventVisibility(scope),
              sql`COALESCE(${rawEvents.sourceMetadata} ->> 'deleted', 'false') <> 'true'`,
              or(...timelineConditions),
            ),
          )
          .orderBy(desc(rawEvents.occurredAt), desc(rawEvents.id))
          .limit(24)
      : [];
  const factRawEventIdSet = new Set(factRawEventIds);
  const artifactRawEventIdSet = new Set(artifactRawEventIds);
  const filteredTimelineRows = timelineRows
    .filter((row) => {
      if (
        row.sourceEntityId === object.id ||
        factRawEventIdSet.has(row.id) ||
        artifactRawEventIdSet.has(row.id)
      ) {
        return true;
      }
      return textMatchesObjectSearch(row.contentText ?? '', names, tokens);
    })
    .slice(0, 12);

  const calendarConditions = [];
  const linkedCalendarIds = linkedCalendarRows.map((row) => row.calendarEventId);
  if (linkedCalendarIds.length > 0) {
    calendarConditions.push(inArray(calendarEvents.id, linkedCalendarIds));
  }
  const calendarTitleMatch = likeMentionCondition(calendarEvents.title, names);
  if (calendarTitleMatch) calendarConditions.push(calendarTitleMatch);
  const calendarDescriptionMatch = likeMentionCondition(calendarEvents.description, names);
  if (calendarDescriptionMatch) calendarConditions.push(calendarDescriptionMatch);
  const calendarRows =
    calendarConditions.length > 0
      ? await db
          .select({
            id: calendarEvents.id,
            title: calendarEvents.title,
            description: calendarEvents.description,
            startAt: calendarEvents.startAt,
            endAt: calendarEvents.endAt,
            showAs: calendarEvents.showAs,
          })
          .from(calendarEvents)
          .where(
            and(
              eq(calendarEvents.teamId, scope.teamId),
              isNull(calendarEvents.deletedAt),
              calendarVisibleToScope(scope),
              or(...calendarConditions),
            ),
          )
          .orderBy(desc(calendarEvents.startAt), desc(calendarEvents.id))
          .limit(20)
      : [];
  const linkedCalendarIdSet = new Set(linkedCalendarIds);
  const filteredCalendarRows = calendarRows
    .filter((row) => {
      if (linkedCalendarIdSet.has(row.id)) return true;
      return textMentionsAnyValue(`${row.title} ${row.description ?? ''}`, names);
    })
    .slice(0, 10);
  const filteredPendingApprovalRows = pendingApprovalRows
    .filter((row) => {
      if (row.targetId === object.id || row.resultId === object.id) return true;
      if (jsonishText(row.proposedPayload).includes(object.id)) return true;
      return textMentionsAnyValue(
        [
          row.suggestionTitle,
          row.summary,
          row.reason,
          row.title,
          row.description,
          jsonishText(row.proposedPayload),
        ]
          .filter(Boolean)
          .join(' '),
        names,
      );
    })
    .slice(0, 8);
  const projectedApprovalKeys = new Set(
    filteredPendingApprovalRows.map((row) =>
      [row.operation, row.targetKind, row.targetId ?? '', jsonishText(row.proposedPayload)].join(
        '\0',
      ),
    ),
  );
  const pendingReconciliationApprovals = allPendingReconciliationOutputRows
    .filter((row) => {
      const key = [
        row.operation,
        row.targetKind,
        row.targetId ?? '',
        jsonishText(row.payload),
      ].join('\0');
      return !projectedApprovalKeys.has(key);
    })
    .map((row) => ({
      suggestionId: row.outputId,
      itemId: row.outputId,
      title: row.title ?? 'Review reconciliation output',
      operation: row.operation,
      targetKind: row.targetKind,
      createdAt: row.createdAt,
    }));
  const filteredDocumentRows = Array.from(
    new Map(
      documentRows
        .filter((row) =>
          textMentionsAnyValue(
            `${row.name} ${jsonishText(row.metadata)} ${row.chunkText ?? ''}`,
            names,
          ),
        )
        .map((row) => [
          row.id,
          {
            id: row.id,
            name: row.name,
            fileKind: row.fileKind,
            updatedAt: row.updatedAt,
          },
        ]),
    ).values(),
  ).slice(0, 8);
  const relatedRawEventIds = Array.from(
    new Set([
      ...factRawEventIds,
      ...filteredTimelineRows.map((row) => row.id),
      ...currentNoteRawEventRows.map((row) => row.id),
    ]),
  );
  const [linkAssociationRows, capturedFileRows] =
    relatedRawEventIds.length > 0
      ? await Promise.all([
          db
            .select({
              id: artifactClusters.id,
              canonicalName: artifactClusters.canonicalName,
              metadata: artifactEvidenceAssociations.metadata,
              provider: sql<string | null>`${artifactEvidenceAssociations.metadata} ->> 'provider'`,
              updatedAt: artifactClusters.updatedAt,
            })
            .from(artifactEvidenceAssociations)
            .innerJoin(
              reconciliationEvidence,
              and(
                eq(reconciliationEvidence.id, artifactEvidenceAssociations.evidenceId),
                eq(reconciliationEvidence.teamId, scope.teamId),
              ),
            )
            .innerJoin(
              artifactClusters,
              and(
                eq(artifactClusters.id, artifactEvidenceAssociations.clusterId),
                eq(artifactClusters.teamId, scope.teamId),
              ),
            )
            .where(
              and(
                eq(artifactEvidenceAssociations.teamId, scope.teamId),
                inArray(
                  sql<string>`COALESCE(${artifactEvidenceAssociations.rawEventId}, ${reconciliationEvidence.rawEventId})`,
                  relatedRawEventIds,
                ),
                eq(artifactClusters.artifactType, 'link'),
                isNull(artifactClusters.archivedAt),
                artifactAssociationVisibleToScope(scope),
              ),
            )
            .orderBy(desc(artifactEvidenceAssociations.createdAt), desc(artifactClusters.id))
            .limit(20),
          db
            .select({
              id: documents.id,
              name: documents.name,
              contentType: documentVersions.contentType,
              sourceRawEventId: documents.sourceRawEventId,
              updatedAt: documents.updatedAt,
            })
            .from(documents)
            .leftJoin(documentVersions, eq(documentVersions.id, documents.currentVersionId))
            .where(
              and(
                eq(documents.teamId, scope.teamId),
                eq(documents.fileKind, 'captured'),
                inArray(documents.sourceRawEventId, relatedRawEventIds),
                isNull(documents.deletedAt),
                documentVisibleToScope(scope),
              ),
            )
            .orderBy(desc(documents.updatedAt), desc(documents.id))
            .limit(12),
        ])
      : [[], []];
  const filteredLinkRows = Array.from(
    new Map(
      linkAssociationRows.map((row) => {
        const metadata = recordFromUnknown(row.metadata);
        return [
          row.id,
          {
            id: row.id,
            canonicalName: row.canonicalName,
            canonicalUrl: metadataString(metadata, 'canonical_url'),
            displayUrl: metadataString(metadata, 'display_url'),
            domain: metadataString(metadata, 'domain'),
            provider: row.provider ?? metadataString(metadata, 'provider'),
            updatedAt: row.updatedAt,
          },
        ];
      }),
    ).values(),
  ).slice(0, 8);

  return {
    openTasks,
    recentTasks,
    calendarEvents: filteredCalendarRows,
    timelineEvents: filteredTimelineRows,
    objects: sharedObjectRows
      .filter((row) => row.type !== 'task' && row.type !== 'follow_up')
      .slice(0, 12),
    boards: boardRows,
    pendingApprovals: [...filteredPendingApprovalRows, ...pendingReconciliationApprovals].slice(
      0,
      8,
    ),
    documents: filteredDocumentRows,
    links: filteredLinkRows,
    capturedFiles: capturedFileRows,
  };
}

export async function getObject(
  db: Db,
  scope: TeamScopeCore,
  idOrName: string,
): Promise<ObjectDetail | null> {
  await scope.requireMembership();
  const trimmed = idOrName.trim();
  if (!trimmed) return null;

  let entityRow: EntityRow | undefined;
  if (UUID_RE.test(trimmed)) {
    const rows = await db
      .select()
      .from(entities)
      .where(
        and(
          eq(entities.id, trimmed),
          eq(entities.teamId, scope.teamId),
          isNull(entities.mergedIntoId),
        ),
      )
      .limit(1);
    entityRow = rows[0];
  } else {
    const rows = await db
      .select()
      .from(entities)
      .where(
        and(
          eq(entities.teamId, scope.teamId),
          isNull(entities.mergedIntoId),
          sql`lower(${entities.canonicalName}) = lower(${trimmed})`,
        ),
      )
      .orderBy(desc(entities.updatedAt))
      .limit(1);
    entityRow = rows[0];
  }
  if (!entityRow) return null;

  const [
    noteRows,
    outRows,
    inRows,
    changeRows,
    identityFacetRows,
    viewRows,
    factCountRows,
    summaryNoteCountRows,
    summaryRelationshipOutCountRows,
    summaryRelationshipInCountRows,
    summaryTaskCountRows,
    summaryChangeCountRows,
  ] = await Promise.all([
    db
      .select({
        id: objectNotes.id,
        body: objectNotes.body,
        authorUserId: objectNotes.authorUserId,
        createdAt: objectNotes.createdAt,
        updatedAt: objectNotes.updatedAt,
      })
      .from(objectNotes)
      .where(
        and(
          eq(objectNotes.teamId, scope.teamId),
          eq(objectNotes.entityId, entityRow.id),
          isNull(objectNotes.deletedAt),
        ),
      )
      .orderBy(desc(objectNotes.createdAt), desc(objectNotes.id))
      .limit(20),
    db
      .select({
        id: entityRelationships.id,
        kind: entityRelationships.kind,
        otherId: entities.id,
        otherName: entities.canonicalName,
        otherType: entities.type,
      })
      .from(entityRelationships)
      .innerJoin(entities, eq(entityRelationships.toEntityId, entities.id))
      .where(
        and(
          eq(entityRelationships.teamId, scope.teamId),
          eq(entityRelationships.fromEntityId, entityRow.id),
          // Defense-in-depth: the relationship row's team_id is already
          // pinned by the filter above and addRelationship validates both
          // endpoints, but pinning the joined entity's team_id too means a
          // stray cross-team edge (e.g. from a future code path that skips
          // the endpoint check) can never leak through this view.
          eq(entities.teamId, scope.teamId),
          isNull(entities.mergedIntoId),
        ),
      )
      .orderBy(desc(entityRelationships.createdAt), desc(entityRelationships.id))
      .limit(20),
    db
      .select({
        id: entityRelationships.id,
        kind: entityRelationships.kind,
        otherId: entities.id,
        otherName: entities.canonicalName,
        otherType: entities.type,
      })
      .from(entityRelationships)
      .innerJoin(entities, eq(entityRelationships.fromEntityId, entities.id))
      .where(
        and(
          eq(entityRelationships.teamId, scope.teamId),
          eq(entityRelationships.toEntityId, entityRow.id),
          eq(entities.teamId, scope.teamId),
          isNull(entities.mergedIntoId),
        ),
      )
      .orderBy(desc(entityRelationships.createdAt), desc(entityRelationships.id))
      .limit(20),
    db
      .select({
        id: objectChanges.id,
        field: objectChanges.field,
        actorKind: objectChanges.actorKind,
        actorUserId: objectChanges.actorUserId,
        previousValue: objectChanges.previousValue,
        newValue: objectChanges.newValue,
        status: objectChanges.status,
        note: objectChanges.note,
        changedAt: objectChanges.changedAt,
      })
      .from(objectChanges)
      .where(and(eq(objectChanges.teamId, scope.teamId), eq(objectChanges.entityId, entityRow.id)))
      .orderBy(desc(objectChanges.changedAt), desc(objectChanges.id))
      .limit(20),
    db
      .select({
        id: objectIdentityFacets.id,
        entityId: objectIdentityFacets.entityId,
        kind: objectIdentityFacets.kind,
        value: objectIdentityFacets.value,
        normalizedValue: objectIdentityFacets.normalizedValue,
        provider: objectIdentityFacets.provider,
        externalId: objectIdentityFacets.externalId,
        linkedUserId: objectIdentityFacets.linkedUserId,
      })
      .from(objectIdentityFacets)
      .where(
        and(
          eq(objectIdentityFacets.teamId, scope.teamId),
          eq(objectIdentityFacets.entityId, entityRow.id),
          eq(objectIdentityFacets.status, 'approved'),
        ),
      )
      .orderBy(objectIdentityFacets.kind, objectIdentityFacets.value),
    db
      .select({ lastVisitedAt: objectViews.lastVisitedAt })
      .from(objectViews)
      .where(
        and(
          eq(objectViews.teamId, scope.teamId),
          eq(objectViews.userId, scope.userId),
          eq(objectViews.entityId, entityRow.id),
        ),
      )
      .limit(1),
    db
      .select({
        facts: sql<number>`count(*)::int`,
        events: sql<number>`count(distinct summary_fact_sources.raw_event_id)::int`,
      })
      .from(
        db
          .select({
            id: factsTable.id,
            rawEventId: sql<string>`${factsTable.rawEventId}`.as('raw_event_id'),
          })
          .from(factsTable)
          .innerJoin(factEntities, eq(factEntities.factId, factsTable.id))
          .innerJoin(rawEvents, eq(rawEvents.id, factsTable.rawEventId))
          .where(
            and(
              eq(factsTable.teamId, scope.teamId),
              eq(factEntities.entityId, entityRow.id),
              eq(rawEvents.teamId, scope.teamId),
              eq(rawEvents.visibility, 'team'),
              sql`COALESCE(${rawEvents.sourceMetadata} ->> 'deleted', 'false') <> 'true'`,
            ),
          )
          .orderBy(desc(rawEvents.occurredAt), desc(factsTable.extractedAt))
          .limit(24)
          .as('summary_fact_sources'),
      ),
    db
      .select({
        notes: sql<number>`count(*) FILTER (WHERE length(trim(summary_note_sources.body)) >= 40)::int`,
      })
      .from(
        db
          .select({
            id: objectNotes.id,
            body: sql<string>`${objectNotes.body}`.as('body'),
          })
          .from(objectNotes)
          .where(
            and(
              eq(objectNotes.teamId, scope.teamId),
              eq(objectNotes.entityId, entityRow.id),
              isNull(objectNotes.deletedAt),
            ),
          )
          .orderBy(desc(objectNotes.updatedAt), desc(objectNotes.id))
          .limit(8)
          .as('summary_note_sources'),
      ),
    db
      .select({
        relationships: sql<number>`count(*)::int`,
      })
      .from(
        db
          .select({ id: entityRelationships.id })
          .from(entityRelationships)
          .innerJoin(entities, eq(entities.id, entityRelationships.toEntityId))
          .where(
            and(
              eq(entityRelationships.teamId, scope.teamId),
              eq(entityRelationships.fromEntityId, entityRow.id),
              eq(entities.teamId, scope.teamId),
              isNull(entities.mergedIntoId),
            ),
          )
          .orderBy(desc(entityRelationships.createdAt))
          .limit(8)
          .as('summary_relationship_out_sources'),
      ),
    db
      .select({
        relationships: sql<number>`count(*)::int`,
      })
      .from(
        db
          .select({ id: entityRelationships.id })
          .from(entityRelationships)
          .innerJoin(entities, eq(entities.id, entityRelationships.fromEntityId))
          .where(
            and(
              eq(entityRelationships.teamId, scope.teamId),
              eq(entityRelationships.toEntityId, entityRow.id),
              eq(entities.teamId, scope.teamId),
              isNull(entities.mergedIntoId),
            ),
          )
          .orderBy(desc(entityRelationships.createdAt))
          .limit(8)
          .as('summary_relationship_in_sources'),
      ),
    db
      .select({
        tasks: sql<number>`count(*)::int`,
      })
      .from(
        db
          .select({ id: entities.id })
          .from(entityRelationships)
          .innerJoin(entities, eq(entities.id, entityRelationships.fromEntityId))
          .where(
            and(
              eq(entityRelationships.teamId, scope.teamId),
              eq(entityRelationships.toEntityId, entityRow.id),
              eq(entityRelationships.kind, 'child'),
              eq(entities.teamId, scope.teamId),
              eq(entities.type, 'task'),
              isNull(entities.archivedAt),
              isNull(entities.mergedIntoId),
              ne(entities.status, 'done'),
              ne(entities.status, 'cancelled'),
            ),
          )
          .orderBy(desc(entities.updatedAt), desc(entities.id))
          .limit(8)
          .as('summary_task_sources'),
      ),
    db
      .select({
        changes: sql<number>`count(*)::int`,
      })
      .from(
        db
          .select({ id: objectChanges.id })
          .from(objectChanges)
          .where(
            and(
              eq(objectChanges.teamId, scope.teamId),
              eq(objectChanges.entityId, entityRow.id),
              isNull(objectChanges.sourceEventId),
            ),
          )
          .orderBy(desc(objectChanges.changedAt), desc(objectChanges.id))
          .limit(8)
          .as('summary_change_sources'),
      ),
  ]);

  const lastVisitedAt = viewRows[0]?.lastVisitedAt ?? null;
  // `changeRows` is capped at 50 for the recent-changes pane, so filtering it
  // would undercount once an object accumulates more than 50 changes between
  // visits. Run a dedicated COUNT(*) instead. Notes are NOT added separately
  // here — `createNote`/`updateNote`/`deleteNote` each write a matching
  // `__note_create__` / `__note_update__` / `__note_delete__` row into
  // object_changes, so they're already counted. Summing noteRows on top
  // would double-count every new note.
  let newSinceLastVisit = 0;
  if (lastVisitedAt) {
    // Exclude changes the current user authored. Without this, a mutation
    // by the user immediately followed by router.refresh() reads
    // newSinceLastVisit BEFORE markVisited rolls the timestamp forward,
    // so their own edit echoes back as "1 new change since your last
    // visit." Filtering by actorUserId yields a true "what did OTHERS
    // change while I was away" signal — which is what the banner copy
    // actually claims. Rows authored by the agent (actorUserId IS NULL)
    // still count, since users genuinely want to know what the agent
    // did since their last visit.
    const countRows = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(objectChanges)
      .where(
        and(
          eq(objectChanges.teamId, scope.teamId),
          eq(objectChanges.entityId, entityRow.id),
          gte(objectChanges.changedAt, lastVisitedAt),
          sql`(${objectChanges.actorUserId} IS NULL OR ${objectChanges.actorUserId} <> ${scope.userId})`,
        ),
      );
    newSinceLastVisit = countRows[0]?.count ?? 0;
  }

  const base = toObjectRow(entityRow);
  const connectedWork = await getConnectedWork(db, scope, base);
  const provenance = await getObjectProvenance(db, scope, base, connectedWork);
  const relationships = [
    ...outRows.map((r) => ({ ...r, direction: 'out' as const })),
    ...inRows.map((r) => ({ ...r, direction: 'in' as const })),
  ];
  const summary = await getObjectSummaryFromSnapshot(
    db,
    scope,
    entityRow.id,
    objectSummarySourceSnapshot(entityRow, {
      facts: factCountRows[0]?.facts ?? 0,
      events: factCountRows[0]?.events ?? 0,
      notes: summaryNoteCountRows[0]?.notes ?? 0,
      relationships:
        (summaryRelationshipOutCountRows[0]?.relationships ?? 0) +
        (summaryRelationshipInCountRows[0]?.relationships ?? 0),
      tasks: summaryTaskCountRows[0]?.tasks ?? 0,
      changes: summaryChangeCountRows[0]?.changes ?? 0,
    }),
  );
  return {
    ...base,
    notes: noteRows,
    relationships,
    recentChanges: changeRows,
    identityFacets: identityFacetRows,
    openTasks: connectedWork.openTasks,
    connectedWork,
    provenance,
    summary,
    newSinceLastVisit,
    lastVisitedAt,
  };
}

export async function getObjectNotePreview(
  db: Db,
  scope: TeamScopeCore,
  noteId: string,
): Promise<ObjectNotePreview | null> {
  await scope.requireMembership();
  if (!UUID_RE.test(noteId)) return null;
  const rows = await db
    .select({ note: objectNotes, object: entities })
    .from(objectNotes)
    .innerJoin(entities, eq(objectNotes.entityId, entities.id))
    .where(
      and(
        eq(objectNotes.id, noteId),
        eq(objectNotes.teamId, scope.teamId),
        eq(entities.teamId, scope.teamId),
        isNull(objectNotes.deletedAt),
        isNull(entities.mergedIntoId),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.note.id,
    body: row.note.body,
    authorUserId: row.note.authorUserId,
    createdAt: row.note.createdAt,
    updatedAt: row.note.updatedAt,
    object: toObjectRow(row.object),
  };
}

export async function listReadyObjectSummaries(
  db: Db,
  scope: TeamScopeCore,
  entityIds: string[],
): Promise<ObjectSummarySearchRow[]> {
  await scope.requireMembership();
  const ids = uniqueIds(entityIds.filter((id) => UUID_RE.test(id)));
  if (ids.length === 0) return [];
  return db
    .select({
      entityId: objectSummaries.entityId,
      plainText: objectSummaries.plainText,
      updatedAt: objectSummaries.updatedAt,
    })
    .from(objectSummaries)
    .where(
      and(
        eq(objectSummaries.teamId, scope.teamId),
        inArray(objectSummaries.status, ['ready', 'stale']),
        inArray(objectSummaries.entityId, ids),
      ),
    );
}

export async function searchObjectsBySummary(
  db: Db,
  scope: TeamScopeCore,
  input: { query: string; archived?: boolean; limit?: number },
): Promise<ObjectRow[]> {
  await scope.requireMembership();
  const tokens = objectSearchTokens(input.query);
  if (tokens.length === 0) return [];
  const conds = [
    eq(objectSummaries.teamId, scope.teamId),
    inArray(objectSummaries.status, ['ready', 'stale']),
    eq(entities.teamId, scope.teamId),
    isNull(entities.mergedIntoId),
  ];
  if (input.archived === true) conds.push(isNotNull(entities.archivedAt));
  else if (input.archived !== undefined) conds.push(isNull(entities.archivedAt));
  for (const token of tokens) {
    const pattern = likePattern(token);
    conds.push(sql`lower(${objectSummaries.plainText}) LIKE ${pattern} ESCAPE '\\'`);
  }
  const rows = await db
    .select({ object: entities })
    .from(objectSummaries)
    .innerJoin(entities, eq(entities.id, objectSummaries.entityId))
    .where(and(...conds))
    .orderBy(desc(objectSummaries.updatedAt))
    .limit(Math.min(Math.max(input.limit ?? 100, 1), OBJECT_QUERY_LIMIT_MAX));
  return rows.map((row) => toObjectRow(row.object));
}

export async function getMergedObjectTarget(
  db: Db,
  scope: TeamScopeCore,
  entityId: string,
): Promise<{ id: string; canonicalName: string } | null> {
  await scope.requireMembership();
  if (!UUID_RE.test(entityId)) return null;
  const seen = new Set<string>();
  let currentId = entityId;
  let foundMerge = false;

  for (;;) {
    if (seen.has(currentId)) return null;
    seen.add(currentId);

    const rows = await db
      .select({
        id: entities.id,
        canonicalName: entities.canonicalName,
        mergedIntoId: entities.mergedIntoId,
      })
      .from(entities)
      .where(and(eq(entities.id, currentId), eq(entities.teamId, scope.teamId)))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    if (!row.mergedIntoId) {
      return foundMerge ? { id: row.id, canonicalName: row.canonicalName } : null;
    }

    foundMerge = true;
    currentId = row.mergedIntoId;
  }
}

async function resolveCurrentObjectIds(
  db: Db,
  scope: TeamScopeCore,
  entityIds: string[],
): Promise<string[]> {
  const resolved: string[] = [];
  for (const entityId of entityIds) {
    if (!UUID_RE.test(entityId)) continue;
    const target = await getMergedObjectTarget(db, scope, entityId);
    const currentId = target?.id ?? entityId;
    if (!resolved.includes(currentId)) resolved.push(currentId);
  }
  return resolved;
}

export async function getObjectMergePreview(
  db: Db,
  scope: TeamScopeCore,
  entityIds: string[],
  survivorId?: string,
): Promise<ObjectMergePreview> {
  await scope.requireMembership();
  const ids = await resolveCurrentObjectIds(db, scope, entityIds);
  const resolvedSurvivorId = survivorId
    ? ((await getMergedObjectTarget(db, scope, survivorId))?.id ?? survivorId)
    : undefined;
  if (ids.length < 2) throw new Error('Select at least two objects to merge');
  if (ids.length > 10) throw new Error('Merge at most 10 objects at once');

  const rows = await db
    .select()
    .from(entities)
    .where(
      and(
        eq(entities.teamId, scope.teamId),
        inArray(entities.id, ids),
        isNull(entities.mergedIntoId),
      ),
    );
  if (rows.length !== ids.length) throw new Error('One or more objects no longer exists');
  const objects = rows
    .map(toObjectRow)
    .sort((a, b) => a.canonicalName.localeCompare(b.canonicalName));
  if (!canMergeTypes(objects)) {
    throw new Error('Only same-type objects can be merged, except company/vendor cleanup');
  }

  const survivor = objects.find((row) => row.id === resolvedSurvivorId) ?? objects[0];
  if (!survivor) throw new Error('Survivor object not found');
  const losers = objects.filter((row) => row.id !== survivor.id);

  async function getFactSamples(
    objectIds: string[],
  ): Promise<ObjectMergePreview['factSamplesByObjectId']> {
    const rankedFacts = db
      .select({
        entityId: factEntities.entityId,
        id: factsTable.id,
        statement: factsTable.statement,
        confidence: factsTable.confidence,
        rawEventId: factsTable.rawEventId,
        extractedAt: factsTable.extractedAt,
        rank: sql<number>`row_number() over (partition by ${factEntities.entityId} order by ${factsTable.extractedAt} desc, ${factsTable.id} desc)`.as(
          'fact_sample_rank',
        ),
      })
      .from(factEntities)
      .innerJoin(factsTable, eq(factsTable.id, factEntities.factId))
      .innerJoin(rawEvents, eq(rawEvents.id, factsTable.rawEventId))
      .where(
        and(
          inArray(factEntities.entityId, objectIds),
          eq(factsTable.teamId, scope.teamId),
          eq(rawEvents.teamId, scope.teamId),
          rawEventVisibility(scope),
        ),
      )
      .as('ranked_object_facts');

    const rows = await db
      .select({
        entityId: rankedFacts.entityId,
        id: rankedFacts.id,
        statement: rankedFacts.statement,
        confidence: rankedFacts.confidence,
        rawEventId: rankedFacts.rawEventId,
        extractedAt: rankedFacts.extractedAt,
      })
      .from(rankedFacts)
      .where(sql`${rankedFacts.rank} <= 6`)
      .orderBy(rankedFacts.entityId, rankedFacts.rank);

    const samplesByObjectId: ObjectMergePreview['factSamplesByObjectId'] = Object.fromEntries(
      objectIds.map((id) => [id, []]),
    );
    for (const row of rows) {
      samplesByObjectId[row.entityId]?.push({
        id: row.id,
        statement: row.statement,
        confidence: row.confidence,
        rawEventId: row.rawEventId,
        extractedAt: row.extractedAt,
      });
    }
    return samplesByObjectId;
  }

  async function countMergeImpact(mergeIds: string[]): Promise<ObjectMergePreview['counts']> {
    const [factCountRows, noteCountRows, relCountRows, taskCountRows] = await Promise.all([
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(factEntities)
        .where(inArray(factEntities.entityId, mergeIds)),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(objectNotes)
        .where(
          and(
            eq(objectNotes.teamId, scope.teamId),
            inArray(objectNotes.entityId, mergeIds),
            isNull(objectNotes.deletedAt),
          ),
        ),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(entityRelationships)
        .where(
          and(
            eq(entityRelationships.teamId, scope.teamId),
            or(
              inArray(entityRelationships.fromEntityId, mergeIds),
              inArray(entityRelationships.toEntityId, mergeIds),
            ),
          ),
        ),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(entityRelationships)
        .innerJoin(entities, eq(entities.id, entityRelationships.fromEntityId))
        .where(
          and(
            eq(entityRelationships.teamId, scope.teamId),
            inArray(entityRelationships.toEntityId, mergeIds),
            eq(entityRelationships.kind, 'child'),
            eq(entities.teamId, scope.teamId),
            eq(entities.type, 'task'),
            isNull(entities.archivedAt),
            isNull(entities.mergedIntoId),
            ne(entities.status, 'done'),
            ne(entities.status, 'cancelled'),
          ),
        ),
    ]);
    return {
      facts: factCountRows[0]?.count ?? 0,
      notes: noteCountRows[0]?.count ?? 0,
      relationships: relCountRows[0]?.count ?? 0,
      openTasks: taskCountRows[0]?.count ?? 0,
    };
  }

  const mergeCounts = await countMergeImpact(ids);
  const countEntries = objects.map((object) => [object.id, mergeCounts] as const);
  const countsBySurvivorId = Object.fromEntries(countEntries);
  const counts = countsBySurvivorId[survivor.id] ?? {
    facts: 0,
    notes: 0,
    relationships: 0,
    openTasks: 0,
  };
  const factSamplesByObjectId = await getFactSamples(ids);

  return {
    objects,
    survivorId: survivor.id,
    aliasesToAdd: mergeAliases(survivor, losers).filter(
      (alias) =>
        !survivor.aliases.some((existing) => existing.toLowerCase() === alias.toLowerCase()),
    ),
    factSamplesByObjectId,
    counts,
    countsBySurvivorId,
  };
}

export interface CreateObjectInput {
  type: ObjectType;
  canonicalName: string;
  status?: string;
  stage?: string | null;
  priority?: number | null;
  ownerUserId?: string | null;
  assigneeUserId?: string | null;
  dueAt?: Date | null;
  aliases?: string[];
  metadata?: Record<string, unknown>;
  parentObjectId?: string | null;
  /** Who/what created this. Users go through server actions; agents through
   *  `propose_object_change`/`suggest_task` tools. */
  actor: { kind: ActorKind; userId?: string | null };
}

export async function createObject(
  db: Db,
  scope: TeamScopeCore,
  input: CreateObjectInput,
): Promise<ObjectRow> {
  await scope.requireMembership();
  const name = input.canonicalName.trim();
  if (!name) throw new Error('canonicalName is required');

  // Owner/assignee FK is to `users.id` (system-wide), so the FK alone
  // does not prove team membership. Without this gate an actor (human
  // or agent) could plant a foreign user, and later `updateObject` fan-
  // out would deliver a notification whose summary leaks the entity
  // name to a non-member. Verify membership before the write.
  if (input.ownerUserId) await scope.requireTeamMember(input.ownerUserId);
  if (input.assigneeUserId && input.assigneeUserId !== input.ownerUserId) {
    await scope.requireTeamMember(input.assigneeUserId);
  }

  const txResult = await db.transaction(async (tx) => {
    let primaryProject: { id: string; canonicalName: string } | null = null;
    if (input.parentObjectId !== undefined && input.parentObjectId !== null) {
      if (input.type !== 'task') throw new Error('Only tasks can have a primary project');
      if (!UUID_RE.test(input.parentObjectId)) throw new Error('Invalid project id');
      const [project] = await tx
        .select({ id: entities.id, canonicalName: entities.canonicalName })
        .from(entities)
        .where(
          and(
            eq(entities.id, input.parentObjectId),
            eq(entities.teamId, scope.teamId),
            eq(entities.type, 'project'),
            isNull(entities.archivedAt),
            isNull(entities.mergedIntoId),
          ),
        )
        .limit(1);
      if (!project) throw new Error('Project not found');
      primaryProject = project;
    }
    const taskPacket =
      input.type === 'task'
        ? buildTaskCategoryPacket({
            title: name,
            ...(input.aliases ? { aliases: input.aliases } : {}),
            ...(input.metadata ? { metadata: input.metadata } : {}),
            ...(primaryProject ? { primaryProjectName: primaryProject.canonicalName } : {}),
          })
        : null;
    const requestedCategoryHash = taskPacket
      ? taskCategoryInputHash(taskPacket, TIMELINE_MODELS.taskCategorization.id)
      : null;
    const insertRows = await tx
      .insert(entities)
      .values({
        teamId: scope.teamId,
        type: input.type,
        canonicalName: name,
        status: input.status ?? 'open',
        stage: input.stage ?? null,
        priority: input.priority ?? null,
        ownerUserId: input.ownerUserId ?? null,
        assigneeUserId: input.assigneeUserId ?? null,
        dueAt: input.dueAt ?? null,
        aliases: input.aliases ?? [],
        metadata: input.metadata ?? {},
        sourceEventId: null,
        agentSuggested: false,
        taskCategoryMode: taskPacket ? 'automatic' : null,
        taskCategoryStatus: taskPacket ? 'pending' : null,
        taskCategoryRequestedInputHash: requestedCategoryHash,
        taskCategoryTaxonomyVersion: taskPacket ? TASK_CATEGORY_TAXONOMY_VERSION : null,
        taskCategoryUpdatedAt: taskPacket ? new Date() : null,
      })
      .returning();
    const row = insertRows[0];
    if (!row) throw new Error('Failed to create object');

    // Audit event for the create itself. One row per object, field='__create__'
    // so the UI can group create/edit/archive consistently.
    const rawEventId = randomUUID();
    const eventText = `${input.actor.kind === 'agent' ? 'Agent created' : 'Created'} ${input.type}: ${name}`;
    const eventInsert = await tx
      .insert(rawEvents)
      .values({
        id: rawEventId,
        teamId: scope.teamId,
        authorUserId: input.actor.kind === 'user' ? (input.actor.userId ?? null) : null,
        source: 'system',
        contentText: eventText,
        occurredAt: new Date(),
        visibility: 'team',
        sourceMetadata: systemDirectWriteSourceMetadata({
          rawEventId,
          kind: 'object_create',
          metadata: {
            entity_id: row.id,
            actor_kind: input.actor.kind,
          },
          snapshot: {
            entity_id: row.id,
            object_type: input.type,
            canonical_name: name,
            status: row.status,
            stage: row.stage,
            priority: row.priority,
            owner_user_id: row.ownerUserId,
            assignee_user_id: row.assigneeUserId,
            due_at: row.dueAt?.toISOString() ?? null,
            aliases: row.aliases,
            metadata: row.metadata,
            actor_kind: input.actor.kind,
            actor_user_id: input.actor.userId ?? null,
          },
        }),
      })
      .returning({ id: rawEvents.id });
    const sourceEventId = eventInsert[0]?.id ?? null;
    await normalizeSystemRawEventEvidence({
      db: tx,
      teamId: scope.teamId,
      rawEventId: sourceEventId,
    });
    await reconcileObjectAuditLinks(tx, {
      teamId: scope.teamId,
      rawEventId: sourceEventId,
      text: eventText,
    });

    await tx.insert(objectChanges).values({
      teamId: scope.teamId,
      entityId: row.id,
      actorUserId: input.actor.userId ?? null,
      actorKind: input.actor.kind,
      status: 'applied',
      field: '__create__',
      previousValue: null,
      newValue: { type: input.type, canonicalName: name, status: row.status },
      sourceEventId: null,
    });
    await emitObjectDirectWriteOutput({
      db: tx,
      teamId: scope.teamId,
      entityId: row.id,
      objectType: input.type,
      canonicalName: name,
      actor: input.actor,
      sourceEventId,
      operation: 'create',
      systemEventKind: 'object_create',
    });

    if (primaryProject) {
      // task → parent via `child` edge (the row reads "task is a child of parent")
      const [relationship] = await tx
        .insert(entityRelationships)
        .values({
          teamId: scope.teamId,
          fromEntityId: row.id,
          toEntityId: primaryProject.id,
          kind: 'child',
          createdBy: input.actor.userId ?? null,
        })
        .onConflictDoNothing()
        .returning({ id: entityRelationships.id });
      if (relationship) {
        const relationshipEventId = randomUUID();
        const relationshipText = `Set project for task ${name}: ${primaryProject.canonicalName}`;
        const [relationshipEvent] = await tx
          .insert(rawEvents)
          .values({
            id: relationshipEventId,
            teamId: scope.teamId,
            authorUserId: input.actor.kind === 'user' ? (input.actor.userId ?? null) : null,
            source: 'system',
            contentText: relationshipText,
            occurredAt: new Date(),
            visibility: 'team',
            sourceMetadata: systemDirectWriteSourceMetadata({
              rawEventId: relationshipEventId,
              kind: 'relationship_create',
              metadata: {
                relationship_id: relationship.id,
                task_id: row.id,
                project_id: primaryProject.id,
              },
              snapshot: {
                relationship_id: relationship.id,
                from_entity_id: row.id,
                to_entity_id: primaryProject.id,
                relationship_kind: 'child',
                task_name: name,
                project_name: primaryProject.canonicalName,
                actor_kind: input.actor.kind,
                actor_user_id: input.actor.userId ?? null,
              },
            }),
          })
          .returning({ id: rawEvents.id });
        const relationshipSourceEventId = relationshipEvent?.id ?? null;
        await normalizeSystemRawEventEvidence({
          db: tx,
          teamId: scope.teamId,
          rawEventId: relationshipSourceEventId,
        });
        await reconcileObjectAuditLinks(tx, {
          teamId: scope.teamId,
          rawEventId: relationshipSourceEventId,
          text: relationshipText,
        });
        await tx.insert(objectChanges).values({
          teamId: scope.teamId,
          entityId: row.id,
          actorUserId: input.actor.userId ?? null,
          actorKind: input.actor.kind,
          status: 'applied',
          field: 'primaryProjectId',
          previousValue: null,
          newValue: primaryProject.id,
          sourceEventId: null,
        });
        await emitRelationshipDirectWriteOutput({
          db: tx,
          teamId: scope.teamId,
          relationshipId: relationship.id,
          fromEntityId: row.id,
          toEntityId: primaryProject.id,
          relationshipKind: 'child',
          actor: { kind: input.actor.kind, userId: input.actor.userId ?? null },
          sourceEventId: relationshipSourceEventId,
          operation: 'link',
          systemEventKind: 'relationship_create',
        });
      }
    }

    const dueDateCalendarSync = await syncObjectDueDateCalendarEvent(tx, row);
    await notifyObjectDueDate(tx, row, input.actor);

    return { object: toObjectRow(row), dueDateCalendarSync, requestedCategoryHash };
  });

  // Embed AFTER the transaction commits so the worker (which reads from a
  // separate connection) sees the row. Two points per object: the workspace
  // narrative ('object' scope) and the entity disambiguation text ('entity'
  // scope) — different retrieval modes share the row.
  fireAndForgetEmbed(() => embedQueue.enqueueObjectEmbedJob(scope.teamId, txResult.object.id), {
    teamId: scope.teamId,
    objectId: txResult.object.id,
    op: 'createObject',
  });
  fireAndForgetEmbed(() => embedQueue.enqueueEntityEmbedJob(scope.teamId, txResult.object.id), {
    teamId: scope.teamId,
    entityId: txResult.object.id,
    op: 'createObject',
  });
  refreshObjectAndLinkedParentSummaries(db, scope, txResult.object, {
    teamId: scope.teamId,
    op: 'createObject',
  });
  fireAndForgetEmbed(() => afterDueDateCalendarSync(scope.teamId, txResult.dueDateCalendarSync), {
    teamId: scope.teamId,
    op: 'createObjectDueDateCalendar',
  });
  if (txResult.requestedCategoryHash) {
    const inputHash = txResult.requestedCategoryHash;
    fireAndForgetEmbed(
      async () => {
        await embedQueue.enqueueTaskCategoryJob({
          teamId: scope.teamId,
          taskId: txResult.object.id,
          inputHash,
          trigger: 'create',
        });
      },
      {
        teamId: scope.teamId,
        taskId: txResult.object.id,
        op: 'createObject:taskCategory',
      },
    );
  }
  return txResult.object;
}

export interface UpdateActor {
  kind: ActorKind;
  userId: string | null;
}

/**
 * Apply a patch to an object. Each changed field gets its own immutable
 * `object_changes` row; a single `raw_events` row anchors the whole patch
 * so the timeline shows one entry per save (not one per field). Owner and
 * assignee receive an `object_changed` notification — fan-out is in-process
 * for v1 and out-of-scope for fan-out queues. Returns the updated row plus
 * the list of fields that actually changed (no-op patches return `[]`).
 */
export async function updateObject(
  db: Db,
  scope: TeamScopeCore,
  entityId: string,
  patch: ObjectPatch,
  actor: UpdateActor,
): Promise<{ object: ObjectRow; changedFields: string[] }> {
  await scope.requireMembership();
  if (!UUID_RE.test(entityId)) throw new Error('Invalid entity id');

  // See createObject — owner/assignee FK is system-wide, so verify the
  // referenced user actually belongs to this team before letting an
  // edit reassign to a foreign user. Skip when the patch clears the
  // field (`null`) — that's always safe.
  if (patch.ownerUserId) await scope.requireTeamMember(patch.ownerUserId);
  if (patch.assigneeUserId && patch.assigneeUserId !== patch.ownerUserId) {
    await scope.requireTeamMember(patch.assigneeUserId);
  }

  const txResult = await db.transaction(async (tx) => {
    const currentRows = await tx
      .select()
      .from(entities)
      .where(
        and(
          eq(entities.id, entityId),
          eq(entities.teamId, scope.teamId),
          isNull(entities.mergedIntoId),
        ),
      )
      .for('update')
      .limit(1);
    const currentRow = currentRows[0];
    if (!currentRow) throw new Error('Object not found');
    const current: EntityRow = currentRow;

    const changes: {
      field: string;
      previousValue: unknown;
      newValue: unknown;
    }[] = [];
    const next: Record<string, unknown> = {};

    function diff<K extends keyof EntityRow>(field: K, candidate: EntityRow[K] | undefined): void {
      if (candidate === undefined) return;
      const before = current[field];
      // Date comparison: equal-by-time wins; otherwise stable-stringify so
      // metadata `{a:1,b:2}` and `{b:2,a:1}` aren't reported as a change.
      // A naive JSON.stringify treats key order as significant and would
      // spam `object_changes`/`raw_events` with phantom rows every time
      // the form serializes metadata in a different order.
      const equal =
        before instanceof Date && candidate instanceof Date
          ? before.getTime() === candidate.getTime()
          : stableStringify(before) === stableStringify(candidate);
      if (equal) return;
      changes.push({ field: field, previousValue: before, newValue: candidate });
      next[field] = candidate;
    }

    if (patch.canonicalName !== undefined) {
      const trimmed = patch.canonicalName.trim();
      if (!trimmed) throw new Error('canonicalName cannot be empty');
      diff('canonicalName', trimmed);
    }
    if (patch.status !== undefined) diff('status', patch.status);
    if (patch.stage !== undefined) diff('stage', patch.stage);
    if (patch.priority !== undefined) diff('priority', patch.priority);
    if (patch.ownerUserId !== undefined) diff('ownerUserId', patch.ownerUserId);
    if (patch.assigneeUserId !== undefined) diff('assigneeUserId', patch.assigneeUserId);
    if (patch.dueAt !== undefined) diff('dueAt', patch.dueAt);
    if (patch.aliases !== undefined) diff('aliases', patch.aliases);
    if (patch.metadata !== undefined) diff('metadata', patch.metadata);
    if (patch.archivedAt !== undefined) diff('archivedAt', patch.archivedAt);
    if (patch.type !== undefined) diff('type', patch.type);

    if (changes.length === 0) {
      return {
        object: toObjectRow(current),
        changedFields: [],
        changeIds: [] as string[],
        dueDateCalendarSync: mergeDueDateCalendarSyncResults([]),
        requestedCategoryHash: null as string | null,
        linkedTaskCategoryJobs: [] as { taskId: string; inputHash: string }[],
        linkedTaskCategoryFanout: null as {
          projectId: string;
          projectVersion: string;
          afterTaskId: string;
        } | null,
      };
    }

    let requestedCategoryHash: string | null = null;
    const nextType = (next.type as EntityRow['type'] | undefined) ?? current.type;
    if (current.type === 'project' && nextType !== 'project') {
      const [linkedCount] = await tx
        .select({ total: sql<number>`count(*)::int` })
        .from(entityRelationships)
        .innerJoin(
          entities,
          and(
            eq(entities.teamId, entityRelationships.teamId),
            eq(entities.id, entityRelationships.fromEntityId),
            eq(entities.type, 'task'),
            isNull(entities.mergedIntoId),
          ),
        )
        .where(
          and(
            eq(entityRelationships.teamId, scope.teamId),
            eq(entityRelationships.toEntityId, current.id),
            eq(entityRelationships.kind, 'child'),
          ),
        );
      if ((linkedCount?.total ?? 0) > 0) {
        throw new Error(
          `Reassign or remove ${linkedCount?.total ?? 0} linked task projects before changing this project type`,
        );
      }
    }
    if (current.type === 'task' && nextType !== 'task') {
      Object.assign(next, {
        taskCategory: null,
        taskCategoryMode: null,
        taskCategorySource: null,
        taskCategoryStatus: null,
        taskCategoryAppliedInputHash: null,
        taskCategoryRequestedInputHash: null,
        taskCategoryTaxonomyVersion: null,
        taskCategoryUpdatedAt: null,
      });
    } else if (
      nextType === 'task' &&
      (current.type !== 'task' || current.taskCategoryMode !== 'manual') &&
      (current.type !== 'task' ||
        changes.some((change) =>
          ['canonicalName', 'aliases', 'metadata', 'type'].includes(change.field),
        ))
    ) {
      const packet = await taskCategoryPacketForRow(tx, scope.teamId, {
        id: current.id,
        canonicalName: (next.canonicalName as string | undefined) ?? current.canonicalName,
        aliases: next.aliases ?? current.aliases,
        metadata: next.metadata ?? current.metadata,
      });
      requestedCategoryHash = taskCategoryInputHash(packet, TIMELINE_MODELS.taskCategorization.id);
      Object.assign(next, {
        taskCategoryMode: 'automatic',
        taskCategoryStatus: 'pending',
        taskCategoryRequestedInputHash: requestedCategoryHash,
        taskCategoryTaxonomyVersion: TASK_CATEGORY_TAXONOMY_VERSION,
        taskCategoryUpdatedAt: new Date(),
      });
    }

    const updatedRows = await tx
      .update(entities)
      .set({ ...next, updatedAt: new Date() })
      .where(eq(entities.id, entityId))
      .returning();
    const updated = updatedRows[0];
    if (!updated) throw new Error('Update failed');

    const linkedTaskCategoryJobs: { taskId: string; inputHash: string }[] = [];
    if (updated.type === 'project' && changes.some((change) => change.field === 'canonicalName')) {
      const linkedTasks = await tx
        .select({
          id: entities.id,
          canonicalName: entities.canonicalName,
          aliases: entities.aliases,
          metadata: entities.metadata,
        })
        .from(entityRelationships)
        .innerJoin(
          entities,
          and(
            eq(entities.teamId, entityRelationships.teamId),
            eq(entities.id, entityRelationships.fromEntityId),
            eq(entities.type, 'task'),
            eq(entities.taskCategoryMode, 'automatic'),
            isNull(entities.archivedAt),
            isNull(entities.mergedIntoId),
          ),
        )
        .where(
          and(
            eq(entityRelationships.teamId, scope.teamId),
            eq(entityRelationships.toEntityId, updated.id),
            eq(entityRelationships.kind, 'child'),
          ),
        )
        .orderBy(asc(entities.id))
        .limit(500);
      for (const task of linkedTasks) {
        const packet = buildTaskCategoryPacket({
          title: task.canonicalName,
          aliases: stringArrayFromUnknown(task.aliases),
          metadata: recordFromUnknown(task.metadata),
          primaryProjectName: updated.canonicalName,
        });
        const inputHash = taskCategoryInputHash(packet, TIMELINE_MODELS.taskCategorization.id);
        await tx
          .update(entities)
          .set({
            taskCategoryStatus: 'pending',
            taskCategoryRequestedInputHash: inputHash,
            taskCategoryTaxonomyVersion: TASK_CATEGORY_TAXONOMY_VERSION,
            taskCategoryUpdatedAt: new Date(),
          })
          .where(and(eq(entities.teamId, scope.teamId), eq(entities.id, task.id)));
        linkedTaskCategoryJobs.push({ taskId: task.id, inputHash });
      }
    }
    const linkedTaskCategoryFanout =
      updated.type === 'project' && linkedTaskCategoryJobs.length === 500
        ? {
            projectId: updated.id,
            projectVersion: taskProjectVersion(updated.id, updated.canonicalName),
            afterTaskId: linkedTaskCategoryJobs.at(-1)?.taskId ?? updated.id,
          }
        : null;

    const summary = changes
      .map((c) => `${c.field}: ${JSON.stringify(c.previousValue)} → ${JSON.stringify(c.newValue)}`)
      .join('; ');
    const rawEventId = randomUUID();
    const eventText = `${actor.kind === 'agent' ? 'Agent applied' : 'Updated'} ${updated.type}: ${updated.canonicalName} — ${summary}`;
    const eventInsert = await tx
      .insert(rawEvents)
      .values({
        id: rawEventId,
        teamId: scope.teamId,
        authorUserId: actor.kind === 'user' ? actor.userId : null,
        source: 'system',
        contentText: eventText,
        occurredAt: new Date(),
        visibility: 'team',
        sourceMetadata: systemDirectWriteSourceMetadata({
          rawEventId,
          kind: 'object_update',
          metadata: {
            entity_id: entityId,
            actor_kind: actor.kind,
            changed_fields: changes.map((c) => c.field),
          },
          snapshot: {
            entity_id: entityId,
            object_type: updated.type,
            canonical_name: updated.canonicalName,
            actor_kind: actor.kind,
            actor_user_id: actor.userId ?? null,
            changes,
          },
        }),
      })
      .returning({ id: rawEvents.id });
    const sourceEventId = eventInsert[0]?.id ?? null;
    await normalizeSystemRawEventEvidence({
      db: tx,
      teamId: scope.teamId,
      rawEventId: sourceEventId,
    });
    await reconcileObjectAuditLinks(tx, {
      teamId: scope.teamId,
      rawEventId: sourceEventId,
      text: eventText,
    });

    const changeRows = await tx
      .insert(objectChanges)
      .values(
        changes.map((c) => ({
          teamId: scope.teamId,
          entityId,
          actorUserId: actor.userId,
          actorKind: actor.kind,
          status: 'applied' as const,
          field: c.field,
          previousValue: c.previousValue as never,
          newValue: c.newValue as never,
          sourceEventId: null,
        })),
      )
      .returning({ id: objectChanges.id });
    const reconciliationOperation =
      changes.length === 1 && changes[0]?.field === 'archivedAt' && updated.archivedAt !== null
        ? 'archive_or_cancel'
        : 'update';
    await emitObjectDirectWriteOutput({
      db: tx,
      teamId: scope.teamId,
      entityId,
      objectType: updated.type,
      canonicalName: updated.canonicalName,
      actor,
      sourceEventId,
      operation: reconciliationOperation,
      systemEventKind: 'object_update',
      changedFields: changes.map((c) => c.field),
      changes,
    });

    // Fan out to owner + assignee. The actor shouldn't notify themselves on
    // their own change, so we filter actor.userId out. Dedup by recipient so
    // when owner == assignee they get one row, not two.
    const recipients = new Set<string>();
    if (updated.ownerUserId) recipients.add(updated.ownerUserId);
    if (updated.assigneeUserId) recipients.add(updated.assigneeUserId);
    if (actor.userId) recipients.delete(actor.userId);
    const firstChangeId = changeRows[0]?.id ?? null;
    if (recipients.size > 0 && firstChangeId) {
      await tx.insert(notifications).values(
        Array.from(recipients).map((uid) => ({
          teamId: scope.teamId,
          userId: uid,
          kind: 'object_changed' as const,
          entityId,
          objectChangeId: firstChangeId,
          summary: `${updated.canonicalName}: ${summary}`,
          payload: {
            entity_id: entityId,
            changed_fields: changes.map((c) => c.field),
          },
        })),
      );
    }

    const dueDateRelevantChange = changes.some((c) =>
      [
        'canonicalName',
        'type',
        'status',
        'ownerUserId',
        'assigneeUserId',
        'dueAt',
        'archivedAt',
      ].includes(c.field),
    );
    const dueDateCalendarSyncResults: DueDateCalendarSyncResult[] = [];
    if (dueDateRelevantChange) {
      dueDateCalendarSyncResults.push(await syncObjectDueDateCalendarEvent(tx, updated));
      if (shouldNotifyObjectDueDateOnUpdate(changes, current, updated)) {
        await notifyObjectDueDate(tx, updated, actor);
      }
    }
    if (changes.some((c) => ['canonicalName', 'type', 'archivedAt'].includes(c.field))) {
      const shouldNotifyActiveBoardItems = changes.some((c) => c.field === 'canonicalName');
      dueDateCalendarSyncResults.push(
        await syncBoardItemDueDatesForObject(tx, scope, updated, {
          actor,
          notifyActive:
            shouldNotifyActiveBoardItems ||
            (current.archivedAt !== null &&
              updated.archivedAt === null &&
              changes.some((c) => c.field === 'archivedAt')),
        }),
      );
    }

    return {
      object: toObjectRow(updated),
      changedFields: changes.map((c) => c.field),
      changeIds: changeRows.map((r) => r.id),
      dueDateCalendarSync: mergeDueDateCalendarSyncResults(dueDateCalendarSyncResults),
      requestedCategoryHash,
      linkedTaskCategoryJobs,
      linkedTaskCategoryFanout,
    };
  });

  // Re-embed object + entity on every update — the narrative text bakes in
  // status/stage/owner/etc., so any patch can shift the vector. Skip when
  // the patch was a no-op (no actual changes).
  if (txResult.changedFields.length > 0) {
    fireAndForgetEmbed(() => embedQueue.enqueueObjectEmbedJob(scope.teamId, entityId), {
      teamId: scope.teamId,
      objectId: entityId,
      op: 'updateObject',
    });
    // Only re-embed entity when its text inputs (canonicalName/aliases/type)
    // actually changed — those drive the entity disambiguation point. A
    // pure status flip doesn't need a new entity vector.
    const entityFieldChanged = txResult.changedFields.some(
      (f) => f === 'canonicalName' || f === 'aliases' || f === 'type',
    );
    if (entityFieldChanged) {
      fireAndForgetEmbed(() => embedQueue.enqueueEntityEmbedJob(scope.teamId, entityId), {
        teamId: scope.teamId,
        entityId,
        op: 'updateObject',
      });
    }
    for (const changeId of txResult.changeIds) {
      fireAndForgetEmbed(() => embedQueue.enqueueObjectChangeEmbedJob(scope.teamId, changeId), {
        teamId: scope.teamId,
        changeId,
        op: 'updateObject',
      });
    }
    refreshObjectAndLinkedParentSummaries(db, scope, txResult.object, {
      teamId: scope.teamId,
      op: 'updateObject',
    });
  }
  fireAndForgetEmbed(() => afterDueDateCalendarSync(scope.teamId, txResult.dueDateCalendarSync), {
    teamId: scope.teamId,
    op: 'updateObjectDueDateCalendar',
  });
  if (txResult.requestedCategoryHash) {
    await embedQueue.enqueueTaskCategoryJob({
      teamId: scope.teamId,
      taskId: entityId,
      inputHash: txResult.requestedCategoryHash,
      trigger: 'context_change',
    });
  }
  for (const job of txResult.linkedTaskCategoryJobs) {
    await embedQueue.enqueueTaskCategoryJob({
      teamId: scope.teamId,
      taskId: job.taskId,
      inputHash: job.inputHash,
      trigger: 'project_change',
    });
  }
  if (txResult.linkedTaskCategoryFanout) {
    await embedQueue.enqueueTaskCategoryJob({
      kind: 'project_fanout',
      teamId: scope.teamId,
      ...txResult.linkedTaskCategoryFanout,
    });
  }
  return { object: txResult.object, changedFields: txResult.changedFields };
}

export async function archiveObject(
  db: Db,
  scope: TeamScopeCore,
  entityId: string,
  actor: UpdateActor,
): Promise<ObjectRow & { changedFields: string[] }> {
  await scope.requireMembership();
  const [current] = await db
    .select()
    .from(entities)
    .where(
      and(
        eq(entities.id, entityId),
        eq(entities.teamId, scope.teamId),
        isNull(entities.mergedIntoId),
      ),
    )
    .limit(1);
  if (!current) throw new Error('Object not found');
  if (current.archivedAt) return { ...toObjectRow(current), changedFields: [] };

  const result = await updateObject(db, scope, entityId, { archivedAt: new Date() }, actor);
  return { ...result.object, changedFields: result.changedFields };
}

export async function unarchiveObject(
  db: Db,
  scope: TeamScopeCore,
  entityId: string,
  actor: UpdateActor,
): Promise<ObjectRow> {
  const result = await updateObject(db, scope, entityId, { archivedAt: null }, actor);
  return result.object;
}

export async function mergeObjects(
  db: Db,
  scope: TeamScopeCore,
  input: { survivorId: string; mergedIds: string[]; actor: UpdateActor },
): Promise<{ survivor: ObjectRow; mergedIds: string[] }> {
  await scope.requireMembership();
  const requestedMergedIds = Array.from(new Set(input.mergedIds)).filter(
    (id) => id !== input.survivorId,
  );
  const ids = [input.survivorId, ...requestedMergedIds];
  if (!ids.every((id) => UUID_RE.test(id))) throw new Error('Invalid entity id');
  if (ids.length < 2) throw new Error('Select at least two objects to merge');
  if (ids.length > 10) throw new Error('Merge at most 10 objects at once');

  const result = await db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(entities)
      .where(and(eq(entities.teamId, scope.teamId), inArray(entities.id, ids)))
      .for('update');
    if (rows.length !== ids.length) throw new Error('One or more objects no longer exists');
    if (rows.some((row) => row.mergedIntoId))
      throw new Error('Merged objects cannot be merged again');

    const objects = rows.map(toObjectRow);
    if (!canMergeTypes(objects)) {
      throw new Error('Only same-type objects can be merged, except company/vendor cleanup');
    }
    const survivor = objects.find((row) => row.id === input.survivorId);
    if (!survivor) throw new Error('Survivor object not found');
    const objectsById = new Map(objects.map((row) => [row.id, row]));
    const losers = requestedMergedIds
      .map((id) => objectsById.get(id))
      .filter((row): row is ObjectRow => row !== undefined);
    const loserIds = losers.map((row) => row.id);
    const nextAliases = mergeAliases(survivor, losers);

    const relationships = await tx
      .select()
      .from(entityRelationships)
      .where(
        and(
          eq(entityRelationships.teamId, scope.teamId),
          or(
            inArray(entityRelationships.fromEntityId, loserIds),
            inArray(entityRelationships.toEntityId, loserIds),
          ),
        ),
      );
    for (const rel of relationships) {
      const rawNextFrom = loserIds.includes(rel.fromEntityId) ? survivor.id : rel.fromEntityId;
      const rawNextTo = loserIds.includes(rel.toEntityId) ? survivor.id : rel.toEntityId;
      const { fromEntityId: nextFrom, toEntityId: nextTo } = canonicalRelationshipEndpoints(
        rawNextFrom,
        rawNextTo,
        rel.kind,
      );
      if (nextFrom === nextTo) {
        await tx.delete(entityRelationships).where(eq(entityRelationships.id, rel.id));
        continue;
      }
      const existing = await tx
        .select({ id: entityRelationships.id })
        .from(entityRelationships)
        .where(
          and(
            eq(entityRelationships.teamId, scope.teamId),
            eq(entityRelationships.fromEntityId, nextFrom),
            eq(entityRelationships.toEntityId, nextTo),
            eq(entityRelationships.kind, rel.kind),
            ne(entityRelationships.id, rel.id),
          ),
        )
        .limit(1);
      if (existing[0]) {
        await tx.delete(entityRelationships).where(eq(entityRelationships.id, rel.id));
      } else {
        await tx
          .update(entityRelationships)
          .set({ fromEntityId: nextFrom, toEntityId: nextTo })
          .where(eq(entityRelationships.id, rel.id));
      }
    }

    await tx.execute(sql`
      DELETE FROM ${factEntities} AS loser
      USING ${factEntities} AS keeper
      WHERE loser.entity_id IN (${sql.join(
        loserIds.map((id) => sql`${id}`),
        sql`, `,
      )})
        AND keeper.entity_id = ${survivor.id}
        AND keeper.fact_id = loser.fact_id
        AND keeper.role = loser.role
    `);
    await tx
      .update(factEntities)
      .set({ entityId: survivor.id })
      .where(inArray(factEntities.entityId, loserIds));

    await tx
      .update(objectNotes)
      .set({ entityId: survivor.id })
      .where(and(eq(objectNotes.teamId, scope.teamId), inArray(objectNotes.entityId, loserIds)));
    await tx
      .update(objectChanges)
      .set({ entityId: survivor.id })
      .where(
        and(eq(objectChanges.teamId, scope.teamId), inArray(objectChanges.entityId, loserIds)),
      );
    await tx
      .update(notifications)
      .set({ entityId: survivor.id })
      .where(
        and(eq(notifications.teamId, scope.teamId), inArray(notifications.entityId, loserIds)),
      );
    await tx
      .update(chatSessions)
      .set({ pinnedEntityId: survivor.id })
      .where(
        and(eq(chatSessions.teamId, scope.teamId), inArray(chatSessions.pinnedEntityId, loserIds)),
      );
    await tx.execute(sql`
      DELETE FROM ${calendarEventEntities} AS loser
      USING ${calendarEventEntities} AS keeper
      WHERE loser.team_id = ${scope.teamId}
        AND loser.entity_id IN (${sql.join(
          loserIds.map((id) => sql`${id}`),
          sql`, `,
        )})
        AND keeper.team_id = loser.team_id
        AND keeper.calendar_event_id = loser.calendar_event_id
        AND keeper.entity_id = ${survivor.id}
    `);
    await tx
      .update(calendarEventEntities)
      .set({ entityId: survivor.id })
      .where(
        and(
          eq(calendarEventEntities.teamId, scope.teamId),
          inArray(calendarEventEntities.entityId, loserIds),
        ),
      );

    const now = new Date();
    const dueDateCalendarSyncResults: DueDateCalendarSyncResult[] = [];
    const loserBoardItems = await tx
      .select({ item: boardItems, board: boards })
      .from(boardItems)
      .innerJoin(boards, eq(boardItems.boardId, boards.id))
      .where(and(eq(boardItems.teamId, scope.teamId), inArray(boardItems.entityId, loserIds)));
    for (const { item, board } of loserBoardItems) {
      if (item.archivedAt) {
        const updatedItem = { ...item, entityId: survivor.id, updatedAt: now };
        await tx
          .update(boardItems)
          .set({ entityId: updatedItem.entityId, updatedAt: updatedItem.updatedAt })
          .where(and(eq(boardItems.id, item.id), eq(boardItems.teamId, scope.teamId)));
        dueDateCalendarSyncResults.push(
          await syncBoardItemDueDateCalendarEvent(tx, updatedItem, survivor, board),
        );
        continue;
      }

      const duplicateActive = await tx
        .select({ id: boardItems.id })
        .from(boardItems)
        .where(
          and(
            eq(boardItems.teamId, scope.teamId),
            eq(boardItems.boardId, item.boardId),
            eq(boardItems.entityId, survivor.id),
            isNull(boardItems.archivedAt),
          ),
        )
        .limit(1);
      if (duplicateActive[0]) {
        const updatedItem = { ...item, entityId: survivor.id, archivedAt: now, updatedAt: now };
        await tx
          .update(boardItems)
          .set({
            entityId: updatedItem.entityId,
            archivedAt: updatedItem.archivedAt,
            updatedAt: updatedItem.updatedAt,
          })
          .where(and(eq(boardItems.id, item.id), eq(boardItems.teamId, scope.teamId)));
        dueDateCalendarSyncResults.push(
          await syncBoardItemDueDateCalendarEvent(tx, updatedItem, survivor, board),
        );
      } else {
        const updatedItem = { ...item, entityId: survivor.id, updatedAt: now };
        await tx
          .update(boardItems)
          .set({ entityId: updatedItem.entityId, updatedAt: updatedItem.updatedAt })
          .where(and(eq(boardItems.id, item.id), eq(boardItems.teamId, scope.teamId)));
        dueDateCalendarSyncResults.push(
          await syncBoardItemDueDateCalendarEvent(tx, updatedItem, survivor, board),
        );
      }
    }
    await tx
      .update(boardItemChanges)
      .set({ entityId: survivor.id })
      .where(
        and(
          eq(boardItemChanges.teamId, scope.teamId),
          inArray(boardItemChanges.entityId, loserIds),
        ),
      );

    const views = await tx
      .select()
      .from(objectViews)
      .where(and(eq(objectViews.teamId, scope.teamId), inArray(objectViews.entityId, loserIds)));
    for (const view of views) {
      const existing = await tx
        .select()
        .from(objectViews)
        .where(
          and(
            eq(objectViews.teamId, scope.teamId),
            eq(objectViews.userId, view.userId),
            eq(objectViews.entityId, survivor.id),
          ),
        )
        .limit(1);
      if (existing[0]) {
        const lastVisitedAt =
          existing[0].lastVisitedAt.getTime() > view.lastVisitedAt.getTime()
            ? existing[0].lastVisitedAt
            : view.lastVisitedAt;
        await tx
          .update(objectViews)
          .set({ lastVisitedAt })
          .where(
            and(
              eq(objectViews.teamId, scope.teamId),
              eq(objectViews.userId, view.userId),
              eq(objectViews.entityId, survivor.id),
            ),
          );
        await tx
          .delete(objectViews)
          .where(
            and(
              eq(objectViews.teamId, scope.teamId),
              eq(objectViews.userId, view.userId),
              eq(objectViews.entityId, view.entityId),
            ),
          );
      } else {
        await tx
          .update(objectViews)
          .set({ entityId: survivor.id })
          .where(
            and(
              eq(objectViews.teamId, scope.teamId),
              eq(objectViews.userId, view.userId),
              eq(objectViews.entityId, view.entityId),
            ),
          );
      }
    }

    const facets = await tx
      .select()
      .from(objectIdentityFacets)
      .where(
        and(
          eq(objectIdentityFacets.teamId, scope.teamId),
          inArray(objectIdentityFacets.entityId, loserIds),
        ),
      );
    for (const facet of facets) {
      const duplicateConditions = [
        and(
          eq(objectIdentityFacets.status, 'approved'),
          eq(objectIdentityFacets.kind, facet.kind),
          eq(objectIdentityFacets.normalizedValue, facet.normalizedValue),
        ),
      ];
      if (facet.externalId) {
        duplicateConditions.push(
          and(
            eq(objectIdentityFacets.status, 'approved'),
            eq(objectIdentityFacets.kind, facet.kind),
            facet.provider
              ? eq(objectIdentityFacets.provider, facet.provider)
              : isNull(objectIdentityFacets.provider),
            eq(objectIdentityFacets.externalId, facet.externalId),
          ),
        );
      }
      if (facet.kind === 'timeline_user' && facet.linkedUserId) {
        duplicateConditions.push(
          and(
            eq(objectIdentityFacets.status, 'approved'),
            eq(objectIdentityFacets.kind, 'timeline_user'),
            eq(objectIdentityFacets.linkedUserId, facet.linkedUserId),
          ),
        );
      }
      const duplicate = await tx
        .select({ id: objectIdentityFacets.id })
        .from(objectIdentityFacets)
        .where(
          and(
            eq(objectIdentityFacets.teamId, scope.teamId),
            eq(objectIdentityFacets.entityId, survivor.id),
            or(...duplicateConditions),
          ),
        )
        .limit(1);
      if (duplicate[0]) {
        await tx
          .update(objectIdentityFacets)
          .set({ status: 'archived', archivedAt: new Date(), updatedAt: new Date() })
          .where(eq(objectIdentityFacets.id, facet.id));
      } else {
        await tx
          .update(objectIdentityFacets)
          .set({ entityId: survivor.id, updatedAt: new Date() })
          .where(eq(objectIdentityFacets.id, facet.id));
      }
    }

    const rawEventId = randomUUID();
    const eventText = `Merged ${losers.map((row) => row.canonicalName).join(', ')} into ${survivor.canonicalName}`;
    const eventInsert = await tx
      .insert(rawEvents)
      .values({
        id: rawEventId,
        teamId: scope.teamId,
        authorUserId: input.actor.kind === 'user' ? input.actor.userId : null,
        source: 'system',
        contentText: eventText,
        occurredAt: new Date(),
        visibility: 'team',
        sourceMetadata: systemDirectWriteSourceMetadata({
          rawEventId,
          kind: 'object_merge',
          metadata: {
            entity_id: survivor.id,
            merged_entity_ids: loserIds,
            actor_kind: input.actor.kind,
          },
          snapshot: {
            entity_id: survivor.id,
            object_type: survivor.type,
            canonical_name: survivor.canonicalName,
            merged_entity_ids: loserIds,
            merged_objects: losers.map((loser) => ({
              id: loser.id,
              canonicalName: loser.canonicalName,
              type: loser.type,
            })),
            aliases: nextAliases,
            actor_kind: input.actor.kind,
            actor_user_id: input.actor.userId ?? null,
          },
        }),
      })
      .returning({ id: rawEvents.id });
    const sourceEventId = eventInsert[0]?.id ?? null;
    await normalizeSystemRawEventEvidence({
      db: tx,
      teamId: scope.teamId,
      rawEventId: sourceEventId,
    });
    await reconcileObjectAuditLinks(tx, {
      teamId: scope.teamId,
      rawEventId: sourceEventId,
      text: eventText,
    });

    await tx
      .update(entities)
      .set({ aliases: nextAliases, updatedAt: new Date() })
      .where(eq(entities.id, survivor.id));
    await tx
      .update(entities)
      .set({ mergedIntoId: survivor.id, updatedAt: new Date() })
      .where(and(eq(entities.teamId, scope.teamId), inArray(entities.id, loserIds)));
    dueDateCalendarSyncResults.push(
      await tombstoneObjectDueDateCalendarEventsForEntities(tx, {
        teamId: scope.teamId,
        entityIds: loserIds,
      }),
    );

    await tx.insert(objectChanges).values([
      {
        teamId: scope.teamId,
        entityId: survivor.id,
        actorUserId: input.actor.userId,
        actorKind: input.actor.kind,
        status: 'applied',
        field: '__merge__',
        previousValue: null,
        newValue: {
          survivor_id: survivor.id,
          merged_entity_ids: loserIds,
          aliases: nextAliases,
        },
        sourceEventId: null,
      },
      ...losers.map((loser) => ({
        teamId: scope.teamId,
        entityId: survivor.id,
        actorUserId: input.actor.userId,
        actorKind: input.actor.kind,
        status: 'applied' as const,
        field: '__merged_from__',
        previousValue: { id: loser.id, canonicalName: loser.canonicalName, type: loser.type },
        newValue: { mergedIntoId: survivor.id },
        sourceEventId: null,
      })),
    ]);
    await emitObjectDirectWriteOutput({
      db: tx,
      teamId: scope.teamId,
      entityId: survivor.id,
      objectType: survivor.type,
      canonicalName: survivor.canonicalName,
      actor: input.actor,
      sourceEventId,
      operation: 'merge',
      systemEventKind: 'object_merge',
      merge: {
        mergedEntityIds: loserIds,
        mergedObjects: losers.map((loser) => ({
          id: loser.id,
          canonicalName: loser.canonicalName,
          type: loser.type,
        })),
        aliases: nextAliases,
      },
    });

    const linkedTaskCategoryJobs: { taskId: string; inputHash: string }[] = [];
    if (survivor.type === 'project') {
      const linkedTasks = await tx
        .select({
          id: entities.id,
          canonicalName: entities.canonicalName,
          aliases: entities.aliases,
          metadata: entities.metadata,
        })
        .from(entityRelationships)
        .innerJoin(
          entities,
          and(
            eq(entities.teamId, entityRelationships.teamId),
            eq(entities.id, entityRelationships.fromEntityId),
            eq(entities.type, 'task'),
            eq(entities.taskCategoryMode, 'automatic'),
            isNull(entities.archivedAt),
            isNull(entities.mergedIntoId),
          ),
        )
        .where(
          and(
            eq(entityRelationships.teamId, scope.teamId),
            eq(entityRelationships.toEntityId, survivor.id),
            eq(entityRelationships.kind, 'child'),
          ),
        )
        .orderBy(asc(entities.id))
        .limit(500);
      for (const task of linkedTasks) {
        const packet = buildTaskCategoryPacket({
          title: task.canonicalName,
          aliases: stringArrayFromUnknown(task.aliases),
          metadata: recordFromUnknown(task.metadata),
          primaryProjectName: survivor.canonicalName,
        });
        const inputHash = taskCategoryInputHash(packet, TIMELINE_MODELS.taskCategorization.id);
        await tx
          .update(entities)
          .set({
            taskCategoryStatus: 'pending',
            taskCategoryRequestedInputHash: inputHash,
            taskCategoryTaxonomyVersion: TASK_CATEGORY_TAXONOMY_VERSION,
            taskCategoryUpdatedAt: new Date(),
          })
          .where(and(eq(entities.teamId, scope.teamId), eq(entities.id, task.id)));
        linkedTaskCategoryJobs.push({ taskId: task.id, inputHash });
      }
    }
    const linkedTaskCategoryFanout =
      survivor.type === 'project' && linkedTaskCategoryJobs.length === 500
        ? {
            projectId: survivor.id,
            projectVersion: taskProjectVersion(survivor.id, survivor.canonicalName),
            afterTaskId: linkedTaskCategoryJobs.at(-1)?.taskId ?? survivor.id,
          }
        : null;

    const updatedRows = await tx
      .select()
      .from(entities)
      .where(eq(entities.id, survivor.id))
      .limit(1);
    const updated = updatedRows[0];
    if (!updated) throw new Error('Merge failed');
    return {
      survivor: toObjectRow(updated),
      mergedIds: loserIds,
      dueDateCalendarSync: mergeDueDateCalendarSyncResults(dueDateCalendarSyncResults),
      linkedTaskCategoryJobs,
      linkedTaskCategoryFanout,
    };
  });

  fireAndForgetEmbed(() => afterDueDateCalendarSync(scope.teamId, result.dueDateCalendarSync), {
    teamId: scope.teamId,
    op: 'mergeObjectsDueDateCalendar',
  });
  fireAndForgetEmbed(() => embedQueue.enqueueObjectEmbedJob(scope.teamId, result.survivor.id), {
    teamId: scope.teamId,
    objectId: result.survivor.id,
    op: 'mergeObjects',
  });
  fireAndForgetEmbed(() => embedQueue.enqueueEntityEmbedJob(scope.teamId, result.survivor.id), {
    teamId: scope.teamId,
    entityId: result.survivor.id,
    op: 'mergeObjects',
  });
  void fireAndForgetObjectSummaryRefresh(db, scope, result.survivor.id, {
    teamId: scope.teamId,
    objectId: result.survivor.id,
    op: 'mergeObjects',
  });
  for (const mergedId of result.mergedIds) {
    fireAndForgetEmbed(() => deleteMergedObjectEmbeddingPoints(scope.teamId, mergedId), {
      teamId: scope.teamId,
      entityId: mergedId,
      op: 'mergeObjects:deleteMergedEmbeddings',
    });
  }
  for (const job of result.linkedTaskCategoryJobs) {
    await embedQueue.enqueueTaskCategoryJob({
      teamId: scope.teamId,
      taskId: job.taskId,
      inputHash: job.inputHash,
      trigger: 'project_change',
    });
  }
  if (result.linkedTaskCategoryFanout) {
    await embedQueue.enqueueTaskCategoryJob({
      kind: 'project_fanout',
      teamId: scope.teamId,
      ...result.linkedTaskCategoryFanout,
    });
  }
  return result;
}

export async function addRelationship(
  db: Db,
  scope: TeamScopeCore,
  input: {
    fromEntityId: string;
    toEntityId: string;
    kind: RelationshipKind;
    actorUserId: string | null;
    // Optional so existing user-driven callers (server actions) keep working
    // without passing an actor. Agent tools that call this helper should pass
    // `{ kind: 'agent', userId: null }` so the audit row attributes the link
    // to the agent, not a user.
    actor?: UpdateActor;
    metadata?: Record<string, unknown>;
  },
): Promise<{ id: string } | null> {
  await scope.requireMembership();
  if (!UUID_RE.test(input.fromEntityId) || !UUID_RE.test(input.toEntityId)) {
    throw new Error('Invalid entity id');
  }
  if (input.fromEntityId === input.toEntityId) {
    throw new Error('Cannot link an object to itself');
  }
  const endpoints = canonicalRelationshipEndpoints(
    input.fromEntityId,
    input.toEntityId,
    input.kind,
  );

  const result = await db.transaction(async (tx) => {
    // Both endpoints must belong to this team. Re-select to validate.
    const ends = await tx
      .select({
        id: entities.id,
        canonicalName: entities.canonicalName,
        type: entities.type,
        aliases: entities.aliases,
        metadata: entities.metadata,
        taskCategoryMode: entities.taskCategoryMode,
      })
      .from(entities)
      .where(
        and(
          eq(entities.teamId, scope.teamId),
          inArray(entities.id, [endpoints.fromEntityId, endpoints.toEntityId]),
          isNull(entities.mergedIntoId),
        ),
      );
    if (ends.length !== 2) throw new Error('Both objects must belong to this team');

    const from = ends.find((row) => row.id === endpoints.fromEntityId);
    const to = ends.find((row) => row.id === endpoints.toEntityId);
    const isTaskProjectHierarchy =
      (input.kind === 'child' && from?.type === 'task' && to?.type === 'project') ||
      (input.kind === 'parent' && from?.type === 'project' && to?.type === 'task');
    if (isTaskProjectHierarchy) {
      throw new Error('Use the task Project field to manage a primary project');
    }

    const inserted = await tx
      .insert(entityRelationships)
      .values({
        teamId: scope.teamId,
        fromEntityId: endpoints.fromEntityId,
        toEntityId: endpoints.toEntityId,
        kind: input.kind,
        createdBy: input.actorUserId,
      })
      .onConflictDoNothing()
      .returning({ id: entityRelationships.id });
    const row = inserted[0] ?? null;
    // onConflictDoNothing returns nothing on a duplicate; skip audit writes
    // in that case — the relationship already existed and the prior insert
    // logged it. Mirrors the email-event dedup path.
    if (!row) {
      const existing = await tx
        .select({ id: entityRelationships.id })
        .from(entityRelationships)
        .where(
          and(
            eq(entityRelationships.teamId, scope.teamId),
            eq(entityRelationships.fromEntityId, endpoints.fromEntityId),
            eq(entityRelationships.toEntityId, endpoints.toEntityId),
            eq(entityRelationships.kind, input.kind),
          ),
        )
        .limit(1);
      return existing[0] ?? null;
    }

    const fromEnt = ends.find((e) => e.id === endpoints.fromEntityId);
    const toEnt = ends.find((e) => e.id === endpoints.toEntityId);
    const summary = `Linked ${fromEnt?.canonicalName ?? endpoints.fromEntityId} → ${toEnt?.canonicalName ?? endpoints.toEntityId} (${input.kind})`;

    const rawEventId = randomUUID();
    const ev = await tx
      .insert(rawEvents)
      .values({
        id: rawEventId,
        teamId: scope.teamId,
        authorUserId: input.actorUserId,
        source: 'system',
        contentText: summary,
        occurredAt: new Date(),
        visibility: 'team',
        sourceMetadata: systemDirectWriteSourceMetadata({
          rawEventId,
          kind: 'relationship_create',
          metadata: {
            ...(input.metadata ?? {}),
            relationship_id: row.id,
            from_entity_id: endpoints.fromEntityId,
            to_entity_id: endpoints.toEntityId,
            relationship_kind: input.kind,
          },
          snapshot: {
            relationship_id: row.id,
            from_entity_id: endpoints.fromEntityId,
            from_canonical_name: fromEnt?.canonicalName ?? null,
            to_entity_id: endpoints.toEntityId,
            to_canonical_name: toEnt?.canonicalName ?? null,
            relationship_kind: input.kind,
            actor_kind: input.actor?.kind ?? 'user',
            actor_user_id: input.actor?.userId ?? input.actorUserId,
          },
        }),
      })
      .returning({ id: rawEvents.id });
    const sourceEventId = ev[0]?.id ?? null;
    await normalizeSystemRawEventEvidence({
      db: tx,
      teamId: scope.teamId,
      rawEventId: sourceEventId,
    });
    await reconcileObjectAuditLinks(tx, {
      teamId: scope.teamId,
      rawEventId: sourceEventId,
      text: summary,
    });

    // Write one object_change row per endpoint so both object pages surface
    // the link in their "Recent changes" pane. Newer-first sorts naturally.
    await tx.insert(objectChanges).values([
      {
        teamId: scope.teamId,
        entityId: endpoints.fromEntityId,
        actorUserId: input.actor?.userId ?? input.actorUserId,
        actorKind: input.actor?.kind ?? 'user',
        status: 'applied',
        field: '__relationship_create__',
        previousValue: null,
        newValue: { relationship_id: row.id, to: endpoints.toEntityId, kind: input.kind },
        sourceEventId: null,
      },
      {
        teamId: scope.teamId,
        entityId: endpoints.toEntityId,
        actorUserId: input.actor?.userId ?? input.actorUserId,
        actorKind: input.actor?.kind ?? 'user',
        status: 'applied',
        field: '__relationship_create__',
        previousValue: null,
        newValue: { relationship_id: row.id, from: endpoints.fromEntityId, kind: input.kind },
        sourceEventId: null,
      },
    ]);
    await emitRelationshipDirectWriteOutput({
      db: tx,
      teamId: scope.teamId,
      relationshipId: row.id,
      fromEntityId: endpoints.fromEntityId,
      toEntityId: endpoints.toEntityId,
      relationshipKind: input.kind,
      actor: {
        kind: input.actor?.kind ?? 'user',
        userId: input.actor?.userId ?? input.actorUserId,
      },
      sourceEventId,
      operation: 'link',
      systemEventKind: 'relationship_create',
    });

    return row;
  });
  if (result) {
    for (const objectId of [endpoints.fromEntityId, endpoints.toEntityId]) {
      void fireAndForgetObjectSummaryRefresh(db, scope, objectId, {
        teamId: scope.teamId,
        objectId,
        relationshipId: result.id,
        op: 'addRelationship',
      });
    }
  }
  return result;
}

export async function listPrimaryProjectsForTasks(
  db: Db,
  scope: TeamScopeCore,
  taskIds: string[],
): Promise<TaskPrimaryProjectRow[]> {
  await scope.requireMembership();
  const ids = Array.from(new Set(taskIds.filter((id) => UUID_RE.test(id)))).slice(0, 500);
  if (ids.length === 0) return [];
  return db
    .select({
      taskId: entityRelationships.fromEntityId,
      projectId: entities.id,
      projectName: entities.canonicalName,
      archivedAt: entities.archivedAt,
    })
    .from(entityRelationships)
    .innerJoin(
      entities,
      and(
        eq(entities.teamId, entityRelationships.teamId),
        eq(entities.id, entityRelationships.toEntityId),
      ),
    )
    .where(
      and(
        eq(entityRelationships.teamId, scope.teamId),
        inArray(entityRelationships.fromEntityId, ids),
        eq(entityRelationships.kind, 'child'),
        eq(entities.type, 'project'),
        isNull(entities.mergedIntoId),
      ),
    )
    .orderBy(asc(entityRelationships.createdAt), asc(entityRelationships.id));
}

export async function setTaskProject(
  db: Db,
  scope: TeamScopeCore,
  taskId: string,
  projectId: string | null,
  actor: UpdateActor,
): Promise<{ changed: boolean; project: TaskPrimaryProjectRow | null; touchedIds: string[] }> {
  await scope.requireMembership();
  if (!UUID_RE.test(taskId) || (projectId !== null && !UUID_RE.test(projectId))) {
    throw new Error('Invalid entity id');
  }

  const result = await db.transaction(async (tx) => {
    const [task] = await tx
      .select({
        id: entities.id,
        canonicalName: entities.canonicalName,
        type: entities.type,
        aliases: entities.aliases,
        metadata: entities.metadata,
        taskCategoryMode: entities.taskCategoryMode,
      })
      .from(entities)
      .where(
        and(
          eq(entities.teamId, scope.teamId),
          eq(entities.id, taskId),
          isNull(entities.mergedIntoId),
          isNull(entities.archivedAt),
        ),
      )
      .for('update')
      .limit(1);
    if (task?.type !== 'task') throw new Error('Task not found');

    const project = projectId
      ? (
          await tx
            .select({
              id: entities.id,
              canonicalName: entities.canonicalName,
              archivedAt: entities.archivedAt,
              type: entities.type,
            })
            .from(entities)
            .where(
              and(
                eq(entities.teamId, scope.teamId),
                eq(entities.id, projectId),
                eq(entities.type, 'project'),
                isNull(entities.mergedIntoId),
                isNull(entities.archivedAt),
              ),
            )
            .limit(1)
        )[0]
      : null;
    if (projectId && !project) throw new Error('Project not found');

    const existing = await tx
      .select({
        id: entityRelationships.id,
        projectId: entityRelationships.toEntityId,
        projectName: entities.canonicalName,
      })
      .from(entityRelationships)
      .innerJoin(
        entities,
        and(
          eq(entities.teamId, entityRelationships.teamId),
          eq(entities.id, entityRelationships.toEntityId),
          eq(entities.type, 'project'),
        ),
      )
      .where(
        and(
          eq(entityRelationships.teamId, scope.teamId),
          eq(entityRelationships.fromEntityId, taskId),
          eq(entityRelationships.kind, 'child'),
          isNull(entities.mergedIntoId),
        ),
      )
      .for('update');

    if (existing.length === 1 && existing[0]?.projectId === projectId) {
      return {
        changed: false,
        project: project
          ? {
              taskId,
              projectId: project.id,
              projectName: project.canonicalName,
              archivedAt: project.archivedAt,
            }
          : null,
        touchedIds: [] as string[],
        requestedCategoryHash: null as string | null,
      };
    }

    if (existing.length > 0) {
      await tx.delete(entityRelationships).where(
        inArray(
          entityRelationships.id,
          existing.map((row) => row.id),
        ),
      );
    }

    const [created] = project
      ? await tx
          .insert(entityRelationships)
          .values({
            teamId: scope.teamId,
            fromEntityId: taskId,
            toEntityId: project.id,
            kind: 'child',
            createdBy: actor.userId,
          })
          .returning({ id: entityRelationships.id })
      : [];

    const previous = existing.map((row) => ({ id: row.projectId, name: row.projectName }));
    const eventText = project
      ? `Set project for task ${task.canonicalName}: ${project.canonicalName}`
      : `Removed project from task ${task.canonicalName}`;
    const rawEventId = randomUUID();
    const [event] = await tx
      .insert(rawEvents)
      .values({
        id: rawEventId,
        teamId: scope.teamId,
        authorUserId: actor.kind === 'user' ? actor.userId : null,
        source: 'system',
        contentText: eventText,
        occurredAt: new Date(),
        visibility: 'team',
        sourceMetadata: systemDirectWriteSourceMetadata({
          rawEventId,
          kind: project ? 'relationship_create' : 'relationship_delete',
          metadata: {
            task_id: taskId,
            previous_project_ids: previous.map((row) => row.id),
            project_id: project?.id ?? null,
          },
          snapshot: {
            task_id: taskId,
            task_name: task.canonicalName,
            previous_projects: previous,
            project_id: project?.id ?? null,
            project_name: project?.canonicalName ?? null,
            actor_kind: actor.kind,
            actor_user_id: actor.userId,
          },
        }),
      })
      .returning({ id: rawEvents.id });
    const sourceEventId = event?.id ?? null;
    await normalizeSystemRawEventEvidence({
      db: tx,
      teamId: scope.teamId,
      rawEventId: sourceEventId,
    });
    await reconcileObjectAuditLinks(tx, {
      teamId: scope.teamId,
      rawEventId: sourceEventId,
      text: eventText,
    });

    await tx.insert(objectChanges).values({
      teamId: scope.teamId,
      entityId: taskId,
      actorUserId: actor.userId,
      actorKind: actor.kind,
      status: 'applied',
      field: 'primaryProjectId',
      previousValue: previous.length === 1 ? previous[0]?.id : previous.map((row) => row.id),
      newValue: project?.id ?? null,
      sourceEventId: null,
    });

    for (const old of existing) {
      await emitRelationshipDirectWriteOutput({
        db: tx,
        teamId: scope.teamId,
        relationshipId: old.id,
        fromEntityId: taskId,
        toEntityId: old.projectId,
        relationshipKind: 'child',
        actor,
        sourceEventId,
        operation: 'unlink',
        systemEventKind: 'relationship_delete',
      });
    }
    if (created && project) {
      await emitRelationshipDirectWriteOutput({
        db: tx,
        teamId: scope.teamId,
        relationshipId: created.id,
        fromEntityId: taskId,
        toEntityId: project.id,
        relationshipKind: 'child',
        actor,
        sourceEventId,
        operation: 'link',
        systemEventKind: 'relationship_create',
      });
    }

    let requestedCategoryHash: string | null = null;
    if (task.taskCategoryMode === 'automatic') {
      const packet = await taskCategoryPacketForRow(tx, scope.teamId, task);
      requestedCategoryHash = taskCategoryInputHash(packet, TIMELINE_MODELS.taskCategorization.id);
      await tx
        .update(entities)
        .set({
          taskCategoryStatus: 'pending',
          taskCategoryRequestedInputHash: requestedCategoryHash,
          taskCategoryTaxonomyVersion: TASK_CATEGORY_TAXONOMY_VERSION,
          taskCategoryUpdatedAt: new Date(),
        })
        .where(and(eq(entities.teamId, scope.teamId), eq(entities.id, taskId)));
    }

    return {
      changed: true,
      project: project
        ? {
            taskId,
            projectId: project.id,
            projectName: project.canonicalName,
            archivedAt: project.archivedAt,
          }
        : null,
      touchedIds: [
        taskId,
        ...existing.map((row) => row.projectId),
        ...(project ? [project.id] : []),
      ],
      requestedCategoryHash,
    };
  });

  for (const objectId of new Set(result.touchedIds)) {
    void fireAndForgetObjectSummaryRefresh(db, scope, objectId, {
      teamId: scope.teamId,
      objectId,
      taskId,
      op: 'setTaskProject',
    });
  }
  if (result.requestedCategoryHash) {
    await embedQueue.enqueueTaskCategoryJob({
      teamId: scope.teamId,
      taskId,
      inputHash: result.requestedCategoryHash,
      trigger: 'project_change',
    });
  }
  return { changed: result.changed, project: result.project, touchedIds: result.touchedIds };
}

async function taskCategoryPacketForRow(
  tx: DbOrTx,
  teamId: string,
  task: Pick<EntityRow, 'id' | 'canonicalName' | 'aliases' | 'metadata'>,
) {
  const [project] = await tx
    .select({ canonicalName: entities.canonicalName })
    .from(entityRelationships)
    .innerJoin(
      entities,
      and(
        eq(entities.teamId, entityRelationships.teamId),
        eq(entities.id, entityRelationships.toEntityId),
        eq(entities.type, 'project'),
        isNull(entities.mergedIntoId),
      ),
    )
    .where(
      and(
        eq(entityRelationships.teamId, teamId),
        eq(entityRelationships.fromEntityId, task.id),
        eq(entityRelationships.kind, 'child'),
      ),
    )
    .orderBy(asc(entityRelationships.createdAt), asc(entityRelationships.id))
    .limit(1);
  return buildTaskCategoryPacket({
    title: task.canonicalName,
    aliases: stringArrayFromUnknown(task.aliases),
    metadata: recordFromUnknown(task.metadata),
    primaryProjectName: project?.canonicalName ?? null,
  });
}

export async function getTaskCategoryClassificationInput(
  db: Db,
  scope: TeamScopeCore,
  taskId: string,
): Promise<{
  packet: ReturnType<typeof buildTaskCategoryPacket>;
  inputHash: string;
  requestedInputHash: string;
} | null> {
  await scope.requireMembership();
  if (!UUID_RE.test(taskId)) return null;
  const [task] = await db
    .select()
    .from(entities)
    .where(
      and(
        eq(entities.teamId, scope.teamId),
        eq(entities.id, taskId),
        eq(entities.type, 'task'),
        eq(entities.taskCategoryMode, 'automatic'),
        eq(entities.taskCategoryStatus, 'pending'),
        isNotNull(entities.taskCategoryRequestedInputHash),
        isNull(entities.archivedAt),
        isNull(entities.mergedIntoId),
      ),
    )
    .limit(1);
  if (!task?.taskCategoryRequestedInputHash) return null;
  const packet = await taskCategoryPacketForRow(db, scope.teamId, task);
  return {
    packet,
    inputHash: taskCategoryInputHash(packet, TIMELINE_MODELS.taskCategorization.id),
    requestedInputHash: task.taskCategoryRequestedInputHash,
  };
}

export async function setTaskCategory(
  db: Db,
  scope: TeamScopeCore,
  taskId: string,
  categoryInput: TaskCategory,
  actor: UpdateActor,
): Promise<{ object: ObjectRow; changeId: string }> {
  await scope.requireMembership();
  if (!UUID_RE.test(taskId)) throw new Error('Invalid entity id');
  if (actor.kind !== 'user' || !actor.userId) throw new Error('A teammate must set the category');
  const category = taskCategorySchema.parse(categoryInput);
  const now = new Date();
  const result = await db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(entities)
      .where(
        and(
          eq(entities.teamId, scope.teamId),
          eq(entities.id, taskId),
          eq(entities.type, 'task'),
          isNull(entities.archivedAt),
          isNull(entities.mergedIntoId),
        ),
      )
      .for('update')
      .limit(1);
    if (!current) throw new Error('Task not found');
    const [row] = await tx
      .update(entities)
      .set({
        taskCategory: category,
        taskCategoryMode: 'manual',
        taskCategorySource: 'user',
        taskCategoryStatus: 'ready',
        taskCategoryAppliedInputHash: null,
        taskCategoryRequestedInputHash: null,
        taskCategoryTaxonomyVersion: TASK_CATEGORY_TAXONOMY_VERSION,
        taskCategoryUpdatedAt: now,
        updatedAt: now,
      })
      .where(and(eq(entities.teamId, scope.teamId), eq(entities.id, taskId)))
      .returning();
    if (!row) throw new Error('Category update failed');
    await tx.insert(taskCategoryAssignments).values({
      teamId: scope.teamId,
      entityId: taskId,
      category,
      source: 'user',
      mode: 'manual',
      actorUserId: actor.userId,
      taxonomyVersion: TASK_CATEGORY_TAXONOMY_VERSION,
      outcome: 'applied',
    });
    const [change] = await tx
      .insert(objectChanges)
      .values({
        teamId: scope.teamId,
        entityId: taskId,
        actorUserId: actor.userId,
        actorKind: 'user',
        status: 'applied',
        field: 'taskCategory',
        previousValue: taskCategoryStateSnapshot(current),
        newValue: taskCategoryStateSnapshot(row),
        sourceEventId: null,
      })
      .returning({ id: objectChanges.id });
    if (!change) throw new Error('Category audit failed');
    return { row, changeId: change.id };
  });
  return { object: toObjectRow(result.row), changeId: result.changeId };
}

interface TaskCategoryStateSnapshot {
  category: TaskCategory | null;
  mode: TaskCategoryMode | null;
  source: TaskCategorySource | null;
  status: TaskCategoryStatus | null;
  appliedInputHash: string | null;
  requestedInputHash: string | null;
  taxonomyVersion: string | null;
}

function taskCategoryStateSnapshot(row: EntityRow): TaskCategoryStateSnapshot {
  return {
    category: row.taskCategory as TaskCategory | null,
    mode: row.taskCategoryMode as TaskCategoryMode | null,
    source: row.taskCategorySource as TaskCategorySource | null,
    status: row.taskCategoryStatus as TaskCategoryStatus | null,
    appliedInputHash: row.taskCategoryAppliedInputHash,
    requestedInputHash: row.taskCategoryRequestedInputHash,
    taxonomyVersion: row.taskCategoryTaxonomyVersion,
  };
}

function taskCategoryStateSnapshotFromUnknown(value: unknown): TaskCategoryStateSnapshot | null {
  const record = recordFromUnknown(value);
  const category = record.category === null ? null : taskCategorySchema.safeParse(record.category);
  const mode = record.mode === null ? null : taskCategoryModeSchema.safeParse(record.mode);
  const source = record.source === null ? null : taskCategorySourceSchema.safeParse(record.source);
  const status = record.status === null ? null : taskCategoryStatusSchema.safeParse(record.status);
  if (
    (category !== null && !category.success) ||
    (mode !== null && !mode.success) ||
    (source !== null && !source.success) ||
    (status !== null && !status.success)
  ) {
    return null;
  }
  const nullableString = (candidate: unknown): string | null =>
    typeof candidate === 'string' ? candidate : null;
  return {
    category: category === null ? null : category.data,
    mode: mode === null ? null : mode.data,
    source: source === null ? null : source.data,
    status: status === null ? null : status.data,
    appliedInputHash: nullableString(record.appliedInputHash),
    requestedInputHash: nullableString(record.requestedInputHash),
    taxonomyVersion: nullableString(record.taxonomyVersion),
  };
}

function taskProjectVersion(projectId: string, projectName: string): string {
  return createHash('sha256').update(`${projectId}\0${projectName}`).digest('hex');
}

export async function invalidateTaskCategoriesForProject(
  db: Db,
  scope: TeamScopeCore,
  input: {
    projectId: string;
    projectVersion: string;
    afterTaskId: string | null;
    limit?: number;
  },
): Promise<{ jobs: { taskId: string; inputHash: string }[]; nextCursor: string | null }> {
  await scope.requireMembership();
  const limit = Math.min(Math.max(input.limit ?? 500, 1), 500);
  return db.transaction(async (tx) => {
    const [project] = await tx
      .select({ id: entities.id, canonicalName: entities.canonicalName })
      .from(entities)
      .where(
        and(
          eq(entities.teamId, scope.teamId),
          eq(entities.id, input.projectId),
          eq(entities.type, 'project'),
          isNull(entities.mergedIntoId),
        ),
      )
      .limit(1);
    if (
      !project ||
      taskProjectVersion(project.id, project.canonicalName) !== input.projectVersion
    ) {
      return { jobs: [], nextCursor: null };
    }
    const rows = await tx
      .select({
        id: entities.id,
        canonicalName: entities.canonicalName,
        aliases: entities.aliases,
        metadata: entities.metadata,
      })
      .from(entityRelationships)
      .innerJoin(
        entities,
        and(
          eq(entities.teamId, entityRelationships.teamId),
          eq(entities.id, entityRelationships.fromEntityId),
          eq(entities.type, 'task'),
          eq(entities.taskCategoryMode, 'automatic'),
          isNull(entities.archivedAt),
          isNull(entities.mergedIntoId),
        ),
      )
      .where(
        and(
          eq(entityRelationships.teamId, scope.teamId),
          eq(entityRelationships.toEntityId, project.id),
          eq(entityRelationships.kind, 'child'),
          input.afterTaskId ? sql`${entities.id} > ${input.afterTaskId}` : undefined,
        ),
      )
      .orderBy(asc(entities.id))
      .limit(limit);
    const jobs: { taskId: string; inputHash: string }[] = [];
    for (const task of rows) {
      const packet = buildTaskCategoryPacket({
        title: task.canonicalName,
        aliases: stringArrayFromUnknown(task.aliases),
        metadata: recordFromUnknown(task.metadata),
        primaryProjectName: project.canonicalName,
      });
      const inputHash = taskCategoryInputHash(packet, TIMELINE_MODELS.taskCategorization.id);
      await tx
        .update(entities)
        .set({
          taskCategoryStatus: 'pending',
          taskCategoryRequestedInputHash: inputHash,
          taskCategoryTaxonomyVersion: TASK_CATEGORY_TAXONOMY_VERSION,
          taskCategoryUpdatedAt: new Date(),
        })
        .where(
          and(
            eq(entities.teamId, scope.teamId),
            eq(entities.id, task.id),
            eq(entities.taskCategoryMode, 'automatic'),
          ),
        );
      jobs.push({ taskId: task.id, inputHash });
    }
    return {
      jobs,
      nextCursor: rows.length === limit ? (rows.at(-1)?.id ?? null) : null,
    };
  });
}

export async function undoTaskCategoryChange(
  db: Db,
  scope: TeamScopeCore,
  taskId: string,
  changeId: string,
  actor: UpdateActor,
): Promise<ObjectRow> {
  await scope.requireMembership();
  if (!UUID_RE.test(taskId) || !UUID_RE.test(changeId)) throw new Error('Invalid category change');
  if (actor.kind !== 'user' || !actor.userId) throw new Error('A teammate must undo the category');
  const result = await db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(entities)
      .where(
        and(
          eq(entities.teamId, scope.teamId),
          eq(entities.id, taskId),
          eq(entities.type, 'task'),
          isNull(entities.archivedAt),
          isNull(entities.mergedIntoId),
        ),
      )
      .for('update')
      .limit(1);
    if (!current) throw new Error('Task not found');
    const [targetChange] = await tx
      .select({
        id: objectChanges.id,
        changedAt: objectChanges.changedAt,
        previousValue: objectChanges.previousValue,
        newValue: objectChanges.newValue,
      })
      .from(objectChanges)
      .where(
        and(
          eq(objectChanges.teamId, scope.teamId),
          eq(objectChanges.entityId, taskId),
          eq(objectChanges.id, changeId),
          eq(objectChanges.field, 'taskCategory'),
          eq(objectChanges.status, 'applied'),
        ),
      )
      .limit(1);
    const targetNewState = targetChange
      ? taskCategoryStateSnapshotFromUnknown(targetChange.newValue)
      : null;
    const [laterChange] = targetChange
      ? await tx
          .select({ id: objectChanges.id })
          .from(objectChanges)
          .where(
            and(
              eq(objectChanges.teamId, scope.teamId),
              eq(objectChanges.entityId, taskId),
              eq(objectChanges.field, 'taskCategory'),
              eq(objectChanges.status, 'applied'),
              sql`${objectChanges.changedAt} > ${targetChange.changedAt}`,
            ),
          )
          .limit(1)
      : [];
    if (
      !targetChange ||
      !targetNewState ||
      laterChange ||
      JSON.stringify(taskCategoryStateSnapshot(current)) !== JSON.stringify(targetNewState)
    ) {
      throw new Error('Category changed again; this undo is stale');
    }
    let previous = taskCategoryStateSnapshotFromUnknown(targetChange.previousValue);
    if (!previous) throw new Error('Previous category state is unavailable');
    let enqueueInputHash: string | null = null;
    if (previous.mode === null) {
      const packet = await taskCategoryPacketForRow(tx, scope.teamId, current);
      enqueueInputHash = taskCategoryInputHash(packet, TIMELINE_MODELS.taskCategorization.id);
      previous = {
        category: null,
        mode: 'automatic',
        source: null,
        status: 'pending',
        appliedInputHash: null,
        requestedInputHash: enqueueInputHash,
        taxonomyVersion: TASK_CATEGORY_TAXONOMY_VERSION,
      };
    }
    const now = new Date();
    const [updated] = await tx
      .update(entities)
      .set({
        taskCategory: previous.category,
        taskCategoryMode: previous.mode,
        taskCategorySource: previous.source,
        taskCategoryStatus: previous.status,
        taskCategoryAppliedInputHash: previous.appliedInputHash,
        taskCategoryRequestedInputHash: previous.requestedInputHash,
        taskCategoryTaxonomyVersion: previous.taxonomyVersion,
        taskCategoryUpdatedAt: now,
        updatedAt: now,
      })
      .where(and(eq(entities.teamId, scope.teamId), eq(entities.id, taskId)))
      .returning();
    if (!updated || !previous.mode) throw new Error('Category undo failed');
    await tx.insert(taskCategoryAssignments).values({
      teamId: scope.teamId,
      entityId: taskId,
      category: previous.category,
      source: 'user',
      mode: previous.mode,
      actorUserId: actor.userId,
      taxonomyVersion: previous.taxonomyVersion,
      outcome: 'applied',
    });
    await tx.insert(objectChanges).values({
      teamId: scope.teamId,
      entityId: taskId,
      actorUserId: actor.userId,
      actorKind: 'user',
      status: 'applied',
      field: 'taskCategory',
      previousValue: taskCategoryStateSnapshot(current),
      newValue: previous,
      sourceEventId: null,
    });
    return { row: updated, enqueueInputHash };
  });
  if (result.enqueueInputHash) {
    await embedQueue.enqueueTaskCategoryJob({
      teamId: scope.teamId,
      taskId,
      inputHash: result.enqueueInputHash,
      trigger: 'retry',
    });
  }
  return toObjectRow(result.row);
}

async function transitionTaskCategoryToPending(
  db: Db,
  scope: TeamScopeCore,
  taskId: string,
  actor: UpdateActor,
  requireFailed: boolean,
  trigger: 'context_change' | 'retry' | 'backfill',
): Promise<{ object: ObjectRow; inputHash: string }> {
  await scope.requireMembership();
  if (!UUID_RE.test(taskId)) throw new Error('Invalid entity id');
  const result = await db.transaction(async (tx) => {
    const [task] = await tx
      .select()
      .from(entities)
      .where(
        and(
          eq(entities.teamId, scope.teamId),
          eq(entities.id, taskId),
          eq(entities.type, 'task'),
          isNull(entities.archivedAt),
          isNull(entities.mergedIntoId),
        ),
      )
      .for('update')
      .limit(1);
    if (!task) throw new Error('Task not found');
    if (
      requireFailed &&
      (task.taskCategoryMode !== 'automatic' || task.taskCategoryStatus !== 'failed')
    ) {
      throw new Error('Only failed automatic categories can be retried');
    }
    const packet = await taskCategoryPacketForRow(tx, scope.teamId, task);
    const inputHash = taskCategoryInputHash(packet, TIMELINE_MODELS.taskCategorization.id);
    const [updated] = await tx
      .update(entities)
      .set({
        taskCategoryMode: 'automatic',
        taskCategoryStatus: 'pending',
        taskCategoryRequestedInputHash: inputHash,
        taskCategoryTaxonomyVersion: TASK_CATEGORY_TAXONOMY_VERSION,
        taskCategoryUpdatedAt: new Date(),
      })
      .where(and(eq(entities.teamId, scope.teamId), eq(entities.id, taskId)))
      .returning();
    if (!updated) throw new Error('Category update failed');
    if (task.taskCategoryMode !== 'automatic') {
      await tx.insert(objectChanges).values({
        teamId: scope.teamId,
        entityId: taskId,
        actorUserId: actor.userId,
        actorKind: actor.kind,
        status: 'applied',
        field: 'taskCategoryMode',
        previousValue: task.taskCategoryMode,
        newValue: 'automatic',
        sourceEventId: null,
      });
    }
    return { object: toObjectRow(updated), inputHash };
  });
  await embedQueue.enqueueTaskCategoryJob({
    teamId: scope.teamId,
    taskId,
    inputHash: result.inputHash,
    trigger,
  });
  return result;
}

export function resetTaskCategoryToAutomatic(
  db: Db,
  scope: TeamScopeCore,
  taskId: string,
  actor: UpdateActor,
) {
  return transitionTaskCategoryToPending(db, scope, taskId, actor, false, 'context_change');
}

export function retryTaskCategory(
  db: Db,
  scope: TeamScopeCore,
  taskId: string,
  actor: UpdateActor,
) {
  return transitionTaskCategoryToPending(db, scope, taskId, actor, true, 'retry');
}

export function enqueueTaskCategoryBackfill(db: Db, scope: TeamScopeCore, taskId: string) {
  return transitionTaskCategoryToPending(
    db,
    scope,
    taskId,
    { kind: 'agent', userId: null },
    false,
    'backfill',
  );
}

export async function applyTaskCategoryClassification(
  db: Db,
  scope: TeamScopeCore,
  input: {
    taskId: string;
    inputHash: string;
    category: TaskCategory;
    confidence: number;
    model: string;
    latencyMs: number;
  },
): Promise<'applied' | 'discarded_stale' | 'discarded_human_override'> {
  await scope.requireMembership();
  const category = taskCategorySchema.parse(input.category);
  return db.transaction(async (tx) => {
    const [task] = await tx
      .select()
      .from(entities)
      .where(and(eq(entities.teamId, scope.teamId), eq(entities.id, input.taskId)))
      .for('update')
      .limit(1);
    const applicable =
      task?.type === 'task' &&
      !task.archivedAt &&
      !task.mergedIntoId &&
      task.taskCategoryMode === 'automatic' &&
      task.taskCategoryRequestedInputHash === input.inputHash;
    if (!task) return 'discarded_stale';
    const outcome = applicable
      ? 'applied'
      : task.taskCategoryMode === 'manual'
        ? 'discarded_human_override'
        : 'discarded_stale';
    await tx.insert(taskCategoryAssignments).values({
      teamId: scope.teamId,
      entityId: input.taskId,
      category,
      source: 'llm',
      mode: 'automatic',
      confidence: input.confidence,
      model: input.model,
      promptVersion: TASK_CATEGORY_PROMPT_VERSION,
      taxonomyVersion: TASK_CATEGORY_TAXONOMY_VERSION,
      inputHash: input.inputHash,
      outcome,
      latencyMs: input.latencyMs,
    });
    if (!applicable) return outcome;
    await tx
      .update(entities)
      .set({
        taskCategory: category,
        taskCategoryMode: 'automatic',
        taskCategorySource: 'llm',
        taskCategoryStatus: 'ready',
        taskCategoryAppliedInputHash: input.inputHash,
        taskCategoryRequestedInputHash: null,
        taskCategoryTaxonomyVersion: TASK_CATEGORY_TAXONOMY_VERSION,
        taskCategoryUpdatedAt: new Date(),
      })
      .where(and(eq(entities.teamId, scope.teamId), eq(entities.id, input.taskId)));
    if (task.taskCategory !== category) {
      await tx.insert(objectChanges).values({
        teamId: scope.teamId,
        entityId: input.taskId,
        actorUserId: null,
        actorKind: 'agent',
        status: 'applied',
        field: 'taskCategory',
        previousValue: task.taskCategory,
        newValue: category,
        sourceEventId: null,
      });
    }
    return outcome;
  });
}

export async function failTaskCategoryClassification(
  db: Db,
  scope: TeamScopeCore,
  input: {
    taskId: string;
    inputHash: string;
    model: string;
    failureCode: string;
    latencyMs: number;
  },
): Promise<'failed' | 'discarded_stale' | 'discarded_human_override'> {
  await scope.requireMembership();
  return db.transaction(async (tx) => {
    const [task] = await tx
      .select()
      .from(entities)
      .where(and(eq(entities.teamId, scope.teamId), eq(entities.id, input.taskId)))
      .for('update')
      .limit(1);
    const applicable =
      task?.type === 'task' &&
      !task.archivedAt &&
      !task.mergedIntoId &&
      task.taskCategoryMode === 'automatic' &&
      task.taskCategoryRequestedInputHash === input.inputHash;
    if (!task) return 'discarded_stale';
    const outcome = applicable
      ? 'failed'
      : task.taskCategoryMode === 'manual'
        ? 'discarded_human_override'
        : 'discarded_stale';
    await tx.insert(taskCategoryAssignments).values({
      teamId: scope.teamId,
      entityId: input.taskId,
      category: null,
      source: 'llm',
      mode: 'automatic',
      model: input.model,
      promptVersion: TASK_CATEGORY_PROMPT_VERSION,
      taxonomyVersion: TASK_CATEGORY_TAXONOMY_VERSION,
      inputHash: input.inputHash,
      outcome,
      failureCode: input.failureCode.slice(0, 120),
      latencyMs: input.latencyMs,
    });
    if (applicable) {
      await tx
        .update(entities)
        .set({
          taskCategoryStatus: 'failed',
          taskCategoryRequestedInputHash: null,
          taskCategoryUpdatedAt: new Date(),
        })
        .where(and(eq(entities.teamId, scope.teamId), eq(entities.id, input.taskId)));
    }
    return outcome;
  });
}

export async function removeRelationship(
  db: Db,
  scope: TeamScopeCore,
  relationshipId: string,
  actor: UpdateActor = { kind: 'user', userId: null },
): Promise<boolean> {
  await scope.requireMembership();
  if (!UUID_RE.test(relationshipId)) return false;

  const result = await db.transaction(async (tx) => {
    // Capture endpoints + kind before delete so the audit row has full
    // context. SELECT FOR UPDATE pins the row against a concurrent delete
    // (which would otherwise turn this into a no-op silently).
    const existing = await tx
      .select()
      .from(entityRelationships)
      .where(
        and(
          eq(entityRelationships.id, relationshipId),
          eq(entityRelationships.teamId, scope.teamId),
        ),
      )
      .for('update')
      .limit(1);
    const rel = existing[0];
    if (!rel) return null;

    if (rel.kind === 'child' || rel.kind === 'parent') {
      const endpoints = await tx
        .select({ id: entities.id, type: entities.type })
        .from(entities)
        .where(
          and(
            eq(entities.teamId, scope.teamId),
            inArray(entities.id, [rel.fromEntityId, rel.toEntityId]),
          ),
        );
      const from = endpoints.find((row) => row.id === rel.fromEntityId);
      const to = endpoints.find((row) => row.id === rel.toEntityId);
      const isTaskProjectHierarchy =
        (rel.kind === 'child' && from?.type === 'task' && to?.type === 'project') ||
        (rel.kind === 'parent' && from?.type === 'project' && to?.type === 'task');
      if (isTaskProjectHierarchy) {
        throw new Error('Use the task Project field to manage a primary project');
      }
    }

    await tx.delete(entityRelationships).where(eq(entityRelationships.id, relationshipId));

    const rawEventId = randomUUID();
    const eventText = `Removed link (${rel.kind})`;
    const ev = await tx
      .insert(rawEvents)
      .values({
        id: rawEventId,
        teamId: scope.teamId,
        authorUserId: actor.userId,
        source: 'system',
        contentText: eventText,
        occurredAt: new Date(),
        visibility: 'team',
        sourceMetadata: systemDirectWriteSourceMetadata({
          rawEventId,
          kind: 'relationship_delete',
          metadata: {
            relationship_id: rel.id,
            from_entity_id: rel.fromEntityId,
            to_entity_id: rel.toEntityId,
            relationship_kind: rel.kind,
          },
          snapshot: {
            relationship_id: rel.id,
            from_entity_id: rel.fromEntityId,
            to_entity_id: rel.toEntityId,
            relationship_kind: rel.kind,
            actor_kind: actor.kind,
            actor_user_id: actor.userId ?? null,
          },
        }),
      })
      .returning({ id: rawEvents.id });
    const sourceEventId = ev[0]?.id ?? null;
    await normalizeSystemRawEventEvidence({
      db: tx,
      teamId: scope.teamId,
      rawEventId: sourceEventId,
    });
    await reconcileObjectAuditLinks(tx, {
      teamId: scope.teamId,
      rawEventId: sourceEventId,
      text: eventText,
    });

    await tx.insert(objectChanges).values([
      {
        teamId: scope.teamId,
        entityId: rel.fromEntityId,
        actorUserId: actor.userId,
        actorKind: actor.kind,
        status: 'applied',
        field: '__relationship_delete__',
        previousValue: { relationship_id: rel.id, to: rel.toEntityId, kind: rel.kind },
        newValue: null,
        sourceEventId: null,
      },
      {
        teamId: scope.teamId,
        entityId: rel.toEntityId,
        actorUserId: actor.userId,
        actorKind: actor.kind,
        status: 'applied',
        field: '__relationship_delete__',
        previousValue: { relationship_id: rel.id, from: rel.fromEntityId, kind: rel.kind },
        newValue: null,
        sourceEventId: null,
      },
    ]);
    await emitRelationshipDirectWriteOutput({
      db: tx,
      teamId: scope.teamId,
      relationshipId: rel.id,
      fromEntityId: rel.fromEntityId,
      toEntityId: rel.toEntityId,
      relationshipKind: rel.kind,
      actor,
      sourceEventId,
      operation: 'unlink',
      systemEventKind: 'relationship_delete',
    });
    return { fromEntityId: rel.fromEntityId, toEntityId: rel.toEntityId };
  });
  if (!result) return false;
  for (const objectId of [result.fromEntityId, result.toEntityId]) {
    void fireAndForgetObjectSummaryRefresh(db, scope, objectId, {
      teamId: scope.teamId,
      objectId,
      relationshipId,
      op: 'removeRelationship',
    });
  }
  return true;
}

/** Notes are mutable; every CRUD writes raw_events + object_changes for audit. */
export async function createNote(
  db: Db,
  scope: TeamScopeCore,
  input: {
    entityId: string;
    body: string;
    authorUserId: string | null;
    metadata?: Record<string, unknown>;
    actor?: UpdateActor;
  },
): Promise<{ id: string }> {
  await scope.requireMembership();
  if (!UUID_RE.test(input.entityId)) throw new Error('Invalid entity id');
  const body = input.body.trim();
  if (!body) throw new Error('Note body cannot be empty');

  const result = await db.transaction(async (tx) => {
    // Verify entity belongs to team before writing the note.
    const ent = await tx
      .select({ id: entities.id, canonicalName: entities.canonicalName, type: entities.type })
      .from(entities)
      .where(
        and(
          eq(entities.id, input.entityId),
          eq(entities.teamId, scope.teamId),
          isNull(entities.mergedIntoId),
        ),
      )
      .limit(1);
    if (!ent[0]) throw new Error('Object not found');

    const noteRows = await tx
      .insert(objectNotes)
      .values({
        teamId: scope.teamId,
        entityId: input.entityId,
        authorUserId: input.authorUserId,
        body,
      })
      .returning({ id: objectNotes.id });
    const noteId = noteRows[0]?.id;
    if (!noteId) throw new Error('Failed to insert note');

    const rawEventId = randomUUID();
    const eventText = `Note on ${ent[0].type} "${ent[0].canonicalName}": ${body}`;
    const ev = await tx
      .insert(rawEvents)
      .values({
        id: rawEventId,
        teamId: scope.teamId,
        authorUserId: input.authorUserId,
        source: 'system',
        contentText: eventText,
        occurredAt: new Date(),
        visibility: 'team',
        sourceMetadata: systemDirectWriteSourceMetadata({
          rawEventId,
          kind: 'object_note_create',
          metadata: {
            ...(input.metadata ?? {}),
            entity_id: input.entityId,
            note_id: noteId,
          },
          snapshot: {
            entity_id: input.entityId,
            note_id: noteId,
            body,
            actor_kind: input.actor?.kind ?? 'user',
            actor_user_id: input.actor ? (input.actor.userId ?? null) : input.authorUserId,
          },
        }),
      })
      .returning({ id: rawEvents.id });
    const sourceEventId = ev[0]?.id ?? null;
    await normalizeSystemRawEventEvidence({
      db: tx,
      teamId: scope.teamId,
      rawEventId: sourceEventId,
    });
    await reconcileObjectAuditLinks(tx, {
      teamId: scope.teamId,
      rawEventId: sourceEventId,
      text: eventText,
    });
    await tx.insert(objectChanges).values({
      teamId: scope.teamId,
      entityId: input.entityId,
      actorUserId: input.actor ? (input.actor.userId ?? null) : input.authorUserId,
      actorKind: input.actor?.kind ?? 'user',
      status: 'applied',
      field: '__note_create__',
      previousValue: null,
      newValue: { note_id: noteId, body },
      sourceEventId: null,
    });
    await emitNoteDirectWriteOutput({
      db: tx,
      teamId: scope.teamId,
      entityId: input.entityId,
      noteId,
      actor: {
        kind: input.actor?.kind ?? 'user',
        userId: input.actor ? (input.actor.userId ?? null) : input.authorUserId,
      },
      sourceEventId,
      operation: 'create',
      systemEventKind: 'object_note_create',
      body,
    });

    return { id: noteId };
  });

  fireAndForgetEmbed(() => embedQueue.enqueueObjectNoteEmbedJob(scope.teamId, result.id), {
    teamId: scope.teamId,
    noteId: result.id,
    op: 'createNote',
  });
  void fireAndForgetObjectSummaryRefresh(db, scope, input.entityId, {
    teamId: scope.teamId,
    objectId: input.entityId,
    noteId: result.id,
    op: 'createNote',
  });
  return result;
}

export async function listIdentityFacets(
  db: Db,
  scope: TeamScopeCore,
  entityId: string,
): Promise<IdentityFacetRow[]> {
  await scope.requireMembership();
  if (!UUID_RE.test(entityId)) return [];
  const rows = await db
    .select({
      id: objectIdentityFacets.id,
      entityId: objectIdentityFacets.entityId,
      kind: objectIdentityFacets.kind,
      value: objectIdentityFacets.value,
      normalizedValue: objectIdentityFacets.normalizedValue,
      provider: objectIdentityFacets.provider,
      externalId: objectIdentityFacets.externalId,
      linkedUserId: objectIdentityFacets.linkedUserId,
    })
    .from(objectIdentityFacets)
    .where(
      and(
        eq(objectIdentityFacets.teamId, scope.teamId),
        eq(objectIdentityFacets.entityId, entityId),
        eq(objectIdentityFacets.status, 'approved'),
      ),
    )
    .orderBy(objectIdentityFacets.kind, objectIdentityFacets.value);
  return rows;
}

export async function listIdentityFacetsForUser(
  db: Db,
  scope: TeamScopeCore,
  linkedUserId: string,
): Promise<IdentityFacetRow[]> {
  await scope.requireMembership();
  if (!UUID_RE.test(linkedUserId)) return [];
  const rows = await db
    .select({
      id: objectIdentityFacets.id,
      entityId: objectIdentityFacets.entityId,
      kind: objectIdentityFacets.kind,
      value: objectIdentityFacets.value,
      normalizedValue: objectIdentityFacets.normalizedValue,
      provider: objectIdentityFacets.provider,
      externalId: objectIdentityFacets.externalId,
      linkedUserId: objectIdentityFacets.linkedUserId,
    })
    .from(objectIdentityFacets)
    .where(
      and(
        eq(objectIdentityFacets.teamId, scope.teamId),
        eq(objectIdentityFacets.linkedUserId, linkedUserId),
        eq(objectIdentityFacets.status, 'approved'),
      ),
    )
    .orderBy(objectIdentityFacets.kind, objectIdentityFacets.value);
  return rows;
}

export async function createIdentityFacet(
  db: Db,
  scope: TeamScopeCore,
  input: IdentityFacetInput,
): Promise<{ id: string }> {
  await scope.requireMembership();
  if (!UUID_RE.test(input.entityId)) throw new Error('Invalid entity id');
  const value = input.value.trim();
  if (!value) throw new Error('Identity facet value cannot be empty');
  const normalizedInput = input.normalizedValue?.trim();
  const normalizedValue =
    input.kind === 'email' ||
    input.kind === 'phone' ||
    normalizedInput === undefined ||
    normalizedInput === ''
      ? normalizeIdentityFacet(input.kind, value)
      : normalizedInput;
  if (!normalizedValue) throw new Error('Identity facet normalized value cannot be empty');
  validateIdentityFacetValue(input.kind, normalizedValue);
  if (input.linkedUserId) await scope.requireTeamMember(input.linkedUserId);

  const result = await db.transaction(async (tx) => {
    const ent = await tx
      .select({ id: entities.id, type: entities.type, canonicalName: entities.canonicalName })
      .from(entities)
      .where(
        and(
          eq(entities.id, input.entityId),
          eq(entities.teamId, scope.teamId),
          isNull(entities.mergedIntoId),
        ),
      )
      .limit(1);
    if (!ent[0]) throw new Error('Object not found');
    if (ent[0].type !== 'person') throw new Error('Identity facets can only be added to people');

    const duplicateConditions = [
      and(
        eq(objectIdentityFacets.kind, input.kind),
        eq(objectIdentityFacets.normalizedValue, normalizedValue),
      ),
    ];
    if (input.externalId) {
      duplicateConditions.push(
        and(
          eq(objectIdentityFacets.kind, input.kind),
          eq(objectIdentityFacets.externalId, input.externalId),
          input.provider
            ? eq(objectIdentityFacets.provider, input.provider)
            : isNull(objectIdentityFacets.provider),
        ),
      );
    }
    if (input.kind === 'timeline_user' && input.linkedUserId) {
      duplicateConditions.push(
        and(
          eq(objectIdentityFacets.kind, 'timeline_user'),
          eq(objectIdentityFacets.linkedUserId, input.linkedUserId),
        ),
      );
    }

    const existing = await tx
      .select({
        id: objectIdentityFacets.id,
        entityId: objectIdentityFacets.entityId,
        value: objectIdentityFacets.value,
        normalizedValue: objectIdentityFacets.normalizedValue,
        provider: objectIdentityFacets.provider,
        externalId: objectIdentityFacets.externalId,
        linkedUserId: objectIdentityFacets.linkedUserId,
        metadata: objectIdentityFacets.metadata,
      })
      .from(objectIdentityFacets)
      .where(
        and(
          eq(objectIdentityFacets.teamId, scope.teamId),
          eq(objectIdentityFacets.status, 'approved'),
          or(...duplicateConditions),
        ),
      )
      .limit(1);
    if (existing[0]) {
      if (existing[0].entityId !== input.entityId) {
        throw new Error('Identity facet already belongs to another person');
      }
      const mergedMetadata = {
        ...((existing[0].metadata && typeof existing[0].metadata === 'object'
          ? existing[0].metadata
          : {}) as Record<string, unknown>),
        ...(input.metadata ?? {}),
      };
      await tx
        .update(objectIdentityFacets)
        .set({
          value,
          normalizedValue,
          provider: input.provider !== undefined ? input.provider : existing[0].provider,
          externalId: input.externalId !== undefined ? input.externalId : existing[0].externalId,
          linkedUserId:
            input.linkedUserId !== undefined ? input.linkedUserId : existing[0].linkedUserId,
          source: input.source ?? (input.actor.kind === 'agent' ? 'agent_approved' : 'manual'),
          metadata: mergedMetadata,
          updatedAt: new Date(),
        })
        .where(eq(objectIdentityFacets.id, existing[0].id));
      const summary = `Updated ${input.kind} identity for ${ent[0].canonicalName}: ${value}`;
      const rawEventId = randomUUID();
      const ev = await tx
        .insert(rawEvents)
        .values({
          id: rawEventId,
          teamId: scope.teamId,
          authorUserId: input.actor.userId ?? null,
          source: 'system',
          contentText: summary,
          occurredAt: new Date(),
          visibility: 'team',
          sourceMetadata: systemDirectWriteSourceMetadata({
            rawEventId,
            kind: 'identity_facet_update',
            metadata: {
              entity_id: input.entityId,
              identity_facet_id: existing[0].id,
              identity_facet_kind: input.kind,
            },
            snapshot: {
              entity_id: input.entityId,
              identity_facet_id: existing[0].id,
              identity_facet_kind: input.kind,
              value,
              normalized_value: normalizedValue,
              provider: input.provider !== undefined ? input.provider : existing[0].provider,
              external_id:
                input.externalId !== undefined ? input.externalId : existing[0].externalId,
              linked_user_id:
                input.linkedUserId !== undefined ? input.linkedUserId : existing[0].linkedUserId,
              previous: {
                value: existing[0].value,
                normalized_value: existing[0].normalizedValue,
                provider: existing[0].provider,
                external_id: existing[0].externalId,
                linked_user_id: existing[0].linkedUserId,
              },
              actor_kind: input.actor.kind,
              actor_user_id: input.actor.userId ?? null,
            },
          }),
        })
        .returning({ id: rawEvents.id });
      const sourceEventId = ev[0]?.id ?? null;
      await normalizeSystemRawEventEvidence({
        db: tx,
        teamId: scope.teamId,
        rawEventId: sourceEventId,
      });
      await reconcileObjectAuditLinks(tx, {
        teamId: scope.teamId,
        rawEventId: sourceEventId,
        text: summary,
      });
      await tx.insert(objectChanges).values({
        teamId: scope.teamId,
        entityId: input.entityId,
        actorUserId: input.actor.userId ?? null,
        actorKind: input.actor.kind,
        status: 'applied',
        field: '__identity_facet_update__',
        previousValue: { id: existing[0].id },
        newValue: {
          id: existing[0].id,
          kind: input.kind,
          value,
          normalizedValue,
          provider: input.provider !== undefined ? input.provider : existing[0].provider,
          externalId: input.externalId !== undefined ? input.externalId : existing[0].externalId,
          linkedUserId:
            input.linkedUserId !== undefined ? input.linkedUserId : existing[0].linkedUserId,
        },
        sourceEventId: null,
      });
      await emitIdentityFacetDirectWriteOutput({
        db: tx,
        teamId: scope.teamId,
        entityId: input.entityId,
        identityFacetId: existing[0].id,
        identityFacetKind: input.kind,
        actor: input.actor,
        sourceEventId,
        operation: 'update',
        systemEventKind: 'identity_facet_update',
        value,
        normalizedValue,
        provider: input.provider !== undefined ? input.provider : existing[0].provider,
        externalId: input.externalId !== undefined ? input.externalId : existing[0].externalId,
        linkedUserId:
          input.linkedUserId !== undefined ? input.linkedUserId : existing[0].linkedUserId,
        previous: {
          value: existing[0].value,
          normalizedValue: existing[0].normalizedValue,
          provider: existing[0].provider,
          externalId: existing[0].externalId,
          linkedUserId: existing[0].linkedUserId,
        },
      });
      return { id: existing[0].id };
    }

    const inserted = await tx
      .insert(objectIdentityFacets)
      .values({
        teamId: scope.teamId,
        entityId: input.entityId,
        kind: input.kind,
        value,
        normalizedValue,
        provider: input.provider ?? null,
        externalId: input.externalId ?? null,
        linkedUserId: input.linkedUserId ?? null,
        source: input.source ?? (input.actor.kind === 'agent' ? 'agent_approved' : 'manual'),
        metadata: input.metadata ?? {},
        createdByUserId: input.actor.userId ?? null,
      })
      .returning({ id: objectIdentityFacets.id });
    const row = inserted[0];
    if (!row) throw new Error('Failed to create identity facet');

    const summary = `Added ${input.kind} identity for ${ent[0].canonicalName}: ${value}`;
    const rawEventId = randomUUID();
    const ev = await tx
      .insert(rawEvents)
      .values({
        id: rawEventId,
        teamId: scope.teamId,
        authorUserId: input.actor.userId ?? null,
        source: 'system',
        contentText: summary,
        occurredAt: new Date(),
        visibility: 'team',
        sourceMetadata: systemDirectWriteSourceMetadata({
          rawEventId,
          kind: 'identity_facet_create',
          metadata: {
            entity_id: input.entityId,
            identity_facet_id: row.id,
            identity_facet_kind: input.kind,
          },
          snapshot: {
            entity_id: input.entityId,
            identity_facet_id: row.id,
            identity_facet_kind: input.kind,
            value,
            normalized_value: normalizedValue,
            provider: input.provider ?? null,
            external_id: input.externalId ?? null,
            linked_user_id: input.linkedUserId ?? null,
            actor_kind: input.actor.kind,
            actor_user_id: input.actor.userId ?? null,
          },
        }),
      })
      .returning({ id: rawEvents.id });
    const sourceEventId = ev[0]?.id ?? null;
    await normalizeSystemRawEventEvidence({
      db: tx,
      teamId: scope.teamId,
      rawEventId: sourceEventId,
    });
    await reconcileObjectAuditLinks(tx, {
      teamId: scope.teamId,
      rawEventId: sourceEventId,
      text: summary,
    });

    await tx.insert(objectChanges).values({
      teamId: scope.teamId,
      entityId: input.entityId,
      actorUserId: input.actor.userId ?? null,
      actorKind: input.actor.kind,
      status: 'applied',
      field: '__identity_facet_create__',
      previousValue: null,
      newValue: {
        id: row.id,
        kind: input.kind,
        value,
        normalizedValue,
        provider: input.provider ?? null,
        externalId: input.externalId ?? null,
        linkedUserId: input.linkedUserId ?? null,
      },
      sourceEventId: null,
    });
    await emitIdentityFacetDirectWriteOutput({
      db: tx,
      teamId: scope.teamId,
      entityId: input.entityId,
      identityFacetId: row.id,
      identityFacetKind: input.kind,
      actor: input.actor,
      sourceEventId,
      operation: 'create',
      systemEventKind: 'identity_facet_create',
      value,
      normalizedValue,
      provider: input.provider ?? null,
      externalId: input.externalId ?? null,
      linkedUserId: input.linkedUserId ?? null,
    });

    return row;
  });

  fireAndForgetEmbed(() => embedQueue.enqueueObjectEmbedJob(scope.teamId, input.entityId), {
    teamId: scope.teamId,
    entityId: input.entityId,
    op: 'createIdentityFacet',
  });
  void fireAndForgetObjectSummaryRefresh(db, scope, input.entityId, {
    teamId: scope.teamId,
    objectId: input.entityId,
    identityFacetId: result.id,
    op: 'createIdentityFacet',
  });
  return result;
}

export async function updateNote(
  db: Db,
  scope: TeamScopeCore,
  input: {
    noteId: string;
    body: string;
    actorUserId: string | null;
    actor?: { kind: ActorKind; userId?: string | null };
    metadata?: Record<string, unknown>;
  },
): Promise<boolean> {
  await scope.requireMembership();
  if (!UUID_RE.test(input.noteId)) return false;
  const body = input.body.trim();
  if (!body) throw new Error('Note body cannot be empty');
  const actor = input.actor ?? { kind: 'user' as const, userId: input.actorUserId };

  const updated = await db.transaction(async (tx) => {
    // Authors-only edit. The UI hides the Edit button when authorUserId
    // doesn't match the viewer, but the action is also reachable by direct
    // POST — without this guard, any team member could rewrite anyone
    // else's notes. Returning false (not throw) so a hostile actor can't
    // probe note-id existence by error class.
    const conditions = [
      eq(objectNotes.id, input.noteId),
      eq(objectNotes.teamId, scope.teamId),
      isNull(objectNotes.deletedAt),
    ];
    if (actor.kind === 'user') {
      if (!input.actorUserId) return null;
      conditions.push(eq(objectNotes.authorUserId, input.actorUserId));
    }

    const existing = await tx
      .select()
      .from(objectNotes)
      .where(and(...conditions))
      .limit(1);
    const note = existing[0];
    if (!note) return null;
    if (note.body === body) return { changed: false, entityId: note.entityId };

    await tx
      .update(objectNotes)
      .set({ body, updatedAt: new Date() })
      .where(eq(objectNotes.id, input.noteId));

    const rawEventId = randomUUID();
    const ev = await tx
      .insert(rawEvents)
      .values({
        id: rawEventId,
        teamId: scope.teamId,
        authorUserId: input.actorUserId,
        source: 'system',
        contentText: `Note edited: ${body}`,
        occurredAt: new Date(),
        visibility: 'team',
        sourceMetadata: systemDirectWriteSourceMetadata({
          rawEventId,
          kind: 'object_note_update',
          metadata: {
            ...(input.metadata ?? {}),
            entity_id: note.entityId,
            note_id: note.id,
          },
          snapshot: {
            entity_id: note.entityId,
            note_id: note.id,
            body,
            previous_body: note.body,
            actor_kind: actor.kind,
            actor_user_id: actor.userId ?? null,
          },
        }),
      })
      .returning({ id: rawEvents.id });
    const sourceEventId = ev[0]?.id ?? null;
    await normalizeSystemRawEventEvidence({
      db: tx,
      teamId: scope.teamId,
      rawEventId: sourceEventId,
    });
    await reconcileObjectAuditLinks(tx, {
      teamId: scope.teamId,
      rawEventId: sourceEventId,
      text: `Note edited: ${body}`,
    });
    await tx.insert(objectChanges).values({
      teamId: scope.teamId,
      entityId: note.entityId,
      actorUserId: actor.userId ?? null,
      actorKind: actor.kind,
      status: 'applied',
      field: '__note_update__',
      previousValue: { note_id: note.id, body: note.body },
      newValue: { note_id: note.id, body },
      sourceEventId: null,
    });
    await emitNoteDirectWriteOutput({
      db: tx,
      teamId: scope.teamId,
      entityId: note.entityId,
      noteId: note.id,
      actor,
      sourceEventId,
      operation: 'update',
      systemEventKind: 'object_note_update',
      body,
      previousBody: note.body,
    });
    return { changed: true, entityId: note.entityId };
  });

  if (updated?.changed) {
    fireAndForgetEmbed(() => embedQueue.enqueueObjectNoteEmbedJob(scope.teamId, input.noteId), {
      teamId: scope.teamId,
      noteId: input.noteId,
      op: 'updateNote',
    });
    void fireAndForgetObjectSummaryRefresh(db, scope, updated.entityId, {
      teamId: scope.teamId,
      objectId: updated.entityId,
      noteId: input.noteId,
      op: 'updateNote',
    });
  }
  return Boolean(updated);
}

export async function deleteNote(
  db: Db,
  scope: TeamScopeCore,
  input: { noteId: string; actorUserId: string },
): Promise<boolean> {
  await scope.requireMembership();
  if (!UUID_RE.test(input.noteId)) return false;

  const result = await db.transaction(async (tx) => {
    // Authors-only delete. Same threat model as updateNote — UI hides the
    // button for non-authors, but the action is reachable by direct POST.
    const existing = await tx
      .select()
      .from(objectNotes)
      .where(
        and(
          eq(objectNotes.id, input.noteId),
          eq(objectNotes.teamId, scope.teamId),
          eq(objectNotes.authorUserId, input.actorUserId),
          isNull(objectNotes.deletedAt),
        ),
      )
      .limit(1);
    const note = existing[0];
    if (!note) return null;

    await tx
      .update(objectNotes)
      .set({ deletedAt: new Date() })
      .where(eq(objectNotes.id, input.noteId));

    const rawEventId = randomUUID();
    const ev = await tx
      .insert(rawEvents)
      .values({
        id: rawEventId,
        teamId: scope.teamId,
        authorUserId: input.actorUserId,
        source: 'system',
        contentText: `Note deleted`,
        occurredAt: new Date(),
        visibility: 'team',
        sourceMetadata: systemDirectWriteSourceMetadata({
          rawEventId,
          kind: 'object_note_delete',
          metadata: {
            entity_id: note.entityId,
            note_id: note.id,
          },
          snapshot: {
            entity_id: note.entityId,
            note_id: note.id,
            previous_body: note.body,
            actor_kind: 'user',
            actor_user_id: input.actorUserId,
          },
        }),
      })
      .returning({ id: rawEvents.id });
    const sourceEventId = ev[0]?.id ?? null;
    await normalizeSystemRawEventEvidence({
      db: tx,
      teamId: scope.teamId,
      rawEventId: sourceEventId,
    });
    await reconcileObjectAuditLinks(tx, {
      teamId: scope.teamId,
      rawEventId: sourceEventId,
      text: 'Note deleted',
    });
    await tx.insert(objectChanges).values({
      teamId: scope.teamId,
      entityId: note.entityId,
      actorUserId: input.actorUserId,
      actorKind: 'user',
      status: 'applied',
      field: '__note_delete__',
      previousValue: { note_id: note.id, body: note.body },
      newValue: null,
      sourceEventId: null,
    });
    await emitNoteDirectWriteOutput({
      db: tx,
      teamId: scope.teamId,
      entityId: note.entityId,
      noteId: note.id,
      actor: { kind: 'user', userId: input.actorUserId },
      sourceEventId,
      operation: 'archive_or_cancel',
      systemEventKind: 'object_note_delete',
      previousBody: note.body,
    });
    return { entityId: note.entityId };
  });
  if (!result) return false;
  void fireAndForgetObjectSummaryRefresh(db, scope, result.entityId, {
    teamId: scope.teamId,
    objectId: result.entityId,
    noteId: input.noteId,
    op: 'deleteNote',
  });
  return true;
}

export async function markVisited(db: Db, scope: TeamScopeCore, entityId: string): Promise<void> {
  await scope.requireMembership();
  if (!UUID_RE.test(entityId)) return;
  await db
    .insert(objectViews)
    .values({
      teamId: scope.teamId,
      userId: scope.userId,
      entityId,
      lastVisitedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [objectViews.teamId, objectViews.userId, objectViews.entityId],
      set: { lastVisitedAt: new Date() },
    });
}

// ---------- Notifications ----------

export interface NotificationRow {
  id: string;
  kind:
    | 'object_changed'
    | 'task_due'
    | 'board_item_due'
    | 'task_overdue'
    | 'follow_up_overdue'
    | 'mention'
    | 'agent_suggestion'
    | 'connection_attention';
  entityId: string | null;
  objectChangeId: string | null;
  agentSuggestionId: string | null;
  summary: string;
  payload: Record<string, unknown>;
  createdAt: Date;
  readAt: Date | null;
}

export async function listNotifications(
  db: Db,
  scope: TeamScopeCore,
  filter: {
    unreadOnly?: boolean;
    limit?: number;
    offset?: number;
    order?: 'inbox' | 'latest';
  } = {},
): Promise<NotificationRow[]> {
  await scope.requireMembership();
  const conds = [eq(notifications.teamId, scope.teamId), eq(notifications.userId, scope.userId)];
  if (filter.unreadOnly) conds.push(isNull(notifications.readAt));
  const limit = Math.min(Math.max(filter.limit ?? 100, 1), NOTIFICATION_QUERY_LIMIT_MAX);
  const offset = Math.max(filter.offset ?? 0, 0);
  // Unread-first, then newest. Matches the shape of
  // `notifications_team_user_inbox_idx` (team_id, user_id, read_at,
  // created_at) so the planner can satisfy the inbox query directly from
  // the index without re-sorting. Postgres default for ASC is NULLS LAST,
  // but we want unread (NULL read_at) at the TOP — hence the explicit
  // NULLS FIRST.
  const orderBy =
    filter.order === 'latest'
      ? [desc(notifications.createdAt)]
      : [sql`${notifications.readAt} ASC NULLS FIRST`, desc(notifications.createdAt)];
  const rows = await db
    .select()
    .from(notifications)
    .where(and(...conds))
    .orderBy(...orderBy)
    .limit(limit)
    .offset(offset);
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    entityId: r.entityId,
    objectChangeId: r.objectChangeId,
    agentSuggestionId: r.agentSuggestionId,
    summary: r.summary,
    payload: (r.payload ?? {}) as Record<string, unknown>,
    createdAt: r.createdAt,
    readAt: r.readAt,
  }));
}

export async function notificationCount(
  db: Db,
  scope: TeamScopeCore,
  filter: { unreadOnly?: boolean } = {},
): Promise<number> {
  await scope.requireMembership();
  const conds = [eq(notifications.teamId, scope.teamId), eq(notifications.userId, scope.userId)];
  if (filter.unreadOnly) conds.push(isNull(notifications.readAt));
  const rows = await db
    .select({ c: sql<number>`COUNT(*)::int` })
    .from(notifications)
    .where(and(...conds));
  return rows[0]?.c ?? 0;
}

export async function unreadNotificationCount(db: Db, scope: TeamScopeCore): Promise<number> {
  await scope.requireMembership();
  const rows = await db
    .select({ c: sql<number>`COUNT(*)::int` })
    .from(notifications)
    .where(
      and(
        eq(notifications.teamId, scope.teamId),
        eq(notifications.userId, scope.userId),
        isNull(notifications.readAt),
      ),
    );
  return rows[0]?.c ?? 0;
}

export async function markNotificationRead(
  db: Db,
  scope: TeamScopeCore,
  notificationId: string,
): Promise<boolean> {
  await scope.requireMembership();
  if (!UUID_RE.test(notificationId)) return false;
  const result = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notifications.id, notificationId),
        eq(notifications.teamId, scope.teamId),
        eq(notifications.userId, scope.userId),
        isNull(notifications.readAt),
      ),
    )
    .returning({ id: notifications.id });
  return result.length > 0;
}

export async function markAllNotificationsRead(db: Db, scope: TeamScopeCore): Promise<number> {
  await scope.requireMembership();
  const result = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notifications.teamId, scope.teamId),
        eq(notifications.userId, scope.userId),
        isNull(notifications.readAt),
      ),
    )
    .returning({ id: notifications.id });
  return result.length;
}

// ---------- Chat sessions ----------

export interface ChatSessionRow {
  id: string;
  title: string | null;
  pinnedEntityId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ChatMessageRow {
  id: string;
  role: 'user' | 'assistant' | 'tool' | 'system';
  authorUserId: string | null;
  content: unknown;
  createdAt: Date;
}

const CHAT_TITLE_MAX_LENGTH = 48;

function normalizeStoredChatTitle(title: string): string {
  const compact = title.replace(/\s+/g, ' ').trim();
  return (compact || 'New chat').slice(0, CHAT_TITLE_MAX_LENGTH).trim() || 'New chat';
}

function dedupeStoredChatTitle(title: string, existingTitles: string[]): string {
  const baseTitle = normalizeStoredChatTitle(title);
  const seen = new Set(existingTitles.map((value) => value.toLowerCase()));
  if (!seen.has(baseTitle.toLowerCase())) return baseTitle;
  for (let n = 2; n < 100; n += 1) {
    const suffix = ` ${n}`;
    const base = baseTitle.slice(0, CHAT_TITLE_MAX_LENGTH - suffix.length).trim();
    const candidate = `${base}${suffix}`;
    if (!seen.has(candidate.toLowerCase())) return candidate;
  }
  return `${baseTitle.slice(0, CHAT_TITLE_MAX_LENGTH - 4).trim()} ${Date.now()
    .toString()
    .slice(-3)}`;
}

export async function listChatSessions(
  db: Db,
  scope: TeamScopeCore,
  filter: { pinnedEntityId?: string; limit?: number; includeArchived?: boolean } = {},
): Promise<ChatSessionRow[]> {
  await scope.requireMembership();
  // Chat sessions are private to their creator within a team. Without
  // the createdBy filter, every team member would see every other
  // member's AI conversations in the sidebar and be able to read/write
  // them. `createdBy` is set to `scope.userId` at session creation
  // (see `createChatSession`) — every chat helper below mirrors this
  // (createdBy + teamId) pair.
  const conds = [eq(chatSessions.teamId, scope.teamId), eq(chatSessions.createdBy, scope.userId)];
  if (!filter.includeArchived) conds.push(isNull(chatSessions.archivedAt));
  if (filter.pinnedEntityId && UUID_RE.test(filter.pinnedEntityId)) {
    conds.push(eq(chatSessions.pinnedEntityId, filter.pinnedEntityId));
  }
  const rows = await db
    .select()
    .from(chatSessions)
    .where(and(...conds))
    .orderBy(desc(chatSessions.updatedAt))
    .limit(Math.min(Math.max(filter.limit ?? 50, 1), 200));
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    pinnedEntityId: r.pinnedEntityId,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));
}

export async function createChatSession(
  db: Db,
  scope: TeamScopeCore,
  input: { title?: string | null; pinnedEntityId?: string | null } = {},
): Promise<ChatSessionRow> {
  await scope.requireMembership();
  // If pinnedEntityId is given, verify team membership of that object.
  if (input.pinnedEntityId) {
    if (!UUID_RE.test(input.pinnedEntityId)) throw new Error('Invalid pinnedEntityId');
    const ent = await db
      .select({ id: entities.id })
      .from(entities)
      .where(and(eq(entities.id, input.pinnedEntityId), eq(entities.teamId, scope.teamId)))
      .limit(1);
    if (!ent[0]) throw new Error('Pinned object not in this team');
  }
  const rows = await db
    .insert(chatSessions)
    .values({
      teamId: scope.teamId,
      createdBy: scope.userId,
      title: input.title ?? null,
      pinnedEntityId: input.pinnedEntityId ?? null,
    })
    .returning();
  const r = rows[0];
  if (!r) throw new Error('Failed to create chat session');
  return {
    id: r.id,
    title: r.title,
    pinnedEntityId: r.pinnedEntityId,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

/**
 * Lightweight existence + team-scope check. Use this instead of
 * `getChatSession` when you only need to validate that a session id is
 * legal for the current team — `getChatSession` also loads every message,
 * which grows unbounded over the life of a conversation and turns into
 * wasted bandwidth on every /api/chat turn.
 */
export async function chatSessionExists(
  db: Db,
  scope: TeamScopeCore,
  sessionId: string,
): Promise<boolean> {
  await scope.requireMembership();
  if (!UUID_RE.test(sessionId)) return false;
  // Archived sessions must not accept new persisted turns. Without this
  // filter, `/api/chat` would happily route appendChatMessages into a
  // session the user has archived from the sidebar — confusing because
  // the chat appears "gone" from the UI but still grows in the DB.
  const rows = await db
    .select({ id: chatSessions.id })
    .from(chatSessions)
    .where(
      and(
        eq(chatSessions.id, sessionId),
        eq(chatSessions.teamId, scope.teamId),
        // See listChatSessions — sessions are per-user within a team.
        eq(chatSessions.createdBy, scope.userId),
        isNull(chatSessions.archivedAt),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

export async function chatSessionTitleStatus(
  db: Db,
  scope: TeamScopeCore,
  sessionId: string,
): Promise<{ exists: boolean; needsTitle: boolean }> {
  await scope.requireMembership();
  if (!UUID_RE.test(sessionId)) return { exists: false, needsTitle: false };
  const rows = await db
    .select({ title: chatSessions.title })
    .from(chatSessions)
    .where(
      and(
        eq(chatSessions.id, sessionId),
        eq(chatSessions.teamId, scope.teamId),
        eq(chatSessions.createdBy, scope.userId),
        isNull(chatSessions.archivedAt),
      ),
    )
    .limit(1);
  const row = rows[0];
  return { exists: Boolean(row), needsTitle: row?.title === null };
}

export async function getChatSession(
  db: Db,
  scope: TeamScopeCore,
  sessionId: string,
): Promise<{ session: ChatSessionRow; messages: ChatMessageRow[] } | null> {
  await scope.requireMembership();
  if (!UUID_RE.test(sessionId)) return null;
  // Archived sessions are also hidden from hydration. The chat page
  // would otherwise render an archived transcript that the route then
  // refuses to write to (chatSessionExists + appendChatMessages both
  // filter archived), so the user sees old messages but every new turn
  // returns session_not_found. Returning null here makes the page
  // resolve activeSessionId to null and behave like a fresh chat.
  const sessionRows = await db
    .select()
    .from(chatSessions)
    .where(
      and(
        eq(chatSessions.id, sessionId),
        eq(chatSessions.teamId, scope.teamId),
        // See listChatSessions — sessions are per-user within a team.
        eq(chatSessions.createdBy, scope.userId),
        isNull(chatSessions.archivedAt),
      ),
    )
    .limit(1);
  const s = sessionRows[0];
  if (!s) return null;
  const msgs = await db
    .select()
    .from(chatMessages)
    .where(and(eq(chatMessages.sessionId, sessionId), eq(chatMessages.teamId, scope.teamId)))
    .orderBy(chatMessages.createdAt);
  return {
    session: {
      id: s.id,
      title: s.title,
      pinnedEntityId: s.pinnedEntityId,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    },
    messages: msgs.map((m) => ({
      id: m.id,
      role: m.role,
      authorUserId: m.authorUserId,
      content: m.content,
      createdAt: m.createdAt,
    })),
  };
}

export interface AppendChatMessageInput {
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: unknown;
  authorUserId?: string | null;
}

export async function appendChatMessages(
  db: Db,
  scope: TeamScopeCore,
  sessionId: string,
  messages: AppendChatMessageInput[],
): Promise<void> {
  await scope.requireMembership();
  if (!UUID_RE.test(sessionId)) throw new Error('Invalid sessionId');
  if (messages.length === 0) return;
  await db.transaction(async (tx) => {
    // Reject archived sessions: belt-and-braces with `chatSessionExists`
    // in the route. A session archived between the route's existence
    // check and this append would otherwise grow under the user's nose.
    const sessionRows = await tx
      .select({ id: chatSessions.id })
      .from(chatSessions)
      .where(
        and(
          eq(chatSessions.id, sessionId),
          eq(chatSessions.teamId, scope.teamId),
          // See listChatSessions — sessions are per-user within a team.
          // Without this, /api/chat could write a teammate's message into
          // someone else's transcript.
          eq(chatSessions.createdBy, scope.userId),
          isNull(chatSessions.archivedAt),
        ),
      )
      .limit(1);
    if (!sessionRows[0]) throw new Error('Session not found');
    await tx.insert(chatMessages).values(
      messages.map((m) => ({
        teamId: scope.teamId,
        sessionId,
        role: m.role,
        authorUserId: m.authorUserId ?? null,
        content: m.content as never,
      })),
    );
    await tx
      .update(chatSessions)
      .set({ updatedAt: new Date() })
      .where(eq(chatSessions.id, sessionId));
  });
}

export async function setChatSessionTitle(
  db: Db,
  scope: TeamScopeCore,
  sessionId: string,
  title: string,
  options: { touchUpdatedAt?: boolean } = {},
): Promise<void> {
  await scope.requireMembership();
  if (!UUID_RE.test(sessionId)) return;
  await db
    .update(chatSessions)
    .set(options.touchUpdatedAt === false ? { title } : { title, updatedAt: new Date() })
    .where(
      and(
        eq(chatSessions.id, sessionId),
        eq(chatSessions.teamId, scope.teamId),
        // See listChatSessions — sessions are per-user within a team.
        eq(chatSessions.createdBy, scope.userId),
      ),
    );
}

export async function setUniqueChatSessionTitle(
  db: Db,
  scope: TeamScopeCore,
  sessionId: string,
  title: string,
  options: { touchUpdatedAt?: boolean } = {},
): Promise<void> {
  await scope.requireMembership();
  if (!UUID_RE.test(sessionId)) return;
  await db.transaction(async (tx) => {
    const lockKey = `${scope.teamId}:${scope.userId}:chat-title`;
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);

    const targetRows = await tx
      .select({ id: chatSessions.id, title: chatSessions.title })
      .from(chatSessions)
      .where(
        and(
          eq(chatSessions.id, sessionId),
          eq(chatSessions.teamId, scope.teamId),
          eq(chatSessions.createdBy, scope.userId),
          isNull(chatSessions.archivedAt),
        ),
      )
      .limit(1);
    const target = targetRows[0];
    if (target?.title !== null) return;

    const existingRows = await tx
      .select({ title: chatSessions.title })
      .from(chatSessions)
      .where(
        and(
          eq(chatSessions.teamId, scope.teamId),
          eq(chatSessions.createdBy, scope.userId),
          ne(chatSessions.id, sessionId),
          isNull(chatSessions.archivedAt),
          isNotNull(chatSessions.title),
        ),
      );
    const uniqueTitle = dedupeStoredChatTitle(
      title,
      existingRows.map((row) => row.title).filter((value): value is string => value !== null),
    );
    await tx
      .update(chatSessions)
      .set(
        options.touchUpdatedAt === false
          ? { title: uniqueTitle }
          : { title: uniqueTitle, updatedAt: new Date() },
      )
      .where(eq(chatSessions.id, sessionId));
  });
}

export async function linkChatSessionToObject(
  db: Db,
  scope: TeamScopeCore,
  sessionId: string,
  entityId: string | null,
): Promise<void> {
  await scope.requireMembership();
  if (!UUID_RE.test(sessionId)) return;
  if (entityId !== null && !UUID_RE.test(entityId)) return;
  // Verify the entity belongs to this team before pinning. The WHERE on
  // chat_sessions only checks the session's team; without this re-select a
  // caller could pin a session to another team's entity UUID, and the
  // session page would render an object id that resolves to nothing (or
  // worse — to that entity, if a future tool walks the pinned id without
  // its own team check). Mirror the guard from `createChatSession`.
  if (entityId !== null) {
    const ent = await db
      .select({ id: entities.id })
      .from(entities)
      .where(and(eq(entities.id, entityId), eq(entities.teamId, scope.teamId)))
      .limit(1);
    if (!ent[0]) throw new Error('Pinned object not in this team');
  }
  await db
    .update(chatSessions)
    .set({ pinnedEntityId: entityId, updatedAt: new Date() })
    .where(
      and(
        eq(chatSessions.id, sessionId),
        eq(chatSessions.teamId, scope.teamId),
        // See listChatSessions — sessions are per-user within a team.
        eq(chatSessions.createdBy, scope.userId),
      ),
    );
}

export async function archiveChatSession(
  db: Db,
  scope: TeamScopeCore,
  sessionId: string,
): Promise<void> {
  await scope.requireMembership();
  if (!UUID_RE.test(sessionId)) return;
  await db
    .update(chatSessions)
    .set({ archivedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(chatSessions.id, sessionId),
        eq(chatSessions.teamId, scope.teamId),
        // See listChatSessions — sessions are per-user within a team.
        eq(chatSessions.createdBy, scope.userId),
      ),
    );
}

// ---------- Object changes (queries + agent suggestions + review) ----------

export interface ObjectChangeRow {
  id: string;
  entityId: string;
  entityName: string;
  entityType: ObjectType;
  field: string;
  actorKind: ActorKind;
  actorUserId: string | null;
  previousValue: unknown;
  newValue: unknown;
  status: 'applied' | 'suggested' | 'rejected';
  note: string | null;
  changedAt: Date;
}

export async function listObjectChanges(
  db: Db,
  scope: TeamScopeCore,
  filter: {
    entityId?: string;
    status?: 'applied' | 'suggested' | 'rejected';
    since?: Date;
    limit?: number;
  } = {},
): Promise<ObjectChangeRow[]> {
  await scope.requireMembership();
  const conds = [eq(objectChanges.teamId, scope.teamId)];
  if (filter.entityId && UUID_RE.test(filter.entityId)) {
    conds.push(eq(objectChanges.entityId, filter.entityId));
  }
  if (filter.status) conds.push(eq(objectChanges.status, filter.status));
  if (filter.since) conds.push(gte(objectChanges.changedAt, filter.since));
  const rows = await db
    .select({
      id: objectChanges.id,
      entityId: objectChanges.entityId,
      entityName: entities.canonicalName,
      entityType: entities.type,
      field: objectChanges.field,
      actorKind: objectChanges.actorKind,
      actorUserId: objectChanges.actorUserId,
      previousValue: objectChanges.previousValue,
      newValue: objectChanges.newValue,
      status: objectChanges.status,
      note: objectChanges.note,
      changedAt: objectChanges.changedAt,
    })
    .from(objectChanges)
    .innerJoin(entities, eq(objectChanges.entityId, entities.id))
    .where(and(...conds))
    .orderBy(desc(objectChanges.changedAt))
    .limit(Math.min(Math.max(filter.limit ?? 50, 1), 200));
  return rows;
}

export interface ProposeObjectChangeInput {
  entityId: string;
  field: 'status' | 'stage' | 'priority' | 'ownerUserId' | 'assigneeUserId' | 'dueAt';
  newValue: unknown;
  note?: string | null;
  actorUserId?: string | null;
}

/**
 * Validate (field, value) against the same shape `updateObject` enforces
 * when the suggestion is later accepted. Without this check, an LLM
 * could call `propose_object_change({field:'priority', newValue:'banana'})`
 * and the row sits in `object_changes` until a human clicks Accept —
 * at which point `acceptObjectChange` would try `new Date('banana')`
 * (Invalid Date) or write a string into a smallint column (22P02),
 * surfacing as a generic 500 from the accept button with no hint that
 * the suggestion was malformed. Reject at propose time so the agent
 * gets immediate feedback and the inbox never shows un-acceptable rows.
 *
 * Returns the normalized value so the stored jsonb matches what
 * `updateObject` will eventually write (e.g., null instead of empty
 * string for nullable fields, ISO datetime instead of Date object).
 */
export function normalizeObjectPatchValue(
  field: ProposeObjectChangeInput['field'],
  newValue: unknown,
): unknown {
  switch (field) {
    case 'status': {
      if (typeof newValue !== 'string') throw new Error('status must be a string');
      const trimmed = newValue.trim();
      if (!trimmed || trimmed.length > 40) throw new Error('status: 1-40 chars');
      return trimmed;
    }
    case 'stage': {
      if (newValue === null) return null;
      if (typeof newValue !== 'string') throw new Error('stage must be a string or null');
      const trimmed = newValue.trim();
      if (trimmed.length > 40) throw new Error('stage: max 40 chars');
      return trimmed === '' ? null : trimmed;
    }
    case 'priority': {
      if (newValue === null) return null;
      if (typeof newValue !== 'number' || !Number.isInteger(newValue)) {
        throw new Error('priority must be an integer 1-4 or null');
      }
      if (newValue < 1 || newValue > 4) throw new Error('priority: 1-4');
      return newValue;
    }
    case 'ownerUserId':
    case 'assigneeUserId': {
      if (newValue === null) return null;
      if (typeof newValue !== 'string' || !UUID_RE.test(newValue)) {
        throw new Error(`${field} must be a UUID or null`);
      }
      return newValue;
    }
    case 'dueAt': {
      if (newValue === null) return null;
      if (typeof newValue !== 'string') throw new Error('dueAt must be ISO datetime or null');
      const d = new Date(newValue);
      if (Number.isNaN(d.getTime())) throw new Error('dueAt: invalid date');
      return d.toISOString();
    }
  }
}

/**
 * Write a `suggested` row to object_changes without mutating the entity.
 * Used by the agent's `propose_object_change` tool. A human reviews via the
 * suggestion UI on the object page; `acceptObjectChange` applies it.
 */
export async function proposeObjectChange(
  db: Db,
  scope: TeamScopeCore,
  input: ProposeObjectChangeInput,
): Promise<{ id: string }> {
  await scope.requireMembership();
  if (!UUID_RE.test(input.entityId)) throw new Error('Invalid entity id');

  // Validate value shape against the target field BEFORE writing. See
  // `normalizeProposedValue` doc for why this matters — without it, the
  // failure surfaces at human-accept time as a confusing 500.
  const normalized = normalizeObjectPatchValue(input.field, input.newValue);

  // If the proposed value is a user reference, verify team membership so
  // the agent can't seed a foreign user that later gets pushed through
  // updateObject and leaks via notification fan-out.
  if (
    (input.field === 'ownerUserId' || input.field === 'assigneeUserId') &&
    typeof normalized === 'string'
  ) {
    await scope.requireTeamMember(normalized);
  }

  const result = await db.transaction(async (tx) => {
    const entRows = await tx
      .select()
      .from(entities)
      .where(
        and(
          eq(entities.id, input.entityId),
          eq(entities.teamId, scope.teamId),
          isNull(entities.mergedIntoId),
        ),
      )
      .limit(1);
    const ent = entRows[0];
    if (!ent) throw new Error('Object not found');

    const previousValue = (ent as Record<string, unknown>)[input.field] ?? null;

    const inserted = await tx
      .insert(objectChanges)
      .values({
        teamId: scope.teamId,
        entityId: input.entityId,
        actorUserId: input.actorUserId ?? null,
        actorKind: 'agent',
        status: 'suggested',
        field: input.field,
        previousValue,
        newValue: normalized,
        note: input.note ?? null,
      })
      .returning({ id: objectChanges.id });
    const changeId = inserted[0]?.id;
    if (!changeId) throw new Error('Failed to record suggestion');

    // Fan out to owner + assignee. Mirrors the recipient set in
    // updateObject so assignees don't silently miss agent suggestions on
    // objects they don't own. Dedup via Set: when owner == assignee they
    // get one row, not two.
    const recipients = new Set<string>();
    if (ent.ownerUserId) recipients.add(ent.ownerUserId);
    if (ent.assigneeUserId) recipients.add(ent.assigneeUserId);
    if (recipients.size > 0) {
      const summary = `Agent suggests ${input.field} → ${JSON.stringify(input.newValue)} on ${ent.canonicalName}`;
      await tx.insert(notifications).values(
        Array.from(recipients).map((uid) => ({
          teamId: scope.teamId,
          userId: uid,
          kind: 'agent_suggestion' as const,
          entityId: input.entityId,
          objectChangeId: changeId,
          summary,
          payload: {
            entity_id: input.entityId,
            field: input.field,
            new_value: input.newValue,
          },
        })),
      );
    }

    return { id: changeId };
  });

  fireAndForgetEmbed(() => embedQueue.enqueueObjectChangeEmbedJob(scope.teamId, result.id), {
    teamId: scope.teamId,
    changeId: result.id,
    op: 'proposeObjectChange',
  });
  return result;
}

/**
 * Accept a suggested change: apply it to the entity via `updateObject` so the
 * full audit/notification path runs, then flip the suggestion row's status to
 * `applied`. Returns false if the suggestion isn't in `suggested` state.
 */
export async function acceptObjectChange(
  db: Db,
  scope: TeamScopeCore,
  changeId: string,
  actor: UpdateActor,
): Promise<boolean> {
  await scope.requireMembership();
  if (!UUID_RE.test(changeId)) return false;

  const rows = await db
    .select()
    .from(objectChanges)
    .where(
      and(
        eq(objectChanges.id, changeId),
        eq(objectChanges.teamId, scope.teamId),
        eq(objectChanges.status, 'suggested'),
      ),
    )
    .limit(1);
  const change = rows[0];
  if (!change) return false;

  // Build a patch object keyed by the suggestion's field. Two cases:
  //
  // 1. Legacy `__create__` suggestions. New object creation approvals are
  //    represented by reconciliation outputs and suggestion projection rows,
  //    but older rows may still point at an entity with `status='suggested'`.
  //    Accepting flips it to a working status so the object leaves the
  //    "needs review" state. We pick the default by type so a suggested task
  //    lands in 'todo' and other types land in 'open'.
  //
  // 2. A field-scoped suggestion (`status`/`stage`/...) from
  //    `proposeObjectChange`. Restrict to the exact set the proposer
  //    accepts so the agent can't sneak a canonicalName/aliases/metadata
  //    rewrite through a hand-crafted row, and other structural markers
  //    (`__relationship_create__`, `__note_update__`, ...) can never be
  //    auto-applied.
  const proposable: readonly (keyof ObjectPatch)[] = [
    'status',
    'stage',
    'priority',
    'ownerUserId',
    'assigneeUserId',
    'dueAt',
  ];
  const isCreate = change.field === '__create__';
  if (!isCreate && !(proposable as readonly string[]).includes(change.field)) return false;

  const patch: ObjectPatch = {};
  if (isCreate) {
    // Read the entity's current type so we pick the right default
    // working status. Cheap one-row lookup keyed by id+team — the
    // updateObject call below will re-fetch with FOR UPDATE.
    const entRows = await db
      .select({ type: entities.type })
      .from(entities)
      .where(and(eq(entities.id, change.entityId), eq(entities.teamId, scope.teamId)))
      .limit(1);
    const entType = entRows[0]?.type;
    if (!entType) return false;
    patch.status = entType === 'task' || entType === 'follow_up' ? 'todo' : 'open';
  } else {
    const value = change.newValue;
    // `dueAt` round-trips through JSON as a string — rehydrate so the
    // diff in updateObject doesn't compare Date to string and write a
    // phantom change.
    if (change.field === 'dueAt') {
      patch.dueAt = value === null ? null : new Date(value as string);
    } else {
      (patch as Record<string, unknown>)[change.field] = value;
    }
  }

  // Claim the suggestion FIRST with an atomic CAS on status='suggested',
  // before mutating the entity. This is the only synchronization point
  // between accept and reject — `Db` doesn't expose `PgTransaction` so we
  // can't wrap updateObject in an outer transaction, and a post-mutation
  // flip would race with a concurrent reject (the user wanted to reject,
  // but the entity already got the suggested value applied — irreversible).
  // Claim-then-apply means a concurrent reject loses cleanly (0 rows), and
  // a failed updateObject can revert the claim so the user can retry.
  const claimed = await db
    .update(objectChanges)
    .set({ status: 'applied' })
    .where(and(eq(objectChanges.id, changeId), eq(objectChanges.status, 'suggested')))
    .returning({ id: objectChanges.id });
  if (claimed.length === 0) return false;

  try {
    await updateObject(db, scope, change.entityId, patch, actor);
  } catch (err) {
    // Restore the suggestion to `suggested` so the user can retry or
    // reject. Only restore if it's still our `applied` claim — a manual
    // status change in the meantime should win.
    await db
      .update(objectChanges)
      .set({ status: 'suggested' })
      .where(and(eq(objectChanges.id, changeId), eq(objectChanges.status, 'applied')));
    throw err;
  }
  return true;
}

export async function rejectObjectChange(
  db: Db,
  scope: TeamScopeCore,
  changeId: string,
): Promise<boolean> {
  await scope.requireMembership();
  if (!UUID_RE.test(changeId)) return false;
  const result = await db
    .update(objectChanges)
    .set({ status: 'rejected' })
    .where(
      and(
        eq(objectChanges.id, changeId),
        eq(objectChanges.teamId, scope.teamId),
        eq(objectChanges.status, 'suggested'),
      ),
    )
    .returning({ id: objectChanges.id });
  return result.length > 0;
}

export function createObjectScope(db: Db, scope: TeamScopeCore) {
  return {
    listObjects: (filter?: ObjectListFilter) => listObjects(db, scope, filter),
    countObjects: (filter?: ObjectCountFilter) => countObjects(db, scope, filter),
    searchObjects: (filter: ObjectSearchFilter) => searchObjects(db, scope, filter),
    searchObjectsBySummary: (input: { query: string; archived?: boolean; limit?: number }) =>
      searchObjectsBySummary(db, scope, input),
    getObject: (idOrName: string) => getObject(db, scope, idOrName),
    getObjectSummary: (entityId: string) => getObjectSummary(db, scope, entityId),
    listReadyObjectSummaries: (entityIds: string[]) =>
      listReadyObjectSummaries(db, scope, entityIds),
    enqueueObjectSummaryRefresh: (
      entityId: string,
      opts?: Parameters<typeof enqueueObjectSummaryRefresh>[3],
    ) => enqueueObjectSummaryRefresh(db, scope, entityId, opts),
    getObjectNotePreview: (noteId: string) => getObjectNotePreview(db, scope, noteId),
    getMergedObjectTarget: (entityId: string) => getMergedObjectTarget(db, scope, entityId),
    getObjectMergePreview: (entityIds: string[], survivorId?: string) =>
      getObjectMergePreview(db, scope, entityIds, survivorId),
    getObjectSectionPage: (
      entityId: string,
      section: ObjectSection,
      args?: { limit?: number; cursor?: string | null },
    ) => getObjectSectionPage(db, scope, entityId, section, args),
    createObject: (input: CreateObjectInput) => createObject(db, scope, input),
    updateObject: (entityId: string, patch: ObjectPatch, actor: UpdateActor) =>
      updateObject(db, scope, entityId, patch, actor),
    archiveObject: (entityId: string, actor: UpdateActor) =>
      archiveObject(db, scope, entityId, actor),
    unarchiveObject: (entityId: string, actor: UpdateActor) =>
      unarchiveObject(db, scope, entityId, actor),
    mergeObjects: (input: Parameters<typeof mergeObjects>[2]) => mergeObjects(db, scope, input),
    listPrimaryProjectsForTasks: (taskIds: string[]) =>
      listPrimaryProjectsForTasks(db, scope, taskIds),
    setTaskProject: (taskId: string, projectId: string | null, actor: UpdateActor) =>
      setTaskProject(db, scope, taskId, projectId, actor),
    getTaskCategoryClassificationInput: (taskId: string) =>
      getTaskCategoryClassificationInput(db, scope, taskId),
    setTaskCategory: (taskId: string, category: TaskCategory, actor: UpdateActor) =>
      setTaskCategory(db, scope, taskId, category, actor),
    undoTaskCategoryChange: (taskId: string, changeId: string, actor: UpdateActor) =>
      undoTaskCategoryChange(db, scope, taskId, changeId, actor),
    resetTaskCategoryToAutomatic: (taskId: string, actor: UpdateActor) =>
      resetTaskCategoryToAutomatic(db, scope, taskId, actor),
    retryTaskCategory: (taskId: string, actor: UpdateActor) =>
      retryTaskCategory(db, scope, taskId, actor),
    enqueueTaskCategoryBackfill: (taskId: string) => enqueueTaskCategoryBackfill(db, scope, taskId),
    applyTaskCategoryClassification: (
      input: Parameters<typeof applyTaskCategoryClassification>[2],
    ) => applyTaskCategoryClassification(db, scope, input),
    invalidateTaskCategoriesForProject: (
      input: Parameters<typeof invalidateTaskCategoriesForProject>[2],
    ) => invalidateTaskCategoriesForProject(db, scope, input),
    failTaskCategoryClassification: (input: Parameters<typeof failTaskCategoryClassification>[2]) =>
      failTaskCategoryClassification(db, scope, input),
    addRelationship: (input: Parameters<typeof addRelationship>[2]) =>
      addRelationship(db, scope, input),
    createIdentityFacet: (input: IdentityFacetInput) => createIdentityFacet(db, scope, input),
    listIdentityFacets: (entityId: string) => listIdentityFacets(db, scope, entityId),
    listIdentityFacetsForUser: (linkedUserId: string) =>
      listIdentityFacetsForUser(db, scope, linkedUserId),
    removeRelationship: (id: string, actor: UpdateActor) =>
      removeRelationship(db, scope, id, actor),
    createNote: (input: Parameters<typeof createNote>[2]) => createNote(db, scope, input),
    updateNote: (input: Parameters<typeof updateNote>[2]) => updateNote(db, scope, input),
    deleteNote: (input: Parameters<typeof deleteNote>[2]) => deleteNote(db, scope, input),
    markVisited: (entityId: string) => markVisited(db, scope, entityId),
    listNotifications: (filter?: Parameters<typeof listNotifications>[2]) =>
      listNotifications(db, scope, filter),
    notificationCount: (filter?: Parameters<typeof notificationCount>[2]) =>
      notificationCount(db, scope, filter),
    unreadNotificationCount: () => unreadNotificationCount(db, scope),
    markNotificationRead: (id: string) => markNotificationRead(db, scope, id),
    markAllNotificationsRead: () => markAllNotificationsRead(db, scope),
    listChatSessions: (filter?: Parameters<typeof listChatSessions>[2]) =>
      listChatSessions(db, scope, filter),
    createChatSession: (input?: Parameters<typeof createChatSession>[2]) =>
      createChatSession(db, scope, input),
    chatSessionExists: (sessionId: string) => chatSessionExists(db, scope, sessionId),
    chatSessionTitleStatus: (sessionId: string) => chatSessionTitleStatus(db, scope, sessionId),
    getChatSession: (sessionId: string) => getChatSession(db, scope, sessionId),
    appendChatMessages: (sessionId: string, messages: AppendChatMessageInput[]) =>
      appendChatMessages(db, scope, sessionId, messages),
    setChatSessionTitle: (
      sessionId: string,
      title: string,
      options?: Parameters<typeof setChatSessionTitle>[4],
    ) => setChatSessionTitle(db, scope, sessionId, title, options),
    setUniqueChatSessionTitle: (
      sessionId: string,
      title: string,
      options?: Parameters<typeof setUniqueChatSessionTitle>[4],
    ) => setUniqueChatSessionTitle(db, scope, sessionId, title, options),
    linkChatSessionToObject: (sessionId: string, entityId: string | null) =>
      linkChatSessionToObject(db, scope, sessionId, entityId),
    archiveChatSession: (sessionId: string) => archiveChatSession(db, scope, sessionId),
    listObjectChanges: (filter?: Parameters<typeof listObjectChanges>[2]) =>
      listObjectChanges(db, scope, filter),
    proposeObjectChange: (input: ProposeObjectChangeInput) => proposeObjectChange(db, scope, input),
    acceptObjectChange: (changeId: string, actor: UpdateActor) =>
      acceptObjectChange(db, scope, changeId, actor),
    rejectObjectChange: (changeId: string) => rejectObjectChange(db, scope, changeId),
  };
}

export type ObjectScope = ReturnType<typeof createObjectScope>;

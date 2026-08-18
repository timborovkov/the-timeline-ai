import {
  artifactEvidenceAssociations,
  type Db,
  entities,
  integrations,
  mondayConversationTombstoneInvalidations,
  mondayConversationTombstones,
  rawEvents,
  reconciliationEvidence,
  reconciliationOutputs,
  reconciliationRuns,
  slackConversationBindings,
  slackWorkspaces,
} from '@timeline/db';
import { and, eq, inArray, sql } from 'drizzle-orm';

import type { IntegrationEvent, IntegrationRow, ObjectMapping } from '#src/integrations/types.js';

import {
  reconcileArtifactEvidence,
  type ArtifactAnchorInput,
  type ArtifactClusterKind,
  type ArtifactStatus,
  type EvidenceRole,
  type EvidenceStrength,
} from '#src/artifacts/index.js';
import { sourceMetadataWithConversationArtifacts } from '#src/conversational/contact-artifacts.js';
import {
  reconcileLinkArtifactsForRawEvent,
  textHasLinks,
} from '#src/conversational/link-artifacts.js';
import { classifyCapturedEvent, type TimelineEventClass } from '#src/event-class.js';
import {
  enqueueGithubTaskProposalJob,
  capturedWorkItemFromIntegrationEvent,
} from '#src/integrations/github-task-proposals.js';
import {
  integrationExtractSkipReason,
  integrationSkipsExtract,
} from '#src/integrations/ingest-processing.js';
import { compactObjectMap, resolveSignalClassForEvent } from '#src/integrations/signal-class.js';
import { childLogger } from '#src/logger.js';
import { invalidateObjectSummariesForRawEvent } from '#src/objects/summaries.js';
import { enqueueEmbedJob, enqueueExtractJob } from '#src/queue/queues.js';
import {
  AUTHORITY_POLICY_VERSION,
  authorityDecisionPayload,
  evaluateAuthorityPolicy,
  type AuthorityPolicyInput,
} from '#src/reconciliation/authority.js';
import {
  buildAssociationDedupeKey,
  buildOutputDedupeKey,
  reconciliationDedupeKey,
} from '#src/reconciliation/index.js';
import { normalizeIntegrationEventsToEvidence } from '#src/reconciliation/normalization.js';
import {
  inlineSourceSnapshotMetadata,
  payloadDigestFromMetadata,
  sourcePayloadRefFromMetadata,
} from '#src/reconciliation/source-snapshot.js';
import { withTeam } from '#src/team-scope.js';

const log = childLogger('integrations:event-writer');

// Phase 11 — Persist normalized integration events into raw_events with
// source='integration' + dedup_key. The partial unique index
// `raw_events_integration_dedup_unq` makes duplicate writes a no-op.
//
// Embedding: every newly inserted row is enqueued as a standard
// raw_event embed job. The worker stamps `source_kind='integration_event'`
// onto the Qdrant payload so the agent can narrow searches.
//
// Workspace object mapping: events that carry `objectMap` now feed artifact
// reconciliation instead of upserting workspace objects. Existing provider-
// linked entities are still resolved as compatibility links so old object pages
// can hydrate connected work, but new provider records are represented by
// clusters, associations, source refs, and reconciliation outputs.

const INTEGRATION_DIRECT_WRITE_RUN_VERSION = 'integration-direct-write-2026-06';
const INTEGRATION_DIRECT_WRITE_PLANNER_VERSION = 'integration-object-map-2026-06';
const INTEGRATION_OBSERVED_ASSOCIATION_RUN_VERSION = 'integration-observed-association-2026-06';
const INTEGRATION_OBSERVED_ASSOCIATION_PLANNER_VERSION = 'integration-association-2026-06';
const INTEGRATION_SOURCE_SNAPSHOT_VERSION = 'integration-source-snapshot-2026-06';
const TOMBSTONE_SYSTEM_ACTOR_ID = '00000000-0000-0000-0000-000000000000';

interface IntegrationProjectionEvidence {
  id: string;
  sourcePayloadRef: string | null;
  visibility: 'team' | 'private' | 'specific_users';
  visibilityOwnerUserId: string | null;
  visibilityUserIds: string[] | null;
}

function sourcePayloadRefsForEvidence(
  evidence: Pick<IntegrationProjectionEvidence, 'sourcePayloadRef'>,
): string[] {
  return evidence.sourcePayloadRef ? [evidence.sourcePayloadRef] : [];
}

function integrationProjectionSourceEnvelope(
  evidence: IntegrationProjectionEvidence,
  sourceRefs: { source: string; rawEventId: string; sourcePayloadRef: string | null }[],
) {
  return {
    sourceRefs,
    sourcePayloadRefs: sourcePayloadRefsForEvidence(evidence),
    visibility: evidence.visibility,
    visibilityOwnerUserId: evidence.visibilityOwnerUserId,
    visibilityUserIds: evidence.visibilityUserIds,
    visibilityFloor: evidence.visibility,
    visibilityFloorOwnerUserId: evidence.visibilityOwnerUserId,
    visibilityFloorUserIds: evidence.visibilityUserIds,
  };
}

interface IntegrationProjectionOutputInput {
  teamId: string;
  integrationId: string;
  clusterId: string;
  rawEventId: string;
  event: IntegrationEvent & { objectMap: ObjectMapping };
  role: (typeof artifactEvidenceAssociations.$inferInsert)['role'];
  strength: EvidenceStrength;
  associationSource: (typeof artifactEvidenceAssociations.$inferInsert)['associationSource'];
  evidence: IntegrationProjectionEvidence;
}

interface IntegrationProjectionOutputConfig {
  runScope: string;
  runVersion: string;
  runDedupeKind: string;
  outputKind: 'direct_write' | 'observed_association';
  targetKind: 'cluster_lifecycle' | 'cluster_identity';
  targetField: string | null;
  operation: 'update' | 'link';
  targetIdentity: string;
  plannerVersion: string;
  payload: Record<string, unknown>;
}

function resolveEventVisibility(args: {
  requestedVisibility: 'team' | 'private' | 'specific_users';
  integrationDefault: 'team' | 'private' | 'specific_users';
  hasSpecificUsers: boolean;
  hasVisibilityOwner: boolean;
}): 'team' | 'private' | 'specific_users' {
  if (args.requestedVisibility === 'specific_users') {
    if (args.hasSpecificUsers) return 'specific_users';
    if (args.integrationDefault === 'private' && args.hasVisibilityOwner) return 'private';
    return 'team';
  }

  if (args.requestedVisibility === 'private' && !args.hasVisibilityOwner) {
    return 'team';
  }

  return args.requestedVisibility;
}

function integrationEventClass(event: IntegrationEvent): TimelineEventClass {
  if (event.eventClass) return event.eventClass;
  return classifyCapturedEvent({
    source: 'integration',
    metadata: {
      ...(event.extra ?? {}),
      provider: event.provider,
      event_type: event.eventType,
    },
  });
}

export async function writeIntegrationEvents(deps: {
  db: Db;
  integration: IntegrationRow;
  events: IntegrationEvent[];
}): Promise<string[]> {
  if (deps.events.length === 0) return [];

  const visibility = deps.integration.visibilityDefault;
  const teamId = deps.integration.teamId;
  // Attribute integration rows to the user who connected the integration.
  // Private visibility matches either author_user_id or visibility_owner_user_id;
  // using the connector owner for both preserves old private-row semantics and
  // makes ownership obvious in the timeline UI.
  const authorUserId = deps.integration.connectedByUserId ?? null;

  // Dedupe by dedupKey within the batch. Postgres's
  // `ON CONFLICT DO NOTHING` only resolves conflicts against existing
  // rows — two rows in the same VALUES list that share the partial
  // unique index's expression still raise
  // `cardinality_violation`/`unique_violation` and fail the whole
  // batch. A single sync page or coalesced webhook delivery can carry
  // the same dedupKey twice (e.g. a PR webhook firing `pr.updated`
  // and `pr.review.approved` for the same review), so collapse them
  // here before the insert. First occurrence wins.
  const seenDedup = new Set<string>();
  const uniqueEvents = deps.events.filter((evt) => {
    if (seenDedup.has(evt.dedupKey)) return false;
    seenDedup.add(evt.dedupKey);
    return true;
  });
  const writableEvents = await filterEventsOwnedByNativeIntegrations(deps, uniqueEvents);
  if (writableEvents.length === 0) return [];

  // A delete and a stale backfill can arrive in either order. Serialize writes
  // for this integration, persist delete targets first, and consult those
  // targets while constructing immutable raw rows. The lock makes this durable
  // across workers rather than merely within one in-memory batch.
  const writeResult = await deps.db.transaction(async (tx) => {
    const lockedIntegration = await tx
      .select({ id: integrations.id })
      .from(integrations)
      .where(
        and(
          eq(integrations.id, deps.integration.id),
          eq(integrations.teamId, deps.integration.teamId),
        ),
      )
      .for('update')
      .limit(1);
    if (!lockedIntegration[0]) {
      throw new Error('Integration is no longer available for event writing');
    }

    const tombstones = mondayConversationTombstonesFromEvents(deps.integration, writableEvents);
    await persistMondayConversationTombstones(tx as unknown as Db, tombstones);
    const tombstonedConversations = await tombstoneStoredMondayConversations(
      tx as unknown as Db,
      deps.integration,
      tombstones,
    );
    await persistMondayConversationTombstoneInvalidations(
      tx as unknown as Db,
      deps.integration,
      tombstonedConversations,
    );
    // Deleting a ready summary is derived database state, so make it atomic
    // with the tombstone and its durable invalidation record. If this fails,
    // the source lifecycle change rolls back too; there is no committed state
    // where retrieval can serve a deleted conversation from a stale summary.
    await invalidateMondayConversationTombstoneSummaries(
      tx as unknown as Db,
      deps.integration,
      tombstones.map((target) => target.targetKey),
    );
    const tombstonesByTargetKey = await loadMondayConversationTombstones(
      tx as unknown as Db,
      deps.integration,
      writableEvents,
    );

    const values = writableEvents.map((evt) => {
      const visibilityOwnerUserId = deps.integration.connectedByUserId ?? null;
      const sourcePayloadMetadata = sourcePayloadMetadataForEvent(evt);
      const requestedVisibility = evt.visibility ?? visibility;
      const requestedUserIds =
        requestedVisibility === 'specific_users'
          ? (evt.visibilityUserIds ??
            (visibility === 'specific_users' ? deps.integration.visibilityDefaultUserIds : null))
          : null;
      const hasSpecificUsers = (requestedUserIds?.length ?? 0) > 0;
      const resolvedVisibility = resolveEventVisibility({
        requestedVisibility,
        integrationDefault: visibility,
        hasSpecificUsers,
        hasVisibilityOwner: Boolean(visibilityOwnerUserId),
      });
      const deletionMetadata = tombstoneMetadataForFutureConversationEvent(
        evt,
        tombstonesByTargetKey,
      );
      const signalClass = resolveSignalClassForEvent(evt);
      const extractSkipReason = integrationExtractSkipReason({
        signalClass,
        provider: evt.provider,
        eventType: evt.eventType,
        extra: evt.extra ?? null,
        objectMap: evt.objectMap ?? null,
      });
      const extractionSkip = extractSkipReason
        ? {
            extraction_skipped_at: new Date().toISOString(),
            extraction_skipped_reason: extractSkipReason,
          }
        : {};
      const objectMap = compactObjectMap(evt.objectMap);

      return {
        teamId,
        authorUserId,
        visibilityOwnerUserId,
        source: 'integration' as const,
        contentText: evt.contentText,
        occurredAt: evt.occurredAt,
        visibility: resolvedVisibility,
        visibilityUserIds: resolvedVisibility === 'specific_users' ? requestedUserIds : null,
        sourceMetadata: sourceMetadataWithConversationArtifacts(
          {
            ...rawMetadataExtra(evt.extra),
            provider: evt.provider,
            integration_id: deps.integration.id,
            external_object_id: evt.externalObjectId,
            external_event_id: evt.externalEventId ?? null,
            event_type: evt.eventType,
            event_class: integrationEventClass(evt),
            actor: evt.actor ?? null,
            dedup_key: evt.dedupKey,
            sync_at: new Date().toISOString(),
            source_kind: 'integration_event',
            signal_class: signalClass,
            ...(objectMap ? { object_map: objectMap } : {}),
            ...sourcePayloadMetadata,
            ...deletionMetadata,
            ...extractionSkip,
          },
          evt.contentText,
        ),
      };
    });

    const inserted = await tx
      .insert(rawEvents)
      .values(values)
      .returning({
        id: rawEvents.id,
        dedupKey: sql<string>`${rawEvents.sourceMetadata} ->> 'dedup_key'`,
        sourceMetadata: rawEvents.sourceMetadata,
      })
      .onConflictDoNothing();
    return { inserted };
  });

  const { inserted } = writeResult;

  const activeInserted = inserted.filter(
    (row) => (row.sourceMetadata as { deleted?: unknown }).deleted !== true,
  );

  const eventByDedupKey = new Map(writableEvents.map((event) => [event.dedupKey, event]));
  await Promise.all(
    activeInserted.flatMap((row) => {
      const matchingEvent = eventByDedupKey.get(row.dedupKey);
      const jobs = [
        enqueueIntegrationProcessingJob(deps.db, row.id, 'embedding', () =>
          enqueueEmbedJob({ scope: 'raw_event', teamId, rawEventId: row.id }),
        ),
      ];
      if (
        !integrationSkipsExtract({
          sourceMetadata: row.sourceMetadata,
          extra: matchingEvent?.extra,
          objectMap: matchingEvent?.objectMap,
          provider: matchingEvent?.provider ?? deps.integration.provider,
          eventType: matchingEvent?.eventType,
          signalClass: matchingEvent?.signalClass,
        })
      ) {
        jobs.unshift(
          enqueueIntegrationProcessingJob(deps.db, row.id, 'extraction', () =>
            enqueueExtractJob({ teamId, rawEventId: row.id }),
          ),
        );
      }
      return jobs;
    }),
  );

  // Normalization and artifact reconciliation are repairable from existing
  // raw_events. Replays with the same dedup_key must fill missing evidence,
  // links, clusters, associations, and outputs.
  const rawEventIdsByDedupKey = await loadRawEventIdsByDedupKey(
    deps.db,
    teamId,
    writableEvents.map((event) => event.dedupKey),
  );
  // A raw source that is already tombstoned remains immutable evidence, but
  // must not feed extraction, embeddings, links, or reconciliation again on a
  // stale sync replay.
  const activeWritableEvents = writableEvents.filter((event) =>
    rawEventIdsByDedupKey.has(event.dedupKey),
  );
  await normalizeIntegrationEventsToEvidence({
    db: deps.db,
    teamId,
    events: activeWritableEvents,
    rawEventIdsByDedupKey,
  });

  const artifactEvents = activeWritableEvents.filter(
    (evt): evt is IntegrationEvent & { objectMap: ObjectMapping } =>
      Boolean(evt.objectMap) && integrationEventClass(evt) !== 'pulse',
  );
  const linkEvents = activeWritableEvents.filter((evt) => textHasLinks(evt.contentText));
  await Promise.all(
    linkEvents.map((evt) => {
      const rawEventId = rawEventIdsByDedupKey.get(evt.dedupKey);
      if (!rawEventId) return Promise.resolve();
      return reconcileLinkArtifactsForRawEvent(deps.db, {
        teamId,
        rawEventId,
        text: evt.contentText,
        occurredAt: evt.occurredAt,
      });
    }),
  );
  const byExternal = new Map<string, IntegrationEvent & { objectMap: ObjectMapping }>();
  // Iterate the active, dedup-winning list instead of `deps.events`
  // so the objectMap paired with each externalId comes from the same event as
  // the raw_events row. Iterating the pre-dedup list would let a later
  // same-dedupKey event silently override the winner's objectMap.
  for (const evt of artifactEvents) {
    if (!rawEventIdsByDedupKey.has(evt.dedupKey)) continue;
    byExternal.set(evt.objectMap.externalId, evt);
  }
  const repairableArtifactEvents = artifactEvents.filter((evt) =>
    rawEventIdsByDedupKey.has(evt.dedupKey),
  );
  if (repairableArtifactEvents.length > 0) {
    const entityByExternalId = await loadExistingWorkspaceObjectLinks(deps.db, deps.integration, [
      ...byExternal.values(),
    ]);
    await reconcileIntegrationArtifacts({
      db: deps.db,
      integration: deps.integration,
      rawEventIdsByDedupKey,
      entityByExternalId,
      events: repairableArtifactEvents,
    });
    const capturedWorkItems = [
      ...new Set(
        repairableArtifactEvents
          .map((event) => capturedWorkItemFromIntegrationEvent(event)?.externalId)
          .filter((externalId): externalId is string => typeof externalId === 'string'),
      ),
    ];
    await Promise.all(
      capturedWorkItems.map(async (externalObjectId) => {
        try {
          await enqueueGithubTaskProposalJob({
            teamId,
            integrationId: deps.integration.id,
            externalObjectId,
          });
        } catch (err) {
          log.warn(
            { err, teamId, integrationId: deps.integration.id, externalObjectId },
            'failed to enqueue captured-work task proposal job',
          );
        }
      }),
    );
  }

  return inserted.map((r) => r.id);
}

interface MondayConversationTombstoneTarget {
  teamId: string;
  integrationId: string;
  updateId: string;
  replyId: string | null;
  targetKey: string;
  reason: string;
  sourceEventDedupKey: string;
  deletedAt: Date;
}

function mondayConversationTargetKey(updateId: string, replyId: string | null): string {
  return replyId ? `reply:${updateId}:${replyId}` : `update:${updateId}`;
}

function mondayConversationTombstonesFromEvents(
  integration: IntegrationRow,
  events: IntegrationEvent[],
): MondayConversationTombstoneTarget[] {
  const byTargetKey = new Map<string, MondayConversationTombstoneTarget>();
  for (const event of events) {
    const tombstone = event.sourceTombstone;
    if (!tombstone) continue;
    if (integration.provider !== 'monday' || event.provider !== 'monday') {
      throw new Error('Only Monday integrations may persist Monday conversation tombstones');
    }
    const updateId = tombstone.updateId.trim();
    const replyId = tombstone.replyId?.trim() ?? null;
    if (!updateId) throw new Error('Monday conversation tombstones require an update id');
    const targetKey = mondayConversationTargetKey(updateId, replyId);
    if (!byTargetKey.has(targetKey)) {
      byTargetKey.set(targetKey, {
        teamId: integration.teamId,
        integrationId: integration.id,
        updateId,
        replyId,
        targetKey,
        reason: tombstone.reason,
        sourceEventDedupKey: event.dedupKey,
        deletedAt: event.occurredAt,
      });
    }
  }
  return [...byTargetKey.values()];
}

async function persistMondayConversationTombstones(
  db: Db,
  targets: MondayConversationTombstoneTarget[],
): Promise<void> {
  if (targets.length === 0) return;
  await db
    .insert(mondayConversationTombstones)
    .values(
      targets.map((target) => ({
        teamId: target.teamId,
        integrationId: target.integrationId,
        provider: 'monday' as const,
        updateId: target.updateId,
        replyId: target.replyId,
        targetKey: target.targetKey,
        reason: target.reason,
        sourceEventDedupKey: target.sourceEventDedupKey,
        deletedAt: target.deletedAt,
      })),
    )
    .onConflictDoNothing();
}

interface MondayTombstoneInvalidation {
  targetKey: string;
  rawEventId: string;
}

function mondayStoredConversationConditions(
  integration: IntegrationRow,
  target: MondayConversationTombstoneTarget,
  options: { activeOnly?: boolean } = {},
) {
  return [
    eq(rawEvents.teamId, integration.teamId),
    eq(rawEvents.source, 'integration'),
    sql`${rawEvents.sourceMetadata} ->> 'provider' = 'monday'`,
    sql`${rawEvents.sourceMetadata} ->> 'integration_id' = ${integration.id}`,
    sql`${rawEvents.sourceMetadata} ->> 'monday_update_id' = ${target.updateId}`,
    ...(target.replyId
      ? [sql`${rawEvents.sourceMetadata} ->> 'monday_reply_id' = ${target.replyId}`]
      : []),
    // The delete audit event intentionally has the same stable update id.
    sql`COALESCE(${rawEvents.sourceMetadata} ->> 'event_type', '') NOT IN ('update.deleted', 'reply.deleted')`,
    sql`(${rawEvents.sourceMetadata} ->> 'dedup_key') IS DISTINCT FROM ${target.sourceEventDedupKey}`,
    ...(options.activeOnly
      ? [sql`COALESCE(${rawEvents.sourceMetadata} ->> 'deleted', 'false') <> 'true'`]
      : []),
  ];
}

async function tombstoneStoredMondayConversations(
  db: Db,
  integration: IntegrationRow,
  targets: MondayConversationTombstoneTarget[],
): Promise<MondayTombstoneInvalidation[]> {
  const invalidations = new Map<string, MondayTombstoneInvalidation>();
  for (const target of targets) {
    const patch = JSON.stringify(tombstoneRawEventMetadata(target));
    await db
      .update(rawEvents)
      .set({
        // Content is immutable. Tombstoning only records derived lifecycle
        // metadata that keeps the original source available for audit/export.
        sourceMetadata: sql`COALESCE(${rawEvents.sourceMetadata}, '{}'::jsonb) || ${patch}::jsonb`,
      })
      .where(and(...mondayStoredConversationConditions(integration, target, { activeOnly: true })));

    // Include already-deleted rows. A tombstone replay must recreate/execute
    // its idempotent invalidation even though the lifecycle update above now
    // returns zero rows.
    const rows = await db
      .select({ id: rawEvents.id })
      .from(rawEvents)
      .where(and(...mondayStoredConversationConditions(integration, target)));
    for (const row of rows) {
      invalidations.set(`${target.targetKey}\x00${row.id}`, {
        targetKey: target.targetKey,
        rawEventId: row.id,
      });
    }
  }
  return [...invalidations.values()];
}

async function persistMondayConversationTombstoneInvalidations(
  db: Db,
  integration: IntegrationRow,
  invalidations: MondayTombstoneInvalidation[],
): Promise<void> {
  if (invalidations.length === 0) return;
  await db
    .insert(mondayConversationTombstoneInvalidations)
    .values(
      invalidations.map((invalidation) => ({
        teamId: integration.teamId,
        integrationId: integration.id,
        targetKey: invalidation.targetKey,
        rawEventId: invalidation.rawEventId,
      })),
    )
    .onConflictDoNothing();
}

async function invalidateMondayConversationTombstoneSummaries(
  db: Db,
  integration: IntegrationRow,
  targetKeys: string[],
): Promise<void> {
  if (targetKeys.length === 0) return;
  const invalidations = await db
    .select({
      id: mondayConversationTombstoneInvalidations.id,
      rawEventId: mondayConversationTombstoneInvalidations.rawEventId,
    })
    .from(mondayConversationTombstoneInvalidations)
    .where(
      and(
        eq(mondayConversationTombstoneInvalidations.teamId, integration.teamId),
        eq(mondayConversationTombstoneInvalidations.integrationId, integration.id),
        inArray(mondayConversationTombstoneInvalidations.targetKey, [...new Set(targetKeys)]),
      ),
    );
  if (invalidations.length === 0) return;

  const systemScope = withTeam(db, integration.teamId, TOMBSTONE_SYSTEM_ACTOR_ID, {
    skipMembershipCheck: true,
  });
  for (const invalidation of invalidations) {
    try {
      await invalidateObjectSummariesForRawEvent(db, systemScope, invalidation.rawEventId, {
        trigger: 'monday_conversation_tombstone',
      });
      await db
        .update(mondayConversationTombstoneInvalidations)
        .set({ invalidatedAt: new Date(), lastError: null, updatedAt: new Date() })
        .where(eq(mondayConversationTombstoneInvalidations.id, invalidation.id));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await db
        .update(mondayConversationTombstoneInvalidations)
        .set({ lastError: message.slice(0, 500), updatedAt: new Date() })
        .where(eq(mondayConversationTombstoneInvalidations.id, invalidation.id))
        .catch(() => undefined);
      throw error;
    }
  }
}

interface MondayConversationIdentity {
  updateId: string;
  replyId: string | null;
}

function metadataText(metadata: IntegrationEvent['extra'], key: string): string | null {
  const value = metadata?.[key];
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value).trim();
  return text || null;
}

function mondayConversationIdentity(event: IntegrationEvent): MondayConversationIdentity | null {
  if (event.provider !== 'monday' || event.sourceTombstone) return null;
  const updateId = metadataText(event.extra, 'monday_update_id');
  if (!updateId) return null;
  const replyId = metadataText(event.extra, 'monday_reply_id');
  const kind = metadataText(event.extra, 'monday_conversation_kind');
  if (
    kind !== 'update' &&
    kind !== 'reply' &&
    !event.eventType.startsWith('update.') &&
    !event.eventType.startsWith('reply.')
  ) {
    return null;
  }
  return { updateId, replyId };
}

function tombstoneRawEventMetadata(target: MondayConversationTombstoneTarget) {
  return {
    deleted: true,
    delete_reason: target.reason,
    deleted_at: target.deletedAt.toISOString(),
    deleted_from_dedup_key: target.sourceEventDedupKey,
  };
}

async function loadMondayConversationTombstones(
  db: Db,
  integration: IntegrationRow,
  events: IntegrationEvent[],
): Promise<Map<string, MondayConversationTombstoneTarget>> {
  if (integration.provider !== 'monday') return new Map();
  const keys = [
    ...new Set(
      events.flatMap((event) => {
        const identity = mondayConversationIdentity(event);
        if (!identity) return [];
        return [
          mondayConversationTargetKey(identity.updateId, null),
          ...(identity.replyId
            ? [mondayConversationTargetKey(identity.updateId, identity.replyId)]
            : []),
        ];
      }),
    ),
  ];
  if (keys.length === 0) return new Map();
  const rows = await db
    .select({
      teamId: mondayConversationTombstones.teamId,
      integrationId: mondayConversationTombstones.integrationId,
      updateId: mondayConversationTombstones.updateId,
      replyId: mondayConversationTombstones.replyId,
      targetKey: mondayConversationTombstones.targetKey,
      reason: mondayConversationTombstones.reason,
      sourceEventDedupKey: mondayConversationTombstones.sourceEventDedupKey,
      deletedAt: mondayConversationTombstones.deletedAt,
    })
    .from(mondayConversationTombstones)
    .where(
      and(
        eq(mondayConversationTombstones.teamId, integration.teamId),
        eq(mondayConversationTombstones.integrationId, integration.id),
        eq(mondayConversationTombstones.provider, 'monday'),
        inArray(mondayConversationTombstones.targetKey, keys),
      ),
    );
  return new Map(rows.map((row) => [row.targetKey, row]));
}

function tombstoneMetadataForFutureConversationEvent(
  event: IntegrationEvent,
  tombstonesByTargetKey: Map<string, MondayConversationTombstoneTarget>,
): Record<string, unknown> {
  const identity = mondayConversationIdentity(event);
  if (!identity) return {};
  // An update deletion takes precedence for a reply: it made the entire
  // thread unavailable, whereas a reply-specific tombstone is narrower.
  const target =
    tombstonesByTargetKey.get(mondayConversationTargetKey(identity.updateId, null)) ??
    (identity.replyId
      ? tombstonesByTargetKey.get(mondayConversationTargetKey(identity.updateId, identity.replyId))
      : undefined);
  return target ? tombstoneRawEventMetadata(target) : {};
}

async function enqueueIntegrationProcessingJob(
  db: Db,
  rawEventId: string,
  stage: 'extraction' | 'embedding',
  enqueue: () => Promise<unknown>,
): Promise<void> {
  try {
    await enqueue();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const patch = JSON.stringify({
      [`${stage}_failed_at`]: new Date().toISOString(),
      [`${stage}_error`]: `enqueue failed: ${message.slice(0, 480)}`,
    });
    await db
      .update(rawEvents)
      .set({
        sourceMetadata: sql`COALESCE(${rawEvents.sourceMetadata}, '{}'::jsonb) || ${patch}::jsonb`,
      })
      .where(eq(rawEvents.id, rawEventId));
  }
}

function rawMetadataExtra(extra: IntegrationEvent['extra']): Record<string, unknown> {
  if (!extra || typeof extra !== 'object' || Array.isArray(extra)) return {};
  const {
    source_payload_ref: _sourcePayloadRef,
    payload_digest: _payloadDigest,
    payload_ref: _payloadRef,
    raw_payload_ref: _rawPayloadRef,
    source_snapshot_ref: _sourceSnapshotRef,
    source_payload_digest: _sourcePayloadDigest,
    raw_payload_digest: _rawPayloadDigest,
    ...rest
  } = extra;
  return rest;
}

function sourcePayloadMetadataForEvent(event: IntegrationEvent): Record<string, unknown> {
  const existingRef = sourcePayloadRefFromMetadata(event.extra);
  const existingDigest = payloadDigestFromMetadata(event.extra);
  if (existingRef) {
    return {
      source_payload_ref: existingRef,
      ...(existingDigest ? { payload_digest: existingDigest } : {}),
    };
  }

  const snapshot = normalizedIntegrationSourceSnapshot(event);
  return inlineSourceSnapshotMetadata({
    snapshot,
    kind: 'normalized_integration_event',
    version: INTEGRATION_SOURCE_SNAPSHOT_VERSION,
    ref: (digest) =>
      `inline://timeline/integration/${event.provider}/${digest.slice('sha256:'.length)}`,
  });
}

function normalizedIntegrationSourceSnapshot(event: IntegrationEvent): Record<string, unknown> {
  return {
    dedupKey: event.dedupKey,
    provider: event.provider,
    externalObjectId: event.externalObjectId,
    externalEventId: event.externalEventId ?? null,
    eventType: event.eventType,
    occurredAt: event.occurredAt.toISOString(),
    actor: event.actor ?? null,
    contentText: event.contentText,
    visibility: event.visibility ?? null,
    visibilityUserIds: event.visibilityUserIds ?? null,
    extra: event.extra ?? {},
    objectMap: event.objectMap ?? null,
  };
}

async function loadRawEventIdsByDedupKey(
  db: Db,
  teamId: string,
  dedupKeys: string[],
): Promise<Map<string, string>> {
  const keys = [...new Set(dedupKeys)];
  if (keys.length === 0) return new Map();
  const rows = await db
    .select({
      id: rawEvents.id,
      dedupKey: sql<string>`${rawEvents.sourceMetadata} ->> 'dedup_key'`,
    })
    .from(rawEvents)
    .where(
      and(
        eq(rawEvents.teamId, teamId),
        inArray(sql<string>`${rawEvents.sourceMetadata} ->> 'dedup_key'`, keys),
        sql`COALESCE(${rawEvents.sourceMetadata} ->> 'deleted', 'false') <> 'true'`,
      ),
    );
  return new Map(rows.map((row) => [row.dedupKey, row.id]));
}

async function filterEventsOwnedByNativeIntegrations(
  deps: {
    db: Db;
    integration: IntegrationRow;
  },
  events: IntegrationEvent[],
): Promise<IntegrationEvent[]> {
  if (deps.integration.provider !== 'slack') return events;

  const nativeOwnedEvents = events.filter(isSlackEventOwnedByConversationalCapture);
  if (nativeOwnedEvents.length === 0) return events;

  const channels = [
    ...new Set(nativeOwnedEvents.map(slackBindingKey).filter((key) => key !== null)),
  ];
  if (channels.length === 0) return events;

  const boundRows = await deps.db
    .select({
      slackTeamId: slackWorkspaces.slackTeamId,
      channelId: slackConversationBindings.slackConversationId,
    })
    .from(slackConversationBindings)
    .innerJoin(slackWorkspaces, eq(slackWorkspaces.id, slackConversationBindings.workspaceId))
    .where(
      and(
        eq(slackConversationBindings.teamId, deps.integration.teamId),
        eq(slackConversationBindings.enabled, true),
        inArray(
          sql<string>`${slackWorkspaces.slackTeamId} || ${':'} || ${slackConversationBindings.slackConversationId}`,
          channels,
        ),
      ),
    );
  if (boundRows.length === 0) return events;

  const bound = new Set(
    boundRows.map((row) => slackBindingKeyParts(row.slackTeamId, row.channelId)),
  );
  return events.filter((event) => {
    if (!isSlackEventOwnedByConversationalCapture(event)) return true;
    const key = slackBindingKey(event);
    return !key || !bound.has(key);
  });
}

function isSlackEventOwnedByConversationalCapture(event: IntegrationEvent): boolean {
  return (
    event.provider === 'slack' &&
    ['message.created', 'message.edited', 'thread.reply', 'file.shared'].includes(event.eventType)
  );
}

function slackBindingKey(event: IntegrationEvent): string | null {
  const teamId = metadataString(event.extra, 'slack_team_id');
  const channelId = metadataString(event.extra, 'slack_channel_id');
  return teamId && channelId ? slackBindingKeyParts(teamId, channelId) : null;
}

function slackBindingKeyParts(slackTeamId: string, channelId: string): string {
  return `${slackTeamId}:${channelId}`;
}

async function loadExistingWorkspaceObjectLinks(
  db: Db,
  integration: IntegrationRow,
  evts: (IntegrationEvent & { objectMap: ObjectMapping })[],
): Promise<Map<string, string>> {
  const externalIds = [...new Set(evts.map((e) => e.objectMap.externalId))];
  if (externalIds.length === 0) return new Map();

  const rows = await db
    .select({
      id: entities.id,
      externalId: sql<string>`${entities.metadata} ->> 'integration_external_id'`,
    })
    .from(entities)
    .where(
      and(
        eq(entities.teamId, integration.teamId),
        sql`(${entities.metadata} ->> 'integration_provider') = ${integration.provider}`,
        inArray(sql`(${entities.metadata} ->> 'integration_external_id')`, [...externalIds]),
      ),
    );
  const entityByExternalId = new Map<string, string>();
  for (const row of rows) entityByExternalId.set(row.externalId, row.id);
  return entityByExternalId;
}

async function reconcileIntegrationArtifacts(deps: {
  db: Db;
  integration: IntegrationRow;
  rawEventIdsByDedupKey: Map<string, string>;
  entityByExternalId: Map<string, string>;
  events: (IntegrationEvent & { objectMap: ObjectMapping })[];
}): Promise<void> {
  for (const event of deps.events) {
    const rawEventId = deps.rawEventIdsByDedupKey.get(event.dedupKey);
    const entityId = deps.entityByExternalId.get(event.objectMap.externalId);
    if (!rawEventId) continue;
    const role = evidenceRoleForIntegrationEvent(event);
    const strength = evidenceStrengthForIntegrationEvent(event);
    const authoritative = integrationEventIsAuthoritative(event);
    const result = await reconcileArtifactEvidence(deps.db, {
      teamId: deps.integration.teamId,
      artifactClusterKind: artifactClusterKindForIntegrationEvent(event),
      artifactType: event.objectMap.type,
      canonicalName: event.objectMap.displayTitle ?? event.objectMap.canonicalName,
      status: clusterStatusFromObjectStatus(event.objectMap.status),
      canonicalEntityId: entityId ?? null,
      rawEventId,
      occurredAt: event.occurredAt,
      provider: event.provider,
      externalObjectId: event.externalObjectId,
      role,
      strength,
      authoritative,
      anchors: artifactAnchorsForIntegrationEvent(event),
      metadata: {
        provider: event.provider,
        event_type: event.eventType,
        integration_id: deps.integration.id,
        artifact_cluster_kind: artifactClusterKindForIntegrationEvent(event),
        signal_class: resolveSignalClassForEvent(event),
      },
    });
    await attachReconciliationAssociationForIntegrationEvent(deps.db, {
      teamId: deps.integration.teamId,
      integrationId: deps.integration.id,
      clusterId: result.clusterId,
      rawEventId,
      event,
      role,
      strength,
      authoritative,
    });
  }
}

async function attachReconciliationAssociationForIntegrationEvent(
  db: Db,
  input: {
    teamId: string;
    integrationId: string;
    clusterId: string;
    rawEventId: string;
    event: IntegrationEvent & { objectMap: ObjectMapping };
    role: EvidenceRole;
    strength: EvidenceStrength;
    authoritative: boolean;
  },
): Promise<void> {
  const evidence = await loadCanonicalIntegrationEvidence(db, input.teamId, input.rawEventId);
  if (!evidence) return;

  const role = associationRoleForIntegrationEvidence(input.role);
  const associationSource = input.authoritative ? 'authoritative_provider' : 'hard_anchor';
  const existingAssociation = await db
    .select({ id: artifactEvidenceAssociations.id })
    .from(artifactEvidenceAssociations)
    .where(
      and(
        eq(artifactEvidenceAssociations.teamId, input.teamId),
        eq(artifactEvidenceAssociations.clusterId, input.clusterId),
        eq(artifactEvidenceAssociations.rawEventId, input.rawEventId),
        eq(artifactEvidenceAssociations.role, role),
        eq(artifactEvidenceAssociations.associationSource, associationSource),
      ),
    )
    .limit(1);
  if (existingAssociation.length === 0) {
    await db
      .insert(artifactEvidenceAssociations)
      .values({
        teamId: input.teamId,
        clusterId: input.clusterId,
        evidenceId: evidence.id,
        rawEventId: input.rawEventId,
        role,
        strength: input.strength,
        confidence: 'high',
        associationSource,
        rationale: `${input.event.provider} ${input.event.eventType} matched ${input.event.objectMap.externalId}`,
        sourceRefs: [
          {
            source: input.event.provider,
            rawEventId: input.rawEventId,
            evidenceId: evidence.id,
            sourcePayloadRef: evidence.sourcePayloadRef,
          },
        ],
        visibility: evidence.visibility,
        visibilityOwnerUserId: evidence.visibilityOwnerUserId,
        visibilityUserIds: evidence.visibilityUserIds,
        visibilityFloor: evidence.visibility,
        visibilityFloorOwnerUserId: evidence.visibilityOwnerUserId,
        visibilityFloorUserIds: evidence.visibilityUserIds,
        metadata: {
          provider: input.event.provider,
          event_type: input.event.eventType,
          integration_id: input.integrationId,
          external_object_id: input.event.externalObjectId,
        },
        dedupeKey: buildAssociationDedupeKey({
          teamId: input.teamId,
          clusterId: input.clusterId,
          evidenceId: evidence.id,
          role,
          associationSource,
          associationPolicyVersion: 'integration-association-2026-06',
        }),
      })
      .onConflictDoNothing();
  }

  if (input.authoritative) {
    await emitIntegrationDirectWriteOutput(db, {
      ...input,
      evidence,
      role,
      associationSource,
    });
  } else {
    await emitIntegrationObservedAssociationOutput(db, {
      ...input,
      evidence,
      role,
      associationSource,
    });
  }
}

async function loadCanonicalIntegrationEvidence(
  db: Db,
  teamId: string,
  rawEventId: string,
): Promise<IntegrationProjectionEvidence | null> {
  const [evidence] = await db
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
        eq(reconciliationEvidence.teamId, teamId),
        eq(reconciliationEvidence.rawEventId, rawEventId),
      ),
    )
    .orderBy(
      sql`CASE WHEN ${reconciliationEvidence.sourcePayloadRef} IS NULL THEN 1 ELSE 0 END`,
      reconciliationEvidence.sourcePayloadRef,
      reconciliationEvidence.id,
    )
    .limit(1);
  return evidence ?? null;
}

async function emitIntegrationDirectWriteOutput(
  db: Db,
  input: IntegrationProjectionOutputInput,
): Promise<void> {
  const targetId = input.event.objectMap.externalId;
  await emitIntegrationProjectionOutput(db, input, {
    runScope: 'integration_direct_write',
    runVersion: INTEGRATION_DIRECT_WRITE_RUN_VERSION,
    runDedupeKind: 'integration-direct-write-run',
    outputKind: 'direct_write',
    targetKind: 'cluster_lifecycle',
    targetField: 'status',
    operation: 'update',
    targetIdentity: `${input.event.provider}:${targetId}:${input.event.eventType}`,
    plannerVersion: INTEGRATION_DIRECT_WRITE_PLANNER_VERSION,
    payload: {
      provider: input.event.provider,
      event_type: input.event.eventType,
      integration_id: input.integrationId,
      external_object_id: input.event.externalObjectId,
      object_map_external_id: input.event.objectMap.externalId,
      object_map_type: input.event.objectMap.type,
      object_map_status: input.event.objectMap.status ?? 'open',
      cluster_status: clusterStatusFromObjectStatus(input.event.objectMap.status),
      association_role: input.role,
      association_source: input.associationSource,
      evidence_strength: input.strength,
    },
  });
}

async function emitIntegrationObservedAssociationOutput(
  db: Db,
  input: IntegrationProjectionOutputInput,
): Promise<void> {
  await emitIntegrationProjectionOutput(db, input, {
    runScope: 'integration_observed_association',
    runVersion: INTEGRATION_OBSERVED_ASSOCIATION_RUN_VERSION,
    runDedupeKind: 'integration-observed-association-run',
    outputKind: 'observed_association',
    targetKind: 'cluster_identity',
    targetField: null,
    operation: 'link',
    targetIdentity: `${input.event.provider}:${input.event.objectMap.externalId}:${input.event.eventType}`,
    plannerVersion: INTEGRATION_OBSERVED_ASSOCIATION_PLANNER_VERSION,
    payload: {
      provider: input.event.provider,
      event_type: input.event.eventType,
      integration_id: input.integrationId,
      external_object_id: input.event.externalObjectId,
      object_map_external_id: input.event.objectMap.externalId,
      object_map_type: input.event.objectMap.type,
      association_role: input.role,
      association_source: input.associationSource,
      evidence_strength: input.strength,
    },
  });
}

async function emitIntegrationProjectionOutput(
  db: Db,
  input: IntegrationProjectionOutputInput,
  config: IntegrationProjectionOutputConfig,
): Promise<void> {
  const sourceRefs = [
    {
      source: input.event.provider,
      rawEventId: input.rawEventId,
      sourcePayloadRef: input.evidence.sourcePayloadRef,
    },
  ];
  const sourceEnvelope = integrationProjectionSourceEnvelope(input.evidence, sourceRefs);
  const runFingerprint = reconciliationDedupeKey(config.runDedupeKind, {
    teamId: input.teamId,
    clusterId: input.clusterId,
    rawEventId: input.rawEventId,
    sourcePayloadRef: input.evidence.sourcePayloadRef,
    eventType: input.event.eventType,
    policyVersion: AUTHORITY_POLICY_VERSION,
  });
  const now = new Date();
  const metrics = {
    provider: input.event.provider,
    event_type: input.event.eventType,
  };
  const [run] = await db
    .insert(reconciliationRuns)
    .values({
      teamId: input.teamId,
      trigger: 'raw_event',
      scope: config.runScope,
      status: 'completed',
      inputFingerprint: runFingerprint,
      engineVersion: config.runVersion,
      completedAt: now,
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
        completedAt: now,
        metrics,
      },
    })
    .returning({ id: reconciliationRuns.id });
  if (!run) return;

  const authorityInput = authorityPolicyInputForIntegrationEvent(input.event, {
    targetKind: config.targetKind,
    targetField: config.targetField,
  });
  const authority = evaluateAuthorityPolicy(authorityInput);
  await db
    .insert(reconciliationOutputs)
    .values({
      teamId: input.teamId,
      runId: run.id,
      clusterId: input.clusterId,
      outputKind: config.outputKind,
      targetKind: config.targetKind,
      operation: config.operation,
      payload: config.payload,
      authorityDecision: {
        ...authorityDecisionPayload(authority, authorityInput),
        provider: input.event.provider,
      },
      confidence: 'high',
      requiresApproval: false,
      ...sourceEnvelope,
      dedupeKey: buildOutputDedupeKey({
        teamId: input.teamId,
        clusterId: input.clusterId,
        targetKind: config.targetKind,
        operation: config.operation,
        targetId: null,
        targetIdentity: config.targetIdentity,
        sourceRefs,
        authorityPolicyVersion: AUTHORITY_POLICY_VERSION,
        plannerVersion: config.plannerVersion,
      }),
      status: 'applied',
    })
    .onConflictDoUpdate({
      target: [reconciliationOutputs.teamId, reconciliationOutputs.dedupeKey],
      set: {
        runId: run.id,
        ...sourceEnvelope,
        status: 'applied',
        updatedAt: new Date(),
      },
    });
}

function clusterStatusFromObjectStatus(status: ObjectMapping['status']): ArtifactStatus {
  if (status === 'done') return 'resolved';
  if (status === 'cancelled') return 'cancelled';
  if (status === 'in_progress') return 'active';
  return 'open';
}

function artifactClusterKindForIntegrationEvent(
  event: IntegrationEvent & { objectMap: ObjectMapping },
): ArtifactClusterKind {
  const artifactKey = metadataString(event.objectMap.metadata, 'artifact_key');
  if (artifactKey?.startsWith('customer:')) return 'customer_project';
  if (metadataString(event.objectMap.metadata, 'sentry_record_kind')) return 'provider_record';
  if (metadataString(event.objectMap.metadata, 'linear_record_kind')) return 'provider_record';
  const mondayRecordKind = metadataString(event.objectMap.metadata, 'monday_record_kind');
  if (mondayRecordKind && mondayRecordKind !== 'doc') return 'provider_record';

  switch (event.objectMap.type) {
    case 'company':
      return 'account';
    case 'project':
      return 'customer_project';
    case 'incident':
      return 'incident';
    case 'deal':
      return 'deal';
    case 'document':
      return 'document';
    case 'decision':
      return 'decision';
    case 'task':
    case 'follow_up':
      return 'task';
    case 'person':
      return 'person_context';
    case 'topic':
      return 'topic';
    default:
      return 'provider_record';
  }
}

function evidenceStrengthForIntegrationEvent(event: IntegrationEvent): EvidenceStrength {
  if (event.provider === 'github' || event.provider === 'sentry') return 'provider';
  return 'structured';
}

function evidenceRoleForIntegrationEvent(event: IntegrationEvent): EvidenceRole {
  const github = recordField(event.extra, 'github');
  const githubType = metadataString(github, 'type');
  if (event.eventType.includes('release')) return 'release';
  if (event.provider === 'sentry') {
    return event.eventType === 'issue.resolved' ? 'lifecycle_update' : 'error';
  }
  if (event.provider === 'github') {
    if (githubType === 'issue')
      return event.eventType === 'issue.closed' ? 'lifecycle_update' : 'issue';
    if (githubType === 'pull_request') {
      return event.eventType === 'pr.merged' || event.eventType === 'pr.closed'
        ? 'lifecycle_update'
        : 'implementation';
    }
    if (githubType === 'review') return 'review';
    if (githubType === 'release') return 'release';
    if (githubType === 'commit') return 'implementation';
  }
  if (event.objectMap?.type === 'document') return 'document';
  if (event.objectMap?.type === 'decision') return 'decision';
  return event.eventType.includes('status') || event.eventType.includes('completed')
    ? 'lifecycle_update'
    : 'related_context';
}

function associationRoleForIntegrationEvidence(
  role: EvidenceRole,
): (typeof artifactEvidenceAssociations.$inferInsert)['role'] {
  if (role === 'lifecycle_update') return 'lifecycle_update';
  if (role === 'decision') return 'decision';
  if (role === 'discussion') return 'discussion';
  if (role === 'error' || role === 'issue') return 'blocker';
  if (role === 'related_context') return 'related_context';
  if (role === 'review' || role === 'report') return 'discussion';
  if (role === 'document') return 'evidence_only';
  return 'update';
}

function integrationEventIsAuthoritative(
  event: IntegrationEvent & { objectMap: ObjectMapping },
): boolean {
  return (
    evaluateAuthorityPolicy(
      authorityPolicyInputForIntegrationEvent(event, {
        targetKind: 'cluster_lifecycle',
        targetField: 'status',
      }),
    ).decision === 'direct'
  );
}

function authorityPolicyInputForIntegrationEvent(
  event: IntegrationEvent & { objectMap: ObjectMapping },
  target: { targetKind: string; targetField: string | null },
): AuthorityPolicyInput {
  return {
    source: 'integration',
    provider: event.provider,
    eventType: event.eventType,
    targetKind: target.targetKind,
    targetField: target.targetField,
    externalObjectId: event.objectMap.externalId,
    visibility: event.visibility ?? 'team',
    confidence: 'high',
    currentOwner: {
      provider: event.provider,
      externalObjectId: event.objectMap.externalId,
    },
  };
}

function artifactAnchorsForIntegrationEvent(event: IntegrationEvent): ArtifactAnchorInput[] {
  const anchors: ArtifactAnchorInput[] = [
    {
      type: 'provider_object',
      value: `${event.provider}:${event.externalObjectId}`,
      strength: 'hard',
    },
  ];
  if (event.objectMap) {
    anchors.push({
      type: `provider_external:${event.provider}`,
      value: event.objectMap.externalId,
      strength: 'hard',
    });
    for (const alias of event.objectMap.aliases ?? []) {
      anchors.push({
        type: `alias:${event.objectMap.type}`,
        value: alias,
        strength: 'structured',
      });
    }
    const artifactKey = metadataString(event.objectMap.metadata, 'artifact_key');
    if (artifactKey) anchors.push({ type: 'artifact_key', value: artifactKey, strength: 'hard' });
    const contractId = metadataString(event.objectMap.metadata, 'contract_id');
    if (contractId) anchors.push({ type: 'contract_id', value: contractId, strength: 'hard' });
    const dealId = metadataString(event.objectMap.metadata, 'deal_id');
    if (dealId) anchors.push({ type: 'deal_id', value: dealId, strength: 'hard' });
    if (event.objectMap.url)
      anchors.push({
        type: 'url',
        value: normalizeUrlAnchor(event.objectMap.url),
        strength: 'hard',
      });
  }

  const externalUrl =
    metadataString(event.extra, 'external_url') ?? metadataString(event.extra, 'url');
  if (externalUrl)
    anchors.push({ type: 'url', value: normalizeUrlAnchor(externalUrl), strength: 'hard' });

  const github = recordField(event.extra, 'github');
  const repo = metadataString(github, 'repo');
  const ghNumber = metadataString(github, 'number') ?? metadataString(github, 'pr_number');
  const ghType = metadataString(github, 'type');
  if (repo && ghNumber) {
    anchors.push({
      type: ghType === 'issue' ? 'github_issue' : 'github_pr',
      value: `${repo}#${ghNumber}`,
      strength: 'hard',
    });
  }
  const head = metadataString(github, 'head') ?? metadataString(github, 'head_branch');
  if (repo && head)
    anchors.push({ type: 'github_branch', value: `${repo}:${head}`, strength: 'structured' });
  const sha = metadataString(github, 'sha') ?? metadataString(github, 'head_sha');
  if (repo && sha) anchors.push({ type: 'commit_sha', value: `${repo}@${sha}`, strength: 'hard' });
  if (repo) {
    for (const issueRef of githubIssueRefs(event.contentText)) {
      anchors.push({ type: 'github_issue', value: `${repo}#${issueRef}`, strength: 'structured' });
    }
  }

  const sentryIssueId = metadataString(event.extra, 'sentry_issue_id');
  if (sentryIssueId) anchors.push({ type: 'sentry_issue', value: sentryIssueId, strength: 'hard' });
  const sentryShortId = metadataString(event.extra, 'sentry_short_id');
  if (sentryShortId)
    anchors.push({ type: 'sentry_short_id', value: sentryShortId, strength: 'structured' });
  for (const shortId of sentryShortIds(event.contentText)) {
    anchors.push({ type: 'sentry_short_id', value: shortId, strength: 'structured' });
  }

  return anchors;
}

function githubIssueRefs(text: string): string[] {
  const refs = new Set<string>();
  for (const match of text.matchAll(/(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)?\s+#(\d+)\b/gi)) {
    if (match[1]) refs.add(match[1]);
  }
  return [...refs];
}

function sentryShortIds(text: string): string[] {
  const refs = new Set<string>();
  for (const match of text.matchAll(/\b[A-Z][A-Z0-9_-]+-\d+\b/g)) {
    if (match[0]) refs.add(match[0]);
  }
  return [...refs];
}

function recordField(
  value: Record<string, unknown> | undefined,
  key: string,
): Record<string, unknown> | undefined {
  const field = value?.[key];
  return field && typeof field === 'object' && !Array.isArray(field)
    ? (field as Record<string, unknown>)
    : undefined;
}

function normalizeUrlAnchor(value: string): string {
  try {
    const url = new URL(value);
    url.hash = '';
    const params = [...url.searchParams.entries()].filter(
      ([key]) => !key.toLowerCase().startsWith('utm_'),
    );
    url.search = '';
    for (const [key, paramValue] of params) url.searchParams.append(key, paramValue);
    return url.toString().replace(/\/$/, '');
  } catch {
    return value.trim();
  }
}

function metadataString(metadata: Record<string, unknown> | undefined, key: string): string | null {
  const value = metadata?.[key];
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value).trim();
  return text || null;
}

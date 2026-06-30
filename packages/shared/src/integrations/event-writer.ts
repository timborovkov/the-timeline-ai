import { createHash } from 'node:crypto';

import {
  artifactEvidenceAssociations,
  type Db,
  entities,
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
  type ArtifactStatus,
  type EvidenceRole,
  type EvidenceStrength,
} from '#src/artifacts/index.js';
import { enqueueEmbedJob } from '#src/queue/queues.js';
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

    return {
      teamId,
      authorUserId,
      visibilityOwnerUserId,
      source: 'integration' as const,
      contentText: evt.contentText,
      occurredAt: evt.occurredAt,
      visibility: resolvedVisibility,
      visibilityUserIds: resolvedVisibility === 'specific_users' ? requestedUserIds : null,
      sourceMetadata: {
        ...(evt.extra ?? {}),
        provider: evt.provider,
        integration_id: deps.integration.id,
        external_object_id: evt.externalObjectId,
        external_event_id: evt.externalEventId ?? null,
        event_type: evt.eventType,
        actor: evt.actor ?? null,
        dedup_key: evt.dedupKey,
        sync_at: new Date().toISOString(),
        source_kind: 'integration_event',
        ...sourcePayloadMetadata,
      },
    };
  });

  const inserted = await deps.db
    .insert(rawEvents)
    .values(values)
    .returning({
      id: rawEvents.id,
      dedupKey: sql<string>`${rawEvents.sourceMetadata} ->> 'dedup_key'`,
    })
    .onConflictDoNothing();

  await Promise.all(
    inserted.map((row) => enqueueEmbedJob({ scope: 'raw_event', teamId, rawEventId: row.id })),
  );

  // Workspace-object upsert and artifact reconciliation are deliberately
  // repairable from existing raw_events. If a previous run inserted the raw
  // event and then failed while attaching artifact evidence, a replay with the
  // same dedup_key must fill the missing cluster/member rows.
  // Dedupe workspace-object upserts by externalId, but reconcile every raw
  // event as evidence. Multiple lifecycle events for the same object in one
  // batch should remain distinct cluster members.
  const rawEventIdsByDedupKey = await loadRawEventIdsByDedupKey(
    deps.db,
    teamId,
    writableEvents.map((event) => event.dedupKey),
  );
  await normalizeIntegrationEventsToEvidence({
    db: deps.db,
    teamId,
    events: writableEvents,
    rawEventIdsByDedupKey,
  });

  const artifactEvents = writableEvents.filter(
    (evt): evt is IntegrationEvent & { objectMap: ObjectMapping } => Boolean(evt.objectMap),
  );
  const byExternal = new Map<string, IntegrationEvent & { objectMap: ObjectMapping }>();
  // Iterate `writableEvents` (the dedup-winning list) instead of `deps.events`
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
  }

  return inserted.map((r) => r.id);
}

function sourcePayloadMetadataForEvent(event: IntegrationEvent): Record<string, unknown> {
  const existingRef =
    metadataString(event.extra, 'source_payload_ref') ??
    metadataString(event.extra, 'payload_ref') ??
    metadataString(event.extra, 'raw_payload_ref') ??
    metadataString(event.extra, 'source_snapshot_ref');
  const existingDigest =
    metadataString(event.extra, 'payload_digest') ??
    metadataString(event.extra, 'source_payload_digest') ??
    metadataString(event.extra, 'raw_payload_digest');
  if (existingRef) {
    return {
      source_payload_ref: existingRef,
      ...(existingDigest ? { payload_digest: existingDigest } : {}),
    };
  }

  const snapshot = normalizedIntegrationSourceSnapshot(event);
  const digest = `sha256:${createHash('sha256').update(stableJson(snapshot)).digest('hex')}`;
  return {
    source_payload_ref: `inline://timeline/integration/${event.provider}/${digest.slice('sha256:'.length)}`,
    payload_digest: digest,
    source_snapshot: snapshot,
    source_snapshot_kind: 'normalized_integration_event',
    source_snapshot_version: INTEGRATION_SOURCE_SNAPSHOT_VERSION,
  };
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
        eq(reconciliationEvidence.teamId, input.teamId),
        eq(reconciliationEvidence.rawEventId, input.rawEventId),
      ),
    )
    .limit(1);
  if (!evidence) return;

  const role = associationRoleForIntegrationEvidence(input.role);
  const associationSource = input.authoritative ? 'authoritative_provider' : 'hard_anchor';
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

async function emitIntegrationDirectWriteOutput(
  db: Db,
  input: {
    teamId: string;
    integrationId: string;
    clusterId: string;
    rawEventId: string;
    event: IntegrationEvent & { objectMap: ObjectMapping };
    role: (typeof artifactEvidenceAssociations.$inferInsert)['role'];
    strength: EvidenceStrength;
    associationSource: (typeof artifactEvidenceAssociations.$inferInsert)['associationSource'];
    evidence: {
      id: string;
      sourcePayloadRef: string | null;
      visibility: 'team' | 'private' | 'specific_users';
      visibilityOwnerUserId: string | null;
      visibilityUserIds: string[] | null;
    };
  },
): Promise<void> {
  const sourceRefs = [
    {
      source: input.event.provider,
      rawEventId: input.rawEventId,
      evidenceId: input.evidence.id,
      sourcePayloadRef: input.evidence.sourcePayloadRef,
    },
  ];
  const runFingerprint = reconciliationDedupeKey('integration-direct-write-run', {
    teamId: input.teamId,
    clusterId: input.clusterId,
    rawEventId: input.rawEventId,
    evidenceId: input.evidence.id,
    eventType: input.event.eventType,
    policyVersion: AUTHORITY_POLICY_VERSION,
  });
  const [run] = await db
    .insert(reconciliationRuns)
    .values({
      teamId: input.teamId,
      trigger: 'raw_event',
      scope: 'integration_direct_write',
      status: 'completed',
      inputFingerprint: runFingerprint,
      engineVersion: INTEGRATION_DIRECT_WRITE_RUN_VERSION,
      completedAt: new Date(),
      metrics: {
        provider: input.event.provider,
        event_type: input.event.eventType,
      },
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
        metrics: {
          provider: input.event.provider,
          event_type: input.event.eventType,
        },
      },
    })
    .returning({ id: reconciliationRuns.id });
  if (!run) return;

  const targetId = input.event.objectMap.externalId;
  const authorityInput = authorityPolicyInputForIntegrationEvent(input.event, {
    targetKind: 'cluster_lifecycle',
    targetField: 'status',
  });
  const authority = evaluateAuthorityPolicy(authorityInput);
  await db
    .insert(reconciliationOutputs)
    .values({
      teamId: input.teamId,
      runId: run.id,
      clusterId: input.clusterId,
      outputKind: 'direct_write',
      targetKind: 'cluster_lifecycle',
      operation: 'update',
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
      authorityDecision: {
        ...authorityDecisionPayload(authority, authorityInput),
        provider: input.event.provider,
      },
      confidence: 'high',
      requiresApproval: false,
      sourceRefs,
      sourcePayloadRefs: input.evidence.sourcePayloadRef ? [input.evidence.sourcePayloadRef] : [],
      visibility: input.evidence.visibility,
      visibilityOwnerUserId: input.evidence.visibilityOwnerUserId,
      visibilityUserIds: input.evidence.visibilityUserIds,
      visibilityFloor: input.evidence.visibility,
      visibilityFloorOwnerUserId: input.evidence.visibilityOwnerUserId,
      visibilityFloorUserIds: input.evidence.visibilityUserIds,
      dedupeKey: buildOutputDedupeKey({
        teamId: input.teamId,
        clusterId: input.clusterId,
        targetKind: 'cluster_lifecycle',
        operation: 'update',
        targetId: null,
        targetIdentity: `${input.event.provider}:${targetId}:${input.event.eventType}`,
        sourceRefs,
        authorityPolicyVersion: AUTHORITY_POLICY_VERSION,
        plannerVersion: INTEGRATION_DIRECT_WRITE_PLANNER_VERSION,
      }),
      status: 'applied',
    })
    .onConflictDoUpdate({
      target: [reconciliationOutputs.teamId, reconciliationOutputs.dedupeKey],
      set: {
        runId: run.id,
        status: 'applied',
        updatedAt: new Date(),
      },
    });
}

async function emitIntegrationObservedAssociationOutput(
  db: Db,
  input: {
    teamId: string;
    integrationId: string;
    clusterId: string;
    rawEventId: string;
    event: IntegrationEvent & { objectMap: ObjectMapping };
    role: (typeof artifactEvidenceAssociations.$inferInsert)['role'];
    strength: EvidenceStrength;
    associationSource: (typeof artifactEvidenceAssociations.$inferInsert)['associationSource'];
    evidence: {
      id: string;
      sourcePayloadRef: string | null;
      visibility: 'team' | 'private' | 'specific_users';
      visibilityOwnerUserId: string | null;
      visibilityUserIds: string[] | null;
    };
  },
): Promise<void> {
  const sourceRefs = [
    {
      source: input.event.provider,
      rawEventId: input.rawEventId,
      evidenceId: input.evidence.id,
      sourcePayloadRef: input.evidence.sourcePayloadRef,
    },
  ];
  const runFingerprint = reconciliationDedupeKey('integration-observed-association-run', {
    teamId: input.teamId,
    clusterId: input.clusterId,
    rawEventId: input.rawEventId,
    evidenceId: input.evidence.id,
    eventType: input.event.eventType,
    policyVersion: AUTHORITY_POLICY_VERSION,
  });
  const [run] = await db
    .insert(reconciliationRuns)
    .values({
      teamId: input.teamId,
      trigger: 'raw_event',
      scope: 'integration_observed_association',
      status: 'completed',
      inputFingerprint: runFingerprint,
      engineVersion: INTEGRATION_OBSERVED_ASSOCIATION_RUN_VERSION,
      completedAt: new Date(),
      metrics: {
        provider: input.event.provider,
        event_type: input.event.eventType,
      },
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
        metrics: {
          provider: input.event.provider,
          event_type: input.event.eventType,
        },
      },
    })
    .returning({ id: reconciliationRuns.id });
  if (!run) return;

  const authorityInput = authorityPolicyInputForIntegrationEvent(input.event, {
    targetKind: 'cluster_identity',
    targetField: null,
  });
  const authority = evaluateAuthorityPolicy(authorityInput);
  await db
    .insert(reconciliationOutputs)
    .values({
      teamId: input.teamId,
      runId: run.id,
      clusterId: input.clusterId,
      outputKind: 'observed_association',
      targetKind: 'cluster_identity',
      operation: 'link',
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
      authorityDecision: {
        ...authorityDecisionPayload(authority, authorityInput),
        provider: input.event.provider,
      },
      confidence: 'high',
      requiresApproval: false,
      sourceRefs,
      sourcePayloadRefs: input.evidence.sourcePayloadRef ? [input.evidence.sourcePayloadRef] : [],
      visibility: input.evidence.visibility,
      visibilityOwnerUserId: input.evidence.visibilityOwnerUserId,
      visibilityUserIds: input.evidence.visibilityUserIds,
      visibilityFloor: input.evidence.visibility,
      visibilityFloorOwnerUserId: input.evidence.visibilityOwnerUserId,
      visibilityFloorUserIds: input.evidence.visibilityUserIds,
      dedupeKey: buildOutputDedupeKey({
        teamId: input.teamId,
        clusterId: input.clusterId,
        targetKind: 'cluster_identity',
        operation: 'link',
        targetId: null,
        targetIdentity: `${input.event.provider}:${input.event.objectMap.externalId}:${input.event.eventType}`,
        sourceRefs,
        authorityPolicyVersion: AUTHORITY_POLICY_VERSION,
        plannerVersion: INTEGRATION_OBSERVED_ASSOCIATION_PLANNER_VERSION,
      }),
      status: 'applied',
    })
    .onConflictDoUpdate({
      target: [reconciliationOutputs.teamId, reconciliationOutputs.dedupeKey],
      set: {
        runId: run.id,
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

function evidenceStrengthForIntegrationEvent(event: IntegrationEvent): EvidenceStrength {
  if (event.provider === 'github' || event.provider === 'sentry') return 'provider';
  return 'structured';
}

function evidenceRoleForIntegrationEvent(event: IntegrationEvent): EvidenceRole {
  const github = recordField(event.extra, 'github');
  const githubType = metadataString(github, 'type');
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
  if (event.eventType.includes('release')) return 'release';
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

function stableJson(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(',')}}`;
}

function metadataString(metadata: Record<string, unknown> | undefined, key: string): string | null {
  const value = metadata?.[key];
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value).trim();
  return text || null;
}

import {
  type Db,
  entities,
  rawEvents,
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
import { sourceMetadataWithConversationArtifacts } from '#src/conversational/contact-artifacts.js';
import {
  reconcileLinkArtifactsForRawEvent,
  textHasLinks,
} from '#src/conversational/link-artifacts.js';
import { enqueueEmbedJob, enqueueObjectEmbedJob } from '#src/queue/queues.js';

// Phase 11 — Persist normalized integration events into raw_events with
// source='integration' + dedup_key. The partial unique index
// `raw_events_integration_dedup_unq` makes duplicate writes a no-op.
//
// Embedding: every newly inserted row is enqueued as a standard
// raw_event embed job. The worker stamps `source_kind='integration_event'`
// onto the Qdrant payload so the agent can narrow searches.
//
// Workspace object mapping (Phase 11): events that carry `objectMap`
// upsert an entities row keyed on
// `(team_id, metadata->>'integration_provider', metadata->>'integration_external_id')`.
// A backfill of 50 Linear issues used to issue 50× (SELECT + INSERT-or-
// UPDATE) round-trips. The current path collapses that to three:
// one bulk SELECT to learn which externalIds already exist,
// one bulk INSERT for the new ones,
// one bulk UPDATE for the existing ones via `UPDATE ... FROM (VALUES …)`.
//
// We can't use ON CONFLICT against our partial expression index because
// drizzle's typed `target` can't express it. Three queries is the
// simplest path that's both correct (the canonical-name unique
// `entities_team_type_canonical_name_unq` would collapse distinct
// external objects sharing a name) and bulk-friendly.

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
      sourceMetadata: sourceMetadataWithConversationArtifacts(
        {
          provider: evt.provider,
          integration_id: deps.integration.id,
          external_object_id: evt.externalObjectId,
          external_event_id: evt.externalEventId ?? null,
          event_type: evt.eventType,
          actor: evt.actor ?? null,
          dedup_key: evt.dedupKey,
          sync_at: new Date().toISOString(),
          source_kind: 'integration_event',
          ...(evt.extra ?? {}),
        },
        evt.contentText,
      ),
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
  const artifactEvents = writableEvents.filter(
    (evt): evt is IntegrationEvent & { objectMap: ObjectMapping } => Boolean(evt.objectMap),
  );
  const linkEvents = writableEvents.filter((evt) => textHasLinks(evt.contentText));
  const rawEventIdsByDedupKey = await loadRawEventIdsByDedupKey(
    deps.db,
    teamId,
    [...artifactEvents, ...linkEvents].map((event) => event.dedupKey),
  );
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
  if (byExternal.size > 0) {
    const entityByExternalId = await upsertWorkspaceObjects(deps.db, deps.integration, [
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

/**
 * Batched upsert. Three queries regardless of N:
 *
 *   1. SELECT `id, metadata->>integration_external_id` for every
 *      externalId in the batch — split into existing vs new.
 *   2. INSERT new rows in one statement.
 *   3. UPDATE existing rows via `UPDATE entities SET … FROM (VALUES …)
 *      WHERE entities.id = v.id`.
 *
 * The bulk UPDATE merges the incoming metadata into the existing jsonb
 * (`entities.metadata || incoming.metadata`) so per-event additions
 * (last_event_at, last_event_type) win without clobbering anything else
 * a previous sync stamped.
 */
async function upsertWorkspaceObjects(
  db: Db,
  integration: IntegrationRow,
  evts: (IntegrationEvent & { objectMap: ObjectMapping })[],
): Promise<Map<string, string>> {
  const externalIds = evts.map((e) => e.objectMap.externalId);

  // 1) Bulk-fetch existing entity rows for this provider × externalId.
  const existingRows = await db
    .select({
      id: entities.id,
      canonicalName: entities.canonicalName,
      externalId: sql<string>`${entities.metadata} ->> 'integration_external_id'`,
      metadata: sql<Record<string, unknown>>`${entities.metadata}`,
    })
    .from(entities)
    .where(
      and(
        eq(entities.teamId, integration.teamId),
        sql`(${entities.metadata} ->> 'integration_provider') = ${integration.provider}`,
        inArray(sql`(${entities.metadata} ->> 'integration_external_id')`, [...externalIds]),
      ),
    );
  const existingByExternal = new Map<string, (typeof existingRows)[number]>();
  for (const r of existingRows) existingByExternal.set(r.externalId, r);

  const toInsert: (typeof entities.$inferInsert)[] = [];
  const toUpdate: {
    id: string;
    externalId: string;
    type: ObjectMapping['type'];
    canonicalName: string;
    status: NonNullable<ObjectMapping['status']>;
    priority: number | null;
    aliases: string[];
    metadata: Record<string, unknown>;
  }[] = [];

  for (const evt of evts) {
    const map = evt.objectMap;
    const existing = existingByExternal.get(map.externalId);
    const preserveCanonicalName = existing
      ? shouldPreserveExistingCanonicalName(existing, map)
      : false;
    const hasDisplayTitleSource = existing
      ? metadataString(existing.metadata, 'display_title_canonical_name') !== null
      : false;
    const shouldWriteDisplayTitle = Boolean(
      map.displayTitle && (!preserveCanonicalName || hasDisplayTitleSource),
    );
    const metadata: Record<string, unknown> = {
      ...(map.metadata ?? {}),
      integration_id: integration.id,
      integration_provider: integration.provider,
      integration_external_id: map.externalId,
      ...(shouldWriteDisplayTitle
        ? { display_title: map.displayTitle, display_title_canonical_name: map.canonicalName }
        : {}),
      ...(map.url ? { url: map.url } : {}),
      last_event_at: evt.occurredAt.toISOString(),
      last_event_type: evt.eventType,
    };
    if (existing) {
      const canonicalName = preserveCanonicalName ? existing.canonicalName : map.canonicalName;
      toUpdate.push({
        id: existing.id,
        externalId: map.externalId,
        type: map.type,
        canonicalName,
        status: map.status ?? 'open',
        priority: mapPriorityLabel(map.priority) ?? null,
        aliases: map.aliases ?? [],
        metadata,
      });
    } else {
      toInsert.push({
        teamId: integration.teamId,
        type: map.type,
        canonicalName: map.canonicalName,
        status: map.status ?? 'open',
        priority: mapPriorityLabel(map.priority) ?? null,
        aliases: map.aliases ?? [],
        metadata,
      });
    }
  }

  const affectedIds: string[] = [];
  const entityByExternalId = new Map<string, string>();

  // 2) Bulk INSERT new rows. `onConflictDoNothing()` catches collisions on
  //    the existing partial canonical-name unique
  //    (entities_team_type_canonical_name_unq) — a user who already
  //    created `"acme/repo#7: Add feature"` by hand before connecting
  //    GitHub doesn't have their row clobbered, and the sync doesn't
  //    23505 out the whole batch. The integration_event for that PR
  //    still lands in raw_events; only the workspace-object mapping is
  //    skipped for that one row.
  if (toInsert.length > 0) {
    // Dedupe within the batch by `(type, canonical_name)` — the partial
    // unique that `onConflictDoNothing` is meant to catch is a
    // row-vs-existing predicate, so two new rows in the same VALUES list
    // sharing the index expression still 23505 the whole batch. Real
    // payloads can carry duplicates (two Linear projects sharing a
    // title; two GitHub issues with the same number across forks). First
    // occurrence wins; the second event's `objectMap` is dropped from
    // mapping (its raw_event still lands).
    const seenKey = new Set<string>();
    const dedupedInsert = toInsert.filter((r) => {
      const key = `${r.type}\x00${r.canonicalName}`;
      if (seenKey.has(key)) return false;
      seenKey.add(key);
      return true;
    });
    const inserted = await db
      .insert(entities)
      .values(dedupedInsert)
      .onConflictDoNothing()
      .returning({ id: entities.id, metadata: entities.metadata });
    for (const r of inserted) {
      affectedIds.push(r.id);
      const externalId = metadataString(
        r.metadata as Record<string, unknown>,
        'integration_external_id',
      );
      if (externalId) entityByExternalId.set(externalId, r.id);
    }
  }

  // 3) Bulk UPDATE existing rows. One statement with a VALUES list joined
  //    on entities.id. drizzle doesn't have a typed `update FROM`
  //    builder, so we drop to a parameterised raw query with sql.join.
  if (toUpdate.length > 0) {
    const rows = toUpdate.map(
      (u) =>
        sql`(${u.id}::uuid, ${u.type}::entity_type, ${u.canonicalName}::text, ${u.status}::text, ${u.priority}::smallint, ${JSON.stringify(u.aliases)}::jsonb, ${JSON.stringify(u.metadata)}::jsonb)`,
    );
    // Defense-in-depth: the WHERE clause also pins team_id. The ids in
    // toUpdate came from a team-scoped SELECT, but stamping the team
    // here closes the door on a future bug accidentally crossing teams.
    //
    // Aliases merge instead of overwrite — a manually-added alias on a
    // Linear-mapped entity (e.g. "EngOnDeck" added by hand) survives
    // the next sync alongside the provider's own ones (e.g. "ENG-42").
    await db.execute(sql`
      WITH incoming(id, type, canonical_name, status, priority, aliases, metadata) AS (
        VALUES ${sql.join(rows, sql.raw(', '))}
      ),
      resolved AS (
        SELECT
          e.id,
          incoming.type,
          incoming.canonical_name,
          incoming.status,
          incoming.priority,
          incoming.aliases,
          incoming.metadata,
          EXISTS (
            SELECT 1
            FROM ${entities} AS other
            WHERE other.team_id = e.team_id
              AND other.type = incoming.type
              AND lower(other.canonical_name) = lower(incoming.canonical_name)
              AND other.merged_into_id IS NULL
              AND other.id <> e.id
          ) AS canonical_collision
        FROM ${entities} AS e
        JOIN incoming ON incoming.id = e.id
        WHERE e.team_id = ${integration.teamId}
      )
      UPDATE ${entities} AS e
      SET
        canonical_name = CASE
          WHEN resolved.canonical_collision THEN e.canonical_name
          ELSE resolved.canonical_name
        END,
        status = resolved.status,
        priority = COALESCE(resolved.priority, e.priority),
        aliases = (
          SELECT COALESCE(jsonb_agg(DISTINCT a), '[]'::jsonb)
          FROM jsonb_array_elements(COALESCE(e.aliases, '[]'::jsonb) || resolved.aliases) AS t(a)
        ),
        metadata = (e.metadata - 'display_title_canonical_name_collision') || CASE
          WHEN resolved.canonical_collision
            AND resolved.metadata ? 'display_title_canonical_name'
          THEN (resolved.metadata - 'display_title_canonical_name')
            || jsonb_build_object(
              'display_title_canonical_name',
              e.canonical_name,
              'display_title_canonical_name_collision',
              resolved.canonical_name
            )
          ELSE resolved.metadata - 'display_title_canonical_name_collision'
        END,
        updated_at = NOW()
      FROM resolved
      WHERE e.id = resolved.id
        AND e.team_id = ${integration.teamId}
    `);
    for (const u of toUpdate) affectedIds.push(u.id);
    for (const u of toUpdate) entityByExternalId.set(u.externalId, u.id);
  }

  await Promise.all(affectedIds.map((id) => enqueueObjectEmbedJob(integration.teamId, id)));
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
    await reconcileArtifactEvidence(deps.db, {
      teamId: deps.integration.teamId,
      artifactType: event.objectMap.type,
      canonicalName: event.objectMap.displayTitle ?? event.objectMap.canonicalName,
      status: clusterStatusFromObjectStatus(event.objectMap.status),
      canonicalEntityId: entityId ?? null,
      rawEventId,
      occurredAt: event.occurredAt,
      provider: event.provider,
      externalObjectId: event.externalObjectId,
      role: evidenceRoleForIntegrationEvent(event),
      strength: evidenceStrengthForIntegrationEvent(event),
      authoritative: integrationEventIsAuthoritative(event),
      anchors: artifactAnchorsForIntegrationEvent(event),
      metadata: {
        provider: event.provider,
        event_type: event.eventType,
        integration_id: deps.integration.id,
      },
    });
  }
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

function integrationEventIsAuthoritative(event: IntegrationEvent): boolean {
  if (!event.objectMap) return false;
  if (event.provider === 'github') {
    return [
      'issue.closed',
      'issue.updated',
      'pr.merged',
      'pr.closed',
      'pr.updated',
      'release.published',
    ].includes(event.eventType);
  }
  if (event.provider === 'sentry') return event.eventType.startsWith('issue.');
  if (event.provider === 'linear') return event.eventType.startsWith('issue.');
  if (event.provider === 'monday') return event.eventType.includes('status');
  return false;
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

function shouldPreserveExistingCanonicalName(
  existing: { canonicalName: string; metadata: Record<string, unknown> },
  map: ObjectMapping,
): boolean {
  const previousProviderName = metadataString(existing.metadata, 'display_title_canonical_name');
  if (previousProviderName) return existing.canonicalName !== previousProviderName;
  return existing.canonicalName !== map.canonicalName;
}

/**
 * Translate a string priority label from a provider into the small-int
 * scale entities.priority uses: 1=urgent, 2=high, 3=medium, 4=low (mirrors
 * Linear's own scale). null means "leave priority alone".
 */
function mapPriorityLabel(label: ObjectMapping['priority']): number | null | undefined {
  if (label === undefined) return undefined;
  if (label === null) return null;
  switch (label) {
    case 'urgent':
      return 1;
    case 'high':
      return 2;
    case 'medium':
      return 3;
    case 'low':
      return 4;
  }
}

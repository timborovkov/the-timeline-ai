import { type Db, entities, rawEvents } from '@timeline/db';
import { and, eq, inArray, sql } from 'drizzle-orm';

import type { IntegrationEvent, IntegrationRow, ObjectMapping } from '#src/integrations/types.js';

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

  const values = uniqueEvents.map((evt) => {
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
      sourceMetadata: {
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

  // Workspace-object upsert only fires for events that actually
  // inserted (i.e. the dedup_key wasn't already on raw_events). A
  // webhook replay that produces zero new raw_events shouldn't bump
  // mapped-entity rows or re-enqueue object embed jobs — that would
  // re-embed unchanged entities every time the same payload arrives.
  // Dedupe by externalId within the surviving set (a single PR can
  // fire pr.updated AND pr.review.approved in one webhook; both carry
  // the same objectMap).
  const insertedDedupKeys = new Set(inserted.map((r) => r.dedupKey));
  const byExternal = new Map<string, IntegrationEvent & { objectMap: ObjectMapping }>();
  // Iterate `uniqueEvents` (the dedup-winning list) instead of
  // `deps.events` so the objectMap paired with each externalId comes
  // from the SAME event whose raw_events row landed. Iterating the
  // pre-dedup list would let a later same-dedupKey event silently
  // override the winner's objectMap and decouple the entity row from
  // the stored raw_event content.
  for (const evt of uniqueEvents) {
    if (!evt.objectMap) continue;
    if (!insertedDedupKeys.has(evt.dedupKey)) continue;
    byExternal.set(
      evt.objectMap.externalId,
      evt as IntegrationEvent & { objectMap: ObjectMapping },
    );
  }
  if (byExternal.size > 0) {
    await upsertWorkspaceObjects(deps.db, deps.integration, [...byExternal.values()]);
  }

  return inserted.map((r) => r.id);
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
): Promise<void> {
  const externalIds = evts.map((e) => e.objectMap.externalId);

  // 1) Bulk-fetch existing entity rows for this provider × externalId.
  const existingRows = await db
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
  const idByExternal = new Map<string, string>();
  for (const r of existingRows) idByExternal.set(r.externalId, r.id);

  const toInsert: (typeof entities.$inferInsert)[] = [];
  const toUpdate: {
    id: string;
    canonicalName: string;
    status: NonNullable<ObjectMapping['status']>;
    priority: number | null;
    aliases: string[];
    metadata: Record<string, unknown>;
  }[] = [];

  for (const evt of evts) {
    const map = evt.objectMap;
    const metadata: Record<string, unknown> = {
      integration_id: integration.id,
      integration_provider: integration.provider,
      integration_external_id: map.externalId,
      ...(map.url ? { url: map.url } : {}),
      last_event_at: evt.occurredAt.toISOString(),
      last_event_type: evt.eventType,
    };
    const existingId = idByExternal.get(map.externalId);
    if (existingId) {
      toUpdate.push({
        id: existingId,
        canonicalName: map.canonicalName,
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
      .returning({ id: entities.id });
    for (const r of inserted) affectedIds.push(r.id);
  }

  // 3) Bulk UPDATE existing rows. One statement with a VALUES list joined
  //    on entities.id. drizzle doesn't have a typed `update FROM`
  //    builder, so we drop to a parameterised raw query with sql.join.
  if (toUpdate.length > 0) {
    const rows = toUpdate.map(
      (u) =>
        sql`(${u.id}::uuid, ${u.canonicalName}::text, ${u.status}::text, ${u.priority}::smallint, ${JSON.stringify(u.aliases)}::jsonb, ${JSON.stringify(u.metadata)}::jsonb)`,
    );
    // Defense-in-depth: the WHERE clause also pins team_id. The ids in
    // toUpdate came from a team-scoped SELECT, but stamping the team
    // here closes the door on a future bug accidentally crossing teams.
    //
    // Aliases merge instead of overwrite — a manually-added alias on a
    // Linear-mapped entity (e.g. "EngOnDeck" added by hand) survives
    // the next sync alongside the provider's own ones (e.g. "ENG-42").
    await db.execute(sql`
      UPDATE ${entities} AS e
      SET
        canonical_name = v.canonical_name,
        status = v.status,
        priority = COALESCE(v.priority, e.priority),
        aliases = (
          SELECT COALESCE(jsonb_agg(DISTINCT a), '[]'::jsonb)
          FROM jsonb_array_elements(COALESCE(e.aliases, '[]'::jsonb) || v.aliases) AS t(a)
        ),
        metadata = e.metadata || v.metadata,
        updated_at = NOW()
      FROM (VALUES ${sql.join(rows, sql.raw(', '))})
        AS v(id, canonical_name, status, priority, aliases, metadata)
      WHERE e.id = v.id
        AND e.team_id = ${integration.teamId}
    `);
    for (const u of toUpdate) affectedIds.push(u.id);
  }

  await Promise.all(affectedIds.map((id) => enqueueObjectEmbedJob(integration.teamId, id)));
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

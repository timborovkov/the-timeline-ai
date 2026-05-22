import {
  type Db,
  entities,
  factEntities,
  facts as factsTable,
  rawEvents,
  teamMembers,
  teams,
  teamRole,
  users,
} from '@timeline/db';
import { and, asc, desc, eq, gte, inArray, isNull, lt, ne, or, sql } from 'drizzle-orm';

import { embed as defaultEmbed, type EmbedResult } from './llm/embed.js';
import { getQdrantClient, type SearchHit, type SearchOpts } from './qdrant/client.js';

// Note: `teamRole` value is referenced at runtime by drizzle elsewhere; keeping
// the value import lets us derive the union type from the enum definition.
const _roleValues = teamRole.enumValues;
export type TeamRole = (typeof _roleValues)[number];

const ROLE_RANK: Record<TeamRole, number> = { member: 0, admin: 1, owner: 2 };

export interface EventListFilters {
  authorUserId?: string;
  /** Inclusive lower bound on `occurred_at`. */
  from?: Date;
  /** Exclusive upper bound on `occurred_at`. Callers wanting "include all of
   *  day X" should pass midnight UTC of day X+1. */
  to?: Date;
  limit?: number;
}

export interface CreateEventInput {
  authorUserId: string | null;
  source: 'web' | 'telegram' | 'email' | 'system';
  contentText?: string | null;
  contentAudioUrl?: string | null;
  occurredAt?: Date;
  visibility?: 'private' | 'team' | 'specific_users';
  visibilityUserIds?: string[] | null;
  sourceMetadata?: Record<string, unknown>;
}

export interface CreateEmailEventInput {
  authorUserId: string | null;
  /** RFC 5322 Message-ID, normalized (no angle brackets). Drives the
   *  per-team unique index that makes Postmark retries idempotent. */
  messageId: string;
  /** Optional In-Reply-To Message-ID (normalized) for direct-parent linking. */
  inReplyTo?: string | null;
  /** References-list (normalized). Used as the fallback chain when In-Reply-To
   *  points at a Message-ID we never received. */
  references?: string[];
  contentText: string;
  occurredAt: Date;
  /** Full source_metadata payload to merge with the computed thread fields.
   *  The dispatcher composes this; team-scope only adds `thread_root_id`. */
  sourceMetadata: Record<string, unknown>;
}

export interface CreateEmailEventResult {
  id: string;
  teamId: string;
  threadRootId: string;
  /** True if the insert hit the unique index (Postmark retry / duplicate
   *  delivery). The dispatcher should skip downstream enqueues but NOT mark
   *  failure — the original delivery already enqueued them. */
  deduplicated: boolean;
}

export interface SearchEventsInput {
  query: string;
  from?: Date;
  to?: Date;
  source?: 'web' | 'telegram' | 'email' | 'system';
  entityIds?: string[];
  limit?: number;
}

export interface SearchEventResult {
  eventId: string;
  factIds: string[];
  score: number;
  occurredAt: string;
  source: 'web' | 'telegram' | 'email' | 'system';
  authorUserId: string | null;
  entityIds: string[];
  snippet: string;
}

export interface EntityFact {
  id: string;
  statement: string;
  confidence: number;
  rawEventId: string;
  extractedAt: Date;
}

export interface CoOccurringEntity {
  id: string;
  canonicalName: string;
  type: 'person' | 'company' | 'project' | 'topic' | 'other';
  count: number;
}

export interface EntityProfile {
  entity: {
    id: string;
    type: 'person' | 'company' | 'project' | 'topic' | 'other';
    canonicalName: string;
    aliases: string[];
    metadata: Record<string, unknown>;
  };
  facts: EntityFact[];
  /** Source events whose facts mention this entity, visibility-filtered. */
  events: {
    id: string;
    occurredAt: Date;
    source: 'web' | 'telegram' | 'email' | 'system';
    authorUserId: string | null;
    authorName: string | null;
    authorEmail: string | null;
    contentText: string | null;
    contentAudioUrl: string | null;
  }[];
  coOccurring: CoOccurringEntity[];
}

export interface EventWithFacts {
  event: {
    id: string;
    occurredAt: Date;
    source: 'web' | 'telegram' | 'email' | 'system';
    authorUserId: string | null;
    contentText: string | null;
    contentAudioUrl: string | null;
    visibility: 'private' | 'team' | 'specific_users';
  };
  facts: EntityFact[];
  entities: { id: string; canonicalName: string; type: string }[];
}

export interface TeamScopeDeps {
  /** Inject a custom embedder. Tests pass a deterministic stub; production
   *  uses the OpenRouter-backed `llm.embed`. */
  embed?: (input: { text: string }) => Promise<EmbedResult>;
  /** Inject a custom Qdrant client. Tests pass a fake; production uses the
   *  module-cached `getQdrantClient()`. */
  qdrantSearch?: (
    teamId: string,
    userId: string,
    vector: number[],
    opts: SearchOpts,
  ) => Promise<SearchHit[]>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Construct a query helper bound to a single (team, user) pair.
 *
 * Every query the helper runs is automatically scoped to `teamId`. Callers
 * cannot override the team_id after construction — this is the single
 * chokepoint that enforces team isolation. Row-level visibility for
 * `raw_events` is applied here too, so it cannot be forgotten by callers.
 *
 * Membership is verified on first query (cached) so isolation is enforced,
 * not advised. Callers may still invoke `requireMembership(role)` explicitly
 * to require a higher role than `member` (e.g. for admin-only operations).
 */
export function withTeam(db: Db, teamId: string, userId: string, deps: TeamScopeDeps = {}) {
  const visibilityFilter = or(
    eq(rawEvents.visibility, 'team'),
    and(eq(rawEvents.visibility, 'private'), eq(rawEvents.authorUserId, userId)),
    and(
      eq(rawEvents.visibility, 'specific_users'),
      sql`${userId}::uuid = ANY(${rawEvents.visibilityUserIds})`,
    ),
  );

  let membershipPromise: Promise<TeamRole> | undefined;

  function ensureMember(minRole: TeamRole = 'member'): Promise<TeamRole> {
    membershipPromise ??= (async () => {
      const rows = await db
        .select({ role: teamMembers.role })
        .from(teamMembers)
        .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)))
        .limit(1);
      const row = rows[0];
      if (!row) throw new Error('Not a member of this team');
      return row.role;
    })();
    return membershipPromise.then((role) => {
      if (ROLE_RANK[role] < ROLE_RANK[minRole]) {
        throw new Error(`Requires ${minRole} role`);
      }
      return role;
    });
  }

  // Hoisted so both the public `getEventsByIds` method and `searchEvents`
  // call one implementation. Previously `searchEvents` re-rolled the same
  // select+where, which Bugbot flagged: two copies will drift the next time
  // we touch the visibility filter. Single chokepoint — same idea as
  // visibilityFilter itself.
  async function getEventsByIdsImpl(ids: string[]) {
    if (ids.length === 0) return [];
    await ensureMember();
    return db
      .select()
      .from(rawEvents)
      .where(and(inArray(rawEvents.id, ids), eq(rawEvents.teamId, teamId), visibilityFilter));
  }

  return {
    teamId,
    userId,

    requireMembership: ensureMember,

    async team() {
      await ensureMember();
      const rows = await db.select().from(teams).where(eq(teams.id, teamId)).limit(1);
      return rows[0] ?? null;
    },

    async listEvents(filters: EventListFilters = {}) {
      await ensureMember();
      const conditions = [eq(rawEvents.teamId, teamId), visibilityFilter];
      if (filters.authorUserId) {
        conditions.push(eq(rawEvents.authorUserId, filters.authorUserId));
      }
      if (filters.from) conditions.push(gte(rawEvents.occurredAt, filters.from));
      if (filters.to) conditions.push(lt(rawEvents.occurredAt, filters.to));
      return db
        .select()
        .from(rawEvents)
        .where(and(...conditions))
        .orderBy(desc(rawEvents.occurredAt))
        .limit(filters.limit ?? 200);
    },

    async getEvent(id: string) {
      await ensureMember();
      const rows = await db
        .select()
        .from(rawEvents)
        .where(and(eq(rawEvents.id, id), eq(rawEvents.teamId, teamId), visibilityFilter))
        .limit(1);
      return rows[0] ?? null;
    },

    /**
     * Bulk-load events by id with team + visibility enforced at the SQL
     * layer. Used by /api/search to hydrate result rows in a single
     * round-trip rather than N getEvent() calls. Returns only rows visible
     * to (teamId, userId); ids that fail the filter are silently dropped —
     * callers must reconcile by id, not by index.
     */
    getEventsByIds: getEventsByIdsImpl,

    async createEvent(input: CreateEventInput) {
      await ensureMember();
      const rows = await db
        .insert(rawEvents)
        .values({
          teamId,
          authorUserId: input.authorUserId,
          source: input.source,
          contentText: input.contentText ?? null,
          contentAudioUrl: input.contentAudioUrl ?? null,
          occurredAt: input.occurredAt ?? new Date(),
          visibility: input.visibility ?? 'team',
          visibilityUserIds: input.visibilityUserIds ?? null,
          sourceMetadata: input.sourceMetadata ?? {},
        })
        .returning();
      const row = rows[0];
      if (!row) throw new Error('Failed to create event');
      return row;
    },

    /**
     * Phase 7 email-specific create that wraps insert + thread-root lookup
     * in one transaction so the email dispatcher cannot bypass team isolation
     * or forget to thread-link. Idempotent against the partial unique index
     * on `(team_id, source_metadata->>'message_id')`: a Postmark retry returns
     * `{ deduplicated: true }` so the dispatcher skips re-enqueueing extract /
     * embed (the original delivery already did that).
     *
     * Thread linking strategy: probe in-reply-to first (direct parent), then
     * walk references[] oldest-to-newest looking for any ancestor in this
     * team. Inherit the *root* id from the matched ancestor so every email in
     * the thread shares one `thread_root_id` — render is a single GROUP BY.
     * If no ancestor exists, the new row's thread_root_id is its own id.
     *
     * Sender membership is NOT re-verified here (unlike the Telegram path).
     * Email's sender_unverified semantics are decided by the dispatcher
     * before this call, because the From address need not correspond to a
     * team member at all — that's the whole point of the unverified-sender
     * carve-out.
     */
    async createEmailEvent(input: CreateEmailEventInput): Promise<CreateEmailEventResult | null> {
      await ensureMember();
      return db.transaction(async (tx) => {
        // Probe parent: in-reply-to first, then any reference we know about.
        let parentRootId: string | null = null;
        // Inherit the parent's unverified flag when threading. A child reply
        // attributed to a verified member should not "launder" an unverified
        // parent's content — the thread surfaces together in the UI and the
        // user has to be able to see "this thread started with an unverified
        // sender." Without this inheritance, an attacker who plants a Message-ID
        // by guessing then catches a legitimate reply turns the whole thread
        // into verified-looking history.
        let inheritedUnverified = false;
        // RFC 5322 §3.6.4 priority: `In-Reply-To` names the DIRECT parent;
        // `References` is an oldest-to-newest chain of ancestors. For
        // `thread_root_id` inheritance any ancestor works (they all share a
        // root), but for `sender_unverified` inheritance picking the wrong
        // ancestor is observable — a verified deeper ancestor would clear
        // the flag set by an unverified direct parent, defeating the
        // sticky-unverified guarantee. Probe both, then resolve priority
        // in memory: in-reply-to wins, then references newest-to-oldest.
        const probeIds = [input.inReplyTo, ...(input.references ?? [])].filter(
          (s): s is string => typeof s === 'string' && s.length > 0,
        );
        if (probeIds.length > 0) {
          const probeRows = await tx
            .select({
              id: rawEvents.id,
              metadata: rawEvents.sourceMetadata,
            })
            .from(rawEvents)
            .where(
              and(
                eq(rawEvents.teamId, teamId),
                eq(rawEvents.source, 'email'),
                sql`(${rawEvents.sourceMetadata} ->> 'message_id') = ANY(${probeIds})`,
              ),
            );
          // Index by message_id so we can look up matches in priority order
          // without re-querying. Tolerant of rows whose metadata is missing
          // the field (shouldn't happen, but cheap defense).
          const byMid = new Map<string, (typeof probeRows)[number]>();
          for (const r of probeRows) {
            const mid = ((r.metadata ?? {}) as Record<string, unknown>).message_id;
            if (typeof mid === 'string') byMid.set(mid, r);
          }
          let parent: (typeof probeRows)[number] | undefined;
          if (input.inReplyTo) parent = byMid.get(input.inReplyTo);
          if (!parent && input.references && input.references.length > 0) {
            // References goes oldest-first per RFC; walk reverse for newest
            // (closest) ancestor first.
            for (let i = input.references.length - 1; i >= 0; i--) {
              const ref = input.references[i];
              if (!ref) continue;
              const hit = byMid.get(ref);
              if (hit) {
                parent = hit;
                break;
              }
            }
          }
          if (parent) {
            const meta = (parent.metadata ?? {}) as Record<string, unknown>;
            const inheritedRoot =
              typeof meta.thread_root_id === 'string' ? meta.thread_root_id : parent.id;
            parentRootId = inheritedRoot;
            if (meta.sender_unverified === true) inheritedUnverified = true;
          }
        }

        const composedMetadata: Record<string, unknown> = {
          ...input.sourceMetadata,
          message_id: input.messageId,
        };
        if (inheritedUnverified) {
          composedMetadata.sender_unverified = true;
          composedMetadata.unverified_inherited_from_thread = true;
        }
        if (input.inReplyTo) composedMetadata.in_reply_to = input.inReplyTo;
        if (input.references && input.references.length > 0) {
          composedMetadata.references = input.references;
        }
        // thread_root_id is a placeholder when there's no parent — we'll
        // backfill it to the row's own id after insert. Setting it
        // pre-insert lets us emit the canonical metadata shape on the
        // ON CONFLICT path too.
        if (parentRootId) composedMetadata.thread_root_id = parentRootId;

        const inserted = await tx
          .insert(rawEvents)
          .values({
            teamId,
            authorUserId: input.authorUserId,
            source: 'email',
            contentText: input.contentText,
            occurredAt: input.occurredAt,
            visibility: 'team',
            sourceMetadata: composedMetadata,
          })
          .onConflictDoNothing()
          .returning({ id: rawEvents.id, teamId: rawEvents.teamId });

        const row = inserted[0];
        if (!row) {
          // Postmark retry; the original row is already on disk with its
          // own thread_root_id. Look it up so callers can still link.
          const existing = await tx
            .select({ id: rawEvents.id, metadata: rawEvents.sourceMetadata })
            .from(rawEvents)
            .where(
              and(
                eq(rawEvents.teamId, teamId),
                eq(rawEvents.source, 'email'),
                sql`(${rawEvents.sourceMetadata} ->> 'message_id') = ${input.messageId}`,
              ),
            )
            .limit(1);
          const existingRow = existing[0];
          if (!existingRow) return null;
          const meta = (existingRow.metadata ?? {}) as Record<string, unknown>;
          const rootId =
            typeof meta.thread_root_id === 'string' ? meta.thread_root_id : existingRow.id;
          return {
            id: existingRow.id,
            teamId,
            threadRootId: rootId,
            deduplicated: true,
          };
        }

        const rootId = parentRootId ?? row.id;
        if (!parentRootId) {
          // No parent found at insert time — stamp the row as its own root
          // so a later child can inherit it without an extra query.
          const patch = JSON.stringify({ thread_root_id: rootId });
          await tx
            .update(rawEvents)
            .set({
              sourceMetadata: sql`COALESCE(${rawEvents.sourceMetadata}, '{}'::jsonb) || ${patch}::jsonb`,
            })
            .where(eq(rawEvents.id, row.id));
        }
        return { id: row.id, teamId: row.teamId, threadRootId: rootId, deduplicated: false };
      });
    },

    async listMembers() {
      await ensureMember();
      return db
        .select({
          userId: teamMembers.userId,
          role: teamMembers.role,
          createdAt: teamMembers.createdAt,
        })
        .from(teamMembers)
        .where(eq(teamMembers.teamId, teamId))
        .orderBy(asc(teamMembers.createdAt));
    },

    /**
     * Fetch one event with its linked facts and entities. Used by the agent
     * `get_event` tool and by `/api/chat` citation expansion. Returns `null`
     * if the event isn't in this team OR if it isn't visible to this user —
     * the visibility filter runs at the SQL layer, so a leaked id from
     * another team or a private event from another user both resolve to
     * `null` indistinguishably (intentional: do not reveal existence).
     */
    async getEventWithFacts(id: string): Promise<EventWithFacts | null> {
      if (!UUID_RE.test(id)) return null;
      await ensureMember();
      const eventRows = await db
        .select()
        .from(rawEvents)
        .where(and(eq(rawEvents.id, id), eq(rawEvents.teamId, teamId), visibilityFilter))
        .limit(1);
      const event = eventRows[0];
      if (!event) return null;

      const factRows = await db
        .select({
          id: factsTable.id,
          statement: factsTable.statement,
          confidence: factsTable.confidence,
          rawEventId: factsTable.rawEventId,
          extractedAt: factsTable.extractedAt,
        })
        .from(factsTable)
        .where(and(eq(factsTable.rawEventId, event.id), eq(factsTable.teamId, teamId)))
        .orderBy(desc(factsTable.extractedAt));

      const factIds = factRows.map((f) => f.id);
      const entityRows =
        factIds.length > 0
          ? await db
              .select({
                id: entities.id,
                canonicalName: entities.canonicalName,
                type: entities.type,
              })
              .from(factEntities)
              .innerJoin(entities, eq(factEntities.entityId, entities.id))
              .where(
                and(
                  inArray(factEntities.factId, factIds),
                  eq(entities.teamId, teamId),
                  isNull(entities.mergedIntoId),
                ),
              )
              .groupBy(entities.id, entities.canonicalName, entities.type)
          : [];

      return {
        event: {
          id: event.id,
          occurredAt: event.occurredAt,
          source: event.source,
          authorUserId: event.authorUserId,
          contentText: event.contentText,
          contentAudioUrl: event.contentAudioUrl,
          visibility: event.visibility,
        },
        facts: factRows,
        entities: entityRows,
      };
    },

    /**
     * Resolve an entity by UUID or by canonical-name / alias (case-insensitive),
     * then load its facts + visibility-filtered source events + co-occurring
     * entities — the same payload the entity profile page renders. Single
     * source of truth: the profile page and the agent `get_entity` tool both
     * call this.
     *
     * Name resolution is exact case-insensitive on `canonical_name` OR alias
     * membership. Multi-match (e.g. a person "Apple" and a company "Apple")
     * resolves to the most recently updated row. Embedding-similarity match
     * remains deferred (see Phase 4/5 carryovers).
     */
    async getEntity(
      idOrName: string,
      opts: { factLimit?: number; coOccurringLimit?: number } = {},
    ): Promise<EntityProfile | null> {
      await ensureMember();
      const trimmed = idOrName.trim();
      if (!trimmed) return null;
      const factLimit = opts.factLimit ?? 200;
      const coLimit = opts.coOccurringLimit ?? 20;

      let entityRow: typeof entities.$inferSelect | undefined;
      if (UUID_RE.test(trimmed)) {
        // Explicit UUID lookup. If the UUID matches no row (or matches a
        // merged entity), do NOT fall through to name search — name
        // matching a UUID-shaped string against canonical_name is dead
        // code, and the fall-through used to mask "wrong team / merged"
        // as "name not found". Be honest and return null.
        const rows = await db
          .select()
          .from(entities)
          .where(
            and(
              eq(entities.id, trimmed),
              eq(entities.teamId, teamId),
              isNull(entities.mergedIntoId),
            ),
          )
          .limit(1);
        if (!rows[0]) return null;
        entityRow = rows[0];
      } else {
        // case-insensitive name OR alias-array contains
        const rows = await db
          .select()
          .from(entities)
          .where(
            and(
              eq(entities.teamId, teamId),
              isNull(entities.mergedIntoId),
              or(
                sql`lower(${entities.canonicalName}) = lower(${trimmed})`,
                sql`${entities.aliases} @> ${JSON.stringify([trimmed])}::jsonb`,
              ),
            ),
          )
          .orderBy(desc(entities.updatedAt))
          .limit(1);
        if (!rows[0]) return null;
        entityRow = rows[0];
      }

      const factRows = await db
        .select({
          id: factsTable.id,
          statement: factsTable.statement,
          confidence: factsTable.confidence,
          rawEventId: factsTable.rawEventId,
          extractedAt: factsTable.extractedAt,
        })
        .from(factsTable)
        .innerJoin(factEntities, eq(factEntities.factId, factsTable.id))
        .where(and(eq(factEntities.entityId, entityRow.id), eq(factsTable.teamId, teamId)))
        .orderBy(desc(factsTable.extractedAt))
        .limit(factLimit);

      const eventIds = Array.from(new Set(factRows.map((f) => f.rawEventId)));
      const eventRows =
        eventIds.length > 0
          ? await db
              .select({
                id: rawEvents.id,
                occurredAt: rawEvents.occurredAt,
                source: rawEvents.source,
                authorUserId: rawEvents.authorUserId,
                contentText: rawEvents.contentText,
                contentAudioUrl: rawEvents.contentAudioUrl,
                authorName: users.name,
                authorEmail: users.email,
              })
              .from(rawEvents)
              .leftJoin(users, eq(rawEvents.authorUserId, users.id))
              .where(
                and(
                  inArray(rawEvents.id, eventIds),
                  eq(rawEvents.teamId, teamId),
                  visibilityFilter,
                ),
              )
              .orderBy(desc(rawEvents.occurredAt))
          : [];

      const visibleEventIds = new Set(eventRows.map((e) => e.id));
      const visibleFacts = factRows.filter((f) => visibleEventIds.has(f.rawEventId));
      const visibleFactIds = visibleFacts.map((f) => f.id);

      const coRows =
        visibleFactIds.length > 0
          ? await db
              .select({
                id: entities.id,
                canonicalName: entities.canonicalName,
                type: entities.type,
                count: sql<number>`COUNT(*)::int`,
              })
              .from(factEntities)
              .innerJoin(entities, eq(factEntities.entityId, entities.id))
              .where(
                and(
                  inArray(factEntities.factId, visibleFactIds),
                  ne(factEntities.entityId, entityRow.id),
                  eq(entities.teamId, teamId),
                  isNull(entities.mergedIntoId),
                ),
              )
              .groupBy(entities.id, entities.canonicalName, entities.type)
              .orderBy(sql`COUNT(*) DESC`)
              .limit(coLimit)
          : [];

      const aliases = Array.isArray(entityRow.aliases)
        ? (entityRow.aliases as unknown[]).filter((v): v is string => typeof v === 'string')
        : [];
      const metadata =
        entityRow.metadata && typeof entityRow.metadata === 'object'
          ? (entityRow.metadata as Record<string, unknown>)
          : {};

      return {
        entity: {
          id: entityRow.id,
          type: entityRow.type,
          canonicalName: entityRow.canonicalName,
          aliases,
          metadata,
        },
        facts: visibleFacts,
        events: eventRows,
        coOccurring: coRows,
      };
    },

    /**
     * Semantic search across the team's events. Embeds the query, runs a
     * filtered Qdrant search (team_id + visibility baked into the wrapper),
     * dedups by event_id, then hydrates from Postgres via `getEventsByIds`
     * — the second-line-of-defense visibility filter at the SQL layer.
     *
     * This collapses what used to live inline in `/api/search` so the agent's
     * `search_timeline` tool and the search endpoint share one implementation.
     * The dedup invariant matters: a fact-level point and its parent event
     * point can both match; we merge entity_ids across them so the UI doesn't
     * silently drop entity badges.
     */
    async searchEvents(input: SearchEventsInput): Promise<SearchEventResult[]> {
      await ensureMember();
      const embedFn = deps.embed ?? defaultEmbed;
      const searchFn =
        deps.qdrantSearch ??
        (async (tId, uId, vector, opts) => {
          const client = getQdrantClient();
          return client.search(tId, uId, vector, opts);
        });

      const { vector } = await embedFn({ text: input.query });

      const searchOpts: SearchOpts = { limit: input.limit ?? 20 };
      if (input.from) searchOpts.from = input.from;
      if (input.to) searchOpts.to = input.to;
      if (input.source) searchOpts.source = input.source;
      if (input.entityIds) searchOpts.entityIds = input.entityIds;

      const hits = await searchFn(teamId, userId, vector, searchOpts);

      // Dedupe by event_id. Keep highest score; collect fact_ids; merge
      // entity_ids across event-level + fact-level points on the same event.
      const dedup = new Map<string, SearchEventResult>();
      for (const hit of hits) {
        // Defense in depth: Qdrant's wrapper already filters team_id, but
        // verify here so a misconfigured payload can't leak across teams.
        if (hit.payload.team_id !== teamId) continue;
        // Qdrant payloads CAN drift — schema changes, manual point edits,
        // older embed worker versions. Spread on undefined throws and kills
        // the whole search. Treat each field as best-effort.
        const entityIds = Array.isArray(hit.payload.entity_ids) ? hit.payload.entity_ids : [];
        const factId = hit.payload.fact_id ?? null;
        const existing = dedup.get(hit.payload.event_id);
        if (existing) {
          if (hit.score > existing.score) existing.score = hit.score;
          if (factId && !existing.factIds.includes(factId)) existing.factIds.push(factId);
          for (const entId of entityIds) {
            if (!existing.entityIds.includes(entId)) existing.entityIds.push(entId);
          }
          continue;
        }
        dedup.set(hit.payload.event_id, {
          eventId: hit.payload.event_id,
          factIds: factId ? [factId] : [],
          score: hit.score,
          occurredAt: hit.payload.occurred_at,
          source: hit.payload.source,
          authorUserId: hit.payload.author_user_id,
          entityIds: [...entityIds],
          snippet: '',
        });
      }

      const orderedEventIds = Array.from(dedup.values())
        .sort((a, b) => b.score - a.score)
        .map((r) => r.eventId);
      if (orderedEventIds.length === 0) return [];

      // Hydrate via the shared getEventsByIds helper — same SQL the public
      // method runs, so the visibility filter can't drift across the two
      // call sites.
      const accessibleEvents = await getEventsByIdsImpl(orderedEventIds);
      const eventMap = new Map<string, (typeof accessibleEvents)[number]>();
      for (const ev of accessibleEvents) eventMap.set(ev.id, ev);

      const allFactIds = Array.from(dedup.values()).flatMap((r) => r.factIds);
      const factRows =
        allFactIds.length > 0
          ? await db
              .select({
                id: factsTable.id,
                statement: factsTable.statement,
                teamId: factsTable.teamId,
                rawEventId: factsTable.rawEventId,
              })
              .from(factsTable)
              .where(inArray(factsTable.id, allFactIds))
          : [];
      const factMap = new Map<string, (typeof factRows)[number]>();
      for (const f of factRows) {
        // Cross-team fact id from a stale Qdrant write must not leak.
        if (f.teamId === teamId) factMap.set(f.id, f);
      }

      const results: SearchEventResult[] = [];
      for (const eventId of orderedEventIds) {
        const ev = eventMap.get(eventId);
        if (!ev) continue;
        const row = dedup.get(eventId);
        if (!row) continue;
        const verifiedFactIds = row.factIds.filter((fid) => factMap.has(fid));
        const factSnippet = verifiedFactIds
          .map((fid) => factMap.get(fid)?.statement)
          .filter((s): s is string => Boolean(s))
          .join(' · ');
        const snippet =
          factSnippet ||
          (ev.contentText ? ev.contentText.slice(0, 240) : '[audio event — no transcript]');
        results.push({
          eventId: ev.id,
          factIds: verifiedFactIds,
          score: row.score,
          occurredAt: ev.occurredAt.toISOString(),
          source: ev.source,
          authorUserId: ev.authorUserId,
          entityIds: row.entityIds,
          snippet,
        });
      }
      return results;
    },
  };
}

export type TeamScope = ReturnType<typeof withTeam>;

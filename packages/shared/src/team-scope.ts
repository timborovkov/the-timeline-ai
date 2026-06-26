import {
  type Db,
  auditLog,
  artifactClusterMembers,
  artifactClusters,
  agentSuggestionEvidence,
  agentSuggestionItems,
  agentSuggestions,
  boardItems,
  calendarEvents,
  documentChunks,
  documents,
  documentVersions,
  entities,
  entityType,
  eventSource,
  factEntities,
  facts as factsTable,
  objectIdentityFacets,
  objectChanges,
  objectNotes,
  rawEvents,
  teamMembers,
  teamVisibilityDefaults,
  teams,
  teamRole,
  users,
  visibilityDefaultSource,
} from '@timeline/db';
import { and, asc, desc, eq, gte, inArray, isNull, lt, ne, or, sql } from 'drizzle-orm';

import type { chatStructured } from '#src/llm/chat.js';

import { createAuditScope } from '#src/audit/scope.js';
import { createBoardScope } from '#src/boards/index.js';
import { createCalendarScope } from '#src/calendar/scope.js';
import { documentPresentation } from '#src/documents/presentation.js';
import { createDocumentScope } from '#src/documents/scope.js';
import { createIntegrationScope } from '#src/integrations/scope.js';
import { createJobRecoveryScope } from '#src/job-recovery/index.js';
import { embed as defaultEmbed, type EmbedResult } from '#src/llm/embed.js';
import { TIMELINE_MODELS } from '#src/llm/models.js';
import { createMcpScope } from '#src/mcp/scope.js';
import { createMeetingScope } from '#src/meetings/scope.js';
import { createObjectScope, normalizeIdentityFacet } from '#src/objects/index.js';
import { invalidateObjectSummariesForRawEvent } from '#src/objects/summaries.js';
import { createOnboardingScope } from '#src/onboarding/index.js';
import { decodeCursor, encodeCursor, pageWindow } from '#src/pagination.js';
import {
  getQdrantClient,
  type SearchHit,
  type SearchOpts,
  type SourceKind,
} from '#src/qdrant/client.js';
import { buildPointId } from '#src/qdrant/point-id.js';
import { createSuggestionScope } from '#src/suggestions/index.js';
import { normalizeVisibilityUserIds, rawEventVisibleToUser } from '#src/visibility.js';

// Note: `teamRole` value is referenced at runtime by drizzle elsewhere; keeping
// the value import lets us derive the union type from the enum definition.
const _roleValues = teamRole.enumValues;
export type TeamRole = (typeof _roleValues)[number];

/** Re-exported so callers (e.g. agent tool schemas) and downstream types in
 *  this file share one source of truth with the Postgres enum. The
 *  intermediate const mirrors the `_roleValues` pattern above and pins the
 *  import as a runtime value (otherwise eslint's
 *  `consistent-type-imports` flags it). */
const _entityTypeValues = entityType.enumValues;
export type EntityType = (typeof _entityTypeValues)[number];

// Source values pinned to the Drizzle enum so widening (Phase 9 added
// 'document') only requires changing the schema. Output types use
// `EventSource`; input types pin to the legacy narrow union because doc
// activity goes through the documents scope, not generic createEvent().
const _eventSourceValues = eventSource.enumValues;
export type EventSource = (typeof _eventSourceValues)[number];
export type CreatableEventSource = Exclude<EventSource, 'document'>;
const _visibilityDefaultSourceValues = visibilityDefaultSource.enumValues;
export type VisibilityDefaultSource = (typeof _visibilityDefaultSourceValues)[number];
export type EventVisibility = 'private' | 'team' | 'specific_users';
export type EmailEventVisibility = Exclude<EventVisibility, 'specific_users'>;

const ROLE_RANK: Record<TeamRole, number> = { member: 0, admin: 1, owner: 2 };
const SPECIFIC_USERS_DEFAULT_SOURCES = new Set<VisibilityDefaultSource>([
  'document',
  'meeting',
  'integration',
  'calendar',
]);
const DEFAULT_SENDER_SEARCH_EVENT_ID_BATCH_SIZE = 1000;

async function enqueueRawEventEmbed(input: { teamId: string; rawEventId: string }): Promise<void> {
  const { enqueueEmbedJob } = await import(/* webpackIgnore: true */ '#src/queue/queues.js');
  await enqueueEmbedJob({ scope: 'raw_event', teamId: input.teamId, rawEventId: input.rawEventId });
}

export interface EventListFilters {
  authorUserId?: string;
  personObjectId?: string;
  senderHandle?: string;
  senderSource?: 'telegram' | 'slack' | 'email';
  /** Inclusive lower bound on `occurred_at`. */
  from?: Date;
  /** Exclusive upper bound on `occurred_at`. Callers wanting "include all of
   *  day X" should pass midnight UTC of day X+1. */
  to?: Date;
  /**
   * Narrow to one or more `event_source` values. Pushes the predicate into
   * SQL so `limit` bounds the matching rows (not the pre-filter window).
   * Mirrors the pg enum: 'web' | 'telegram' | 'slack' | 'email' |
   * 'system' | 'document' | 'meeting' | 'integration' | 'calendar'.
   */
  source?: string | string[];
  limit?: number;
  cursor?: string | null;
}

export type TimelineImpactKind =
  | 'task'
  | 'board'
  | 'object'
  | 'calendar'
  | 'document'
  | 'decision'
  | 'approval';

export interface TimelineImpactItem {
  kind: TimelineImpactKind;
  label: string;
  href?: string;
  count?: number;
  status?: string;
  sourceEventId?: string;
}

export interface CreateEventInput {
  authorUserId: string | null;
  source: EventSource;
  contentText?: string | null;
  contentAudioUrl?: string | null;
  occurredAt?: Date;
  visibility?: EventVisibility;
  visibilityUserIds?: string[] | null;
  visibilityOwnerUserId?: string | null;
  sourceMetadata?: Record<string, unknown>;
}

export interface CreateEmailEventInput {
  authorUserId: string | null;
  visibility?: EmailEventVisibility;
  visibilityUserIds?: string[] | null;
  visibilityOwnerUserId?: string | null;
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
  source?:
    | 'web'
    | 'telegram'
    | 'email'
    | 'system'
    | 'integration'
    | 'document'
    | 'meeting'
    | 'calendar'
    | 'slack'
    | 'ingest_webhook';
  entityIds?: string[];
  /**
   * Narrow vector search to a subset of Qdrant source kinds. Phase 8 adds
   * `object`, `object_note`, `object_change`, and `entity` alongside
   * `raw_event` and `fact`. When unset, defaults to `['raw_event', 'fact']`
   * — the event-anchored kinds this hydration pipeline can resolve. Callers
   * asking for non-event kinds get the Qdrant filter widened, but the
   * dedup-by-event_id step still drops hits without an event_id; richer
   * workspace-graph retrieval will need a separate `searchWorkspace`
   * helper (out of scope for this pass).
   */
  sourceKind?: SourceKind | SourceKind[];
  personObjectId?: string;
  senderHandle?: string;
  senderSource?: 'telegram' | 'slack' | 'email';
  limit?: number;
}

export interface PaginatedResult<T> {
  items: T[];
  nextCursor: string | null;
}

export interface SearchEventResult {
  eventId: string;
  factIds: string[];
  score: number;
  occurredAt: string;
  source: EventSource;
  authorUserId: string | null;
  sender: SenderContext | null;
  resolvedSenderObject: ResolvedSenderObject | null;
  senderResolutionStatus: SenderResolutionStatus;
  entityIds: string[];
  snippet: string;
  artifactCluster?: SearchEventArtifactCluster | null;
}

export interface SearchEventArtifactCluster {
  id: string;
  artifactType: EntityType;
  canonicalName: string;
  status: string;
  relatedEvidence: SearchEventArtifactClusterEvidence[];
}

export interface SearchEventArtifactClusterEvidence {
  rawEventId: string | null;
  source: EventSource | null;
  provider: string | null;
  externalObjectId: string | null;
  role: string;
  strength: string;
  authoritative: boolean;
  occurredAt: string | null;
  snippet: string | null;
}

export interface SearchObjectNoteEvidence {
  rawEventId: string;
  quote: string | null;
}

export interface SearchObjectNoteResult {
  noteId: string;
  objectId: string;
  objectName: string;
  objectType: EntityType;
  body: string;
  score: number;
  updatedAt: string;
  evidence: SearchObjectNoteEvidence[];
}

export interface SenderContext {
  source: EventSource;
  displayName: string | null;
  handle: string | null;
  externalId: string | null;
  provider: string | null;
}

export interface ResolvedSenderObject {
  id: string;
  canonicalName: string;
  aliases: string[];
  linkedUserId: string | null;
}

export type SenderResolutionStatus = 'resolved' | 'unresolved' | 'ambiguous';

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
  type: EntityType;
  count: number;
}

export interface EntityProfile {
  entity: {
    id: string;
    type:
      | 'person'
      | 'company'
      | 'project'
      | 'topic'
      | 'other'
      | 'deal'
      | 'vendor'
      | 'incident'
      | 'document'
      | 'decision'
      | 'hiring_loop'
      | 'task'
      | 'follow_up';
    canonicalName: string;
    aliases: string[];
    metadata: Record<string, unknown>;
  };
  facts: EntityFact[];
  /** Source events whose facts mention this entity, visibility-filtered. */
  events: {
    id: string;
    occurredAt: Date;
    source: EventSource;
    authorUserId: string | null;
    authorName: string | null;
    authorEmail: string | null;
    sender: SenderContext | null;
    resolvedSenderObject: ResolvedSenderObject | null;
    senderResolutionStatus: SenderResolutionStatus;
    contentText: string | null;
    contentAudioUrl: string | null;
  }[];
  coOccurring: CoOccurringEntity[];
}

export interface EventWithFacts {
  event: {
    id: string;
    occurredAt: Date;
    source: EventSource;
    authorUserId: string | null;
    sender: SenderContext | null;
    resolvedSenderObject: ResolvedSenderObject | null;
    senderResolutionStatus: SenderResolutionStatus;
    contentText: string | null;
    contentAudioUrl: string | null;
    visibility: EventVisibility;
    visibilityOwnerUserId: string | null;
  };
  facts: EntityFact[];
  entities: { id: string; canonicalName: string; type: string }[];
}

export interface VisibilityDefaultRow {
  source: VisibilityDefaultSource;
  visibility: EventVisibility;
  visibilityUserIds: string[] | null;
  sourceOwnerUserId: string | null;
  updatedByUserId: string | null;
  updatedAt: Date | null;
  inherited: boolean;
}

export interface SetVisibilityDefaultInput {
  source: VisibilityDefaultSource;
  visibility: EventVisibility;
  visibilityUserIds?: string[] | null;
  sourceOwnerUserId?: string | null;
}

export interface SetEventVisibilityInput {
  visibility: EventVisibility;
  visibilityUserIds?: string[] | null;
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
  /** Test seam for sender-scoped semantic search batching. */
  senderSearchEventIdBatchSize?: number;
  /** Inject raw-event embedding enqueue. Keeping this dependency lazy avoids
   *  pulling BullMQ worker internals into read-only web server bundles. */
  enqueueRawEventEmbed?: (input: { teamId: string; rawEventId: string }) => Promise<void>;
  /** Inject structured chat for suggestion adjudication in tests. Production
   *  falls back to the shared OpenRouter-backed llm wrapper. */
  chatStructured?: typeof chatStructured;
  /**
   * Skip the team-membership check on first query. Set only by trusted
   * callers that have already authenticated the team boundary via some
   * other mechanism (e.g. the Phase 11 outbound MCP server uses a bearer
   * key that resolves to a team_id; the bearer-key check IS the
   * membership proof). Visibility filtering still applies — pass an
   * actor userId that the filter should treat as "not the author of any
   * private event" (e.g. the zero UUID) so `private` and
   * `specific_users` events stay invisible.
   */
  skipMembershipCheck?: boolean;
}

export interface TeamScopeCore {
  teamId: string;
  userId: string;
  requireMembership: (minRole?: TeamRole) => Promise<TeamRole>;
  requireTeamMember: (otherUserId: string) => Promise<void>;
  isTeamMember: (otherUserId: string) => Promise<boolean>;
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
  const visibilityFilter = rawEventVisibleToUser(userId);
  const activeRawEventFilter = sql`COALESCE(${rawEvents.sourceMetadata} ->> 'deleted', 'false') <> 'true'`;

  let membershipPromise: Promise<TeamRole> | undefined;

  function ensureMember(minRole: TeamRole = 'member'): Promise<TeamRole> {
    if (deps.skipMembershipCheck) {
      // Trusted-caller path (Phase 11 outbound MCP): membership has
      // already been proven by the bearer-key resolution. Resolve as
      // 'member' so any `requireMembership('admin')` call still throws —
      // outbound MCP keys must never reach admin-only mutations.
      return Promise.resolve('member' as TeamRole);
    }
    membershipPromise ??= (async () => {
      const rows = await db
        .select({ role: teamMembers.role })
        .from(teamMembers)
        .where(
          and(
            eq(teamMembers.teamId, teamId),
            eq(teamMembers.userId, userId),
            isNull(teamMembers.removedAt),
          ),
        )
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
      .where(
        and(
          inArray(rawEvents.id, ids),
          eq(rawEvents.teamId, teamId),
          visibilityFilter,
          activeRawEventFilter,
        ),
      );
  }

  function displayNameForVisibleArtifactEvidence(row: {
    artifactType: EntityType;
    memberMetadata: unknown;
    objectName: string | null;
    contentText: string | null;
  }): string {
    const meta = metadataObject(row.memberMetadata);
    return (
      metadataString(meta, 'canonical_name') ??
      row.objectName ??
      row.contentText?.slice(0, 80) ??
      `Related ${row.artifactType}`
    );
  }

  function statusForVisibleArtifactEvidence(row: { memberMetadata: unknown }): string | null {
    const status = metadataString(metadataObject(row.memberMetadata), 'status');
    return status;
  }

  async function hydrateArtifactClustersForVisibleEventIds(
    accessibleEventIds: string[],
  ): Promise<Map<string, SearchEventArtifactCluster>> {
    if (accessibleEventIds.length === 0) return new Map();

    const eventClusterRows = await db
      .select({
        rawEventId: artifactClusterMembers.rawEventId,
        clusterId: artifactClusters.id,
      })
      .from(artifactClusterMembers)
      .innerJoin(artifactClusters, eq(artifactClusters.id, artifactClusterMembers.clusterId))
      .where(
        and(
          eq(artifactClusterMembers.teamId, teamId),
          inArray(artifactClusterMembers.rawEventId, accessibleEventIds),
          isNull(artifactClusters.archivedAt),
        ),
      );
    const clusterIds = [...new Set(eventClusterRows.map((row) => row.clusterId))];
    if (clusterIds.length === 0) return new Map();

    const clusterMemberRows = await db
      .select({
        clusterId: artifactClusters.id,
        artifactType: artifactClusters.artifactType,
        rawEventId: artifactClusterMembers.rawEventId,
        source: rawEvents.source,
        provider: artifactClusterMembers.provider,
        externalObjectId: artifactClusterMembers.externalObjectId,
        role: artifactClusterMembers.role,
        strength: artifactClusterMembers.strength,
        authoritative: artifactClusterMembers.authoritative,
        memberMetadata: artifactClusterMembers.metadata,
        occurredAt: rawEvents.occurredAt,
        contentText: rawEvents.contentText,
        objectName: entities.canonicalName,
      })
      .from(artifactClusterMembers)
      .innerJoin(artifactClusters, eq(artifactClusters.id, artifactClusterMembers.clusterId))
      .leftJoin(rawEvents, eq(rawEvents.id, artifactClusterMembers.rawEventId))
      .leftJoin(entities, eq(entities.id, artifactClusterMembers.entityId))
      .where(
        and(
          eq(artifactClusterMembers.teamId, teamId),
          inArray(artifactClusterMembers.clusterId, clusterIds),
          isNull(artifactClusters.archivedAt),
          visibilityFilter,
        ),
      )
      .orderBy(desc(artifactClusterMembers.authoritative), desc(rawEvents.occurredAt));

    const clusterById = new Map<string, SearchEventArtifactCluster>();
    for (const row of clusterMemberRows) {
      const existing = clusterById.get(row.clusterId);
      const cluster =
        existing ??
        ({
          id: row.clusterId,
          artifactType: row.artifactType,
          canonicalName: displayNameForVisibleArtifactEvidence(row),
          status: statusForVisibleArtifactEvidence(row) ?? 'open',
          relatedEvidence: [],
        } satisfies SearchEventArtifactCluster);
      if (!existing) clusterById.set(row.clusterId, cluster);
      if (cluster.relatedEvidence.length >= 5) continue;
      cluster.relatedEvidence.push({
        rawEventId: row.rawEventId,
        source: row.source,
        provider: row.provider,
        externalObjectId: row.externalObjectId,
        role: row.role,
        strength: row.strength,
        authoritative: row.authoritative,
        occurredAt: row.occurredAt?.toISOString() ?? null,
        snippet: row.contentText?.slice(0, 180) ?? null,
      });
    }

    const clusterByEventId = new Map<string, SearchEventArtifactCluster>();
    for (const row of eventClusterRows) {
      if (!row.rawEventId) continue;
      const cluster = clusterById.get(row.clusterId);
      if (cluster) clusterByEventId.set(row.rawEventId, cluster);
    }
    return clusterByEventId;
  }

  async function listTimelineArtifactClusters(
    rawEventIds: string[],
  ): Promise<Record<string, SearchEventArtifactCluster>> {
    const ids = [...new Set(rawEventIds.filter((id) => UUID_RE.test(id)))];
    if (ids.length === 0) return {};
    const accessibleEvents = await getEventsByIdsImpl(ids);
    const clusterByEventId = await hydrateArtifactClustersForVisibleEventIds(
      accessibleEvents.map((event) => event.id),
    );
    return Object.fromEntries(clusterByEventId);
  }

  /**
   * Verify the given userId is a member of THIS team. Used by helpers
   * that write a user reference into a team-scoped row (owner_user_id,
   * assignee_user_id, etc.) — the FK only proves the user exists in the
   * system, not in this team, so without this check an actor could
   * plant a foreign user into a team-scoped column and any later
   * notification fan-out on that row would leak the entity name to a
   * non-member. Cached per (teamId,otherUserId) for the lifetime of the
   * scope so repeated calls within one transaction are cheap.
   */
  const otherMemberCache = new Map<string, Promise<boolean>>();
  async function isTeamMember(otherUserId: string): Promise<boolean> {
    let p = otherMemberCache.get(otherUserId);
    if (!p) {
      p = (async () => {
        const rows = await db
          .select({ id: teamMembers.userId })
          .from(teamMembers)
          .where(
            and(
              eq(teamMembers.teamId, teamId),
              eq(teamMembers.userId, otherUserId),
              isNull(teamMembers.removedAt),
            ),
          )
          .limit(1);
        return rows.length > 0;
      })();
      otherMemberCache.set(otherUserId, p);
    }
    return p;
  }
  async function requireTeamMember(otherUserId: string): Promise<void> {
    if (!(await isTeamMember(otherUserId))) {
      throw new Error('Referenced user is not a member of this team');
    }
  }

  function metadataObject(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  function metadataString(meta: Record<string, unknown>, key: string): string | null {
    const value = meta[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number') return String(value);
    return null;
  }

  function emailFromMetadata(meta: Record<string, unknown>): string | null {
    const from = meta.from;
    if (from && typeof from === 'object' && !Array.isArray(from)) {
      const email = (from as Record<string, unknown>).email;
      if (typeof email === 'string' && email.trim()) return email.trim();
    }
    return metadataString(meta, 'from_email') ?? metadataString(meta, 'sender_email');
  }

  function emailMetadataSql() {
    return sql`lower(coalesce(${rawEvents.sourceMetadata} #>> '{from,email}', ${rawEvents.sourceMetadata} ->> 'from_email', ${rawEvents.sourceMetadata} ->> 'sender_email'))`;
  }

  function senderContextForEvent(event: {
    source: EventSource;
    sourceMetadata: unknown;
  }): SenderContext | null {
    const meta = metadataObject(event.sourceMetadata);
    if (event.source === 'telegram') {
      const username = metadataString(meta, 'tg_username');
      return {
        source: event.source,
        displayName: metadataString(meta, 'tg_sender_name'),
        handle: username ? `@${username.replace(/^@/, '')}` : null,
        externalId: metadataString(meta, 'tg_user_id'),
        provider: 'telegram',
      };
    }
    if (event.source === 'slack') {
      return {
        source: event.source,
        displayName: metadataString(meta, 'slack_sender_name'),
        handle: metadataString(meta, 'slack_sender_id'),
        externalId: metadataString(meta, 'slack_sender_id'),
        provider: metadataString(meta, 'slack_workspace_id'),
      };
    }
    if (event.source === 'email') {
      const email = emailFromMetadata(meta);
      return {
        source: event.source,
        displayName: metadataString(meta, 'from_name') ?? email,
        handle: email,
        externalId: email,
        provider: 'email',
      };
    }
    return null;
  }

  interface SenderCandidate {
    eventId: string;
    kind: 'telegram' | 'slack' | 'email' | 'timeline_user';
    normalizedValue?: string;
    externalId?: string | null;
    linkedUserId?: string | null;
  }

  function senderCandidatesForEvent(event: {
    id: string;
    source: EventSource;
    authorUserId: string | null;
    sourceMetadata: unknown;
  }): SenderCandidate[] {
    const meta = metadataObject(event.sourceMetadata);
    const candidates: SenderCandidate[] = [];
    if (event.authorUserId) {
      candidates.push({
        eventId: event.id,
        kind: 'timeline_user',
        normalizedValue: event.authorUserId.toLowerCase(),
        linkedUserId: event.authorUserId,
      });
    }
    if (event.source === 'telegram') {
      const username = metadataString(meta, 'tg_username');
      const tgUserId = metadataString(meta, 'tg_user_id');
      if (username) {
        candidates.push({
          eventId: event.id,
          kind: 'telegram',
          normalizedValue: normalizeIdentityFacet('telegram', username),
        });
      }
      if (tgUserId) candidates.push({ eventId: event.id, kind: 'telegram', externalId: tgUserId });
    } else if (event.source === 'slack') {
      const senderId = metadataString(meta, 'slack_sender_id');
      if (senderId) {
        candidates.push({
          eventId: event.id,
          kind: 'slack',
          normalizedValue: senderId,
          externalId: senderId,
        });
      }
    } else if (event.source === 'email') {
      const email = emailFromMetadata(meta);
      if (email) {
        candidates.push({
          eventId: event.id,
          kind: 'email',
          normalizedValue: normalizeIdentityFacet('email', email),
        });
      }
    }
    return candidates;
  }

  async function resolveSenderContexts(
    events: {
      id: string;
      source: EventSource;
      authorUserId: string | null;
      sourceMetadata: unknown;
    }[],
  ) {
    const result = new Map<
      string,
      {
        sender: SenderContext | null;
        resolvedSenderObject: ResolvedSenderObject | null;
        senderResolutionStatus: SenderResolutionStatus;
      }
    >();
    for (const event of events) {
      result.set(event.id, {
        sender: senderContextForEvent(event),
        resolvedSenderObject: null,
        senderResolutionStatus: 'unresolved',
      });
    }
    const candidatesByEventId = new Map(
      events.map((event) => [event.id, senderCandidatesForEvent(event)] as const),
    );
    const candidates = Array.from(candidatesByEventId.values()).flat();
    if (candidates.length === 0) return result;

    const facetConditions = candidates
      .map((candidate) => {
        if (candidate.kind === 'timeline_user' && candidate.linkedUserId) {
          return and(
            eq(objectIdentityFacets.kind, 'timeline_user'),
            eq(objectIdentityFacets.linkedUserId, candidate.linkedUserId),
          );
        }
        const alternatives = [];
        if (candidate.normalizedValue) {
          alternatives.push(eq(objectIdentityFacets.normalizedValue, candidate.normalizedValue));
        }
        if (candidate.externalId)
          alternatives.push(eq(objectIdentityFacets.externalId, candidate.externalId));
        if (alternatives.length === 0) return undefined;
        return and(eq(objectIdentityFacets.kind, candidate.kind), or(...alternatives));
      })
      .filter((condition): condition is NonNullable<typeof condition> => Boolean(condition));
    if (facetConditions.length === 0) return result;

    const rows = await db
      .select({
        kind: objectIdentityFacets.kind,
        normalizedValue: objectIdentityFacets.normalizedValue,
        externalId: objectIdentityFacets.externalId,
        linkedUserId: objectIdentityFacets.linkedUserId,
        entityId: entities.id,
        canonicalName: entities.canonicalName,
        aliases: entities.aliases,
      })
      .from(objectIdentityFacets)
      .innerJoin(entities, eq(entities.id, objectIdentityFacets.entityId))
      .where(
        and(
          eq(objectIdentityFacets.teamId, teamId),
          eq(objectIdentityFacets.status, 'approved'),
          eq(entities.teamId, teamId),
          isNull(entities.mergedIntoId),
          or(...facetConditions),
        ),
      );

    for (const event of events) {
      const eventCandidates = candidatesByEventId.get(event.id) ?? [];
      const matches = rows.filter((row) =>
        eventCandidates.some((candidate) => {
          if (candidate.kind !== row.kind) return false;
          if (candidate.kind === 'timeline_user')
            return candidate.linkedUserId === row.linkedUserId;
          const normalizedMatches =
            candidate.normalizedValue !== undefined &&
            candidate.normalizedValue === row.normalizedValue;
          const externalMatches =
            candidate.externalId !== undefined &&
            candidate.externalId !== null &&
            candidate.externalId === row.externalId;
          return normalizedMatches || externalMatches;
        }),
      );
      const byEntity = new Map<string, (typeof matches)[number]>();
      for (const match of matches) byEntity.set(match.entityId, match);
      const current = result.get(event.id);
      if (!current) continue;
      if (byEntity.size === 1) {
        const match = byEntity.values().next().value;
        if (!match) continue;
        const aliases = Array.isArray(match.aliases)
          ? (match.aliases as unknown[]).filter((v): v is string => typeof v === 'string')
          : [];
        result.set(event.id, {
          ...current,
          resolvedSenderObject: {
            id: match.entityId,
            canonicalName: match.canonicalName,
            aliases,
            linkedUserId: match.linkedUserId,
          },
          senderResolutionStatus: 'resolved',
        });
      } else if (byEntity.size > 1) {
        result.set(event.id, { ...current, senderResolutionStatus: 'ambiguous' });
      }
    }
    return result;
  }

  async function senderFilterCondition(filters: {
    personObjectId?: string;
    senderHandle?: string;
    senderSource?: 'telegram' | 'slack' | 'email';
  }) {
    const filterGroups = [];
    if (filters.senderHandle) {
      const handle = filters.senderHandle.trim();
      const source = filters.senderSource;
      const handleConditions = [];
      if (!source || source === 'telegram') {
        handleConditions.push(
          and(
            eq(rawEvents.source, 'telegram'),
            sql`lower(regexp_replace(${rawEvents.sourceMetadata} ->> 'tg_username', '^@', '')) = ${normalizeIdentityFacet('telegram', handle)}`,
          ),
        );
      }
      if (!source || source === 'slack') {
        handleConditions.push(
          and(
            eq(rawEvents.source, 'slack'),
            sql`${rawEvents.sourceMetadata} ->> 'slack_sender_id' = ${handle}`,
          ),
        );
      }
      if (!source || source === 'email') {
        handleConditions.push(
          and(
            eq(rawEvents.source, 'email'),
            sql`${emailMetadataSql()} = ${normalizeIdentityFacet('email', handle)}`,
          ),
        );
      }
      filterGroups.push(handleConditions.length > 0 ? or(...handleConditions) : sql`false`);
    }
    if (filters.personObjectId) {
      if (!UUID_RE.test(filters.personObjectId)) return sql`false`;
      const personConditions = [];
      const facets = await db
        .select()
        .from(objectIdentityFacets)
        .where(
          and(
            eq(objectIdentityFacets.teamId, teamId),
            eq(objectIdentityFacets.entityId, filters.personObjectId),
            eq(objectIdentityFacets.status, 'approved'),
          ),
        );
      for (const facet of facets) {
        if (facet.kind === 'timeline_user' && facet.linkedUserId) {
          personConditions.push(eq(rawEvents.authorUserId, facet.linkedUserId));
        } else if (facet.kind === 'telegram') {
          personConditions.push(
            and(
              eq(rawEvents.source, 'telegram'),
              or(
                sql`lower(regexp_replace(${rawEvents.sourceMetadata} ->> 'tg_username', '^@', '')) = ${facet.normalizedValue}`,
                facet.externalId
                  ? sql`${rawEvents.sourceMetadata} ->> 'tg_user_id' = ${facet.externalId}`
                  : sql`false`,
              ),
            ),
          );
        } else if (facet.kind === 'slack') {
          personConditions.push(
            and(
              eq(rawEvents.source, 'slack'),
              sql`${rawEvents.sourceMetadata} ->> 'slack_sender_id' = ${facet.externalId ?? facet.normalizedValue}`,
            ),
          );
        } else if (facet.kind === 'email') {
          personConditions.push(
            and(
              eq(rawEvents.source, 'email'),
              sql`${emailMetadataSql()} = ${facet.normalizedValue}`,
            ),
          );
        }
      }
      filterGroups.push(personConditions.length > 0 ? or(...personConditions) : sql`false`);
    }
    if (filters.senderSource) {
      filterGroups.push(eq(rawEvents.source, filters.senderSource));
    }
    return filterGroups.length > 0 ? and(...filterGroups) : null;
  }

  async function searchSenderFilteredHits(input: {
    searchInput: SearchEventsInput;
    vector: number[];
    searchOpts: SearchOpts;
    searchFn: (
      teamId: string,
      userId: string,
      vector: number[],
      opts: SearchOpts,
    ) => Promise<SearchHit[]>;
  }): Promise<{ hits: SearchHit[]; usedSqlSenderFilter: boolean }> {
    const { searchInput, vector, searchOpts, searchFn } = input;
    if (!searchInput.personObjectId && !searchInput.senderHandle) {
      return {
        hits: await searchFn(teamId, userId, vector, searchOpts),
        usedSqlSenderFilter: false,
      };
    }

    const senderCondition = await senderFilterCondition(searchInput);
    if (!senderCondition) return { hits: [], usedSqlSenderFilter: true };
    const batchSize =
      deps.senderSearchEventIdBatchSize ?? DEFAULT_SENDER_SEARCH_EVENT_ID_BATCH_SIZE;
    const batchSearchLimit = Math.max(searchOpts.limit ?? 20, batchSize);
    const conditions = [
      eq(rawEvents.teamId, teamId),
      visibilityFilter,
      activeRawEventFilter,
      senderCondition,
    ];
    if (searchInput.from) conditions.push(gte(rawEvents.occurredAt, searchInput.from));
    if (searchInput.to) conditions.push(lt(rawEvents.occurredAt, searchInput.to));
    if (searchInput.source) {
      conditions.push(eq(rawEvents.source, searchInput.source));
    }

    const hits: SearchHit[] = [];
    let cursor: { occurredAt: Date; id: string } | null = null;
    for (;;) {
      const pageConditions = [...conditions];
      if (cursor) {
        pageConditions.push(
          or(
            lt(rawEvents.occurredAt, cursor.occurredAt),
            and(eq(rawEvents.occurredAt, cursor.occurredAt), lt(rawEvents.id, cursor.id)),
          ),
        );
      }
      const rows = await db
        .select({ id: rawEvents.id, occurredAt: rawEvents.occurredAt })
        .from(rawEvents)
        .where(and(...pageConditions))
        .orderBy(desc(rawEvents.occurredAt), desc(rawEvents.id))
        .limit(batchSize);
      if (rows.length === 0) break;

      hits.push(
        ...(await searchFn(teamId, userId, vector, {
          ...searchOpts,
          limit: batchSearchLimit,
          eventIds: rows.map((row) => row.id),
        })),
      );

      if (rows.length < batchSize) break;
      const last = rows[rows.length - 1];
      if (!last) break;
      cursor = { occurredAt: last.occurredAt, id: last.id };
    }
    return { hits, usedSqlSenderFilter: true };
  }

  function sameVisibilityUsers(
    a: string[] | null | undefined,
    b: string[] | null | undefined,
  ): boolean {
    const left = [...new Set(a ?? [])].sort();
    const right = [...new Set(b ?? [])].sort();
    if (left.length !== right.length) return false;
    return left.every((id, index) => id === right[index]);
  }

  async function validateVisibilityPatch(
    input: { visibility: EventVisibility; visibilityUserIds?: string[] | null },
    opts: { defaultSource?: VisibilityDefaultSource; allowSpecificUsers?: boolean } = {},
  ): Promise<string[] | null> {
    if (
      input.visibility === 'specific_users' &&
      !opts.allowSpecificUsers &&
      (!opts.defaultSource || !SPECIFIC_USERS_DEFAULT_SOURCES.has(opts.defaultSource))
    ) {
      throw new Error('specific_users visibility is not supported for this source');
    }
    const normalized = normalizeVisibilityUserIds(input.visibility, input.visibilityUserIds);
    if (normalized) {
      for (const uid of normalized) await requireTeamMember(uid);
    }
    return normalized;
  }

  async function resolveVisibilityDefault(
    source: VisibilityDefaultSource,
  ): Promise<VisibilityDefaultRow> {
    await ensureMember();
    const rows = await db
      .select()
      .from(teamVisibilityDefaults)
      .where(
        and(
          eq(teamVisibilityDefaults.teamId, teamId),
          inArray(teamVisibilityDefaults.source, source === 'team' ? ['team'] : [source, 'team']),
        ),
      );
    const bySource = new Map(rows.map((r) => [r.source, r] as const));
    return materializeVisibilityDefault(source, bySource);
  }

  function materializeVisibilityDefault(
    source: VisibilityDefaultSource,
    bySource: Map<VisibilityDefaultSource, typeof teamVisibilityDefaults.$inferSelect>,
  ): VisibilityDefaultRow {
    const row = bySource.get(source) ?? (source === 'team' ? undefined : bySource.get('team'));
    if (!row) {
      return {
        source,
        visibility: 'team',
        visibilityUserIds: null,
        sourceOwnerUserId: null,
        updatedByUserId: null,
        updatedAt: null,
        inherited: source !== 'team',
      };
    }
    const inherited = row.source !== source;
    const supportsSpecificUsers =
      !inherited && SPECIFIC_USERS_DEFAULT_SOURCES.has(source) && row.source !== 'team';
    const visibility =
      row.visibility === 'specific_users' && !supportsSpecificUsers ? 'team' : row.visibility;
    return {
      source,
      visibility,
      visibilityUserIds: visibility === 'specific_users' ? row.visibilityUserIds : null,
      sourceOwnerUserId: row.sourceOwnerUserId,
      updatedByUserId: row.updatedByUserId,
      updatedAt: row.updatedAt,
      inherited,
    };
  }

  async function deleteRawEventEmbeddingPoints(rawEventId: string): Promise<void> {
    try {
      const factRows = await db
        .select({ id: factsTable.id })
        .from(factsTable)
        .where(and(eq(factsTable.teamId, teamId), eq(factsTable.rawEventId, rawEventId)));
      const activeModel = TIMELINE_MODELS.embedding.id;
      const models = [...new Set([activeModel, 'openai/text-embedding-3-small'])];
      const client = getQdrantClient();
      for (const model of models) {
        await client.deletePointsForSource({ teamId, scope: 'event', sourceId: rawEventId, model });
        for (const fact of factRows) {
          await client.deletePointsForSource({
            teamId,
            scope: 'fact',
            sourceId: fact.id,
            model,
          });
        }
      }
      const legacyPointIds = models.flatMap((model) => [
        buildPointId('event', rawEventId, model),
        ...factRows.map((f) => buildPointId('fact', f.id, model)),
      ]);
      await client.deletePoints(legacyPointIds);
    } catch {
      // Visibility updates are authoritative in Postgres. Qdrant cleanup is
      // best-effort; the DB visibility filter still gates hydrated results.
    }
  }

  // Phase 9 — document drive methods, spread in below. Document methods
  // share `ensureMember` / `requireTeamMember` so they participate in the
  // same membership-cache and team-isolation chokepoints.
  const documentScope = createDocumentScope({
    db,
    teamId,
    userId,
    ensureMember,
    requireTeamMember,
    ...(deps.embed ? { embed: deps.embed } : {}),
    ...(deps.qdrantSearch ? { qdrantSearch: deps.qdrantSearch } : {}),
  });

  const meetingScope = createMeetingScope({
    db,
    teamId,
    userId,
    ensureMember,
    requireTeamMember,
  });

  const integrationScope = createIntegrationScope({
    db,
    teamId,
    userId,
    ensureMember,
    requireTeamMember,
  });

  const mcpScope = createMcpScope({
    db,
    teamId,
    userId,
    ensureMember,
  });

  const calendarScope = createCalendarScope({
    db,
    teamId,
    userId,
    ensureMember,
    requireTeamMember,
  });

  const auditScope = createAuditScope({
    db,
    teamId,
    userId,
    ensureMember,
  });

  const onboardingScope = createOnboardingScope({
    db,
    teamId,
    userId,
    ensureMember,
  });

  const jobRecoveryScope = createJobRecoveryScope({
    db,
    teamId,
    userId,
    ensureMember,
  });

  const core: TeamScopeCore = {
    teamId,
    userId,
    requireMembership: ensureMember,
    requireTeamMember,
    isTeamMember,
  };

  async function listEvents(
    filters: EventListFilters = {},
  ): Promise<(typeof rawEvents.$inferSelect)[]> {
    await ensureMember();
    const conditions = [eq(rawEvents.teamId, teamId), visibilityFilter, activeRawEventFilter];
    if (filters.authorUserId) {
      conditions.push(eq(rawEvents.authorUserId, filters.authorUserId));
    }
    const senderCondition = await senderFilterCondition(filters);
    if (senderCondition) conditions.push(senderCondition);
    if (filters.from) conditions.push(gte(rawEvents.occurredAt, filters.from));
    if (filters.to) conditions.push(lt(rawEvents.occurredAt, filters.to));
    if (Array.isArray(filters.source) && filters.source.length > 0) {
      conditions.push(
        inArray(rawEvents.source, filters.source as (typeof rawEvents.source.enumValues)[number][]),
      );
    } else if (filters.source) {
      conditions.push(
        eq(rawEvents.source, filters.source as (typeof rawEvents.source.enumValues)[number]),
      );
    }
    const cursor = decodeCursor(filters.cursor);
    if (filters.cursor && !cursor) throw new Error('Invalid cursor');
    if (cursor) {
      const cursorDate = new Date(cursor.at);
      conditions.push(
        or(
          lt(rawEvents.occurredAt, cursorDate),
          and(eq(rawEvents.occurredAt, cursorDate), lt(rawEvents.id, cursor.id)),
        ),
      );
    }
    return db
      .select()
      .from(rawEvents)
      .where(and(...conditions))
      .orderBy(desc(rawEvents.occurredAt), desc(rawEvents.id))
      .limit(filters.limit ?? 200);
  }

  function pushTimelineImpact(
    map: Map<string, TimelineImpactItem[]>,
    rawEventId: string | null | undefined,
    item: Omit<TimelineImpactItem, 'sourceEventId'>,
  ) {
    if (!rawEventId) return;
    const existing = map.get(rawEventId) ?? [];
    const next: TimelineImpactItem = { ...item, sourceEventId: rawEventId };
    const key = `${next.kind}:${next.label}:${next.href ?? ''}:${next.status ?? ''}`;
    if (
      !existing.some(
        (candidate) =>
          `${candidate.kind}:${candidate.label}:${candidate.href ?? ''}:${candidate.status ?? ''}` ===
          key,
      )
    ) {
      existing.push(next);
    }
    map.set(rawEventId, existing);
  }

  function objectMergeSuggestionHref(itemId: string, proposedPayload: unknown): string | null {
    if (!UUID_RE.test(itemId)) return null;
    const payload =
      proposedPayload && typeof proposedPayload === 'object'
        ? (proposedPayload as { objectIds?: unknown; survivorId?: unknown })
        : null;
    const ids = Array.isArray(payload?.objectIds)
      ? payload.objectIds.filter((value): value is string => typeof value === 'string')
      : [];
    const objectIds = ids.filter((id) => UUID_RE.test(id));
    if (objectIds.length < 2) return null;
    const survivorId = typeof payload?.survivorId === 'string' ? payload.survivorId : null;
    const orderedIds =
      survivorId && UUID_RE.test(survivorId) && objectIds.includes(survivorId)
        ? [survivorId, ...objectIds.filter((id) => id !== survivorId)]
        : objectIds;
    return `/app/objects/merge?ids=${orderedIds.join(',')}&suggestionItemId=${itemId}`;
  }

  async function listTimelineImpactItems(
    rawEventIds: string[],
  ): Promise<Record<string, TimelineImpactItem[]>> {
    const ids = [...new Set(rawEventIds.filter((id) => UUID_RE.test(id)))];
    if (ids.length === 0) return {};
    await ensureMember();

    const impact = new Map<string, TimelineImpactItem[]>();
    const suggestionVisibility = and(
      eq(agentSuggestions.teamId, teamId),
      or(
        eq(agentSuggestions.visibility, 'team'),
        and(
          eq(agentSuggestions.visibility, 'private'),
          eq(agentSuggestions.visibilityOwnerUserId, userId),
        ),
        and(
          eq(agentSuggestions.visibility, 'specific_users'),
          sql`${userId}::uuid = ANY(${agentSuggestions.visibilityUserIds})`,
        ),
      ),
    );
    const documentVisibility = or(
      eq(documents.visibility, 'team'),
      and(eq(documents.visibility, 'private'), eq(documents.ownerUserId, userId)),
      and(
        eq(documents.visibility, 'specific_users'),
        sql`${userId}::uuid = ANY(${documents.visibilityUserIds})`,
      ),
    );
    const calendarVisibility = or(
      eq(calendarEvents.visibility, 'team'),
      and(eq(calendarEvents.visibility, 'private'), eq(calendarEvents.createdByUserId, userId)),
      and(
        eq(calendarEvents.visibility, 'specific_users'),
        sql`${userId}::uuid = ANY(${calendarEvents.visibilityUserIds})`,
      ),
    );

    const [suggestionRows, objectChangeRows, entityRows, documentRows, calendarRows] =
      await Promise.all([
        db
          .select({
            rawEventId: agentSuggestionEvidence.rawEventId,
            suggestionId: agentSuggestions.id,
            itemId: agentSuggestionItems.id,
            suggestionStatus: agentSuggestions.status,
            itemStatus: agentSuggestionItems.status,
            targetKind: agentSuggestionItems.targetKind,
            targetId: agentSuggestionItems.targetId,
            resultId: agentSuggestionItems.resultId,
            title: agentSuggestionItems.title,
            proposedPayload: agentSuggestionItems.proposedPayload,
            boardItemBoardId: boardItems.boardId,
          })
          .from(agentSuggestionEvidence)
          .innerJoin(
            agentSuggestions,
            eq(agentSuggestionEvidence.suggestionId, agentSuggestions.id),
          )
          .innerJoin(
            agentSuggestionItems,
            eq(agentSuggestionItems.suggestionId, agentSuggestions.id),
          )
          .leftJoin(
            boardItems,
            and(
              eq(boardItems.teamId, teamId),
              or(
                eq(boardItems.id, agentSuggestionItems.targetId),
                eq(boardItems.id, agentSuggestionItems.resultId),
              ),
            ),
          )
          .where(
            and(
              eq(agentSuggestionEvidence.teamId, teamId),
              inArray(agentSuggestionEvidence.rawEventId, ids),
              suggestionVisibility,
            ),
          ),
        db
          .select({
            rawEventId: objectChanges.sourceEventId,
            entityId: objectChanges.entityId,
            entityName: entities.canonicalName,
            entityType: entities.type,
            field: objectChanges.field,
            status: objectChanges.status,
            note: objectChanges.note,
          })
          .from(objectChanges)
          .innerJoin(entities, eq(objectChanges.entityId, entities.id))
          .where(and(eq(objectChanges.teamId, teamId), inArray(objectChanges.sourceEventId, ids))),
        db
          .select({
            rawEventId: entities.sourceEventId,
            entityId: entities.id,
            entityName: entities.canonicalName,
            entityType: entities.type,
            status: entities.status,
          })
          .from(entities)
          .where(
            and(
              eq(entities.teamId, teamId),
              inArray(entities.sourceEventId, ids),
              isNull(entities.archivedAt),
              isNull(entities.mergedIntoId),
            ),
          ),
        db
          .select({
            rawEventId: documentVersions.sourceEventId,
            documentId: documents.id,
            documentName: documents.name,
            documentMetadata: documents.metadata,
            fileKind: documents.fileKind,
            contentType: documentVersions.contentType,
            status: documentVersions.processingStatus,
          })
          .from(documentVersions)
          .innerJoin(documents, eq(documentVersions.documentId, documents.id))
          .where(
            and(
              eq(documentVersions.teamId, teamId),
              inArray(documentVersions.sourceEventId, ids),
              isNull(documents.deletedAt),
              documentVisibility,
            ),
          ),
        db
          .select({
            id: calendarEvents.id,
            title: calendarEvents.title,
            startAt: calendarEvents.startAt,
            scheduledRawEventId: calendarEvents.scheduledRawEventId,
            startAtRawEventId: calendarEvents.startAtRawEventId,
          })
          .from(calendarEvents)
          .where(
            and(
              eq(calendarEvents.teamId, teamId),
              isNull(calendarEvents.deletedAt),
              or(
                inArray(calendarEvents.scheduledRawEventId, ids),
                inArray(calendarEvents.startAtRawEventId, ids),
              ),
              calendarVisibility,
            ),
          ),
      ]);

    for (const row of suggestionRows) {
      const kind: TimelineImpactKind =
        row.targetKind === 'calendar_event'
          ? 'calendar'
          : row.targetKind === 'board_membership' || row.targetKind === 'board_item_update'
            ? 'board'
            : row.targetKind === 'identity_facet' ||
                row.targetKind === 'object_note' ||
                row.targetKind === 'object_relationship' ||
                row.targetKind === 'object_merge'
              ? 'object'
              : row.targetKind;
      const objectMemoryTarget =
        row.targetKind === 'identity_facet' ||
        row.targetKind === 'object_note' ||
        row.targetKind === 'object_relationship';
      const targetId = objectMemoryTarget
        ? (row.targetId ?? row.resultId)
        : (row.resultId ?? row.targetId);
      let href =
        kind === 'calendar'
          ? '/app/calendar'
          : targetId
            ? `/app/objects/${targetId}`
            : '/app/approvals';
      if (kind === 'board') {
        const payload =
          row.proposedPayload && typeof row.proposedPayload === 'object'
            ? (row.proposedPayload as Record<string, unknown>)
            : {};
        const boardId =
          row.boardItemBoardId ??
          (typeof payload.boardId === 'string' && payload.boardId.length > 0
            ? payload.boardId
            : null);
        const itemId = row.resultId ?? row.targetId;
        href = boardId
          ? `/app/boards/${boardId}${itemId ? `?item=${itemId}` : ''}`
          : '/app/approvals';
      }
      if (
        row.targetKind === 'object_merge' &&
        (row.itemStatus === 'pending' || row.itemStatus === 'failed')
      ) {
        href = objectMergeSuggestionHref(row.itemId, row.proposedPayload) ?? '/app/approvals';
      }
      pushTimelineImpact(impact, row.rawEventId, {
        kind,
        label: row.title,
        href,
        status: row.itemStatus === 'pending' ? 'pending' : row.suggestionStatus,
      });
      if (row.itemStatus === 'pending') {
        pushTimelineImpact(impact, row.rawEventId, {
          kind: 'approval',
          label: row.title,
          href: '/app/approvals',
          status: 'pending',
        });
      }
    }

    for (const row of objectChangeRows) {
      const kind = row.entityType === 'task' || row.entityType === 'follow_up' ? 'task' : 'object';
      pushTimelineImpact(impact, row.rawEventId, {
        kind,
        label: row.note ?? `${row.entityName} · ${row.field}`,
        href: `/app/objects/${row.entityId}`,
        status: row.status,
      });
    }

    for (const row of entityRows) {
      const kind = row.entityType === 'task' || row.entityType === 'follow_up' ? 'task' : 'object';
      pushTimelineImpact(impact, row.rawEventId, {
        kind,
        label: row.entityName,
        href: `/app/objects/${row.entityId}`,
        status: row.status,
      });
    }

    for (const row of documentRows) {
      pushTimelineImpact(impact, row.rawEventId, {
        kind: 'document',
        label: documentPresentation({
          name: row.documentName,
          contentType: row.contentType,
          metadata:
            typeof row.documentMetadata === 'object' && row.documentMetadata !== null
              ? (row.documentMetadata as Record<string, unknown>)
              : {},
          fileKind: row.fileKind,
        }).displayTitle,
        href: `/app/documents/${row.documentId}`,
        status: row.status,
      });
    }

    for (const row of calendarRows) {
      const date = row.startAt.toISOString().slice(0, 10);
      const href = `/app/calendar?date=${date}&view=day`;
      pushTimelineImpact(impact, row.scheduledRawEventId, {
        kind: 'calendar',
        label: row.title,
        href,
        status: 'scheduled',
      });
      pushTimelineImpact(impact, row.startAtRawEventId, {
        kind: 'calendar',
        label: row.title,
        href,
        status: 'event',
      });
    }

    return Object.fromEntries(impact);
  }

  const objectScope = createObjectScope(db, core);
  const boardScope = createBoardScope({ db, scope: core, objects: objectScope });
  const suggestionScope = createSuggestionScope({
    db,
    teamId,
    userId,
    ensureMember,
    requireTeamMember,
    objects: objectScope,
    boards: boardScope,
    calendar: calendarScope,
    ...(deps.chatStructured ? { chatStructured: deps.chatStructured } : {}),
  });

  return {
    ...core,
    timeline: {
      async team() {
        await ensureMember();
        const rows = await db.select().from(teams).where(eq(teams.id, teamId)).limit(1);
        return rows[0] ?? null;
      },

      resolveVisibilityDefault,

      async getVisibilityDefaults(): Promise<VisibilityDefaultRow[]> {
        await ensureMember('admin');
        const sources = visibilityDefaultSource.enumValues;
        const rows = await db
          .select()
          .from(teamVisibilityDefaults)
          .where(eq(teamVisibilityDefaults.teamId, teamId));
        const bySource = new Map(rows.map((row) => [row.source, row] as const));
        return sources.map((source) => materializeVisibilityDefault(source, bySource));
      },

      async setVisibilityDefault(input: SetVisibilityDefaultInput): Promise<VisibilityDefaultRow> {
        await ensureMember('admin');
        const visibilityUserIds = await validateVisibilityPatch(
          { visibility: input.visibility, visibilityUserIds: input.visibilityUserIds ?? null },
          { defaultSource: input.source },
        );
        if (input.sourceOwnerUserId) await requireTeamMember(input.sourceOwnerUserId);

        await db
          .insert(teamVisibilityDefaults)
          .values({
            teamId,
            source: input.source,
            visibility: input.visibility,
            visibilityUserIds,
            sourceOwnerUserId: input.sourceOwnerUserId ?? null,
            updatedByUserId: userId,
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [teamVisibilityDefaults.teamId, teamVisibilityDefaults.source],
            set: {
              visibility: input.visibility,
              visibilityUserIds,
              sourceOwnerUserId: input.sourceOwnerUserId ?? null,
              updatedByUserId: userId,
              updatedAt: new Date(),
            },
          });
        return resolveVisibilityDefault(input.source);
      },

      async setEventVisibility(
        id: string,
        input: SetEventVisibilityInput,
      ): Promise<typeof rawEvents.$inferSelect | null> {
        await ensureMember();
        const visibilityUserIds = await validateVisibilityPatch(
          { visibility: input.visibility, visibilityUserIds: input.visibilityUserIds ?? null },
          { allowSpecificUsers: true },
        );
        const existingRows = await db
          .select()
          .from(rawEvents)
          .where(
            and(
              eq(rawEvents.id, id),
              eq(rawEvents.teamId, teamId),
              or(visibilityFilter, eq(rawEvents.visibilityOwnerUserId, userId)),
              activeRawEventFilter,
            ),
          )
          .limit(1);
        const existing = existingRows[0];
        if (!existing) return null;
        if (existing.visibilityOwnerUserId === null) {
          throw new Error('This event has no visibility owner');
        }
        if (existing.visibilityOwnerUserId !== userId) {
          throw new Error('Only the visibility owner can change this event');
        }
        const sameVisibility = existing.visibility === input.visibility;
        if (sameVisibility && sameVisibilityUsers(existing.visibilityUserIds, visibilityUserIds)) {
          return existing;
        }

        const updated = await db.transaction(async (tx) => {
          const updatedRows = await tx
            .update(rawEvents)
            .set({
              visibility: input.visibility,
              visibilityUserIds,
              sourceMetadata: sql`COALESCE(${rawEvents.sourceMetadata}, '{}'::jsonb) || ${JSON.stringify(
                {
                  visibility_changed_at: new Date().toISOString(),
                },
              )}::jsonb`,
            })
            .where(and(eq(rawEvents.id, id), eq(rawEvents.teamId, teamId)))
            .returning();
          const row = updatedRows[0];
          if (!row) return null;

          await tx.insert(auditLog).values({
            teamId,
            actorUserId: userId,
            action: 'visibility_change',
            targetType: 'raw_event',
            targetId: id,
            targetVisibility: row.visibility,
            targetOwnerUserId: row.visibilityOwnerUserId,
            targetVisibilityUserIds: row.visibilityUserIds,
            metadata: {
              previous: {
                visibility: existing.visibility,
                visibilityUserIds: existing.visibilityUserIds,
              },
              next: {
                visibility: row.visibility,
                visibilityUserIds: row.visibilityUserIds,
              },
              source: row.source,
            },
          });
          return row;
        });
        if (!updated) return null;

        if (existing.visibility === 'team' && updated.visibility !== 'team') {
          await deleteRawEventEmbeddingPoints(id);
          await invalidateObjectSummariesForRawEvent(db, core, id, {
            trigger: 'raw_event_visibility_hidden',
          });
        } else if (existing.visibility !== 'team' && updated.visibility === 'team') {
          await (deps.enqueueRawEventEmbed ?? enqueueRawEventEmbed)({
            teamId,
            rawEventId: id,
          }).catch(() => {
            // The row is already visible in Postgres; janitor/retry paths can
            // reconcile the embedding if Redis is temporarily unavailable.
          });
          await invalidateObjectSummariesForRawEvent(
            db,
            core,
            id,
            {
              trigger: 'raw_event_visibility_team',
            },
            {
              preserveExisting: true,
            },
          );
        }
        return updated;
      },

      listEvents,

      async resolveEventSenders(
        events: {
          id: string;
          source: EventSource;
          authorUserId: string | null;
          sourceMetadata: unknown;
        }[],
      ) {
        return resolveSenderContexts(events);
      },

      async currentUserIdentityContext() {
        const role = await ensureMember();
        const userRows = await db
          .select({ id: users.id, name: users.name, email: users.email })
          .from(users)
          .where(eq(users.id, userId))
          .limit(1);
        const linkedFacetRows = await db
          .select({
            id: objectIdentityFacets.id,
            kind: objectIdentityFacets.kind,
            value: objectIdentityFacets.value,
            normalizedValue: objectIdentityFacets.normalizedValue,
            provider: objectIdentityFacets.provider,
            externalId: objectIdentityFacets.externalId,
            entityId: entities.id,
            canonicalName: entities.canonicalName,
            aliases: entities.aliases,
          })
          .from(objectIdentityFacets)
          .innerJoin(entities, eq(entities.id, objectIdentityFacets.entityId))
          .where(
            and(
              eq(objectIdentityFacets.teamId, teamId),
              eq(objectIdentityFacets.linkedUserId, userId),
              eq(objectIdentityFacets.kind, 'timeline_user'),
              eq(objectIdentityFacets.status, 'approved'),
              eq(entities.teamId, teamId),
              isNull(entities.mergedIntoId),
            ),
          )
          .orderBy(objectIdentityFacets.kind, objectIdentityFacets.value);
        const linkedEntityIds = Array.from(new Set(linkedFacetRows.map((facet) => facet.entityId)));
        const facetRows = linkedEntityIds.length
          ? await db
              .select({
                id: objectIdentityFacets.id,
                kind: objectIdentityFacets.kind,
                value: objectIdentityFacets.value,
                normalizedValue: objectIdentityFacets.normalizedValue,
                provider: objectIdentityFacets.provider,
                externalId: objectIdentityFacets.externalId,
                entityId: entities.id,
                canonicalName: entities.canonicalName,
                aliases: entities.aliases,
              })
              .from(objectIdentityFacets)
              .innerJoin(entities, eq(entities.id, objectIdentityFacets.entityId))
              .where(
                and(
                  eq(objectIdentityFacets.teamId, teamId),
                  inArray(objectIdentityFacets.entityId, linkedEntityIds),
                  eq(objectIdentityFacets.status, 'approved'),
                  eq(entities.teamId, teamId),
                  isNull(entities.mergedIntoId),
                ),
              )
              .orderBy(objectIdentityFacets.kind, objectIdentityFacets.value)
          : [];
        const person = facetRows[0]
          ? {
              id: facetRows[0].entityId,
              canonicalName: facetRows[0].canonicalName,
              aliases: Array.isArray(facetRows[0].aliases)
                ? (facetRows[0].aliases as unknown[]).filter(
                    (value): value is string => typeof value === 'string',
                  )
                : [],
            }
          : null;
        return {
          userId,
          role,
          name: userRows[0]?.name ?? null,
          email: userRows[0]?.email ?? null,
          person,
          facets: facetRows.map((facet) => ({
            id: facet.id,
            kind: facet.kind,
            value: facet.value,
            normalizedValue: facet.normalizedValue,
            provider: facet.provider,
            externalId: facet.externalId,
          })),
        };
      },

      listImpactItems: listTimelineImpactItems,

      listArtifactClusters: listTimelineArtifactClusters,

      async listEventsPage(
        filters: EventListFilters = {},
      ): Promise<PaginatedResult<typeof rawEvents.$inferSelect>> {
        const limit = Math.min(Math.max(filters.limit ?? 30, 1), 100);
        const rows = await listEvents({ ...filters, limit: limit + 1 });
        return pageWindow(rows, limit, (row) => ({
          at: row.occurredAt.toISOString(),
          id: row.id,
        }));
      },

      async listAllEventsInWindow(filters: {
        from: Date;
        to: Date;
      }): Promise<(typeof rawEvents.$inferSelect)[]> {
        const all: (typeof rawEvents.$inferSelect)[] = [];
        let cursor: string | null = null;
        do {
          const rows = await listEvents({
            from: filters.from,
            to: filters.to,
            limit: 101,
            ...(cursor ? { cursor } : {}),
          });
          const page = rows.slice(0, 100);
          all.push(...page);
          const last = page.at(-1);
          cursor =
            rows.length > 100 && last
              ? encodeCursor({ at: last.occurredAt.toISOString(), id: last.id })
              : null;
        } while (cursor);
        return all;
      },

      async getEvent(id: string) {
        await ensureMember();
        const rows = await db
          .select()
          .from(rawEvents)
          .where(
            and(
              eq(rawEvents.id, id),
              eq(rawEvents.teamId, teamId),
              visibilityFilter,
              activeRawEventFilter,
            ),
          )
          .limit(1);
        return rows[0] ?? null;
      },

      /**
       * Bulk-load events by id with team + visibility enforced at the SQL
       * layer. Used by global search to hydrate result rows in a single
       * round-trip rather than N getEvent() calls. Returns only rows visible
       * to (teamId, userId); ids that fail the filter are silently dropped —
       * callers must reconcile by id, not by index.
       */
      getEventsByIds: getEventsByIdsImpl,

      async removeConversationalMessage(id: string): Promise<boolean> {
        const role = await ensureMember();
        const removedIds = await db.transaction(async (tx) => {
          const rows = await tx
            .select({
              id: rawEvents.id,
              source: rawEvents.source,
              authorUserId: rawEvents.authorUserId,
              sourceMetadata: rawEvents.sourceMetadata,
            })
            .from(rawEvents)
            .where(
              and(
                eq(rawEvents.id, id),
                eq(rawEvents.teamId, teamId),
                visibilityFilter,
                activeRawEventFilter,
              ),
            )
            .limit(1);
          const row = rows[0];
          if (!row) return [];
          if (row.source !== 'telegram' && row.source !== 'slack') {
            throw new Error('Only Telegram and Slack events can be removed this way');
          }
          const isAdmin = role === 'owner' || role === 'admin';
          if (!isAdmin && row.authorUserId !== userId) {
            throw new Error('Only the message author or a team admin can remove this event');
          }

          const meta = (row.sourceMetadata ?? {}) as Record<string, unknown>;
          const isTelegram = row.source === 'telegram';
          const chatId = meta.tg_chat_id;
          const messageId = meta.tg_message_id;
          const workspaceId = meta.slack_workspace_id;
          const channelId = meta.slack_channel_id;
          const slackTs = meta.slack_message_ts;
          if (isTelegram) {
            if (
              (typeof chatId !== 'number' && typeof chatId !== 'string') ||
              (typeof messageId !== 'number' && typeof messageId !== 'string')
            ) {
              throw new Error('Telegram event is missing message metadata');
            }
          } else if (
            typeof workspaceId !== 'string' ||
            typeof channelId !== 'string' ||
            typeof slackTs !== 'string'
          ) {
            throw new Error('Slack event is missing message metadata');
          }

          const patch = JSON.stringify({
            deleted: true,
            delete_reason: isTelegram
              ? 'telegram_removed_in_timeline'
              : 'slack_removed_in_timeline',
            deleted_at: new Date().toISOString(),
            deleted_by_user_id: userId,
            deleted_from_event_id: row.id,
          });
          const baseConditions = [
            eq(rawEvents.teamId, teamId),
            eq(rawEvents.source, row.source),
            activeRawEventFilter,
          ];
          const sourceConditions = isTelegram
            ? [
                sql`${rawEvents.sourceMetadata} ->> 'tg_chat_id' = ${String(chatId)}`,
                sql`${rawEvents.sourceMetadata} ->> 'tg_message_id' = ${String(messageId)}`,
              ]
            : [
                sql`${rawEvents.sourceMetadata} ->> 'slack_workspace_id' = ${workspaceId}`,
                sql`${rawEvents.sourceMetadata} ->> 'slack_channel_id' = ${channelId}`,
                sql`${rawEvents.sourceMetadata} ->> 'slack_message_ts' = ${slackTs}`,
              ];
          const removed = await tx
            .update(rawEvents)
            .set({
              sourceMetadata: sql`COALESCE(${rawEvents.sourceMetadata}, '{}'::jsonb) || ${patch}::jsonb`,
            })
            .where(and(...baseConditions, ...sourceConditions))
            .returning({ id: rawEvents.id });
          return removed.map((event) => event.id);
        });
        for (const rawEventId of removedIds) {
          await invalidateObjectSummariesForRawEvent(db, core, rawEventId, {
            trigger: 'raw_event_tombstone',
          });
        }
        return removedIds.length > 0;
      },

      async removeTelegramMessage(id: string): Promise<boolean> {
        return this.removeConversationalMessage(id);
      },

      async createEvent(input: CreateEventInput) {
        await ensureMember();
        const visibilityUserIds = await validateVisibilityPatch(
          {
            visibility: input.visibility ?? 'team',
            visibilityUserIds: input.visibilityUserIds ?? null,
          },
          { allowSpecificUsers: true },
        );
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
            visibilityUserIds,
            visibilityOwnerUserId: input.visibilityOwnerUserId ?? input.authorUserId,
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
        const visibility = (input.visibility ?? 'team') as EventVisibility;
        if (visibility === 'specific_users') {
          throw new Error('specific_users visibility is not supported for email events');
        }
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
                  inArray(sql`${rawEvents.sourceMetadata} ->> 'message_id'`, probeIds),
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
              visibility,
              visibilityUserIds: null,
              visibilityOwnerUserId: input.visibilityOwnerUserId ?? input.authorUserId,
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
          .where(and(eq(teamMembers.teamId, teamId), isNull(teamMembers.removedAt)))
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
          .where(
            and(
              eq(rawEvents.id, id),
              eq(rawEvents.teamId, teamId),
              visibilityFilter,
              activeRawEventFilter,
            ),
          )
          .limit(1);
        const event = eventRows[0];
        if (!event) return null;
        const senderMap = await resolveSenderContexts([event]);
        const senderInfo = senderMap.get(event.id);
        if (event.visibility !== 'team') {
          await db.insert(auditLog).values({
            teamId,
            actorUserId: userId,
            action: 'event.detail_read',
            targetType: 'raw_event',
            targetId: event.id,
            targetVisibility: event.visibility,
            targetOwnerUserId: event.visibilityOwnerUserId,
            targetVisibilityUserIds: event.visibilityUserIds,
            metadata: { source: event.source },
          });
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
            sender: senderInfo?.sender ?? null,
            resolvedSenderObject: senderInfo?.resolvedSenderObject ?? null,
            senderResolutionStatus: senderInfo?.senderResolutionStatus ?? 'unresolved',
            contentText: event.contentText,
            contentAudioUrl: event.contentAudioUrl,
            visibility: event.visibility,
            visibilityOwnerUserId: event.visibilityOwnerUserId,
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
                  sourceMetadata: rawEvents.sourceMetadata,
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
                    activeRawEventFilter,
                  ),
                )
                .orderBy(desc(rawEvents.occurredAt))
            : [];
        const senderMap = await resolveSenderContexts(eventRows);

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
          events: eventRows.map((event) => {
            const senderInfo = senderMap.get(event.id);
            return {
              ...event,
              sender: senderInfo?.sender ?? null,
              resolvedSenderObject: senderInfo?.resolvedSenderObject ?? null,
              senderResolutionStatus: senderInfo?.senderResolutionStatus ?? 'unresolved',
            };
          }),
          coOccurring: coRows,
        };
      },

      /**
       * Semantic search across the team's events. Embeds the query, runs a
       * filtered Qdrant search (team_id + visibility baked into the wrapper),
       * dedups by event_id, then hydrates from Postgres via `getEventsByIds`
       * — the second-line-of-defense visibility filter at the SQL layer.
       *
       * This collapses what used to live inline in the legacy search endpoint so
       * the agent's `search_timeline` tool and app search share one implementation.
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
        if (input.source && input.senderSource && input.source !== input.senderSource) return [];

        const searchOpts: SearchOpts = {
          limit: input.limit ?? 20,
        };
        if (input.from) searchOpts.from = input.from;
        if (input.to) searchOpts.to = input.to;
        const sourceFilter = input.source ?? input.senderSource;
        if (sourceFilter) searchOpts.source = sourceFilter;
        if (input.entityIds) searchOpts.entityIds = input.entityIds;
        // Timeline search includes event-backed captured-file representations
        // by default. Curated documents stay in search_documents.
        if (input.sourceKind) {
          searchOpts.sourceKind = input.sourceKind;
        } else {
          searchOpts.sourceKind = ['raw_event', 'fact', 'doc_chunk'];
          searchOpts.fileKinds = ['captured'];
        }

        const { hits, usedSqlSenderFilter } = await searchSenderFilteredHits({
          searchInput: input,
          vector,
          searchOpts,
          searchFn,
        });

        // Dedupe by event_id. Keep highest score; collect fact_ids; merge
        // entity_ids across event-level + fact-level points on the same event.
        const dedup = new Map<string, SearchEventResult>();
        const docChunkIdsByEvent = new Map<string, string[]>();
        for (const hit of hits) {
          // Defense in depth: Qdrant's wrapper already filters team_id, but
          // verify here so a misconfigured payload can't leak across teams.
          if (hit.payload.team_id !== teamId) continue;
          // Skip non-event-anchored hits (object/object_note/object_change/
          // entity scopes write event_id=null). This hydration pipeline
          // resolves results via getEventsByIds, so a null event_id has
          // nothing to hydrate; the workspace-graph kinds need a separate
          // helper. Without this check, null keys collide in the dedup map.
          if (!hit.payload.event_id) continue;
          // Qdrant payloads CAN drift — schema changes, manual point edits,
          // older embed worker versions. Spread on undefined throws and kills
          // the whole search. Treat each field as best-effort.
          const entityIds = Array.isArray(hit.payload.entity_ids) ? hit.payload.entity_ids : [];
          const factId = hit.payload.fact_id ?? null;
          const docChunkId =
            hit.payload.source_kind === 'doc_chunk' ? hit.payload.document_chunk_id : null;
          const existing = dedup.get(hit.payload.event_id);
          if (existing) {
            if (hit.score > existing.score) existing.score = hit.score;
            if (factId && !existing.factIds.includes(factId)) existing.factIds.push(factId);
            if (docChunkId) {
              const chunkIds = docChunkIdsByEvent.get(hit.payload.event_id) ?? [];
              if (!chunkIds.includes(docChunkId)) {
                chunkIds.push(docChunkId);
                docChunkIdsByEvent.set(hit.payload.event_id, chunkIds);
              }
            }
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
            sender: null,
            resolvedSenderObject: null,
            senderResolutionStatus: 'unresolved',
          });
          if (docChunkId) docChunkIdsByEvent.set(hit.payload.event_id, [docChunkId]);
        }

        const orderedEventIds = Array.from(dedup.values())
          .sort((a, b) => b.score - a.score)
          .map((r) => r.eventId);
        if (orderedEventIds.length === 0) return [];

        // Hydrate via the shared getEventsByIds helper — same SQL the public
        // method runs, so the visibility filter can't drift across the two
        // call sites.
        const accessibleEvents = await getEventsByIdsImpl(orderedEventIds);
        const senderMap = await resolveSenderContexts(accessibleEvents);
        const eventMap = new Map<string, (typeof accessibleEvents)[number]>();
        for (const ev of accessibleEvents) eventMap.set(ev.id, ev);
        const accessibleEventIds = accessibleEvents.map((event) => event.id);
        const clusterByEventId =
          await hydrateArtifactClustersForVisibleEventIds(accessibleEventIds);

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

        const allDocChunkIds = Array.from(docChunkIdsByEvent.values()).flat();
        const docChunkRows =
          allDocChunkIds.length > 0
            ? await db
                .select({
                  id: documentChunks.id,
                  text: documentChunks.text,
                  representationKind: documentChunks.representationKind,
                  documentId: documentChunks.documentId,
                  teamId: documentChunks.teamId,
                })
                .from(documentChunks)
                .innerJoin(documents, eq(documents.id, documentChunks.documentId))
                .where(
                  and(
                    inArray(documentChunks.id, allDocChunkIds),
                    eq(documentChunks.teamId, teamId),
                    eq(documents.fileKind, 'captured'),
                    isNull(documents.deletedAt),
                  ),
                )
            : [];
        const docChunkMap = new Map(docChunkRows.map((chunk) => [chunk.id, chunk]));

        const results: SearchEventResult[] = [];
        for (const eventId of orderedEventIds) {
          const ev = eventMap.get(eventId);
          if (!ev) continue;
          const senderInfo = senderMap.get(ev.id);
          if (
            !usedSqlSenderFilter &&
            input.personObjectId &&
            senderInfo?.resolvedSenderObject?.id !== input.personObjectId
          ) {
            continue;
          }
          if (!usedSqlSenderFilter && input.senderHandle) {
            const needle = input.senderHandle.replace(/^@/, '').toLowerCase();
            const senderHaystack = [
              senderInfo?.sender?.handle?.replace(/^@/, '').toLowerCase(),
              senderInfo?.sender?.externalId?.toLowerCase(),
            ].filter(Boolean);
            if (!senderHaystack.includes(needle)) continue;
          }
          if (input.senderSource && ev.source !== input.senderSource) continue;
          const row = dedup.get(eventId);
          if (!row) continue;
          const verifiedFactIds = row.factIds.filter((fid) => factMap.has(fid));
          const factSnippet = verifiedFactIds
            .map((fid) => factMap.get(fid)?.statement)
            .filter((s): s is string => Boolean(s))
            .join(' · ');
          const docSnippet = (docChunkIdsByEvent.get(eventId) ?? [])
            .map((id) => docChunkMap.get(id))
            .filter((chunk): chunk is NonNullable<typeof chunk> => Boolean(chunk))
            .map((chunk) => `${chunk.representationKind.replace(/_/g, ' ')}: ${chunk.text}`)
            .join(' · ');
          const snippet =
            factSnippet ||
            (docSnippet ? docSnippet.slice(0, 240) : '') ||
            (ev.contentText ? ev.contentText.slice(0, 240) : '[audio event — no transcript]');
          results.push({
            eventId: ev.id,
            factIds: verifiedFactIds,
            score: row.score,
            occurredAt: ev.occurredAt.toISOString(),
            source: ev.source,
            authorUserId: ev.authorUserId,
            sender: senderInfo?.sender ?? null,
            resolvedSenderObject: senderInfo?.resolvedSenderObject ?? null,
            senderResolutionStatus: senderInfo?.senderResolutionStatus ?? 'unresolved',
            entityIds: row.entityIds,
            snippet,
            artifactCluster: clusterByEventId.get(ev.id) ?? null,
          });
          if (results.length >= (input.limit ?? 20)) break;
        }
        return results;
      },

      async searchObjectNotes(input: {
        query: string;
        objectId?: string;
        limit?: number;
      }): Promise<SearchObjectNoteResult[]> {
        await ensureMember();
        const embedFn = deps.embed ?? defaultEmbed;
        const searchFn =
          deps.qdrantSearch ??
          (async (tId, uId, vector, opts) => {
            const client = getQdrantClient();
            return client.search(tId, uId, vector, opts);
          });

        const limit = Math.min(Math.max(input.limit ?? 10, 1), 20);
        const { vector } = await embedFn({ text: input.query });
        const hits = await searchFn(teamId, userId, vector, {
          limit: limit * 3,
          sourceKind: 'object_note',
        });

        const orderedNoteIds: string[] = [];
        const scoreByNoteId = new Map<string, number>();
        for (const hit of hits) {
          if (hit.payload.team_id !== teamId) continue;
          if (hit.payload.source_kind !== 'object_note') continue;
          const noteId = hit.payload.note_id;
          const objectId = hit.payload.object_id;
          if (!noteId || !objectId) continue;
          if (input.objectId && objectId !== input.objectId) continue;
          if (!scoreByNoteId.has(noteId)) orderedNoteIds.push(noteId);
          const previous = scoreByNoteId.get(noteId) ?? Number.NEGATIVE_INFINITY;
          if (hit.score > previous) scoreByNoteId.set(noteId, hit.score);
        }
        if (orderedNoteIds.length === 0) return [];

        const noteRows = await db
          .select({
            noteId: objectNotes.id,
            objectId: objectNotes.entityId,
            body: objectNotes.body,
            updatedAt: objectNotes.updatedAt,
            objectName: entities.canonicalName,
            objectType: entities.type,
          })
          .from(objectNotes)
          .innerJoin(entities, eq(entities.id, objectNotes.entityId))
          .where(
            and(
              eq(objectNotes.teamId, teamId),
              isNull(objectNotes.deletedAt),
              isNull(entities.mergedIntoId),
              input.objectId ? eq(objectNotes.entityId, input.objectId) : undefined,
              inArray(objectNotes.id, orderedNoteIds),
            ),
          );
        const noteMap = new Map(noteRows.map((row) => [row.noteId, row]));

        const auditRows = await db
          .select({
            noteId: sql<string>`${rawEvents.sourceMetadata} ->> 'note_id'`,
            suggestionItemId: sql<
              string | null
            >`${rawEvents.sourceMetadata} ->> 'agent_suggestion_item_id'`,
          })
          .from(rawEvents)
          .where(
            and(
              eq(rawEvents.teamId, teamId),
              eq(rawEvents.source, 'system'),
              inArray(sql<string>`${rawEvents.sourceMetadata} ->> 'note_id'`, orderedNoteIds),
              sql`${rawEvents.sourceMetadata} ->> 'kind' in ('object_note_create', 'object_note_update')`,
            ),
          );
        const itemToNoteIds = new Map<string, string[]>();
        for (const row of auditRows) {
          if (!row.suggestionItemId || !row.noteId) continue;
          const existing = itemToNoteIds.get(row.suggestionItemId) ?? [];
          existing.push(row.noteId);
          itemToNoteIds.set(row.suggestionItemId, existing);
        }

        const evidenceByNoteId = new Map<string, SearchObjectNoteEvidence[]>();
        const suggestionItemIds = Array.from(itemToNoteIds.keys());
        if (suggestionItemIds.length > 0) {
          const itemRows = await db
            .select({
              itemId: agentSuggestionItems.id,
              suggestionId: agentSuggestionItems.suggestionId,
            })
            .from(agentSuggestionItems)
            .where(inArray(agentSuggestionItems.id, suggestionItemIds));
          const suggestionIds = Array.from(new Set(itemRows.map((row) => row.suggestionId)));
          const suggestionIdToNoteIds = new Map<string, string[]>();
          for (const row of itemRows) {
            const noteIds = itemToNoteIds.get(row.itemId) ?? [];
            const existing = suggestionIdToNoteIds.get(row.suggestionId) ?? [];
            existing.push(...noteIds);
            suggestionIdToNoteIds.set(row.suggestionId, existing);
          }
          if (suggestionIds.length > 0) {
            const evidenceRows = await db
              .select({
                suggestionId: agentSuggestionEvidence.suggestionId,
                rawEventId: agentSuggestionEvidence.rawEventId,
                quote: agentSuggestionEvidence.quote,
              })
              .from(agentSuggestionEvidence)
              .where(inArray(agentSuggestionEvidence.suggestionId, suggestionIds));
            for (const row of evidenceRows) {
              for (const noteId of suggestionIdToNoteIds.get(row.suggestionId) ?? []) {
                const existing = evidenceByNoteId.get(noteId) ?? [];
                if (!existing.some((ev) => ev.rawEventId === row.rawEventId)) {
                  existing.push({ rawEventId: row.rawEventId, quote: row.quote });
                }
                evidenceByNoteId.set(noteId, existing);
              }
            }
          }
        }

        const results: SearchObjectNoteResult[] = [];
        for (const noteId of orderedNoteIds) {
          const row = noteMap.get(noteId);
          if (!row) continue;
          results.push({
            noteId: row.noteId,
            objectId: row.objectId,
            objectName: row.objectName,
            objectType: row.objectType,
            body: row.body,
            score: scoreByNoteId.get(noteId) ?? 0,
            updatedAt: row.updatedAt.toISOString(),
            evidence: evidenceByNoteId.get(noteId) ?? [],
          });
          if (results.length >= limit) break;
        }
        return results;
      },
    },
    documents: documentScope,
    meetings: meetingScope,
    objects: objectScope,
    boards: boardScope,
    suggestions: suggestionScope,
    integrations: integrationScope,
    mcp: mcpScope,
    onboarding: onboardingScope,
    calendar: calendarScope,
    jobRecovery: jobRecoveryScope,
    audit: auditScope,
  };
}

export type TeamScope = ReturnType<typeof withTeam>;

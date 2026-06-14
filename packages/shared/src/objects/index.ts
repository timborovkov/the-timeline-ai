/**
 * Phase 8 — workspace object helpers.
 *
 * All public functions take a `TeamScopeCore` constructed via `withTeam`, so
 * team isolation + membership are already enforced upstream. The helpers
 * never read the team_id off the function argument — they read it off the
 * scope. That's the chokepoint that keeps a typo in a caller from leaking
 * across teams.
 */
import {
  type Db,
  boardItemChanges,
  boardItems,
  calendarEventEntities,
  chatMessages,
  chatSessions,
  entities,
  entityRelationships,
  entityType,
  factEntities,
  facts as factsTable,
  notifications,
  objectChanges,
  objectIdentityFacets,
  objectNotes,
  objectViews,
  rawEvents,
  relationshipKind,
} from '@timeline/db';
import { and, desc, eq, gte, inArray, isNotNull, isNull, lt, ne, or, sql } from 'drizzle-orm';

import type { TeamScopeCore } from '#src/team-scope.js';

import { TIMELINE_MODELS } from '#src/llm/models.js';
import { childLogger } from '#src/logger.js';
import { decodeCursor, pageWindow } from '#src/pagination.js';
import { getQdrantClient } from '#src/qdrant/client.js';
import { buildPointId } from '#src/qdrant/point-id.js';
import * as embedQueue from '#src/queue/queues.js';
import { rawEventVisibleToUser } from '#src/visibility.js';

const embedLog = childLogger('objects:embed');

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

function uniqueIds(ids: string[]): string[] {
  return Array.from(new Set(ids));
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

export type IdentityFacetKind =
  | 'email'
  | 'phone'
  | 'telegram'
  | 'slack'
  | 'github'
  | 'timeline_user'
  | 'other';

export interface IdentityFacetInput {
  entityId: string;
  kind: IdentityFacetKind;
  value: string;
  normalizedValue?: string;
  provider?: string | null;
  externalId?: string | null;
  linkedUserId?: string | null;
  source?: 'manual' | 'agent_approved' | 'integration' | 'system';
  metadata?: Record<string, unknown>;
  actor: { kind: ActorKind; userId?: string | null };
}

export interface IdentityFacetRow {
  id: string;
  entityId: string;
  kind: IdentityFacetKind;
  value: string;
  normalizedValue: string;
  provider: string | null;
  externalId: string | null;
  linkedUserId: string | null;
}

export function normalizeIdentityFacet(kind: IdentityFacetKind, value: string): string {
  const trimmed = value.trim();
  if (kind === 'email') return trimmed.toLowerCase();
  if (kind === 'phone') return trimmed.replace(/[^\d+]/g, '');
  if (kind === 'telegram') return trimmed.toLowerCase().replace(/^@/, '');
  if (kind === 'github') return trimmed.toLowerCase().replace(/^@/, '');
  if (kind === 'slack') return trimmed;
  if (kind === 'timeline_user') return trimmed.toLowerCase();
  return trimmed.toLowerCase();
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

// Derive from the drizzle enum so adding a new type only requires touching
// the schema + migration. The previous shape duplicated the union here, in
// `team-scope.ts`, and in the server action — three places to forget.
export type ObjectType = (typeof entityType.enumValues)[number];

/** The exhaustive runtime list of object types (mirrors the Postgres enum). */
export const OBJECT_TYPES = entityType.enumValues;

export type ActorKind = 'user' | 'agent' | 'system';

export interface ObjectListFilter {
  type?: ObjectType | ObjectType[];
  status?: string | string[];
  stage?: string | string[];
  ownerUserId?: string | null;
  assigneeUserId?: string | null;
  dueBefore?: Date;
  dueAfter?: Date;
  archived?: boolean;
  limit?: number;
  offset?: number;
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
  agentSuggested: boolean;
  archivedAt: Date | null;
  aliases: string[];
  metadata: Record<string, unknown>;
  updatedAt: Date;
  createdAt: Date;
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

function toObjectRow(row: EntityRow): ObjectRow {
  const aliases = Array.isArray(row.aliases)
    ? (row.aliases as unknown[]).filter((v): v is string => typeof v === 'string')
    : [];
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
    agentSuggested: row.agentSuggested,
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

export async function listObjects(
  db: Db,
  scope: TeamScopeCore,
  filter: ObjectListFilter = {},
): Promise<ObjectRow[]> {
  await scope.requireMembership();
  const conds = [eq(entities.teamId, scope.teamId), isNull(entities.mergedIntoId)];

  const types = toArray(filter.type);
  if (types && types.length > 0) conds.push(inArray(entities.type, types));

  const statuses = toArray(filter.status);
  if (statuses && statuses.length > 0) conds.push(inArray(entities.status, statuses));

  const stages = toArray(filter.stage);
  if (stages && stages.length > 0) {
    // `stage` is nullable — only filter when caller asked for non-null stages.
    conds.push(inArray(entities.stage, stages));
  }

  if (filter.ownerUserId === null) conds.push(isNull(entities.ownerUserId));
  else if (filter.ownerUserId) conds.push(eq(entities.ownerUserId, filter.ownerUserId));

  if (filter.assigneeUserId === null) conds.push(isNull(entities.assigneeUserId));
  else if (filter.assigneeUserId) conds.push(eq(entities.assigneeUserId, filter.assigneeUserId));

  if (filter.dueBefore) conds.push(lt(entities.dueAt, filter.dueBefore));
  if (filter.dueAfter) conds.push(gte(entities.dueAt, filter.dueAfter));

  if (filter.archived === true) conds.push(isNotNull(entities.archivedAt));
  else if (filter.archived !== undefined) conds.push(isNull(entities.archivedAt));

  const limit = Math.min(Math.max(filter.limit ?? 100, 1), 500);
  const offset = Math.max(filter.offset ?? 0, 0);

  const rows = await db
    .select()
    .from(entities)
    .where(and(...conds))
    .orderBy(desc(entities.updatedAt))
    .limit(limit)
    .offset(offset);
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
  openTasks: ObjectRow[];
  /** Count of object_changes and notes since the caller's last visit. */
  newSinceLastVisit: number;
  lastVisitedAt: Date | null;
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
    .select({ id: entities.id })
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
    const cursorSql = cursorCondition(args.cursor, factsTable.extractedAt, factsTable.id);
    const rows = await db
      .select({
        id: factsTable.id,
        statement: factsTable.statement,
        confidence: factsTable.confidence,
        rawEventId: factsTable.rawEventId,
        extractedAt: factsTable.extractedAt,
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
      .orderBy(desc(factsTable.extractedAt), desc(factsTable.id))
      .limit(limit + 1);
    return pageWindow(rows, limit, (row) => ({ at: row.extractedAt.toISOString(), id: row.id }));
  }

  const cursorSql = cursorCondition(args.cursor, rawEvents.occurredAt, rawEvents.id);
  const rows = await db
    .select()
    .from(rawEvents)
    .where(
      and(
        eq(rawEvents.teamId, scope.teamId),
        rawEventVisibility(scope),
        sql`COALESCE(${rawEvents.sourceMetadata} ->> 'deleted', 'false') <> 'true'`,
        sql`${rawEvents.sourceMetadata} ->> 'entity_id' = ${entityId}`,
        ...(cursorSql ? [cursorSql] : []),
      ),
    )
    .orderBy(desc(rawEvents.occurredAt), desc(rawEvents.id))
    .limit(limit + 1);
  return pageWindow(rows, limit, (row) => ({ at: row.occurredAt.toISOString(), id: row.id }));
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

  const [noteRows, outRows, inRows, changeRows, taskRows, viewRows] = await Promise.all([
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
    // "Open tasks linked via parent relationship". We model task→parent as a
    // `child` edge from the task to the parent, OR a `parent` edge from the
    // parent to the task. For simplicity, surface tasks where the parent is
    // this object via the `child` edge (task → parent).
    db
      .select({ taskId: entityRelationships.fromEntityId })
      .from(entityRelationships)
      .where(
        and(
          eq(entityRelationships.teamId, scope.teamId),
          eq(entityRelationships.toEntityId, entityRow.id),
          eq(entityRelationships.kind, 'child'),
        ),
      )
      .limit(200),
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
  ]);

  const taskIds = taskRows.map((r) => r.taskId);
  const tasks: ObjectRow[] =
    taskIds.length > 0
      ? (
          await db
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
              ),
            )
            .orderBy(desc(entities.updatedAt), desc(entities.id))
            .limit(20)
        ).map(toObjectRow)
      : [];

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
  return {
    ...base,
    notes: noteRows,
    relationships: [
      ...outRows.map((r) => ({ ...r, direction: 'out' as const })),
      ...inRows.map((r) => ({ ...r, direction: 'in' as const })),
    ],
    recentChanges: changeRows,
    openTasks: tasks,
    newSinceLastVisit,
    lastVisitedAt,
  };
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
  sourceEventId?: string | null;
  agentSuggested?: boolean;
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

  const result = await db.transaction(async (tx) => {
    const insertRows = await tx
      .insert(entities)
      .values({
        teamId: scope.teamId,
        type: input.type,
        canonicalName: name,
        status: input.status ?? (input.agentSuggested ? 'suggested' : 'open'),
        stage: input.stage ?? null,
        priority: input.priority ?? null,
        ownerUserId: input.ownerUserId ?? null,
        assigneeUserId: input.assigneeUserId ?? null,
        dueAt: input.dueAt ?? null,
        aliases: input.aliases ?? [],
        metadata: input.metadata ?? {},
        sourceEventId: input.sourceEventId ?? null,
        agentSuggested: input.agentSuggested ?? false,
      })
      .returning();
    const row = insertRows[0];
    if (!row) throw new Error('Failed to create object');

    // Audit event for the create itself. One row per object, field='__create__'
    // so the UI can group create/edit/archive consistently.
    const eventInsert = await tx
      .insert(rawEvents)
      .values({
        teamId: scope.teamId,
        authorUserId: input.actor.kind === 'user' ? (input.actor.userId ?? null) : null,
        source: 'system',
        contentText: `${input.actor.kind === 'agent' ? 'Agent suggested' : 'Created'} ${input.type}: ${name}`,
        occurredAt: new Date(),
        visibility: 'team',
        sourceMetadata: {
          kind: 'object_create',
          entity_id: row.id,
          actor_kind: input.actor.kind,
        },
      })
      .returning({ id: rawEvents.id });
    const sourceEventId = eventInsert[0]?.id ?? null;

    const changeInsert = await tx
      .insert(objectChanges)
      .values({
        teamId: scope.teamId,
        entityId: row.id,
        actorUserId: input.actor.userId ?? null,
        actorKind: input.actor.kind,
        status: input.agentSuggested ? 'suggested' : 'applied',
        field: '__create__',
        previousValue: null,
        newValue: { type: input.type, canonicalName: name, status: row.status },
        sourceEventId,
      })
      .returning({ id: objectChanges.id });
    const changeId = changeInsert[0]?.id ?? null;

    // Agent-suggested creates need an inbox entry — otherwise the user
    // never sees that the agent dropped a task into their workspace.
    // Mirrors the fan-out shape in `proposeObjectChange`. Skip when the
    // create came from a human (UI) since they already know.
    if (input.agentSuggested && changeId) {
      const recipients = new Set<string>();
      if (input.ownerUserId) recipients.add(input.ownerUserId);
      if (input.assigneeUserId) recipients.add(input.assigneeUserId);
      if (recipients.size > 0) {
        const summary = `Agent suggested ${input.type}: ${name}`;
        await tx.insert(notifications).values(
          Array.from(recipients).map((uid) => ({
            teamId: scope.teamId,
            userId: uid,
            kind: 'agent_suggestion' as const,
            entityId: row.id,
            objectChangeId: changeId,
            summary,
            payload: {
              entity_id: row.id,
              type: input.type,
              canonical_name: name,
            },
          })),
        );
      }
    }

    if (input.parentObjectId && UUID_RE.test(input.parentObjectId)) {
      // Verify the parent belongs to this team before linking — otherwise a
      // caller who knows (or guesses) a UUID from another team could write a
      // cross-team edge, and the joined entity would leak through
      // getObject's relationship panel. Mirrors the endpoint check in
      // addRelationship.
      const parentExists = await tx
        .select({ id: entities.id })
        .from(entities)
        .where(
          and(
            eq(entities.id, input.parentObjectId),
            eq(entities.teamId, scope.teamId),
            isNull(entities.mergedIntoId),
          ),
        )
        .limit(1);
      if (parentExists.length === 0) {
        throw new Error('Parent object does not belong to this team');
      }
      // task → parent via `child` edge (the row reads "task is a child of parent")
      await tx
        .insert(entityRelationships)
        .values({
          teamId: scope.teamId,
          fromEntityId: row.id,
          toEntityId: input.parentObjectId,
          kind: 'child',
          createdBy: input.actor.userId ?? null,
        })
        .onConflictDoNothing();
    }

    return toObjectRow(row);
  });

  // Embed AFTER the transaction commits so the worker (which reads from a
  // separate connection) sees the row. Two points per object: the workspace
  // narrative ('object' scope) and the entity disambiguation text ('entity'
  // scope) — different retrieval modes share the row.
  fireAndForgetEmbed(() => embedQueue.enqueueObjectEmbedJob(scope.teamId, result.id), {
    teamId: scope.teamId,
    objectId: result.id,
    op: 'createObject',
  });
  fireAndForgetEmbed(() => embedQueue.enqueueEntityEmbedJob(scope.teamId, result.id), {
    teamId: scope.teamId,
    entityId: result.id,
    op: 'createObject',
  });
  return result;
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
      return { object: toObjectRow(current), changedFields: [], changeIds: [] as string[] };
    }

    const updatedRows = await tx
      .update(entities)
      .set({ ...next, updatedAt: new Date() })
      .where(eq(entities.id, entityId))
      .returning();
    const updated = updatedRows[0];
    if (!updated) throw new Error('Update failed');

    const summary = changes
      .map((c) => `${c.field}: ${JSON.stringify(c.previousValue)} → ${JSON.stringify(c.newValue)}`)
      .join('; ');
    const eventInsert = await tx
      .insert(rawEvents)
      .values({
        teamId: scope.teamId,
        authorUserId: actor.kind === 'user' ? actor.userId : null,
        source: 'system',
        contentText: `${actor.kind === 'agent' ? 'Agent applied' : 'Updated'} ${updated.type}: ${updated.canonicalName} — ${summary}`,
        occurredAt: new Date(),
        visibility: 'team',
        sourceMetadata: {
          kind: 'object_update',
          entity_id: entityId,
          actor_kind: actor.kind,
          changed_fields: changes.map((c) => c.field),
        },
      })
      .returning({ id: rawEvents.id });
    const sourceEventId = eventInsert[0]?.id ?? null;

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
          sourceEventId,
        })),
      )
      .returning({ id: objectChanges.id });

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

    return {
      object: toObjectRow(updated),
      changedFields: changes.map((c) => c.field),
      changeIds: changeRows.map((r) => r.id),
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
    const loserBoardItems = await tx
      .select()
      .from(boardItems)
      .where(and(eq(boardItems.teamId, scope.teamId), inArray(boardItems.entityId, loserIds)));
    for (const item of loserBoardItems) {
      if (item.archivedAt) {
        await tx
          .update(boardItems)
          .set({ entityId: survivor.id, updatedAt: now })
          .where(and(eq(boardItems.id, item.id), eq(boardItems.teamId, scope.teamId)));
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
        await tx
          .update(boardItems)
          .set({ archivedAt: now, updatedAt: now })
          .where(and(eq(boardItems.id, item.id), eq(boardItems.teamId, scope.teamId)));
      } else {
        await tx
          .update(boardItems)
          .set({ entityId: survivor.id, updatedAt: now })
          .where(and(eq(boardItems.id, item.id), eq(boardItems.teamId, scope.teamId)));
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

    const eventInsert = await tx
      .insert(rawEvents)
      .values({
        teamId: scope.teamId,
        authorUserId: input.actor.kind === 'user' ? input.actor.userId : null,
        source: 'system',
        contentText: `Merged ${losers.map((row) => row.canonicalName).join(', ')} into ${survivor.canonicalName}`,
        occurredAt: new Date(),
        visibility: 'team',
        sourceMetadata: {
          kind: 'object_merge',
          entity_id: survivor.id,
          merged_entity_ids: loserIds,
          actor_kind: input.actor.kind,
        },
      })
      .returning({ id: rawEvents.id });
    const sourceEventId = eventInsert[0]?.id ?? null;

    await tx
      .update(entities)
      .set({ aliases: nextAliases, updatedAt: new Date() })
      .where(eq(entities.id, survivor.id));
    await tx
      .update(entities)
      .set({ mergedIntoId: survivor.id, updatedAt: new Date() })
      .where(and(eq(entities.teamId, scope.teamId), inArray(entities.id, loserIds)));

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
        sourceEventId,
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
        sourceEventId,
      })),
    ]);

    const updatedRows = await tx
      .select()
      .from(entities)
      .where(eq(entities.id, survivor.id))
      .limit(1);
    const updated = updatedRows[0];
    if (!updated) throw new Error('Merge failed');
    return { survivor: toObjectRow(updated), mergedIds: loserIds };
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
  for (const mergedId of result.mergedIds) {
    fireAndForgetEmbed(() => deleteMergedObjectEmbeddingPoints(scope.teamId, mergedId), {
      teamId: scope.teamId,
      entityId: mergedId,
      op: 'mergeObjects:deleteMergedEmbeddings',
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

  return db.transaction(async (tx) => {
    // Both endpoints must belong to this team. Re-select to validate.
    const ends = await tx
      .select({ id: entities.id, canonicalName: entities.canonicalName, type: entities.type })
      .from(entities)
      .where(
        and(
          eq(entities.teamId, scope.teamId),
          inArray(entities.id, [endpoints.fromEntityId, endpoints.toEntityId]),
          isNull(entities.mergedIntoId),
        ),
      );
    if (ends.length !== 2) throw new Error('Both objects must belong to this team');

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

    const ev = await tx
      .insert(rawEvents)
      .values({
        teamId: scope.teamId,
        authorUserId: input.actorUserId,
        source: 'system',
        contentText: summary,
        occurredAt: new Date(),
        visibility: 'team',
        sourceMetadata: {
          ...(input.metadata ?? {}),
          kind: 'relationship_create',
          relationship_id: row.id,
          from_entity_id: endpoints.fromEntityId,
          to_entity_id: endpoints.toEntityId,
          relationship_kind: input.kind,
        },
      })
      .returning({ id: rawEvents.id });

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
        sourceEventId: ev[0]?.id ?? null,
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
        sourceEventId: ev[0]?.id ?? null,
      },
    ]);

    return row;
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

  return db.transaction(async (tx) => {
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
    if (!rel) return false;

    await tx.delete(entityRelationships).where(eq(entityRelationships.id, relationshipId));

    const ev = await tx
      .insert(rawEvents)
      .values({
        teamId: scope.teamId,
        authorUserId: actor.userId,
        source: 'system',
        contentText: `Removed link (${rel.kind})`,
        occurredAt: new Date(),
        visibility: 'team',
        sourceMetadata: {
          kind: 'relationship_delete',
          relationship_id: rel.id,
          from_entity_id: rel.fromEntityId,
          to_entity_id: rel.toEntityId,
          relationship_kind: rel.kind,
        },
      })
      .returning({ id: rawEvents.id });

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
        sourceEventId: ev[0]?.id ?? null,
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
        sourceEventId: ev[0]?.id ?? null,
      },
    ]);
    return true;
  });
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

    const ev = await tx
      .insert(rawEvents)
      .values({
        teamId: scope.teamId,
        authorUserId: input.authorUserId,
        source: 'system',
        contentText: `Note on ${ent[0].type} "${ent[0].canonicalName}": ${body}`,
        occurredAt: new Date(),
        visibility: 'team',
        sourceMetadata: {
          ...(input.metadata ?? {}),
          kind: 'object_note_create',
          entity_id: input.entityId,
          note_id: noteId,
        },
      })
      .returning({ id: rawEvents.id });
    await tx.insert(objectChanges).values({
      teamId: scope.teamId,
      entityId: input.entityId,
      actorUserId: input.actor ? (input.actor.userId ?? null) : input.authorUserId,
      actorKind: input.actor?.kind ?? 'user',
      status: 'applied',
      field: '__note_create__',
      previousValue: null,
      newValue: { note_id: noteId, body },
      sourceEventId: ev[0]?.id ?? null,
    });

    return { id: noteId };
  });

  fireAndForgetEmbed(() => embedQueue.enqueueObjectNoteEmbedJob(scope.teamId, result.id), {
    teamId: scope.teamId,
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
    normalizedInput === undefined || normalizedInput === ''
      ? normalizeIdentityFacet(input.kind, value)
      : normalizedInput;
  if (!normalizedValue) throw new Error('Identity facet normalized value cannot be empty');
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
      const ev = await tx
        .insert(rawEvents)
        .values({
          teamId: scope.teamId,
          authorUserId: input.actor.userId ?? null,
          source: 'system',
          contentText: summary,
          occurredAt: new Date(),
          visibility: 'team',
          sourceMetadata: {
            kind: 'identity_facet_update',
            entity_id: input.entityId,
            identity_facet_id: existing[0].id,
            identity_facet_kind: input.kind,
          },
        })
        .returning({ id: rawEvents.id });
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
        sourceEventId: ev[0]?.id ?? null,
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
    const ev = await tx
      .insert(rawEvents)
      .values({
        teamId: scope.teamId,
        authorUserId: input.actor.userId ?? null,
        source: 'system',
        contentText: summary,
        occurredAt: new Date(),
        visibility: 'team',
        sourceMetadata: {
          kind: 'identity_facet_create',
          entity_id: input.entityId,
          identity_facet_id: row.id,
          identity_facet_kind: input.kind,
        },
      })
      .returning({ id: rawEvents.id });

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
      sourceEventId: ev[0]?.id ?? null,
    });

    return row;
  });

  fireAndForgetEmbed(() => embedQueue.enqueueObjectEmbedJob(scope.teamId, input.entityId), {
    teamId: scope.teamId,
    entityId: input.entityId,
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
      if (!input.actorUserId) return false;
      conditions.push(eq(objectNotes.authorUserId, input.actorUserId));
    }

    const existing = await tx
      .select()
      .from(objectNotes)
      .where(and(...conditions))
      .limit(1);
    const note = existing[0];
    if (!note) return false;
    if (note.body === body) return true;

    await tx
      .update(objectNotes)
      .set({ body, updatedAt: new Date() })
      .where(eq(objectNotes.id, input.noteId));

    const ev = await tx
      .insert(rawEvents)
      .values({
        teamId: scope.teamId,
        authorUserId: input.actorUserId,
        source: 'system',
        contentText: `Note edited: ${body}`,
        occurredAt: new Date(),
        visibility: 'team',
        sourceMetadata: {
          ...(input.metadata ?? {}),
          kind: 'object_note_update',
          entity_id: note.entityId,
          note_id: note.id,
        },
      })
      .returning({ id: rawEvents.id });
    await tx.insert(objectChanges).values({
      teamId: scope.teamId,
      entityId: note.entityId,
      actorUserId: actor.userId ?? null,
      actorKind: actor.kind,
      status: 'applied',
      field: '__note_update__',
      previousValue: { note_id: note.id, body: note.body },
      newValue: { note_id: note.id, body },
      sourceEventId: ev[0]?.id ?? null,
    });
    return true;
  });

  if (updated) {
    fireAndForgetEmbed(() => embedQueue.enqueueObjectNoteEmbedJob(scope.teamId, input.noteId), {
      teamId: scope.teamId,
      noteId: input.noteId,
      op: 'updateNote',
    });
  }
  return updated;
}

export async function deleteNote(
  db: Db,
  scope: TeamScopeCore,
  input: { noteId: string; actorUserId: string },
): Promise<boolean> {
  await scope.requireMembership();
  if (!UUID_RE.test(input.noteId)) return false;

  return db.transaction(async (tx) => {
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
    if (!note) return false;

    await tx
      .update(objectNotes)
      .set({ deletedAt: new Date() })
      .where(eq(objectNotes.id, input.noteId));

    const ev = await tx
      .insert(rawEvents)
      .values({
        teamId: scope.teamId,
        authorUserId: input.actorUserId,
        source: 'system',
        contentText: `Note deleted`,
        occurredAt: new Date(),
        visibility: 'team',
        sourceMetadata: {
          kind: 'object_note_delete',
          entity_id: note.entityId,
          note_id: note.id,
        },
      })
      .returning({ id: rawEvents.id });
    await tx.insert(objectChanges).values({
      teamId: scope.teamId,
      entityId: note.entityId,
      actorUserId: input.actorUserId,
      actorKind: 'user',
      status: 'applied',
      field: '__note_delete__',
      previousValue: { note_id: note.id, body: note.body },
      newValue: null,
      sourceEventId: ev[0]?.id ?? null,
    });
    return true;
  });
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
  const limit = Math.min(Math.max(filter.limit ?? 100, 1), 500);
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
function normalizeProposedValue(
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
  const normalized = normalizeProposedValue(input.field, input.newValue);

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
  // 1. `__create__` — accepting an agent-suggested object (from
  //    `suggest_task` and friends). The entity already exists with
  //    `status='suggested'`; accepting flips it to a working status so
  //    the object leaves the "needs review" state. We pick the default
  //    by type so a suggested task lands in 'todo' (matches the task
  //    status vocabulary) and other types land in 'open'.
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
    getObject: (idOrName: string) => getObject(db, scope, idOrName),
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

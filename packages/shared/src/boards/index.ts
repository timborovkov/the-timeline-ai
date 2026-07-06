import { randomUUID } from 'node:crypto';

import {
  type Db,
  agentSuggestionEvidence,
  agentSuggestionItems,
  boardItemChanges,
  boardItems,
  boardLanes,
  boardPins,
  boards,
  entities,
  rawEvents,
  reconciliationEvidence,
  reconciliationOutputs,
  reconciliationRuns,
} from '@timeline/db';
import {
  type SQL,
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  notInArray,
  or,
  sql,
} from 'drizzle-orm';

import type {
  ActorKind,
  CreateObjectInput,
  ObjectCountFilter,
  ObjectRow,
  ObjectType,
} from '#src/objects/index.js';
import type { TeamScopeCore } from '#src/team-scope.js';

import {
  deleteDueDateCalendarEventEmbeddings,
  enqueueDueDateCalendarEventEmbeddings,
  mergeDueDateCalendarSyncResults,
  notifyBoardItemDueDate,
  syncBoardItemDueDateCalendarEvent,
  type DueDateCalendarSyncResult,
} from '#src/calendar/due-dates.js';
import { childLogger } from '#src/logger.js';
import { AUTHORITY_POLICY_VERSION } from '#src/reconciliation/authority.js';
import { buildOutputDedupeKey, reconciliationDedupeKey } from '#src/reconciliation/index.js';
import { normalizeRawEventsToEvidence } from '#src/reconciliation/normalization.js';
import { sourcePayloadRefFromMetadata } from '#src/reconciliation/source-snapshot.js';
import { stableSha256Digest } from '#src/reconciliation/stable-digest.js';
import { likePattern } from '#src/sql-like.js';
import { rawEventVisibleToUser } from '#src/visibility.js';

type DbTx = Parameters<Parameters<Db['transaction']>[0]>[0];
type DbOrTx = Db | DbTx;
type BoardDirectWriteVisibility = 'private' | 'team' | 'specific_users';

interface BoardDirectWriteSourceContext {
  sourceRefs: {
    source: string;
    rawEventId: string;
    sourcePayloadRef?: string;
  }[];
  sourcePayloadRefs: string[];
  visibility: BoardDirectWriteVisibility;
  visibilityOwnerUserId: string | null;
  visibilityUserIds: string[] | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BOARD_TEMPLATES = ['pipeline', 'task_board', 'catalog', 'custom'] as const;
const BOARD_ITEM_QUERY_LIMIT_MAX = 50_000;
const BOARD_DIRECT_WRITE_RUN_VERSION = 'board-direct-write-2026-06';
const BOARD_DIRECT_WRITE_PLANNER_VERSION = 'board-direct-write-planner-2026-06';
const BOARD_DIRECT_WRITE_SOURCE_SNAPSHOT_VERSION = 'board-direct-write-source-snapshot-2026-06';
const reconciliationLog = childLogger('boards:reconciliation');

export type BoardTemplateKind = (typeof BOARD_TEMPLATES)[number];
export type BoardLaneKind = 'active' | 'done' | 'terminal' | 'lost' | 'blocked';
export type BoardItemChangeStatus = 'applied' | 'suggested' | 'rejected';
export type BoardItemField =
  | '__add__'
  | '__remove__'
  | 'laneId'
  | 'position'
  | 'responsibleUserId'
  | 'dueAt'
  | 'priority'
  | 'nextStep'
  | 'notes'
  | 'customFields';

export interface BoardLaneInput {
  id?: string;
  name: string;
  kind?: BoardLaneKind | null;
}

export interface BoardRow {
  id: string;
  name: string;
  purpose: string;
  templateKind: BoardTemplateKind;
  recommendedObjectTypes: ObjectType[];
  strictObjectTypes: boolean;
  candidateFilter: Record<string, unknown>;
  isShared: boolean;
  archivedAt: Date | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  itemCount: number;
  laneCounts: { laneId: string | null; laneName: string; count: number }[];
  dueSoonCount: number;
  overdueCount: number;
  pinned: boolean;
}

export interface BoardLaneRow {
  id: string;
  boardId: string;
  name: string;
  position: number;
  kind: BoardLaneKind | null;
  archivedAt: Date | null;
}

export interface BoardItemRow {
  id: string;
  boardId: string;
  entityId: string;
  laneId: string | null;
  position: number;
  responsibleUserId: string | null;
  dueAt: Date | null;
  priority: number | null;
  nextStep: string | null;
  notes: string | null;
  customFields: Record<string, unknown>;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  object: ObjectRow;
}

export interface BoardDetail extends BoardRow {
  lanes: BoardLaneRow[];
  items: BoardItemRow[];
}

export interface BoardItemChangeRow {
  id: string;
  boardId: string;
  boardItemId: string | null;
  entityId: string;
  actorKind: ActorKind;
  actorUserId: string | null;
  status: BoardItemChangeStatus;
  field: BoardItemField;
  previousValue: unknown;
  newValue: unknown;
  sourceEventId: string | null;
  suggestionItemId: string | null;
  evidence: BoardItemEvidence[];
  note: string | null;
  changedAt: Date;
}

export interface BoardItemEvidence {
  rawEventId: string;
  source: string;
  contentText: string | null;
  quote: string | null;
  occurredAt: Date;
}

export interface ObjectBoardContextRow {
  boardId: string;
  boardName: string;
  templateKind: BoardTemplateKind;
  purpose: string;
  itemId: string;
  laneId: string | null;
  laneName: string | null;
  responsibleUserId: string | null;
  dueAt: Date | null;
  priority: number | null;
}

export interface BoardWorkQueueItemRow {
  id: string;
  boardId: string;
  boardName: string;
  laneId: string | null;
  laneName: string | null;
  laneKind: BoardLaneKind | null;
  entityId: string;
  responsibleUserId: string | null;
  dueAt: Date | null;
  priority: number | null;
  nextStep: string | null;
  updatedAt: Date;
  object: ObjectRow;
}

export interface CreateBoardInput {
  name: string;
  purpose?: string;
  templateKind: BoardTemplateKind;
  recommendedObjectTypes?: ObjectType[];
  strictObjectTypes?: boolean;
  candidateFilter?: Record<string, unknown>;
  lanes: BoardLaneInput[];
  isShared?: boolean;
}

export interface RenameBoardInput {
  id: string;
  name: string;
}

export interface UpdateBoardSettingsInput {
  id: string;
  name?: string;
  purpose?: string;
  lanes?: BoardLaneInput[];
}

export interface AddBoardItemInput {
  entityId: string;
  laneId?: string | null;
  position?: number;
  responsibleUserId?: string | null;
  dueAt?: Date | null;
  priority?: number | null;
  nextStep?: string | null;
  notes?: string | null;
  customFields?: Record<string, unknown>;
  actor: { kind: ActorKind; userId?: string | null };
}

export interface BoardItemPatch {
  laneId?: string | null;
  position?: number;
  responsibleUserId?: string | null;
  dueAt?: Date | null;
  priority?: number | null;
  nextStep?: string | null;
  notes?: string | null;
  customFields?: Record<string, unknown>;
}

export interface BoardReadOptions {
  itemLimit?: number | 'all';
  itemFilter?: BoardItemFilter;
}

export interface BoardItemFilter {
  query?: string;
  laneId?: string | string[] | null;
  responsibleUserId?: string | null | (string | null)[];
  priority?: number | number[];
  priorityNull?: boolean;
  dueBefore?: Date;
  dueAfter?: Date;
  dueNull?: boolean;
  createdBefore?: Date;
  createdAfter?: Date;
  updatedBefore?: Date;
  updatedAfter?: Date;
  object?: ObjectCountFilter;
}

export interface BoardWorkQueueOptions {
  dueBefore: Date;
  limit?: number;
}

type BoardSelect = typeof boards.$inferSelect;
type LaneSelect = typeof boardLanes.$inferSelect;
type ItemSelect = typeof boardItems.$inferSelect;
type BoardItemChangeSelect = typeof boardItemChanges.$inferSelect;
type EntitySelect = typeof entities.$inferSelect;

function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
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

function jsonStringArray(value: unknown): ObjectType[] {
  return Array.isArray(value) ? value.filter((v): v is ObjectType => typeof v === 'string') : [];
}

function toArray<T>(v: T | T[] | undefined): T[] | undefined {
  if (v === undefined) return undefined;
  return Array.isArray(v) ? v : [v];
}

function toObjectRow(row: EntitySelect): ObjectRow {
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
    aliases: Array.isArray(row.aliases)
      ? row.aliases.filter((v): v is string => typeof v === 'string')
      : [],
    metadata: jsonObject(row.metadata),
    updatedAt: row.updatedAt,
    createdAt: row.createdAt,
  };
}

function toBoardRow(
  row: BoardSelect,
  counts = new Map<string, number>(),
  pins = new Set<string>(),
  stats = new Map<string, Pick<BoardRow, 'laneCounts' | 'dueSoonCount' | 'overdueCount'>>(),
): BoardRow {
  const boardStats = stats.get(row.id);
  return {
    id: row.id,
    name: row.name,
    purpose: row.purpose,
    templateKind: row.templateKind,
    recommendedObjectTypes: jsonStringArray(row.recommendedObjectTypes),
    strictObjectTypes: row.strictObjectTypes,
    candidateFilter: jsonObject(row.candidateFilter),
    isShared: row.isShared,
    archivedAt: row.archivedAt,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    itemCount: counts.get(row.id) ?? 0,
    laneCounts: boardStats?.laneCounts ?? [],
    dueSoonCount: boardStats?.dueSoonCount ?? 0,
    overdueCount: boardStats?.overdueCount ?? 0,
    pinned: pins.has(row.id),
  };
}

function toLaneRow(row: LaneSelect): BoardLaneRow {
  return {
    id: row.id,
    boardId: row.boardId,
    name: row.name,
    position: row.position,
    kind: row.kind,
    archivedAt: row.archivedAt,
  };
}

function toItemRow(item: ItemSelect, object: EntitySelect): BoardItemRow {
  return {
    id: item.id,
    boardId: item.boardId,
    entityId: item.entityId,
    laneId: item.laneId,
    position: item.position,
    responsibleUserId: item.responsibleUserId,
    dueAt: item.dueAt,
    priority: item.priority,
    nextStep: item.nextStep,
    notes: item.notes,
    customFields: jsonObject(item.customFields),
    archivedAt: item.archivedAt,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    object: toObjectRow(object),
  };
}

function toBoardItemChangeRow(row: BoardItemChangeSelect): BoardItemChangeRow {
  return {
    id: row.id,
    boardId: row.boardId,
    boardItemId: row.boardItemId,
    entityId: row.entityId,
    actorKind: row.actorKind,
    actorUserId: row.actorUserId,
    status: row.status,
    field: row.field as BoardItemField,
    previousValue: row.previousValue,
    newValue: row.newValue,
    sourceEventId: row.sourceEventId,
    suggestionItemId: row.suggestionItemId,
    evidence: [],
    note: row.note,
    changedAt: row.changedAt,
  };
}

async function enrichBoardItemHistoryEvidence(
  db: DbOrTx,
  scope: TeamScopeCore,
  changes: BoardItemChangeRow[],
): Promise<BoardItemChangeRow[]> {
  if (changes.length === 0) return changes;

  const evidenceByChangeId = new Map<string, BoardItemEvidence[]>();
  const changeBySuggestionItemId = new Map<string, BoardItemChangeRow[]>();
  const suggestionItemIds = new Set<string>();
  const sourceEventIds = new Set<string>();
  for (const change of changes) {
    if (change.suggestionItemId) {
      suggestionItemIds.add(change.suggestionItemId);
      const list = changeBySuggestionItemId.get(change.suggestionItemId) ?? [];
      list.push(change);
      changeBySuggestionItemId.set(change.suggestionItemId, list);
    }
    if (change.sourceEventId) sourceEventIds.add(change.sourceEventId);
  }

  if (suggestionItemIds.size > 0) {
    const rows = await db
      .select({
        itemId: agentSuggestionItems.id,
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
      .innerJoin(
        agentSuggestionEvidence,
        eq(agentSuggestionEvidence.suggestionId, agentSuggestionItems.suggestionId),
      )
      .innerJoin(rawEvents, eq(rawEvents.id, agentSuggestionEvidence.rawEventId))
      .where(
        and(
          eq(agentSuggestionItems.teamId, scope.teamId),
          eq(agentSuggestionEvidence.teamId, scope.teamId),
          eq(rawEvents.teamId, scope.teamId),
          inArray(agentSuggestionItems.id, [...suggestionItemIds]),
          rawEventVisibleToUser(scope.userId),
          sql`COALESCE(${rawEvents.sourceMetadata} ->> 'deleted', 'false') <> 'true'`,
        ),
      )
      .orderBy(desc(rawEvents.occurredAt), desc(rawEvents.id));

    const rowsByItemId = new Map<string, typeof rows>();
    for (const row of rows) {
      rowsByItemId.set(row.itemId, [...(rowsByItemId.get(row.itemId) ?? []), row]);
    }
    const outputRawEventIdsByItemId = await sourceRefRawEventIdsBySuggestionItem(db, scope, rows);
    for (const itemRows of rowsByItemId.values()) {
      const firstRow = itemRows[0];
      const outputRawEventIds = firstRow
        ? outputRawEventIdsByItemId.get(firstRow.itemId)
        : undefined;
      const relevantRows = relevantSuggestionEvidenceRows(itemRows, outputRawEventIds);
      for (const row of relevantRows) {
        const relatedChanges = changeBySuggestionItemId.get(row.itemId) ?? [];
        for (const change of relatedChanges) {
          const list = evidenceByChangeId.get(change.id) ?? [];
          if (!list.some((evidence) => evidence.rawEventId === row.rawEventId)) {
            list.push({
              rawEventId: row.rawEventId,
              source: row.source,
              contentText: row.contentText,
              quote: row.quote,
              occurredAt: row.occurredAt,
            });
          }
          evidenceByChangeId.set(change.id, list);
        }
      }
    }
  }

  if (sourceEventIds.size > 0) {
    const rows = await db
      .select({
        rawEventId: rawEvents.id,
        source: rawEvents.source,
        contentText: rawEvents.contentText,
        occurredAt: rawEvents.occurredAt,
      })
      .from(rawEvents)
      .where(
        and(
          eq(rawEvents.teamId, scope.teamId),
          inArray(rawEvents.id, [...sourceEventIds]),
          rawEventVisibleToUser(scope.userId),
          sql`COALESCE(${rawEvents.sourceMetadata} ->> 'deleted', 'false') <> 'true'`,
        ),
      );
    const directById = new Map(rows.map((row) => [row.rawEventId, row]));
    for (const change of changes) {
      if (!change.sourceEventId) continue;
      const row = directById.get(change.sourceEventId);
      if (!row) continue;
      const list = evidenceByChangeId.get(change.id) ?? [];
      if (!list.some((evidence) => evidence.rawEventId === row.rawEventId)) {
        list.push({
          rawEventId: row.rawEventId,
          source: row.source,
          contentText: row.contentText,
          quote: null,
          occurredAt: row.occurredAt,
        });
      }
      evidenceByChangeId.set(change.id, list);
    }
  }

  return changes.map((change) => ({
    ...change,
    evidence: evidenceByChangeId.get(change.id) ?? [],
  }));
}

async function sourceRefRawEventIdsBySuggestionItem(
  db: DbOrTx,
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
  const record = jsonObject(metadata);
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
        const ref = jsonObject(item);
        const rawEventId = ref.rawEventId;
        return typeof rawEventId === 'string' && UUID_RE.test(rawEventId) ? [rawEventId] : [];
      }),
    ),
  ];
}

function stableEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
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

async function normalizeBoardSystemRawEventEvidence(input: {
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
      'board system raw event reconciliation evidence normalization failed',
    );
  }
}

export async function buildBoardDirectWriteSourceContext(input: {
  db: DbOrTx;
  teamId: string;
  sourceEventId: string;
}): Promise<BoardDirectWriteSourceContext> {
  const [raw] = await input.db
    .select({
      source: rawEvents.source,
      sourceMetadata: rawEvents.sourceMetadata,
      visibility: rawEvents.visibility,
      visibilityOwnerUserId: rawEvents.visibilityOwnerUserId,
      visibilityUserIds: rawEvents.visibilityUserIds,
    })
    .from(rawEvents)
    .where(and(eq(rawEvents.teamId, input.teamId), eq(rawEvents.id, input.sourceEventId)))
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
        eq(reconciliationEvidence.rawEventId, input.sourceEventId),
      ),
    )
    .orderBy(desc(reconciliationEvidence.createdAt), desc(reconciliationEvidence.id))
    .limit(1);
  const sourcePayloadRef =
    sourcePayloadRefFromMetadata(raw.sourceMetadata) ?? evidence?.sourcePayloadRef ?? null;
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
        rawEventId: input.sourceEventId,
        ...(sourcePayloadRef ? { sourcePayloadRef } : {}),
      },
    ],
    sourcePayloadRefs,
    visibility,
    visibilityOwnerUserId,
    visibilityUserIds,
  };
}

async function createBoardSystemRawEvent(input: {
  db: DbTx;
  teamId: string;
  actor: { kind: ActorKind; userId?: string | null };
  boardId: string;
  boardName: string;
  boardItemId: string;
  entityId: string;
  entityName: string;
  eventKind: 'board_item_add' | 'board_item_update' | 'board_item_remove';
  contentText: string;
  metadata?: Record<string, unknown>;
}): Promise<string | null> {
  const sourceSnapshot = {
    event_kind: input.eventKind,
    board_id: input.boardId,
    board_name: input.boardName,
    board_item_id: input.boardItemId,
    entity_id: input.entityId,
    entity_name: input.entityName,
    actor_kind: input.actor.kind,
    actor_user_id: input.actor.userId ?? null,
    ...(input.metadata ?? {}),
  };
  const digest = stableSha256Digest(sourceSnapshot);
  const rawEventId = randomUUID();
  const [rawEvent] = await input.db
    .insert(rawEvents)
    .values({
      id: rawEventId,
      teamId: input.teamId,
      authorUserId: input.actor.kind === 'user' ? (input.actor.userId ?? null) : null,
      source: 'system',
      contentText: input.contentText,
      visibility: 'team',
      sourceMetadata: {
        kind: input.eventKind,
        event_type: input.eventKind,
        source_payload_ref: `inline://timeline/system/${input.eventKind}/${rawEventId}`,
        payload_digest: digest,
        source_snapshot_kind: 'board_direct_write_event',
        source_snapshot_version: BOARD_DIRECT_WRITE_SOURCE_SNAPSHOT_VERSION,
        board_id: input.boardId,
        board_item_id: input.boardItemId,
        entity_id: input.entityId,
        actor: {
          kind: input.actor.kind,
          user_id: input.actor.userId ?? null,
        },
        source_snapshot: sourceSnapshot,
      },
    })
    .returning({ id: rawEvents.id });
  if (!rawEvent) return null;
  await normalizeBoardSystemRawEventEvidence({
    db: input.db,
    teamId: input.teamId,
    rawEventId: rawEvent.id,
  });
  return rawEvent.id;
}

async function emitBoardDirectWriteOutput(input: {
  db: DbTx;
  teamId: string;
  boardId: string;
  boardItemId: string;
  entityId: string;
  actor: { kind: ActorKind; userId?: string | null };
  sourceEventId: string | null;
  targetKind: 'board_membership' | 'board_item_update';
  operation: 'create' | 'update' | 'archive_or_cancel';
  systemEventKind: 'board_item_add' | 'board_item_update' | 'board_item_remove';
  changedFields?: string[];
  changes?: { field: string; previousValue: unknown; newValue: unknown }[];
  payload?: Record<string, unknown>;
}): Promise<void> {
  if (!input.sourceEventId) return;
  const sourceContext = await buildBoardDirectWriteSourceContext({
    db: input.db,
    teamId: input.teamId,
    sourceEventId: input.sourceEventId,
  });
  const [run] = await input.db
    .insert(reconciliationRuns)
    .values({
      teamId: input.teamId,
      trigger: 'raw_event',
      scope: 'board_direct_write',
      status: 'completed',
      inputFingerprint: reconciliationDedupeKey('board-direct-write-run', {
        teamId: input.teamId,
        boardId: input.boardId,
        boardItemId: input.boardItemId,
        rawEventId: input.sourceEventId,
        targetKind: input.targetKind,
        operation: input.operation,
        policyVersion: AUTHORITY_POLICY_VERSION,
      }),
      engineVersion: BOARD_DIRECT_WRITE_RUN_VERSION,
      completedAt: new Date(),
      metrics: {
        target_kind: input.targetKind,
        operation: input.operation,
        actor_kind: input.actor.kind,
        ...(input.changedFields ? { changed_fields: input.changedFields } : {}),
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
          target_kind: input.targetKind,
          operation: input.operation,
          actor_kind: input.actor.kind,
          ...(input.changedFields ? { changed_fields: input.changedFields } : {}),
        },
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
      targetKind: input.targetKind,
      operation: input.operation,
      targetId: input.boardItemId,
      payload: {
        source: 'system',
        system_event_kind: input.systemEventKind,
        board_id: input.boardId,
        board_item_id: input.boardItemId,
        entity_id: input.entityId,
        actor_kind: input.actor.kind,
        actor_user_id: input.actor.userId ?? null,
        ...(input.changedFields ? { changed_fields: input.changedFields } : {}),
        ...(input.changes ? { changes: input.changes } : {}),
        ...(input.payload ?? {}),
      },
      authorityDecision: {
        decision: 'direct_write',
        authority_decision: 'direct',
        reason: 'user_or_agent_confirmed_workspace_write',
        source: 'system',
        provider: null,
        target_kind: input.targetKind,
        target_field:
          input.operation === 'create'
            ? '__add__'
            : input.operation === 'archive_or_cancel'
              ? '__remove__'
              : '__update__',
        ...(input.changedFields ? { changed_fields: input.changedFields } : {}),
        policy_version: AUTHORITY_POLICY_VERSION,
      },
      confidence: 'high',
      requiresApproval: false,
      sourceRefs: sourceContext.sourceRefs,
      sourcePayloadRefs: sourceContext.sourcePayloadRefs,
      visibility: sourceContext.visibility,
      visibilityOwnerUserId: sourceContext.visibilityOwnerUserId,
      visibilityUserIds: sourceContext.visibilityUserIds,
      visibilityFloor: sourceContext.visibility,
      visibilityFloorOwnerUserId: sourceContext.visibilityOwnerUserId,
      visibilityFloorUserIds: sourceContext.visibilityUserIds,
      dedupeKey: buildOutputDedupeKey({
        teamId: input.teamId,
        targetKind: input.targetKind,
        operation: input.operation,
        targetId: input.boardItemId,
        sourceRefs: sourceContext.sourceRefs,
        authorityPolicyVersion: AUTHORITY_POLICY_VERSION,
        plannerVersion: BOARD_DIRECT_WRITE_PLANNER_VERSION,
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

function normalizeName(name: string, label: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new Error(`${label} required`);
  if (trimmed.length > 120) throw new Error(`${label}: max 120 chars`);
  return trimmed;
}

function patchFromSuggestedField(
  field: Exclude<BoardItemField, '__add__' | '__remove__'>,
  value: unknown,
): BoardItemPatch {
  switch (field) {
    case 'laneId':
      if (value === null) return { laneId: null };
      if (typeof value === 'string' && UUID_RE.test(value)) return { laneId: value };
      throw new Error('Invalid lane id');
    case 'position':
      if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
        return { position: value };
      }
      throw new Error('Invalid position');
    case 'responsibleUserId':
      if (value === null) return { responsibleUserId: null };
      if (typeof value === 'string' && UUID_RE.test(value)) return { responsibleUserId: value };
      throw new Error('Invalid responsible user');
    case 'dueAt':
      if (value === null) return { dueAt: null };
      if (typeof value === 'string' || value instanceof Date) {
        const dueAt = new Date(value);
        if (Number.isFinite(dueAt.getTime())) return { dueAt };
      }
      throw new Error('Invalid due date');
    case 'priority':
      if (value === null) return { priority: null };
      if (typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 4) {
        return { priority: value };
      }
      throw new Error('Invalid priority');
    case 'nextStep':
      if (value === null) return { nextStep: null };
      if (typeof value === 'string' && value.length <= 300) return { nextStep: value };
      throw new Error('Invalid next step');
    case 'notes':
      if (value === null) return { notes: null };
      if (typeof value === 'string' && value.length <= 5000) return { notes: value };
      throw new Error('Invalid notes');
    case 'customFields':
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('Invalid custom fields');
      }
      return { customFields: jsonObject(value) };
  }
}

function isBoardItemPatchField(
  field: string,
): field is Exclude<BoardItemField, '__add__' | '__remove__'> {
  return (
    field === 'laneId' ||
    field === 'position' ||
    field === 'responsibleUserId' ||
    field === 'dueAt' ||
    field === 'priority' ||
    field === 'nextStep' ||
    field === 'notes' ||
    field === 'customFields'
  );
}

export function defaultBoardLanes(template: BoardTemplateKind): BoardLaneInput[] {
  if (template === 'task_board') {
    return [
      { name: 'Backlog', kind: 'active' },
      { name: 'Ready', kind: 'active' },
      { name: 'Doing', kind: 'active' },
      { name: 'Review', kind: 'active' },
      { name: 'Done', kind: 'done' },
      { name: 'Blocked', kind: 'blocked' },
    ];
  }
  if (template === 'pipeline') {
    return [
      { name: 'New', kind: 'active' },
      { name: 'Qualified', kind: 'active' },
      { name: 'Scoping', kind: 'active' },
      { name: 'Proposal', kind: 'active' },
      { name: 'Committed', kind: 'done' },
      { name: 'Active', kind: 'active' },
      { name: 'Won', kind: 'terminal' },
      { name: 'Lost', kind: 'lost' },
    ];
  }
  if (template === 'catalog') {
    return [
      { name: 'Idea', kind: 'active' },
      { name: 'Evaluating', kind: 'active' },
      { name: 'Active', kind: 'active' },
      { name: 'Deprecated', kind: 'terminal' },
    ];
  }
  return [
    { name: 'Todo', kind: 'active' },
    { name: 'Doing', kind: 'active' },
    { name: 'Done', kind: 'done' },
  ];
}

export function createBoardScope({
  db,
  scope,
  objects,
}: {
  db: Db;
  scope: TeamScopeCore;
  objects: { createObject(input: CreateObjectInput): Promise<ObjectRow> };
}) {
  async function requireBoard(boardId: string): Promise<BoardSelect> {
    if (!UUID_RE.test(boardId)) throw new Error('Invalid board id');
    await scope.requireMembership();
    const rows = await db
      .select()
      .from(boards)
      .where(
        and(eq(boards.id, boardId), eq(boards.teamId, scope.teamId), isNull(boards.archivedAt)),
      )
      .limit(1);
    const row = rows[0];
    if (!row) throw new Error('Board not found');
    return row;
  }

  async function requireObject(entityId: string): Promise<EntitySelect> {
    if (!UUID_RE.test(entityId)) throw new Error('Invalid object id');
    const rows = await db
      .select()
      .from(entities)
      .where(and(eq(entities.id, entityId), eq(entities.teamId, scope.teamId)))
      .limit(1);
    const row = rows[0];
    if (!row) throw new Error('Object not in this team');
    return row;
  }

  async function requireLane(boardId: string, laneId: string | null | undefined) {
    if (laneId === null || laneId === undefined) return null;
    if (!UUID_RE.test(laneId)) throw new Error('Invalid lane id');
    const rows = await db
      .select()
      .from(boardLanes)
      .where(
        and(
          eq(boardLanes.id, laneId),
          eq(boardLanes.boardId, boardId),
          eq(boardLanes.teamId, scope.teamId),
          isNull(boardLanes.archivedAt),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) throw new Error('Lane not on this board');
    return row;
  }

  async function touchBoard(boardId: string, query: DbOrTx = db, at = new Date()): Promise<void> {
    await query
      .update(boards)
      .set({ updatedAt: at })
      .where(
        and(eq(boards.id, boardId), eq(boards.teamId, scope.teamId), isNull(boards.archivedAt)),
      );
  }

  async function writeChange(input: {
    tx?: DbOrTx;
    boardId: string;
    boardItemId?: string | null;
    entityId: string;
    actor: { kind: ActorKind; userId?: string | null };
    status?: BoardItemChangeStatus;
    field: BoardItemField;
    previousValue?: unknown;
    newValue?: unknown;
    suggestionItemId?: string | null;
    note?: string | null;
  }): Promise<BoardItemChangeRow> {
    const query = input.tx ?? db;
    const rows = await query
      .insert(boardItemChanges)
      .values({
        teamId: scope.teamId,
        boardId: input.boardId,
        boardItemId: input.boardItemId ?? null,
        entityId: input.entityId,
        actorKind: input.actor.kind,
        actorUserId: input.actor.userId ?? null,
        status: input.status ?? 'applied',
        field: input.field,
        previousValue: input.previousValue ?? null,
        newValue: input.newValue ?? null,
        sourceEventId: null,
        suggestionItemId: input.suggestionItemId ?? null,
        note: input.note ?? null,
      })
      .returning();
    const row = rows[0];
    if (!row) throw new Error('Failed to write board history');
    return toBoardItemChangeRow(row);
  }

  async function itemWithObject(itemId: string, query: DbOrTx = db): Promise<BoardItemRow | null> {
    const rows = await query
      .select({ item: boardItems, object: entities })
      .from(boardItems)
      .innerJoin(entities, eq(boardItems.entityId, entities.id))
      .where(and(eq(boardItems.id, itemId), eq(boardItems.teamId, scope.teamId)))
      .limit(1);
    const row = rows[0];
    return row ? toItemRow(row.item, row.object) : null;
  }

  function boardItemSearchTokens(query: string): string[] {
    return query
      .toLowerCase()
      .replace(/['"]/g, '')
      .split(/[^\p{L}\p{N}]+/u)
      .map((token) => token.trim())
      .filter(Boolean)
      .slice(0, 8);
  }

  function boardItemTokenSearchCondition(token: string): SQL {
    const exact = token.toLowerCase();
    const prefix = `${exact.replace(/[\\%_]/g, (match) => `\\${match}`)}%`;
    const contains = likePattern(exact);
    return sql`(
      lower(${entities.canonicalName}) = ${exact}
      OR lower(${entities.canonicalName}) LIKE ${prefix} ESCAPE '\\'
      OR lower(${entities.type}::text) = ${exact}
      OR lower(${entities.status}) = ${exact}
      OR lower(coalesce(${entities.stage}, '')) = ${exact}
      OR lower(coalesce(${boardItems.nextStep}, '')) LIKE ${contains} ESCAPE '\\'
      OR lower(coalesce(${boardItems.notes}, '')) LIKE ${contains} ESCAPE '\\'
      OR lower(${boardItems.customFields}::text) LIKE ${contains} ESCAPE '\\'
      OR lower(${entities.metadata}::text) LIKE ${contains} ESCAPE '\\'
      OR EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(${entities.aliases}) AS alias(value)
        WHERE lower(alias.value) = ${exact}
          OR lower(alias.value) LIKE ${prefix} ESCAPE '\\'
      )
    )`;
  }

  function boardItemTextSearchCondition(query: string | undefined): SQL | undefined {
    const tokens = boardItemSearchTokens(query?.trim() ?? '');
    if (tokens.length === 0) return undefined;
    return and(...tokens.map(boardItemTokenSearchCondition));
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

  function boardItemObjectFilterConditions(filter: ObjectCountFilter | undefined): SQL[] {
    if (!filter) return [];
    const conds: SQL[] = [];

    const types = toArray(filter.type);
    if (types && types.length > 0) conds.push(inArray(entities.type, types));

    const statuses = toArray(filter.status);
    if (statuses && statuses.length > 0) conds.push(inArray(entities.status, statuses));

    const excludedStatuses = toArray(filter.statusNot);
    if (excludedStatuses && excludedStatuses.length > 0) {
      conds.push(notInArray(entities.status, excludedStatuses));
    }

    const stages = toArray(filter.stage);
    if (stages && stages.length > 0) conds.push(inArray(entities.stage, stages));

    const priorities = toArray(filter.priority);
    if (filter.priorityNull) conds.push(isNull(entities.priority));
    else if (priorities && priorities.length > 0)
      conds.push(inArray(entities.priority, priorities));

    const ownerCondition = nullableUuidCondition(entities.ownerUserId, filter.ownerUserId);
    if (ownerCondition) conds.push(ownerCondition);

    const assigneeCondition = nullableUuidCondition(entities.assigneeUserId, filter.assigneeUserId);
    if (assigneeCondition) conds.push(assigneeCondition);

    if (filter.dueNull) conds.push(isNull(entities.dueAt));
    if (filter.dueBefore) conds.push(lt(entities.dueAt, filter.dueBefore));
    if (filter.dueAfter) conds.push(gte(entities.dueAt, filter.dueAfter));
    if (filter.createdBefore) conds.push(lt(entities.createdAt, filter.createdBefore));
    if (filter.createdAfter) conds.push(gte(entities.createdAt, filter.createdAfter));
    if (filter.updatedBefore) conds.push(lt(entities.updatedAt, filter.updatedBefore));
    if (filter.updatedAfter) conds.push(gte(entities.updatedAt, filter.updatedAfter));

    if (filter.archived === true) conds.push(isNotNull(entities.archivedAt));
    else if (filter.archived !== undefined) conds.push(isNull(entities.archivedAt));

    const textCondition = boardItemTextSearchCondition(filter.query);
    if (textCondition) conds.push(textCondition);

    return conds;
  }

  function boardItemFilterConditions(filter: BoardItemFilter | undefined): SQL[] {
    if (!filter) return [];
    const conds: SQL[] = [];

    const laneCondition = nullableUuidCondition(boardItems.laneId, filter.laneId);
    if (laneCondition) conds.push(laneCondition);

    const responsibleCondition = nullableUuidCondition(
      boardItems.responsibleUserId,
      filter.responsibleUserId,
    );
    if (responsibleCondition) conds.push(responsibleCondition);

    const priorities = toArray(filter.priority);
    if (filter.priorityNull) conds.push(isNull(boardItems.priority));
    else if (priorities && priorities.length > 0)
      conds.push(inArray(boardItems.priority, priorities));

    if (filter.dueNull) conds.push(isNull(boardItems.dueAt));
    if (filter.dueBefore) conds.push(lt(boardItems.dueAt, filter.dueBefore));
    if (filter.dueAfter) conds.push(gte(boardItems.dueAt, filter.dueAfter));
    if (filter.createdBefore) conds.push(lt(boardItems.createdAt, filter.createdBefore));
    if (filter.createdAfter) conds.push(gte(boardItems.createdAt, filter.createdAfter));
    if (filter.updatedBefore) conds.push(lt(boardItems.updatedAt, filter.updatedBefore));
    if (filter.updatedAfter) conds.push(gte(boardItems.updatedAt, filter.updatedAfter));

    const textCondition = boardItemTextSearchCondition(filter.query);
    if (textCondition) conds.push(textCondition);

    conds.push(...boardItemObjectFilterConditions(filter.object));
    return conds;
  }

  async function refreshBoardDueDateMetadata(
    query: DbOrTx,
    board: BoardSelect,
  ): Promise<DueDateCalendarSyncResult> {
    const rows = await query
      .select({ item: boardItems, object: entities })
      .from(boardItems)
      .innerJoin(entities, eq(boardItems.entityId, entities.id))
      .where(
        and(
          eq(boardItems.teamId, scope.teamId),
          eq(boardItems.boardId, board.id),
          isNull(boardItems.archivedAt),
          isNotNull(boardItems.dueAt),
        ),
      );
    const results: DueDateCalendarSyncResult[] = [];
    for (const row of rows) {
      results.push(await syncBoardItemDueDateCalendarEvent(query, row.item, row.object, board));
      await notifyBoardItemDueDate(query, row.item, row.object, board, { kind: 'system' });
    }
    return mergeDueDateCalendarSyncResults(results);
  }

  const api = {
    async listBoards(): Promise<BoardRow[]> {
      await scope.requireMembership();
      const [boardRows, countRows, pinRows] = await Promise.all([
        db
          .select()
          .from(boards)
          .where(and(eq(boards.teamId, scope.teamId), isNull(boards.archivedAt)))
          .orderBy(desc(boards.updatedAt)),
        db
          .select({ boardId: boardItems.boardId, count: sql<number>`count(*)::int` })
          .from(boardItems)
          .where(and(eq(boardItems.teamId, scope.teamId), isNull(boardItems.archivedAt)))
          .groupBy(boardItems.boardId),
        db
          .select({ boardId: boardPins.boardId })
          .from(boardPins)
          .where(and(eq(boardPins.teamId, scope.teamId), eq(boardPins.userId, scope.userId))),
      ]);
      const counts = new Map(countRows.map((row) => [row.boardId, row.count]));
      const pins = new Set(pinRows.map((row) => row.boardId));
      return boardRows.map((row) => toBoardRow(row, counts, pins));
    },

    async getBoard(boardId: string, options: BoardReadOptions = {}): Promise<BoardDetail | null> {
      await scope.requireMembership();
      if (!UUID_RE.test(boardId)) return null;
      const itemLimit =
        options.itemLimit === 'all'
          ? 'all'
          : options.itemLimit === undefined || !Number.isFinite(options.itemLimit)
            ? BOARD_ITEM_QUERY_LIMIT_MAX
            : Math.max(0, Math.min(Math.floor(options.itemLimit), BOARD_ITEM_QUERY_LIMIT_MAX));
      const boardRows = await db
        .select()
        .from(boards)
        .where(
          and(eq(boards.id, boardId), eq(boards.teamId, scope.teamId), isNull(boards.archivedAt)),
        )
        .limit(1);
      const board = boardRows[0];
      if (!board) return null;
      const itemFilterConditions = boardItemFilterConditions(options.itemFilter);
      const itemsQuery = db
        .select({ item: boardItems, object: entities })
        .from(boardItems)
        .innerJoin(entities, eq(boardItems.entityId, entities.id))
        .where(
          and(
            eq(boardItems.boardId, boardId),
            eq(boardItems.teamId, scope.teamId),
            isNull(boardItems.archivedAt),
            ...itemFilterConditions,
          ),
        )
        .orderBy(asc(boardItems.position), asc(boardItems.createdAt));
      const [lanes, rows, countRows, pins] = await Promise.all([
        db
          .select()
          .from(boardLanes)
          .where(
            and(
              eq(boardLanes.boardId, boardId),
              eq(boardLanes.teamId, scope.teamId),
              isNull(boardLanes.archivedAt),
            ),
          )
          .orderBy(asc(boardLanes.position), asc(boardLanes.createdAt)),
        itemLimit === 'all' ? itemsQuery : itemsQuery.limit(itemLimit),
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(boardItems)
          .innerJoin(entities, eq(boardItems.entityId, entities.id))
          .where(
            and(
              eq(boardItems.boardId, boardId),
              eq(boardItems.teamId, scope.teamId),
              isNull(boardItems.archivedAt),
              ...itemFilterConditions,
            ),
          ),
        db
          .select({ boardId: boardPins.boardId })
          .from(boardPins)
          .where(
            and(
              eq(boardPins.teamId, scope.teamId),
              eq(boardPins.userId, scope.userId),
              eq(boardPins.boardId, boardId),
            ),
          ),
      ]);
      return {
        ...toBoardRow(
          board,
          new Map([[boardId, countRows[0]?.count ?? rows.length]]),
          new Set(pins.map((pin) => pin.boardId)),
        ),
        lanes: lanes.map(toLaneRow),
        items: rows.map((row) => toItemRow(row.item, row.object)),
      };
    },

    async getBoardItem(itemId: string): Promise<BoardItemRow | null> {
      await scope.requireMembership();
      if (!UUID_RE.test(itemId)) return null;
      const item = await itemWithObject(itemId);
      return item && !item.archivedAt ? item : null;
    },

    async createBoard(input: CreateBoardInput): Promise<BoardDetail> {
      await scope.requireMembership();
      const name = normalizeName(input.name, 'Board name');
      const templateKind = BOARD_TEMPLATES.includes(input.templateKind)
        ? input.templateKind
        : 'custom';
      const lanes = (input.lanes.length > 0 ? input.lanes : defaultBoardLanes(templateKind)).map(
        (lane, idx) => ({
          name: normalizeName(lane.name, 'Lane name'),
          kind: lane.kind ?? null,
          position: idx,
        }),
      );
      return db.transaction(async (tx) => {
        const boardRows = await tx
          .insert(boards)
          .values({
            teamId: scope.teamId,
            createdBy: scope.userId,
            name,
            purpose: input.purpose?.trim() ?? '',
            templateKind,
            recommendedObjectTypes: input.recommendedObjectTypes ?? [],
            strictObjectTypes: input.strictObjectTypes ?? false,
            candidateFilter: input.candidateFilter ?? {},
            isShared: input.isShared ?? true,
          })
          .returning();
        const board = boardRows[0];
        if (!board) throw new Error('Failed to create board');
        const laneRows = await tx
          .insert(boardLanes)
          .values(
            lanes.map((lane) => ({
              teamId: scope.teamId,
              boardId: board.id,
              name: lane.name,
              kind: lane.kind,
              position: lane.position,
            })),
          )
          .returning();
        return {
          ...toBoardRow(board, new Map([[board.id, 0]]), new Set()),
          lanes: laneRows.map(toLaneRow),
          items: [],
        };
      });
    },

    async archiveBoard(boardId: string): Promise<boolean> {
      await requireBoard(boardId);
      const now = new Date();
      const txResult = await db.transaction(async (tx) => {
        const updatedRows = await tx
          .update(boards)
          .set({ archivedAt: now, updatedAt: now })
          .where(and(eq(boards.id, boardId), eq(boards.teamId, scope.teamId)))
          .returning();
        const archivedBoard = updatedRows[0];
        if (!archivedBoard)
          return { rows: [], dueDateCalendarSync: mergeDueDateCalendarSyncResults([]) };
        const itemRows = await tx
          .select({ item: boardItems, object: entities })
          .from(boardItems)
          .innerJoin(entities, eq(boardItems.entityId, entities.id))
          .where(
            and(
              eq(boardItems.boardId, boardId),
              eq(boardItems.teamId, scope.teamId),
              isNull(boardItems.archivedAt),
            ),
          );
        const dueDateCalendarSyncResults: DueDateCalendarSyncResult[] = [];
        for (const row of itemRows) {
          dueDateCalendarSyncResults.push(
            await syncBoardItemDueDateCalendarEvent(tx, row.item, row.object, archivedBoard),
          );
        }
        return {
          rows: updatedRows,
          dueDateCalendarSync: mergeDueDateCalendarSyncResults(dueDateCalendarSyncResults),
        };
      });
      await afterDueDateCalendarSync(scope.teamId, txResult.dueDateCalendarSync);
      return txResult.rows.length > 0;
    },

    async renameBoard(input: RenameBoardInput): Promise<boolean> {
      await requireBoard(input.id);
      const txResult = await db.transaction(async (tx) => {
        const rows = await tx
          .update(boards)
          .set({ name: normalizeName(input.name, 'Board name'), updatedAt: new Date() })
          .where(
            and(
              eq(boards.id, input.id),
              eq(boards.teamId, scope.teamId),
              isNull(boards.archivedAt),
            ),
          )
          .returning();
        const board = rows[0];
        if (!board) {
          return { renamed: false, dueDateCalendarSync: mergeDueDateCalendarSyncResults([]) };
        }
        return {
          renamed: true,
          dueDateCalendarSync: await refreshBoardDueDateMetadata(tx, board),
        };
      });
      await afterDueDateCalendarSync(scope.teamId, txResult.dueDateCalendarSync);
      return txResult.renamed;
    },

    async updateBoardSettings(input: UpdateBoardSettingsInput): Promise<boolean> {
      await requireBoard(input.id);
      const nextLanes = input.lanes?.map((lane, idx) => ({
        id: lane.id,
        name: normalizeName(lane.name, 'Lane name'),
        kind: lane.kind ?? null,
        position: idx,
      }));
      if (nextLanes?.length === 0) throw new Error('At least one lane is required');
      if (nextLanes && nextLanes.length > 16) throw new Error('Too many lanes');

      const currentLanes = nextLanes
        ? await db
            .select()
            .from(boardLanes)
            .where(
              and(
                eq(boardLanes.boardId, input.id),
                eq(boardLanes.teamId, scope.teamId),
                isNull(boardLanes.archivedAt),
              ),
            )
        : [];
      const currentLaneIds = new Set(currentLanes.map((lane) => lane.id));
      const keptLaneIds = new Set(nextLanes?.flatMap((lane) => (lane.id ? [lane.id] : [])) ?? []);
      for (const lane of nextLanes ?? []) {
        if (lane.id && !currentLaneIds.has(lane.id)) throw new Error('Lane not on this board');
      }
      const removedLaneIds = currentLanes
        .map((lane) => lane.id)
        .filter((laneId) => !keptLaneIds.has(laneId));

      const dueDateCalendarSync = await db.transaction(async (tx) => {
        const now = new Date();
        const boardPatch: Partial<typeof boards.$inferInsert> = { updatedAt: now };
        if (input.name !== undefined) boardPatch.name = normalizeName(input.name, 'Board name');
        if (input.purpose !== undefined) boardPatch.purpose = input.purpose.trim();
        const [updatedBoard] = await tx
          .update(boards)
          .set(boardPatch)
          .where(
            and(
              eq(boards.id, input.id),
              eq(boards.teamId, scope.teamId),
              isNull(boards.archivedAt),
            ),
          )
          .returning();

        for (const lane of nextLanes ?? []) {
          if (lane.id) {
            await tx
              .update(boardLanes)
              .set({
                name: lane.name,
                kind: lane.kind,
                position: lane.position,
                updatedAt: now,
              })
              .where(
                and(
                  eq(boardLanes.id, lane.id),
                  eq(boardLanes.boardId, input.id),
                  eq(boardLanes.teamId, scope.teamId),
                  isNull(boardLanes.archivedAt),
                ),
              );
          } else {
            await tx.insert(boardLanes).values({
              teamId: scope.teamId,
              boardId: input.id,
              name: lane.name,
              kind: lane.kind,
              position: lane.position,
            });
          }
        }

        if (removedLaneIds.length > 0) {
          await tx
            .update(boardLanes)
            .set({ archivedAt: now, updatedAt: now })
            .where(
              and(
                eq(boardLanes.boardId, input.id),
                eq(boardLanes.teamId, scope.teamId),
                inArray(boardLanes.id, removedLaneIds),
                isNull(boardLanes.archivedAt),
              ),
            );
          await tx
            .update(boardItems)
            .set({ laneId: null, updatedAt: now })
            .where(
              and(
                eq(boardItems.boardId, input.id),
                eq(boardItems.teamId, scope.teamId),
                inArray(boardItems.laneId, removedLaneIds),
                isNull(boardItems.archivedAt),
              ),
            );
        }
        return input.name !== undefined && updatedBoard
          ? refreshBoardDueDateMetadata(tx, updatedBoard)
          : mergeDueDateCalendarSyncResults([]);
      });
      await afterDueDateCalendarSync(scope.teamId, dueDateCalendarSync);
      return true;
    },

    async addBoardItem(boardId: string, input: AddBoardItemInput): Promise<BoardItemRow> {
      const board = await requireBoard(boardId);
      const object = await requireObject(input.entityId);
      await requireLane(boardId, input.laneId);
      if (input.responsibleUserId) await scope.requireTeamMember(input.responsibleUserId);
      const txResult = await db.transaction(async (tx) => {
        const rows = await tx
          .insert(boardItems)
          .values({
            teamId: scope.teamId,
            boardId,
            entityId: input.entityId,
            laneId: input.laneId ?? null,
            position: input.position ?? 0,
            responsibleUserId: input.responsibleUserId ?? null,
            dueAt: input.dueAt ?? null,
            priority: input.priority ?? null,
            nextStep: input.nextStep ?? null,
            notes: input.notes ?? null,
            customFields: input.customFields ?? {},
          })
          .returning();
        const item = rows[0];
        if (!item) throw new Error('Failed to add board item');
        await writeChange({
          tx,
          boardId,
          boardItemId: item.id,
          entityId: item.entityId,
          actor: input.actor,
          field: '__add__',
          newValue: { boardId, entityId: item.entityId, laneId: item.laneId },
        });
        const sourceEventId = await createBoardSystemRawEvent({
          db: tx,
          teamId: scope.teamId,
          actor: input.actor,
          boardId,
          boardName: board.name,
          boardItemId: item.id,
          entityId: item.entityId,
          entityName: object.canonicalName,
          eventKind: 'board_item_add',
          contentText: `Added ${object.canonicalName} to board ${board.name}`,
          metadata: {
            lane_id: item.laneId,
            position: item.position,
            responsible_user_id: item.responsibleUserId,
            due_at: item.dueAt?.toISOString() ?? null,
            priority: item.priority,
            next_step: item.nextStep,
            notes: item.notes,
            custom_fields: item.customFields,
          },
        });
        await emitBoardDirectWriteOutput({
          db: tx,
          teamId: scope.teamId,
          boardId,
          boardItemId: item.id,
          entityId: item.entityId,
          actor: input.actor,
          sourceEventId,
          targetKind: 'board_membership',
          operation: 'create',
          systemEventKind: 'board_item_add',
          payload: {
            lane_id: item.laneId,
            position: item.position,
            responsible_user_id: item.responsibleUserId,
            due_at: item.dueAt?.toISOString() ?? null,
            priority: item.priority,
          },
        });
        await touchBoard(boardId, tx);
        const dueDateCalendarSync = await syncBoardItemDueDateCalendarEvent(
          tx,
          item,
          object,
          board,
        );
        await notifyBoardItemDueDate(tx, item, object, board, input.actor);
        return { item: toItemRow(item, object), dueDateCalendarSync };
      });
      await afterDueDateCalendarSync(scope.teamId, txResult.dueDateCalendarSync);
      return txResult.item;
    },

    async createObjectAndAddBoardItem(
      boardId: string,
      objectInput: Omit<CreateObjectInput, 'actor'>,
      itemInput: Omit<AddBoardItemInput, 'entityId' | 'actor'> & {
        actor: { kind: ActorKind; userId?: string | null };
      },
    ): Promise<BoardItemRow> {
      await requireBoard(boardId);
      await requireLane(boardId, itemInput.laneId);
      const created = await objects.createObject({ ...objectInput, actor: itemInput.actor });
      return api.addBoardItem(boardId, { ...itemInput, entityId: created.id });
    },

    async updateBoardItem(
      itemId: string,
      patch: BoardItemPatch,
      actor: { kind: ActorKind; userId?: string | null },
    ): Promise<BoardItemRow | null> {
      if (!UUID_RE.test(itemId)) return null;
      const current = await itemWithObject(itemId);
      if (!current || current.archivedAt) return null;
      const board = await requireBoard(current.boardId);
      if (patch.laneId !== undefined) await requireLane(current.boardId, patch.laneId);
      if (patch.responsibleUserId) await scope.requireTeamMember(patch.responsibleUserId);
      const nextEntries: [keyof BoardItemPatch, unknown][] = [
        ['laneId', patch.laneId],
        ['position', patch.position],
        ['responsibleUserId', patch.responsibleUserId],
        ['dueAt', patch.dueAt],
        ['priority', patch.priority],
        ['nextStep', patch.nextStep],
        ['notes', patch.notes],
        ['customFields', patch.customFields],
      ];
      const changed = nextEntries.filter(([key, value]) => {
        if (value === undefined) return false;
        return !stableEqual(current[key], value);
      });
      if (changed.length === 0) return current;
      const dueDateCalendarSync = await db.transaction(async (tx) => {
        const now = new Date();
        const updatedRows = await tx
          .update(boardItems)
          .set({
            ...(patch.laneId !== undefined ? { laneId: patch.laneId } : {}),
            ...(patch.position !== undefined ? { position: patch.position } : {}),
            ...(patch.responsibleUserId !== undefined
              ? { responsibleUserId: patch.responsibleUserId }
              : {}),
            ...(patch.dueAt !== undefined ? { dueAt: patch.dueAt } : {}),
            ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
            ...(patch.nextStep !== undefined ? { nextStep: patch.nextStep } : {}),
            ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
            ...(patch.customFields !== undefined ? { customFields: patch.customFields } : {}),
            updatedAt: now,
          })
          .where(
            and(
              eq(boardItems.id, itemId),
              eq(boardItems.teamId, scope.teamId),
              isNull(boardItems.archivedAt),
            ),
          )
          .returning();
        const updated = updatedRows[0];
        if (!updated) throw new Error('Board item not found');
        await Promise.all(
          changed.map(([field, value]) =>
            writeChange({
              tx,
              boardId: current.boardId,
              boardItemId: current.id,
              entityId: current.entityId,
              actor,
              field,
              previousValue: current[field],
              newValue: value,
            }),
          ),
        );
        const boardChanges = changed.map(([field, value]) => ({
          field,
          previousValue: current[field],
          newValue: value,
        }));
        const changedFields = boardChanges.map((change) => change.field);
        const sourceEventId = await createBoardSystemRawEvent({
          db: tx,
          teamId: scope.teamId,
          actor,
          boardId: current.boardId,
          boardName: board.name,
          boardItemId: current.id,
          entityId: current.entityId,
          entityName: current.object.canonicalName,
          eventKind: 'board_item_update',
          contentText: `Updated ${current.object.canonicalName} on board ${board.name}: ${changedFields.join(', ')}`,
          metadata: {
            changed_fields: changedFields,
            changes: boardChanges,
          },
        });
        await emitBoardDirectWriteOutput({
          db: tx,
          teamId: scope.teamId,
          boardId: current.boardId,
          boardItemId: current.id,
          entityId: current.entityId,
          actor,
          sourceEventId,
          targetKind: 'board_item_update',
          operation: 'update',
          systemEventKind: 'board_item_update',
          changedFields,
          changes: boardChanges,
        });
        await touchBoard(current.boardId, tx, now);
        const result = await syncBoardItemDueDateCalendarEvent(tx, updated, current.object, board);
        if (changed.some(([field]) => field === 'dueAt' || field === 'responsibleUserId')) {
          await notifyBoardItemDueDate(tx, updated, current.object, board, actor);
        }
        return result;
      });
      await afterDueDateCalendarSync(scope.teamId, dueDateCalendarSync);
      return itemWithObject(itemId);
    },

    async removeBoardItem(
      itemId: string,
      actor: { kind: ActorKind; userId?: string | null },
    ): Promise<BoardItemRow | null> {
      if (!UUID_RE.test(itemId)) return null;
      const current = await itemWithObject(itemId);
      if (!current || current.archivedAt) return null;
      const board = await requireBoard(current.boardId);
      const now = new Date();
      const dueDateCalendarSync = await db.transaction(async (tx) => {
        const updated = await tx
          .update(boardItems)
          .set({ archivedAt: now, updatedAt: now })
          .where(
            and(
              eq(boardItems.id, itemId),
              eq(boardItems.teamId, scope.teamId),
              isNull(boardItems.archivedAt),
            ),
          )
          .returning({ id: boardItems.id });
        if (updated.length === 0) throw new Error('Board item not found');
        await writeChange({
          tx,
          boardId: current.boardId,
          boardItemId: current.id,
          entityId: current.entityId,
          actor,
          field: '__remove__',
          previousValue: { boardId: current.boardId, laneId: current.laneId },
        });
        const sourceEventId = await createBoardSystemRawEvent({
          db: tx,
          teamId: scope.teamId,
          actor,
          boardId: current.boardId,
          boardName: board.name,
          boardItemId: current.id,
          entityId: current.entityId,
          entityName: current.object.canonicalName,
          eventKind: 'board_item_remove',
          contentText: `Removed ${current.object.canonicalName} from board ${board.name}`,
          metadata: {
            previous_lane_id: current.laneId,
            archived_at: now.toISOString(),
          },
        });
        await emitBoardDirectWriteOutput({
          db: tx,
          teamId: scope.teamId,
          boardId: current.boardId,
          boardItemId: current.id,
          entityId: current.entityId,
          actor,
          sourceEventId,
          targetKind: 'board_membership',
          operation: 'archive_or_cancel',
          systemEventKind: 'board_item_remove',
          payload: {
            previous_lane_id: current.laneId,
            archived_at: now.toISOString(),
          },
        });
        await touchBoard(current.boardId, tx, now);
        return syncBoardItemDueDateCalendarEvent(
          tx,
          { ...current, teamId: scope.teamId, archivedAt: now },
          current.object,
          board,
        );
      });
      await afterDueDateCalendarSync(scope.teamId, dueDateCalendarSync);
      return { ...current, archivedAt: now };
    },

    async listBoardItemHistory(itemId: string): Promise<BoardItemChangeRow[]> {
      await scope.requireMembership();
      if (!UUID_RE.test(itemId)) return [];
      const rows = await db
        .select()
        .from(boardItemChanges)
        .where(
          and(eq(boardItemChanges.boardItemId, itemId), eq(boardItemChanges.teamId, scope.teamId)),
        )
        .orderBy(desc(boardItemChanges.changedAt));
      return enrichBoardItemHistoryEvidence(db, scope, rows.map(toBoardItemChangeRow));
    },

    async listObjectBoardContext(entityId: string): Promise<ObjectBoardContextRow[]> {
      await requireObject(entityId);
      const rows = await db
        .select({ board: boards, item: boardItems, lane: boardLanes })
        .from(boardItems)
        .innerJoin(boards, eq(boardItems.boardId, boards.id))
        .leftJoin(boardLanes, eq(boardItems.laneId, boardLanes.id))
        .where(
          and(
            eq(boardItems.teamId, scope.teamId),
            eq(boardItems.entityId, entityId),
            isNull(boardItems.archivedAt),
            isNull(boards.archivedAt),
          ),
        )
        .orderBy(desc(boardItems.updatedAt));
      return rows.map((row) => ({
        boardId: row.board.id,
        boardName: row.board.name,
        templateKind: row.board.templateKind,
        purpose: row.board.purpose,
        itemId: row.item.id,
        laneId: row.item.laneId,
        laneName: row.lane?.name ?? null,
        responsibleUserId: row.item.responsibleUserId,
        dueAt: row.item.dueAt,
        priority: row.item.priority,
      }));
    },

    async listWorkQueueItems(options: BoardWorkQueueOptions): Promise<BoardWorkQueueItemRow[]> {
      await scope.requireMembership();
      const limit = Math.min(Math.max(options.limit ?? 100, 1), BOARD_ITEM_QUERY_LIMIT_MAX);
      const rows = await db
        .select({ board: boards, item: boardItems, lane: boardLanes, object: entities })
        .from(boardItems)
        .innerJoin(boards, eq(boardItems.boardId, boards.id))
        .innerJoin(entities, eq(boardItems.entityId, entities.id))
        .leftJoin(boardLanes, eq(boardItems.laneId, boardLanes.id))
        .where(
          and(
            eq(boardItems.teamId, scope.teamId),
            eq(boards.teamId, scope.teamId),
            eq(entities.teamId, scope.teamId),
            isNull(boardItems.archivedAt),
            isNull(boards.archivedAt),
            isNull(entities.archivedAt),
            isNull(entities.mergedIntoId),
            sql`lower(${entities.status}) not in ('done', 'cancelled', 'canceled', 'shipped')`,
            or(
              eq(boardItems.responsibleUserId, scope.userId),
              and(
                isNull(boardItems.responsibleUserId),
                sql`${boardItems.dueAt} IS NOT NULL`,
                sql`${boardItems.dueAt} <= ${options.dueBefore.toISOString()}::timestamptz`,
              ),
            ),
          ),
        )
        .orderBy(
          sql`case when ${boardItems.responsibleUserId} = ${scope.userId} then 0 else 1 end asc`,
          sql`(${boardItems.dueAt} is not null) desc`,
          asc(boardItems.dueAt),
          desc(boardItems.updatedAt),
        )
        .limit(limit);
      return rows.map((row) => ({
        id: row.item.id,
        boardId: row.board.id,
        boardName: row.board.name,
        laneId: row.item.laneId,
        laneName: row.lane?.name ?? null,
        laneKind: row.lane?.kind ?? null,
        entityId: row.item.entityId,
        responsibleUserId: row.item.responsibleUserId,
        dueAt: row.item.dueAt,
        priority: row.item.priority,
        nextStep: row.item.nextStep,
        updatedAt: row.item.updatedAt,
        object: toObjectRow(row.object),
      }));
    },

    async listPinnedBoards(): Promise<BoardRow[]> {
      await scope.requireMembership();
      const rows = await db
        .select({ board: boards, pin: boardPins })
        .from(boardPins)
        .innerJoin(boards, eq(boardPins.boardId, boards.id))
        .where(
          and(
            eq(boardPins.teamId, scope.teamId),
            eq(boardPins.userId, scope.userId),
            isNull(boards.archivedAt),
          ),
        )
        .orderBy(asc(boardPins.position), desc(boards.updatedAt));
      if (rows.length === 0) return [];
      const boardIds = rows.map((row) => row.board.id);
      const now = new Date();
      const soon = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      const nowIso = now.toISOString();
      const soonIso = soon.toISOString();
      const [countRows, laneRows, dueRows] = await Promise.all([
        db
          .select({ boardId: boardItems.boardId, count: sql<number>`count(*)::int` })
          .from(boardItems)
          .innerJoin(entities, eq(boardItems.entityId, entities.id))
          .where(
            and(
              eq(boardItems.teamId, scope.teamId),
              inArray(boardItems.boardId, boardIds),
              isNull(boardItems.archivedAt),
              isNull(entities.archivedAt),
            ),
          )
          .groupBy(boardItems.boardId),
        db
          .select({
            boardId: boardItems.boardId,
            laneId: boardItems.laneId,
            laneName: sql<string>`COALESCE(${boardLanes.name}, 'Unset')`,
            count: sql<number>`count(*)::int`,
          })
          .from(boardItems)
          .leftJoin(boardLanes, eq(boardItems.laneId, boardLanes.id))
          .innerJoin(entities, eq(boardItems.entityId, entities.id))
          .where(
            and(
              eq(boardItems.teamId, scope.teamId),
              inArray(boardItems.boardId, boardIds),
              isNull(boardItems.archivedAt),
              isNull(entities.archivedAt),
            ),
          )
          .groupBy(boardItems.boardId, boardItems.laneId, boardLanes.name),
        db
          .select({
            boardId: boardItems.boardId,
            overdueCount: sql<number>`count(*) filter (where ${boardItems.dueAt} < ${nowIso}::timestamptz)::int`,
            dueSoonCount: sql<number>`count(*) filter (where ${boardItems.dueAt} >= ${nowIso}::timestamptz and ${boardItems.dueAt} <= ${soonIso}::timestamptz)::int`,
          })
          .from(boardItems)
          .innerJoin(entities, eq(boardItems.entityId, entities.id))
          .where(
            and(
              eq(boardItems.teamId, scope.teamId),
              inArray(boardItems.boardId, boardIds),
              isNull(boardItems.archivedAt),
              isNull(entities.archivedAt),
            ),
          )
          .groupBy(boardItems.boardId),
      ]);
      const counts = new Map(countRows.map((row) => [row.boardId, row.count]));
      const stats = new Map<
        string,
        Pick<BoardRow, 'laneCounts' | 'dueSoonCount' | 'overdueCount'>
      >();
      for (const row of laneRows) {
        const current = stats.get(row.boardId) ?? {
          laneCounts: [],
          dueSoonCount: 0,
          overdueCount: 0,
        };
        current.laneCounts.push({
          laneId: row.laneId,
          laneName: row.laneName,
          count: row.count,
        });
        stats.set(row.boardId, current);
      }
      for (const row of dueRows) {
        const current = stats.get(row.boardId) ?? {
          laneCounts: [],
          dueSoonCount: 0,
          overdueCount: 0,
        };
        current.dueSoonCount = row.dueSoonCount;
        current.overdueCount = row.overdueCount;
        stats.set(row.boardId, current);
      }
      return rows.map((row) => toBoardRow(row.board, counts, new Set([row.board.id]), stats));
    },

    async pinBoard(boardId: string): Promise<boolean> {
      await requireBoard(boardId);
      await db
        .insert(boardPins)
        .values({ teamId: scope.teamId, userId: scope.userId, boardId })
        .onConflictDoNothing();
      return true;
    },

    async unpinBoard(boardId: string): Promise<boolean> {
      await scope.requireMembership();
      const rows = await db
        .delete(boardPins)
        .where(
          and(
            eq(boardPins.teamId, scope.teamId),
            eq(boardPins.userId, scope.userId),
            eq(boardPins.boardId, boardId),
          ),
        )
        .returning({ boardId: boardPins.boardId });
      return rows.length > 0;
    },

    async proposeBoardMembership(input: {
      boardId: string;
      entityId: string;
      laneId?: string | null;
      /** Legacy disambiguation hint. New suggested board history cites suggestion evidence instead. */
      sourceEventId?: string | null;
      suggestionItemId?: string | null;
      note?: string | null;
    }): Promise<BoardItemChangeRow> {
      await requireBoard(input.boardId);
      await requireObject(input.entityId);
      await requireLane(input.boardId, input.laneId);
      return writeChange({
        boardId: input.boardId,
        entityId: input.entityId,
        actor: { kind: 'agent', userId: null },
        status: 'suggested',
        field: '__add__',
        newValue: {
          boardId: input.boardId,
          entityId: input.entityId,
          laneId: input.laneId ?? null,
        },
        suggestionItemId: input.suggestionItemId ?? null,
        note: input.note ?? null,
      });
    },

    async proposeBoardItemUpdate(input: {
      boardItemId: string;
      field: Exclude<BoardItemField, '__add__' | '__remove__'>;
      newValue: unknown;
      /** Legacy disambiguation hint. New suggested board history cites suggestion evidence instead. */
      sourceEventId?: string | null;
      suggestionItemId?: string | null;
      note?: string | null;
    }): Promise<BoardItemChangeRow> {
      const item = await itemWithObject(input.boardItemId);
      if (!item) throw new Error('Board item not found');
      patchFromSuggestedField(input.field, input.newValue);
      return writeChange({
        boardId: item.boardId,
        boardItemId: item.id,
        entityId: item.entityId,
        actor: { kind: 'agent', userId: null },
        status: 'suggested',
        field: input.field,
        previousValue: item[input.field],
        newValue: input.newValue,
        suggestionItemId: input.suggestionItemId ?? null,
        note: input.note ?? null,
      });
    },

    async acceptBoardItemChange(
      changeId: string,
      actor: { kind: ActorKind; userId?: string | null },
    ): Promise<string | null> {
      if (!UUID_RE.test(changeId)) return null;
      const rows = await db
        .select()
        .from(boardItemChanges)
        .where(
          and(
            eq(boardItemChanges.id, changeId),
            eq(boardItemChanges.teamId, scope.teamId),
            eq(boardItemChanges.status, 'suggested'),
          ),
        )
        .limit(1);
      const change = rows[0];
      if (!change) return null;
      await requireBoard(change.boardId);
      if (change.field === '__add__') {
        await requireObject(change.entityId);
        const laneId = jsonObject(change.newValue).laneId;
        const safeLaneId = typeof laneId === 'string' && UUID_RE.test(laneId) ? laneId : null;
        await requireLane(change.boardId, safeLaneId);
      } else if (isBoardItemPatchField(change.field)) {
        const patch = patchFromSuggestedField(change.field, change.newValue);
        if (patch.responsibleUserId) await scope.requireTeamMember(patch.responsibleUserId);
      } else {
        throw new Error('Unsupported board change field');
      }

      return db.transaction(async (tx) => {
        const [claimedChange] = await tx
          .update(boardItemChanges)
          .set({ status: 'applied' })
          .where(
            and(
              eq(boardItemChanges.id, change.id),
              eq(boardItemChanges.teamId, scope.teamId),
              eq(boardItemChanges.status, 'suggested'),
            ),
          )
          .returning();
        if (!claimedChange) return null;

        if (claimedChange.field === '__add__') {
          const existing = await tx
            .select({ id: boardItems.id })
            .from(boardItems)
            .where(
              and(
                eq(boardItems.teamId, scope.teamId),
                eq(boardItems.boardId, claimedChange.boardId),
                eq(boardItems.entityId, claimedChange.entityId),
                isNull(boardItems.archivedAt),
              ),
            )
            .limit(1);
          if (existing[0]) return existing[0].id;

          const laneId = jsonObject(claimedChange.newValue).laneId;
          const safeLaneId = typeof laneId === 'string' && UUID_RE.test(laneId) ? laneId : null;
          const [created] = await tx
            .insert(boardItems)
            .values({
              teamId: scope.teamId,
              boardId: claimedChange.boardId,
              entityId: claimedChange.entityId,
              laneId: safeLaneId,
            })
            .returning({ id: boardItems.id });
          if (!created) throw new Error('Failed to add board item');
          await tx
            .update(boardItemChanges)
            .set({ boardItemId: created.id })
            .where(
              and(
                eq(boardItemChanges.id, claimedChange.id),
                eq(boardItemChanges.teamId, scope.teamId),
              ),
            );
          await touchBoard(claimedChange.boardId, tx);
          return created.id;
        }

        if (!claimedChange.boardItemId || !isBoardItemPatchField(claimedChange.field)) {
          throw new Error('Unsupported board change field');
        }
        const current = await itemWithObject(claimedChange.boardItemId, tx);
        if (!current || current.archivedAt) throw new Error('Board item no longer active');
        const patch = patchFromSuggestedField(claimedChange.field, claimedChange.newValue);
        if (patch.laneId !== undefined) await requireLane(current.boardId, patch.laneId);
        const changed = Object.entries(patch).filter(([key, value]) => {
          const field = key as keyof BoardItemPatch;
          return !stableEqual(current[field], value);
        });
        if (changed.length === 0) return current.id;

        const now = new Date();
        const updated = await tx
          .update(boardItems)
          .set({
            ...(patch.laneId !== undefined ? { laneId: patch.laneId } : {}),
            ...(patch.position !== undefined ? { position: patch.position } : {}),
            ...(patch.responsibleUserId !== undefined
              ? { responsibleUserId: patch.responsibleUserId }
              : {}),
            ...(patch.dueAt !== undefined ? { dueAt: patch.dueAt } : {}),
            ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
            ...(patch.nextStep !== undefined ? { nextStep: patch.nextStep } : {}),
            ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
            ...(patch.customFields !== undefined ? { customFields: patch.customFields } : {}),
            updatedAt: now,
          })
          .where(
            and(
              eq(boardItems.id, current.id),
              eq(boardItems.teamId, scope.teamId),
              isNull(boardItems.archivedAt),
            ),
          )
          .returning({ id: boardItems.id });
        if (updated.length === 0) throw new Error('Board item no longer active');
        await Promise.all(
          changed.map(([field, value]) =>
            writeChange({
              tx,
              boardId: current.boardId,
              boardItemId: current.id,
              entityId: current.entityId,
              actor,
              field: field as BoardItemField,
              previousValue: current[field as keyof BoardItemPatch],
              newValue: value,
            }),
          ),
        );
        await touchBoard(current.boardId, tx, now);
        return current.id;
      });
    },

    async rejectBoardItemChange(changeId: string): Promise<boolean> {
      if (!UUID_RE.test(changeId)) return false;
      const rows = await db
        .update(boardItemChanges)
        .set({ status: 'rejected' })
        .where(
          and(
            eq(boardItemChanges.id, changeId),
            eq(boardItemChanges.teamId, scope.teamId),
            eq(boardItemChanges.status, 'suggested'),
          ),
        )
        .returning({ id: boardItemChanges.id });
      return rows.length > 0;
    },
  };
  return api;
}

export type BoardScope = ReturnType<typeof createBoardScope>;

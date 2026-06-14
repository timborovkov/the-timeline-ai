import {
  type Db,
  boardItemChanges,
  boardItems,
  boardLanes,
  boardPins,
  boards,
  entities,
} from '@timeline/db';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';

import type { ActorKind, CreateObjectInput, ObjectRow, ObjectType } from '#src/objects/index.js';
import type { TeamScopeCore } from '#src/team-scope.js';

import {
  deleteDueDateCalendarEventEmbeddings,
  enqueueDueDateCalendarEventEmbeddings,
  mergeDueDateCalendarSyncResults,
  notifyBoardItemDueDate,
  syncBoardItemDueDateCalendarEvent,
  type DueDateCalendarSyncResult,
} from '#src/calendar/due-dates.js';

type DbTx = Parameters<Parameters<Db['transaction']>[0]>[0];
type DbOrTx = Db | DbTx;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BOARD_TEMPLATES = ['pipeline', 'task_board', 'catalog', 'custom'] as const;

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
  note: string | null;
  changedAt: Date;
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

function jsonStringArray(value: unknown): ObjectType[] {
  return Array.isArray(value) ? value.filter((v): v is ObjectType => typeof v === 'string') : [];
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
    note: row.note,
    changedAt: row.changedAt,
  };
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
    sourceEventId?: string | null;
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
        sourceEventId: input.sourceEventId ?? null,
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
            ? 500
            : Math.max(0, Math.min(Math.floor(options.itemLimit), 500));
      const boardRows = await db
        .select()
        .from(boards)
        .where(
          and(eq(boards.id, boardId), eq(boards.teamId, scope.teamId), isNull(boards.archivedAt)),
        )
        .limit(1);
      const board = boardRows[0];
      if (!board) return null;
      const itemsQuery = db
        .select({ item: boardItems, object: entities })
        .from(boardItems)
        .innerJoin(entities, eq(boardItems.entityId, entities.id))
        .where(
          and(
            eq(boardItems.boardId, boardId),
            eq(boardItems.teamId, scope.teamId),
            isNull(boardItems.archivedAt),
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
          .where(
            and(
              eq(boardItems.boardId, boardId),
              eq(boardItems.teamId, scope.teamId),
              isNull(boardItems.archivedAt),
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
      const rows = await db
        .update(boards)
        .set({ name: normalizeName(input.name, 'Board name'), updatedAt: new Date() })
        .where(
          and(eq(boards.id, input.id), eq(boards.teamId, scope.teamId), isNull(boards.archivedAt)),
        )
        .returning({ id: boards.id });
      return rows.length > 0;
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

      await db.transaction(async (tx) => {
        const now = new Date();
        const boardPatch: Partial<typeof boards.$inferInsert> = { updatedAt: now };
        if (input.name !== undefined) boardPatch.name = normalizeName(input.name, 'Board name');
        if (input.purpose !== undefined) boardPatch.purpose = input.purpose.trim();
        await tx
          .update(boards)
          .set(boardPatch)
          .where(
            and(
              eq(boards.id, input.id),
              eq(boards.teamId, scope.teamId),
              isNull(boards.archivedAt),
            ),
          );

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
      });
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
      return rows.map(toBoardItemChangeRow);
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
      const [countRows, laneRows, dueRows] = await Promise.all([
        db
          .select({ boardId: boardItems.boardId, count: sql<number>`count(*)::int` })
          .from(boardItems)
          .where(
            and(
              eq(boardItems.teamId, scope.teamId),
              inArray(boardItems.boardId, boardIds),
              isNull(boardItems.archivedAt),
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
          .where(
            and(
              eq(boardItems.teamId, scope.teamId),
              inArray(boardItems.boardId, boardIds),
              isNull(boardItems.archivedAt),
            ),
          )
          .groupBy(boardItems.boardId, boardItems.laneId, boardLanes.name),
        db
          .select({
            boardId: boardItems.boardId,
            overdueCount: sql<number>`count(*) filter (where ${boardItems.dueAt} < ${now})::int`,
            dueSoonCount: sql<number>`count(*) filter (where ${boardItems.dueAt} >= ${now} and ${boardItems.dueAt} <= ${soon})::int`,
          })
          .from(boardItems)
          .where(
            and(
              eq(boardItems.teamId, scope.teamId),
              inArray(boardItems.boardId, boardIds),
              isNull(boardItems.archivedAt),
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
        sourceEventId: input.sourceEventId ?? null,
        suggestionItemId: input.suggestionItemId ?? null,
        note: input.note ?? null,
      });
    },

    async proposeBoardItemUpdate(input: {
      boardItemId: string;
      field: Exclude<BoardItemField, '__add__' | '__remove__'>;
      newValue: unknown;
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
        sourceEventId: input.sourceEventId ?? null,
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

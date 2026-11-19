import {
  savedWorkViewDigests,
  savedWorkViews,
  type Db,
  type SavedWorkViewChange,
} from '@timeline/db';
import { and, asc, eq, sql } from 'drizzle-orm';

import type { BoardScope } from '#src/boards/index.js';
import type { CalendarScope } from '#src/calendar/scope.js';
import { getEnv } from '#src/env.js';
import type { ObjectScope } from '#src/objects/index.js';
import { encodeCursor } from '#src/pagination.js';
import type { createSuggestionScope, SuggestionListStatus } from '#src/suggestions/index.js';
import {
  boardItemFilterFromWorkFilters,
  objectListFilterFromWorkFilters,
  parseWorkFilters,
  taskObjectFilterFromWorkFilters,
  WORK_FILTER_PARAM_KEYS,
} from '#src/work-filters.js';

export const SAVED_WORK_COLLECTIONS = ['approvals', 'tasks', 'objects', 'boards'] as const;
type Collection = (typeof SAVED_WORK_COLLECTIONS)[number];
type SavedView = typeof savedWorkViews.$inferSelect;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
const PAGE_SIZE = 150;
const MAX_ITEMS = 15_000;

export function savedWorkViewHref(view: Pick<SavedView, 'collection' | 'targetId' | 'filters'>) {
  const path =
    view.collection === 'boards' ? `/app/boards/${view.targetId}` : `/app/${view.collection}`;
  const query = new URLSearchParams(view.filters).toString();
  return query ? `${path}?${query}` : path;
}

export function savedApprovalStatus(status: string | undefined): SuggestionListStatus {
  return status === 'failed' || status === 'resolved' || status === 'all' ? status : 'pending';
}

function normalizeFilters(collection: Collection, filters: Record<string, string>) {
  const keys =
    collection === 'approvals'
      ? ['status', 'boardId', 'project', 'decision']
      : [...WORK_FILTER_PARAM_KEYS, ...(['tasks', 'boards'].includes(collection) ? ['view'] : [])];
  return Object.fromEntries(
    keys.flatMap((key) => {
      const value = filters[key]?.trim();
      return value ? [[key, value.slice(0, 500)]] : [];
    }),
  );
}

export function createSavedWorkViewScope(input: {
  db: Db;
  teamId: string;
  userId: string;
  ensureMember: () => Promise<unknown>;
  objects: ObjectScope;
  boards: BoardScope;
  calendar: CalendarScope;
  suggestions: ReturnType<typeof createSuggestionScope>;
}) {
  const { db, teamId, userId, ensureMember, objects, boards, calendar, suggestions } = input;
  const ownerCondition = and(eq(savedWorkViews.teamId, teamId), eq(savedWorkViews.userId, userId));
  async function lock(tx: Tx) {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`saved-view:${teamId}:${userId}`}, 0))`,
    );
  }

  async function getMatches(
    view: Pick<SavedView, 'collection' | 'targetId' | 'filters'>,
    now: Date,
  ): Promise<string[] | null> {
    if (view.collection === 'approvals') {
      const status = savedApprovalStatus(view.filters.status);
      if (view.filters.boardId && !(await boards.getBoard(view.filters.boardId, { itemLimit: 0 })))
        return null;
      const ids: string[] = [];
      let cursor: string | null = null;
      for (;;) {
        const rows = await suggestions.listSuggestions({
          status,
          cursor,
          limit: PAGE_SIZE,
          ...(view.filters.boardId ? { boardId: view.filters.boardId } : {}),
          projectId: view.filters.project,
          decisionOnly: view.filters.decision === '1',
        });
        ids.push(
          ...rows.flatMap((row) =>
            row.items
              .filter((item) => {
                if (view.filters.boardId && item.proposedPayload.boardId !== view.filters.boardId)
                  return false;
                if (status === 'pending' || status === 'failed') return item.status === status;
                if (status === 'resolved') return !['pending', 'failed'].includes(item.status);
                return item.status !== 'failed';
              })
              .map((item) => item.id),
          ),
        );
        if (ids.length > MAX_ITEMS) return null;
        const last = rows.at(-1);
        if (!last || rows.length < PAGE_SIZE) break;
        cursor = encodeCursor({ id: last.id, at: last.createdAt.toISOString() });
      }
      return ids;
    }
    const { defaultTimezone: timezone } = await calendar.getCalendarSettings();
    const filters = parseWorkFilters(view.filters, {
      taskCategoriesEnabled: getEnv().TASK_CATEGORY_UI_ENABLED,
    });
    if (view.collection === 'boards') {
      if (!view.targetId) return null;
      const board = await boards.getBoard(view.targetId, {
        itemLimit: 'all',
        itemFilter: boardItemFilterFromWorkFilters(filters, { now, timezone }),
      });
      if (!board || board.items.length > MAX_ITEMS) return null;
      return board.items.map((item) => item.id);
    }
    const filter =
      view.collection === 'tasks'
        ? taskObjectFilterFromWorkFilters(filters, { now, timezone })
        : {
            ...objectListFilterFromWorkFilters(filters, { now, timezone }),
            ...((filters.category || filters.project) && !filters.type
              ? { type: 'task' as const }
              : {}),
            archived: false,
          };
    const ids: string[] = [];
    let cursor: string | null = null;
    for (;;) {
      const rows = await objects.listObjects({ ...filter, cursor, limit: PAGE_SIZE });
      ids.push(...rows.map((row) => row.id));
      if (ids.length > MAX_ITEMS) return null;
      const last = rows.at(-1);
      if (!last || rows.length < PAGE_SIZE) return ids;
      cursor = encodeCursor({ id: last.id, at: last.updatedAt.toISOString() });
    }
  }

  return {
    async list() {
      await ensureMember();
      return db
        .select()
        .from(savedWorkViews)
        .where(ownerCondition)
        .orderBy(asc(savedWorkViews.createdAt));
    },
    async create(data: {
      title: string;
      collection: Collection;
      targetId: string | null;
      filters: Record<string, string>;
    }) {
      await ensureMember();
      if (
        data.collection === 'boards' &&
        (!data.targetId || !(await boards.getBoard(data.targetId, { itemLimit: 0 })))
      )
        return null;
      return db.transaction(async (tx) => {
        await lock(tx);
        const views = await tx
          .select({ id: savedWorkViews.id })
          .from(savedWorkViews)
          .where(ownerCondition)
          .limit(40);
        if (views.length >= 40) return null;
        const [row] = await tx
          .insert(savedWorkViews)
          .values({
            ...data,
            teamId,
            userId,
            filters: normalizeFilters(data.collection, data.filters),
          })
          .returning({ id: savedWorkViews.id });
        return row?.id ?? null;
      });
    },
    async manage(
      id: string,
      change:
        | { type: 'rename'; title: string }
        | { type: 'notify'; enabled: boolean }
        | { type: 'delete' },
    ) {
      await ensureMember();
      const now = new Date();
      const condition = and(ownerCondition, eq(savedWorkViews.id, id));
      const [previous] = await db.select().from(savedWorkViews).where(condition);
      if (!previous) return false;
      const preparedBaseline =
        change.type === 'notify' && change.enabled && !previous.notify
          ? await getMatches(previous, now)
          : [];
      return db.transaction(async (tx) => {
        await lock(tx);
        const [view] = await tx.select().from(savedWorkViews).where(condition);
        if (!view) return false;
        if (change.type === 'delete') {
          await tx.delete(savedWorkViews).where(condition);
        } else if (change.type === 'rename') {
          await tx
            .update(savedWorkViews)
            .set({ title: change.title, updatedAt: new Date() })
            .where(condition);
        } else if (view.notify !== change.enabled) {
          if (view.updatedAt.getTime() !== previous.updatedAt.getTime() || !preparedBaseline)
            return false;
          const baseline = preparedBaseline;
          await tx
            .update(savedWorkViews)
            .set({
              notify: change.enabled,
              baseline,
              evaluatedThrough: change.enabled ? now : null,
              updatedAt: now,
            })
            .where(condition);
        }
        return true;
      });
    },
    async evaluate(windowEnd: Date, now: Date) {
      await ensureMember();
      const eligible = await db
        .select()
        .from(savedWorkViews)
        .where(and(ownerCondition, eq(savedWorkViews.notify, true)));
      if (eligible.length === 0) return [];
      const observations = new Map<string, { view: SavedView; matches: string[] | null }>();
      for (const view of eligible) {
        if (view.evaluatedThrough && view.evaluatedThrough >= windowEnd) continue;
        observations.set(view.id, { view, matches: await getMatches(view, now) });
      }
      const changes = await db.transaction(async (tx) => {
        await lock(tx);
        const [batch] = await tx
          .select()
          .from(savedWorkViewDigests)
          .where(
            and(
              eq(savedWorkViewDigests.teamId, teamId),
              eq(savedWorkViewDigests.userId, userId),
              eq(savedWorkViewDigests.windowEnd, windowEnd),
            ),
          );
        if (batch) return batch.changes;
        const result: SavedWorkViewChange[] = [];
        const views = await tx
          .select()
          .from(savedWorkViews)
          .where(and(ownerCondition, eq(savedWorkViews.notify, true)));
        for (const view of views) {
          if (view.evaluatedThrough && view.evaluatedThrough >= windowEnd) continue;
          const observation = observations.get(view.id);
          if (
            !observation?.matches ||
            observation.view.updatedAt.getTime() !== view.updatedAt.getTime()
          )
            continue;
          const matched = observation.matches;
          const existing = new Set(view.baseline);
          const added = matched.filter((id) => !existing.has(id));
          if (added.length) result.push({ viewId: view.id, itemIds: added });
          await tx
            .update(savedWorkViews)
            .set({ baseline: matched, evaluatedThrough: windowEnd })
            .where(and(ownerCondition, eq(savedWorkViews.id, view.id)));
        }
        if (views.length > 0)
          await tx
            .insert(savedWorkViewDigests)
            .values({ teamId, userId, windowEnd, changes: result });
        return result;
      });
      return changes;
    },
    async visibleDigestChanges(changes: SavedWorkViewChange[], asOf: Date, now: Date) {
      await ensureMember();
      const views = await db
        .select()
        .from(savedWorkViews)
        .where(and(ownerCondition, eq(savedWorkViews.notify, true)));
      const result: { title: string; href: string; count: number }[] = [];
      for (const change of changes) {
        const view = views.find((candidate) => candidate.id === change.viewId);
        if (!view || view.updatedAt > asOf) continue;
        const current = await getMatches(view, now);
        if (!current) continue;
        const set = new Set(current);
        const count = change.itemIds.filter((id) => set.has(id)).length;
        if (count > 0) result.push({ title: view.title, href: savedWorkViewHref(view), count });
      }
      return result;
    },
  };
}

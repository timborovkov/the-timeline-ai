'use client';

import {
  DndContext,
  PointerSensor,
  closestCenter,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { useQueries } from '@tanstack/react-query';
import { TASK_CATEGORY_OPTIONS, type TaskCategory } from '@timeline/shared/task-categories/types';
import { presentDueDate } from '@timeline/shared/time';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  useEffect,
  useCallback,
  useId,
  useMemo,
  useOptimistic,
  useReducer,
  useRef,
  useState,
  useTransition,
} from 'react';

import type { SaveState } from '@/lib/utils';
import type * as objects from '@timeline/shared/objects/types';
import type { Dispatch, ReactNode, SetStateAction } from 'react';

import {
  loadTaskPrimaryProjectsAction,
  loadTaskRowsAction,
  resetTaskCategoryAction,
  setTaskCategoryAction,
  updateObjectAction,
} from '@/app/actions/objects';
import { ObjectTextFilter } from '@/components/boards/object-text-filter';
import { DueDateDisplay } from '@/components/due-date-display';
import { ObjectPinButton } from '@/components/objects/object-pin-button';
import { ObjectRelatedContext } from '@/components/objects/object-related-context';
import { PinOverflowMenu } from '@/components/pins/pin-overflow-menu';
import { TaskCategoryBadge } from '@/components/tasks/task-category-badge';
import { useTaskCategoryPolling } from '@/components/tasks/task-category-polling';
import { TaskCategorySelect } from '@/components/tasks/task-category-select';
import { TaskProjectSelect } from '@/components/tasks/task-project-select';
import { useAppDialog } from '@/components/ui/app-dialog';
import { useWorkspaceTimezone } from '@/components/workspace-timezone-context';
import { displayText } from '@/lib/display-dates';
import { filterObjectsByText } from '@/lib/object-filter';
import { objectDetailHref } from '@/lib/object-links';
import { displayObjectTitle } from '@/lib/object-title';
import { statusLabel } from '@/lib/status-labels';
import {
  TASK_BOARD_COLUMN_RENDER_LIMIT,
  TASK_BOARD_LIST_RENDER_LIMIT,
  TASK_BOARD_TOTAL_LIMIT,
} from '@/lib/task-board-config';
import { taskDisplayStatus } from '@/lib/task-statuses';
import { cn, errorMessage } from '@/lib/utils';

interface TaskMemberOption {
  id: string;
  label: string;
}

type TaskObjectRow = objects.ObjectRow & { pinned?: boolean };

interface Props {
  rows: TaskObjectRow[];
  columns: string[];
  selectedTaskId: string | null;
  selectedTaskContext?: objects.ObjectDetail['connectedWork'] | null;
  selectedTaskPinned?: boolean;
  view: TaskView;
  members: TaskMemberOption[];
  projects?: TaskMemberOption[];
  primaryProjects?: objects.TaskPrimaryProjectRow[];
  initialProjectsHydrated?: boolean;
  totalCount: number;
  nextCursor: string | null;
  filterParams?: Record<string, string>;
  categoryFilterRefreshToken?: string | null;
  taskCategoriesEnabled?: boolean;
}

type TaskPatch = Partial<
  Pick<objects.ObjectRow, 'status' | 'assigneeUserId' | 'dueAt' | 'priority'>
>;
type TaskPatchKey = keyof TaskPatch;
type TaskPatchValue = TaskPatch[TaskPatchKey];
type TaskPatchPendingValues = Partial<Record<TaskPatchKey, TaskPatchValue[]>>;
interface TaskPatchOverlay {
  baseline: TaskPatch;
  pendingValues: TaskPatchPendingValues;
  patch: TaskPatch;
}
type TaskView = 'kanban' | 'list';
type BulkField = 'status' | 'assignee' | 'due' | 'priority' | 'category';

interface BulkState {
  field: BulkField;
  status: string;
  assignee: string;
  due: string;
  priority: string;
  category: TaskCategory | 'automatic';
  message: string | null;
}

type BulkAction =
  | { type: 'field'; field: BulkField }
  | { type: 'status'; status: string }
  | { type: 'assignee'; assignee: string }
  | { type: 'due'; due: string }
  | { type: 'priority'; priority: string }
  | { type: 'category'; category: TaskCategory | 'automatic' }
  | { type: 'message'; message: string | null };

interface MoveUiState {
  saveState: SaveState;
  savingCount: number;
  cardErrors: Record<string, string>;
  savingCardIds: ReadonlySet<string>;
}

interface TaskPaginationState {
  filterKey: string | null;
  appendedRows: TaskObjectRow[];
  cursor: string | null;
}

interface PrimaryProjectOverride {
  project: objects.TaskPrimaryProjectRow | null;
  baselineKey: string;
  committed: boolean;
}

function primaryProjectStateKey(project: objects.TaskPrimaryProjectRow | undefined): string {
  if (!project) return '';
  return `${project.projectId}\u0000${project.projectName}\u0000${project.archivedAt?.toISOString() ?? ''}`;
}

type TaskCategoryStateRow = Pick<
  objects.ObjectRow,
  | 'id'
  | 'taskCategory'
  | 'taskCategoryMode'
  | 'taskCategorySource'
  | 'taskCategoryStatus'
  | 'taskCategoryUpdatedAt'
>;

interface TaskBoardState {
  pagination: TaskPaginationState;
  loadErrorFilterKey: string | null;
  loadError: string | null;
  filterQuery: string;
  selectedFilterKey: string | null;
  selectedIds: ReadonlySet<string>;
  rowPatches: Record<string, TaskPatchOverlay>;
}

type MoveUiAction =
  | { type: 'move-start'; id: string; savingCount: number; savingCardIds: ReadonlySet<string> }
  | { type: 'move-fail'; id: string; message: string }
  | {
      type: 'move-complete';
      savingCount: number;
      savingCardIds: ReadonlySet<string>;
      batchFailed: boolean;
    }
  | { type: 'saved-timeout' };

type TaskBoardAction =
  | { type: 'load-error'; message: string | null; filterKey: string }
  | {
      type: 'append-page';
      rows: TaskObjectRow[];
      nextCursor: string | null;
      filterKey: string;
    }
  | { type: 'filter'; query: string }
  | { type: 'reset-pagination' }
  | { type: 'selected'; next: SetStateAction<ReadonlySet<string>>; filterKey: string }
  | { type: 'patches'; next: SetStateAction<Record<string, TaskPatchOverlay>> };

const INITIAL_MOVE_UI: MoveUiState = {
  saveState: 'idle',
  savingCount: 0,
  cardErrors: {},
  savingCardIds: new Set(),
};
const INITIAL_TASK_BOARD_STATE: TaskBoardState = {
  pagination: { filterKey: null, appendedRows: [], cursor: null },
  loadErrorFilterKey: null,
  loadError: null,
  filterQuery: '',
  selectedFilterKey: null,
  selectedIds: new Set(),
  rowPatches: {},
};
const EMPTY_FILTER_PARAMS: Record<string, string> = {};
const EMPTY_PRIMARY_PROJECTS: objects.TaskPrimaryProjectRow[] = [];
const EMPTY_TASK_ROWS: TaskObjectRow[] = [];
const EMPTY_SELECTED_IDS: ReadonlySet<string> = new Set();
const BULK_UPDATE_CONCURRENCY = 4;

async function runBulkActions<T>(
  ids: string[],
  action: (id: string) => Promise<T>,
): Promise<PromiseSettledResult<T>[]> {
  const results = Array<PromiseSettledResult<T>>(ids.length);
  const pending = ids.entries();

  async function runWorker(): Promise<void> {
    const next = pending.next();
    if (next.done) return;
    const [index, id] = next.value;
    try {
      results[index] = { status: 'fulfilled', value: await action(id) };
    } catch (reason) {
      results[index] = { status: 'rejected', reason };
    }
    return runWorker();
  }

  await Promise.all(
    Array.from({ length: Math.min(BULK_UPDATE_CONCURRENCY, ids.length) }, runWorker),
  );
  return results;
}
const EMPTY_PROJECT_OPTIONS: { id: string; label: string }[] = [];

function reduceSetState<T>(current: T, next: SetStateAction<T>): T {
  return typeof next === 'function' ? (next as (value: T) => T)(current) : next;
}

function taskBoardReducer(state: TaskBoardState, action: TaskBoardAction): TaskBoardState {
  switch (action.type) {
    case 'load-error':
      return { ...state, loadErrorFilterKey: action.filterKey, loadError: action.message };
    case 'append-page': {
      const currentRows =
        action.filterKey === state.pagination.filterKey ? state.pagination.appendedRows : [];
      const seen = new Set(currentRows.map((row) => row.id));
      return {
        ...state,
        pagination: {
          filterKey: action.filterKey,
          appendedRows: [...currentRows, ...action.rows.filter((row) => !seen.has(row.id))],
          cursor: action.nextCursor,
        },
      };
    }
    case 'filter':
      return { ...state, filterQuery: action.query };
    case 'reset-pagination':
      return {
        ...state,
        pagination: INITIAL_TASK_BOARD_STATE.pagination,
        loadErrorFilterKey: null,
        loadError: null,
      };
    case 'selected':
      return {
        ...state,
        selectedFilterKey: action.filterKey,
        selectedIds: reduceSetState(
          state.selectedFilterKey === action.filterKey ? state.selectedIds : new Set<string>(),
          action.next,
        ),
      };
    case 'patches':
      return { ...state, rowPatches: reduceSetState(state.rowPatches, action.next) };
  }
}

function taskHref(taskId: string, extraParams: Record<string, string> = {}): string {
  const params = new URLSearchParams(extraParams);
  params.set('task', taskId);
  return `/app/tasks?${params.toString()}`;
}

function closeHref(view: TaskView, extraParams: Record<string, string> = {}): string {
  return view === 'kanban'
    ? hrefWithParams('/app/tasks', extraParams)
    : taskViewHref(view, null, extraParams);
}

function taskViewHref(
  view: TaskView,
  taskId: string | null,
  extraParams: Record<string, string> = {},
): string {
  const params = new URLSearchParams({ ...extraParams, view });
  if (taskId) params.set('task', taskId);
  return `/app/tasks?${params.toString()}`;
}

function hrefWithParams(basePath: string, params: Record<string, string>): string {
  const qs = new URLSearchParams(params).toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

function filterParamsKey(params: Record<string, string>): string {
  return new URLSearchParams(
    Object.entries(params).sort(([left], [right]) => left.localeCompare(right)),
  ).toString();
}

function pendingTaskCategoryPollingInput(rows: objects.ObjectRow[]): {
  ids: string[];
  generationKey: string;
} {
  const ids: string[] = [];
  const generations: string[] = [];
  for (const row of rows) {
    if (row.taskCategoryStatus !== 'pending') continue;
    ids.push(row.id);
    generations.push(`${row.id}:${row.taskCategoryUpdatedAt?.toISOString() ?? ''}`);
  }
  return { ids, generationKey: generations.join(',') };
}

function patchTaskRow(
  patches: Record<string, TaskPatchOverlay>,
  id: string,
  patch: TaskPatch,
  baseline: TaskPatch,
): Record<string, TaskPatchOverlay> {
  const current = patches[id];
  const pendingValues: TaskPatchPendingValues = { ...(current?.pendingValues ?? {}) };
  for (const key of Object.keys(patch) as TaskPatchKey[]) {
    pendingValues[key] = taskPatchPendingValues(
      current?.pendingValues[key],
      baseline[key],
      current?.patch[key],
      patch[key],
    );
  }
  return {
    ...patches,
    [id]: {
      baseline: {
        ...baseline,
        ...(current?.baseline ?? {}),
      },
      pendingValues,
      patch: {
        ...(current?.patch ?? {}),
        ...patch,
      },
    },
  };
}

function removePatchKeys(
  patches: Record<string, TaskPatchOverlay>,
  id: string,
  keys: TaskPatchKey[],
): Record<string, TaskPatchOverlay> {
  const current = patches[id];
  if (!current) return patches;
  let nextBaseline = current.baseline;
  let nextPendingValues = current.pendingValues;
  let nextPatch = current.patch;
  for (const key of keys) {
    const { [key]: _removedBaseline, ...baselineRest } = nextBaseline;
    const { [key]: _removedPending, ...pendingRest } = nextPendingValues;
    const { [key]: _removedPatch, ...patchRest } = nextPatch;
    nextBaseline = baselineRest;
    nextPendingValues = pendingRest;
    nextPatch = patchRest;
  }
  if (Object.keys(nextPatch).length > 0) {
    return {
      ...patches,
      [id]: { baseline: nextBaseline, pendingValues: nextPendingValues, patch: nextPatch },
    };
  }
  const { [id]: _removed, ...rest } = patches;
  return rest;
}

function taskPatchPendingValues(
  existing: TaskPatchValue[] | undefined,
  baselineValue: TaskPatchValue,
  previousPatchValue: TaskPatchValue,
  nextPatchValue: TaskPatchValue,
): TaskPatchValue[] {
  const values: TaskPatchValue[] = [];
  for (const value of [...(existing ?? []), baselineValue, previousPatchValue]) {
    if (
      !sameTaskPatchValue(value, nextPatchValue) &&
      !values.some((candidate) => sameTaskPatchValue(candidate, value))
    ) {
      values.push(value);
    }
  }
  return values;
}

function sameTaskPatchValue(left: TaskPatchValue, right: TaskPatchValue): boolean {
  if (left instanceof Date || right instanceof Date) {
    const leftTime = left instanceof Date ? left.getTime() : null;
    const rightTime = right instanceof Date ? right.getTime() : null;
    return leftTime === rightTime;
  }
  return left === right;
}

function applyTaskPatch(row: objects.ObjectRow, overlay: TaskPatchOverlay | undefined) {
  if (!overlay) return row;
  const effectiveEntries: [TaskPatchKey, TaskPatch[TaskPatchKey]][] = [];
  for (const key of Object.keys(overlay.patch) as TaskPatchKey[]) {
    const pendingValues = overlay.pendingValues[key] ?? [overlay.baseline[key]];
    const patchValue = overlay.patch[key];
    if (
      pendingValues.some((value) => sameTaskPatchValue(row[key], value)) &&
      !sameTaskPatchValue(row[key], patchValue)
    ) {
      effectiveEntries.push([key, patchValue]);
    }
  }
  const effectivePatch = Object.fromEntries(effectiveEntries) as TaskPatch;
  return Object.keys(effectivePatch).length > 0 ? { ...row, ...effectivePatch } : row;
}

function applyTaskCategoryState(
  row: objects.ObjectRow,
  categoryState: TaskCategoryStateRow | undefined,
): objects.ObjectRow {
  if (!categoryState) return row;
  const rowUpdatedAt = row.taskCategoryUpdatedAt?.getTime() ?? 0;
  const stateUpdatedAt = categoryState.taskCategoryUpdatedAt?.getTime() ?? 0;
  return stateUpdatedAt >= rowUpdatedAt ? { ...row, ...categoryState } : row;
}

function taskPatchBaseline(row: objects.ObjectRow, patch: TaskPatch): TaskPatch {
  return Object.fromEntries((Object.keys(patch) as TaskPatchKey[]).map((key) => [key, row[key]]));
}

function moveUiReducer(state: MoveUiState, action: MoveUiAction): MoveUiState {
  switch (action.type) {
    case 'move-start': {
      const { [action.id]: _cleared, ...cardErrors } = state.cardErrors;
      return {
        ...state,
        saveState: 'saving',
        savingCount: action.savingCount,
        savingCardIds: action.savingCardIds,
        cardErrors,
      };
    }
    case 'move-fail':
      return { ...state, cardErrors: { ...state.cardErrors, [action.id]: action.message } };
    case 'move-complete':
      return {
        ...state,
        saveState: action.savingCount > 0 ? 'saving' : action.batchFailed ? 'idle' : 'saved',
        savingCount: action.savingCount,
        savingCardIds: action.savingCardIds,
      };
    case 'saved-timeout':
      return { ...state, saveState: 'idle' };
  }
}

function useTaskBoardController({
  rows,
  columns,
  selectedTaskId,
  totalCount,
  nextCursor,
  filterParams = EMPTY_FILTER_PARAMS,
  categoryFilterRefreshToken = null,
  primaryProjects = EMPTY_PRIMARY_PROJECTS,
  initialProjectsHydrated = false,
}: Props) {
  const dndContextId = useId();
  const router = useRouter();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const filterKey = `${filterParamsKey(filterParams)}\u0000${categoryFilterRefreshToken ?? ''}`;
  const [boardState, dispatchBoard] = useReducer(taskBoardReducer, INITIAL_TASK_BOARD_STATE);
  const [loadingMore, startLoadMore] = useTransition();
  const appendedRows =
    boardState.pagination.filterKey === filterKey
      ? boardState.pagination.appendedRows
      : EMPTY_TASK_ROWS;
  const loadedRows = useMemo(() => {
    const firstPageIds = new Set(rows.map((row) => row.id));
    return [...rows, ...appendedRows.filter((row) => !firstPageIds.has(row.id))];
  }, [appendedRows, rows]);
  const cursor =
    boardState.pagination.filterKey === filterKey ? boardState.pagination.cursor : nextCursor;
  const [optimisticRows, applyMove] = useOptimistic(
    loadedRows,
    (state, move: { id: string; status: string }) =>
      state.map((row) => (row.id === move.id ? { ...row, status: move.status } : row)),
  );
  const [, startTransition] = useTransition();
  const [moveUi, dispatchMoveUi] = useReducer(moveUiReducer, INITIAL_MOVE_UI);
  const { filterQuery, rowPatches } = boardState;
  const loadError = boardState.loadErrorFilterKey === filterKey ? boardState.loadError : null;
  const selectedIds =
    boardState.selectedFilterKey === filterKey ? boardState.selectedIds : EMPTY_SELECTED_IDS;
  const setFilterQuery = useCallback((query: string) => {
    dispatchBoard({ type: 'filter', query });
  }, []);
  const setSelectedIds: Dispatch<SetStateAction<ReadonlySet<string>>> = useCallback(
    (next) => {
      dispatchBoard({ type: 'selected', next, filterKey });
    },
    [filterKey],
  );
  const setRowPatches: Dispatch<SetStateAction<Record<string, TaskPatchOverlay>>> = useCallback(
    (next) => {
      dispatchBoard({ type: 'patches', next });
    },
    [],
  );
  const savingCountRef = useRef(0);
  const savingCardIdsRef = useRef<Set<string> | null>(null);
  const batchHadFailureRef = useRef(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const patchedRows = useMemo(
    () => optimisticRows.map((row) => applyTaskPatch(row, rowPatches[row.id])),
    [optimisticRows, rowPatches],
  );
  const pendingCategoryInput = useMemo(
    () => pendingTaskCategoryPollingInput(patchedRows),
    [patchedRows],
  );
  const categoryQuery = useTaskCategoryPolling(
    pendingCategoryInput.ids,
    2_500,
    pendingCategoryInput.generationKey,
  );
  const effectiveRows = useMemo(() => {
    const polledCategoryStates = new Map(
      categoryQuery.data.rows.map((row) => [row.id, row] as const),
    );
    return patchedRows.map((row) => applyTaskCategoryState(row, polledCategoryStates.get(row.id)));
  }, [categoryQuery.data.rows, patchedRows]);
  const [primaryProjectOverrides, setPrimaryProjectOverrides] = useState<
    Record<string, PrimaryProjectOverride>
  >({});
  const projectHydrationIds = useMemo(
    () => (initialProjectsHydrated ? appendedRows : effectiveRows).map((row) => row.id),
    [appendedRows, effectiveRows, initialProjectsHydrated],
  );
  const projectHydrationChunks = useMemo(
    () =>
      Array.from({ length: Math.ceil(projectHydrationIds.length / 200) }, (_, index) =>
        projectHydrationIds.slice(index * 200, (index + 1) * 200),
      ),
    [projectHydrationIds],
  );
  const projectHydrationQueries = useQueries({
    queries: projectHydrationChunks.map((ids) => ({
      queryKey: ['task-primary-projects', ids],
      queryFn: async () => {
        const result = await loadTaskPrimaryProjectsAction({ ids });
        if (!result.rows) throw new Error(result.error ?? 'Project hydration failed');
        return result;
      },
      staleTime: Number.POSITIVE_INFINITY,
    })),
  });
  const loadedPrimaryProjects = projectHydrationQueries.flatMap((query) => query.data?.rows ?? []);
  const resolvedPrimaryProjects = useMemo(() => {
    const serverHydratedTaskIds = initialProjectsHydrated
      ? new Set(rows.map((row) => row.id))
      : null;
    const byTask = new Map<string, objects.TaskPrimaryProjectRow>();
    for (const project of loadedPrimaryProjects) {
      if (!serverHydratedTaskIds?.has(project.taskId)) byTask.set(project.taskId, project);
    }
    for (const project of primaryProjects) byTask.set(project.taskId, project);
    return [...byTask.values()];
  }, [initialProjectsHydrated, loadedPrimaryProjects, primaryProjects, rows]);
  const hydratedPrimaryProjects = useMemo(() => {
    const byTask = new Map(
      resolvedPrimaryProjects.map((project) => [project.taskId, project] as const),
    );
    for (const [taskId, override] of Object.entries(primaryProjectOverrides)) {
      if (
        override.committed &&
        override.baselineKey !== primaryProjectStateKey(byTask.get(taskId))
      ) {
        continue;
      }
      if (override.project) byTask.set(taskId, override.project);
      else byTask.delete(taskId);
    }
    return [...byTask.values()];
  }, [primaryProjectOverrides, resolvedPrimaryProjects]);
  const updatePrimaryProject = useCallback(
    (taskId: string, project: { id: string; label: string } | null) => {
      setPrimaryProjectOverrides((current) => ({
        ...current,
        [taskId]: {
          project: project
            ? {
                taskId,
                projectId: project.id,
                projectName: project.label,
                archivedAt: null,
              }
            : null,
          baselineKey: primaryProjectStateKey(
            resolvedPrimaryProjects.find((candidate) => candidate.taskId === taskId),
          ),
          committed: false,
        },
      }));
    },
    [resolvedPrimaryProjects],
  );
  const commitPrimaryProject = useCallback(
    (taskId: string) => {
      setPrimaryProjectOverrides((current) => {
        const override = current[taskId];
        if (!override) return current;
        return { ...current, [taskId]: { ...override, committed: true } };
      });
      if (filterParams.project) dispatchBoard({ type: 'reset-pagination' });
    },
    [filterParams.project],
  );
  const revertPrimaryProject = useCallback((taskId: string) => {
    setPrimaryProjectOverrides((current) => {
      if (!(taskId in current)) return current;
      const { [taskId]: _removed, ...next } = current;
      return next;
    });
  }, []);
  const visibleRows = useMemo(
    () => filterObjectsByText(effectiveRows, filterQuery, { groupBy: 'status' }),
    [effectiveRows, filterQuery],
  );
  const selectedTask = selectedTaskId
    ? (effectiveRows.find((row) => row.id === selectedTaskId) ?? null)
    : null;
  const allColumns = Array.from(
    new Set([...columns, ...effectiveRows.map((row) => taskDisplayStatus(row.status))]),
  );
  const byStatus = new Map<string, objects.ObjectRow[]>();
  for (const column of allColumns) byStatus.set(column, []);
  for (const row of visibleRows) {
    const displayStatus = taskDisplayStatus(row.status);
    const list = byStatus.get(displayStatus) ?? [];
    list.push(row);
    byStatus.set(displayStatus, list);
  }
  const moveErrors = Object.values(moveUi.cardErrors);
  const selectedVisibleIds = useMemo(() => {
    const visibleIds = new Set(visibleRows.map((row) => row.id));
    return new Set([...selectedIds].filter((id) => visibleIds.has(id)));
  }, [selectedIds, visibleRows]);
  const canLoadMore =
    Boolean(cursor) && loadedRows.length < Math.min(totalCount, TASK_BOARD_TOTAL_LIMIT);

  const clearSavedTimer = useCallback(() => {
    if (savedTimer.current) {
      clearTimeout(savedTimer.current);
      savedTimer.current = null;
    }
  }, []);

  useEffect(() => {
    return clearSavedTimer;
  }, [clearSavedTimer]);

  function activeSavingCardIds(): Set<string> {
    savingCardIdsRef.current ??= new Set();
    return savingCardIdsRef.current;
  }

  function onDragEnd(event: DragEndEvent): void {
    const id = String(event.active.id);
    const status = event.over?.id ? String(event.over.id) : null;
    if (!status || activeSavingCardIds().has(id)) return;
    const row = effectiveRows.find((candidate) => candidate.id === id);
    if (!row || taskDisplayStatus(row.status) === status) return;
    const previousStatusPatch = rowPatches[id]?.patch.status;
    const previousStatusBaseline = rowPatches[id]?.baseline.status;
    startTransition(async () => {
      applyMove({ id, status });
      setRowPatches((current) =>
        patchTaskRow(current, id, { status }, taskPatchBaseline(row, { status })),
      );
      clearSavedTimer();
      if (savingCountRef.current === 0) batchHadFailureRef.current = false;
      savingCountRef.current += 1;
      activeSavingCardIds().add(id);
      dispatchMoveUi({
        type: 'move-start',
        id,
        savingCount: savingCountRef.current,
        savingCardIds: new Set(activeSavingCardIds()),
      });
      try {
        const result = await updateObjectAction({ id, status });
        if ('error' in result && result.error) {
          batchHadFailureRef.current = true;
          setRowPatches((current) =>
            previousStatusPatch === undefined
              ? removePatchKeys(current, id, ['status'])
              : patchTaskRow(
                  current,
                  id,
                  { status: previousStatusPatch },
                  { status: previousStatusBaseline },
                ),
          );
          dispatchMoveUi({ type: 'move-fail', id, message: result.error });
        }
      } catch (err) {
        batchHadFailureRef.current = true;
        setRowPatches((current) =>
          previousStatusPatch === undefined
            ? removePatchKeys(current, id, ['status'])
            : patchTaskRow(
                current,
                id,
                { status: previousStatusPatch },
                { status: previousStatusBaseline },
              ),
        );
        dispatchMoveUi({ type: 'move-fail', id, message: errorMessage(err, 'Move failed') });
      } finally {
        savingCountRef.current = Math.max(0, savingCountRef.current - 1);
        activeSavingCardIds().delete(id);
        dispatchMoveUi({
          type: 'move-complete',
          savingCount: savingCountRef.current,
          savingCardIds: new Set(activeSavingCardIds()),
          batchFailed: batchHadFailureRef.current,
        });
        if (savingCountRef.current === 0 && !batchHadFailureRef.current) {
          savedTimer.current = setTimeout(() => {
            dispatchMoveUi({ type: 'saved-timeout' });
          }, 1600);
        }
        router.refresh();
      }
    });
  }

  async function updateTask(
    id: string,
    patch: TaskPatch,
  ): Promise<{ ok?: boolean; error?: string }> {
    const previousPatch = rowPatches[id];
    const row = effectiveRows.find((candidate) => candidate.id === id);
    setRowPatches((current) =>
      row ? patchTaskRow(current, id, patch, taskPatchBaseline(row, patch)) : current,
    );
    const dueAt = patch.dueAt === undefined ? undefined : (patch.dueAt?.toISOString() ?? null);
    const result = await updateObjectAction({
      id,
      ...patch,
      ...(dueAt !== undefined ? { dueAt } : {}),
    });
    if ('error' in result && result.error) {
      setRowPatches((current) => {
        if (previousPatch) return { ...current, [id]: previousPatch };
        const { [id]: _removed, ...rest } = current;
        return rest;
      });
    }
    router.refresh();
    return result;
  }

  async function updateTasks(ids: string[], patch: TaskPatch): Promise<{ failed: number }> {
    const results = await runBulkActions(ids, (id) => updateTask(id, patch));
    return {
      failed: results.filter(
        (result) =>
          result.status === 'rejected' || ('error' in result.value && Boolean(result.value.error)),
      ).length,
    };
  }

  async function updateTaskCategories(
    ids: string[],
    category: TaskCategory | 'automatic',
  ): Promise<{ failed: number }> {
    const results = await runBulkActions(ids, (id) =>
      category === 'automatic'
        ? resetTaskCategoryAction({ id })
        : setTaskCategoryAction({ id, category }),
    );
    router.refresh();
    return {
      failed: results.filter(
        (result) =>
          result.status === 'rejected' || ('error' in result.value && Boolean(result.value.error)),
      ).length,
    };
  }

  function loadMoreTasks(): void {
    if (!cursor || loadingMore) return;
    dispatchBoard({ type: 'load-error', message: null, filterKey });
    startLoadMore(async () => {
      const page = await loadTaskRowsAction({
        cursor,
        ...(Object.keys(filterParams).length > 0 ? { filters: filterParams } : {}),
      });
      if (page.error) {
        dispatchBoard({ type: 'load-error', message: page.error, filterKey });
        return;
      }
      dispatchBoard({
        type: 'append-page',
        rows: page.rows,
        nextCursor: page.nextCursor,
        filterKey,
      });
    });
  }

  return {
    allColumns,
    byStatus,
    canLoadMore,
    dndContextId,
    effectiveRows,
    filterQuery,
    loadError,
    loadingMore,
    loadMoreTasks,
    moveErrors,
    moveUi,
    onDragEnd,
    selectedTask,
    selectedVisibleIds,
    sensors,
    setFilterQuery,
    setSelectedIds,
    updateTask,
    updateTasks,
    updateTaskCategories,
    updatePrimaryProject,
    commitPrimaryProject,
    revertPrimaryProject,
    visibleRows,
    hydratedPrimaryProjects,
    pinnedObjectIdSet: new Set(loadedRows.flatMap((row) => (row.pinned ? [row.id] : []))),
  };
}

export function TaskBoard(props: Props) {
  return <TaskBoardView {...props} {...useTaskBoardController(props)} />;
}

function TaskBoardView({
  allColumns,
  byStatus,
  canLoadMore,
  dndContextId,
  effectiveRows,
  filterQuery,
  loadError,
  loadingMore,
  loadMoreTasks,
  members,
  projects = EMPTY_PROJECT_OPTIONS,
  moveErrors,
  moveUi,
  onDragEnd,
  selectedTask,
  selectedTaskContext,
  selectedTaskId,
  selectedTaskPinned = false,
  selectedVisibleIds,
  sensors,
  setFilterQuery,
  setSelectedIds,
  filterParams = EMPTY_FILTER_PARAMS,
  totalCount,
  taskCategoriesEnabled = true,
  updateTask,
  updateTasks,
  updateTaskCategories,
  updatePrimaryProject,
  commitPrimaryProject,
  revertPrimaryProject,
  view,
  visibleRows,
  hydratedPrimaryProjects,
  pinnedObjectIdSet,
}: Props & ReturnType<typeof useTaskBoardController>) {
  return (
    <div
      className={
        selectedTask
          ? 'grid h-full min-h-0 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(22rem,0.34fr)]'
          : 'h-full min-h-0'
      }
    >
      <DndContext
        id={dndContextId}
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={onDragEnd}
      >
        <div className="flex h-full min-h-0 min-w-0 flex-col">
          <div className="flex w-full shrink-0 flex-wrap items-center justify-between gap-3 px-4 py-4 md:px-8">
            <ObjectTextFilter
              query={filterQuery}
              onQueryChange={setFilterQuery}
              resultCount={visibleRows.length}
              totalCount={effectiveRows.length}
            />
            <div className="flex flex-wrap items-center gap-3">
              {moveUi.saveState !== 'idle' ? (
                <output className="text-xs text-fg-dim" aria-live="polite">
                  {moveUi.saveState === 'saving'
                    ? `Saving${moveUi.savingCount > 1 ? ` ${moveUi.savingCount} moves` : ''}...`
                    : 'Saved'}
                </output>
              ) : null}
              <nav className="inline-flex overflow-hidden rounded-sm border border-border">
                {(['kanban', 'list'] as const).map((nextView) => (
                  <Link
                    key={nextView}
                    href={taskViewHref(nextView, selectedTaskId, filterParams)}
                    className={`px-3 py-1.5 text-xs ${
                      view === nextView
                        ? 'bg-signal text-signal-fg'
                        : 'bg-bg text-fg-muted hover:text-fg'
                    }`}
                  >
                    {nextView}
                  </Link>
                ))}
              </nav>
            </div>
          </div>
          {moveErrors.length > 0 ? (
            <p
              className="mx-4 mb-3 shrink-0 rounded-sm border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger md:mx-8"
              role="alert"
            >
              {moveErrors.length === 1
                ? moveErrors[0]
                : `${moveErrors.length} task moves failed. Clear the filter to inspect affected cards.`}
            </p>
          ) : null}
          {view === 'kanban' ? (
            <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto overflow-y-hidden px-4 pb-2 md:px-8">
              {allColumns.map((column) => (
                <TaskColumn
                  key={column}
                  id={column}
                  rows={byStatus.get(column) ?? []}
                  selectedTaskId={selectedTaskId}
                  savingCardIds={moveUi.savingCardIds}
                  cardErrors={moveUi.cardErrors}
                  members={members}
                  primaryProjects={hydratedPrimaryProjects}
                  taskHref={(taskId) => taskHref(taskId, filterParams)}
                  pinnedObjectIds={pinnedObjectIdSet}
                />
              ))}
            </div>
          ) : (
            <TaskListView
              rows={visibleRows}
              columns={allColumns}
              members={members}
              primaryProjects={hydratedPrimaryProjects}
              selectedTaskId={selectedTaskId}
              selectedIds={selectedVisibleIds}
              setSelectedIds={setSelectedIds}
              onUpdateTask={updateTask}
              onUpdateTasks={updateTasks}
              onUpdateTaskCategories={updateTaskCategories}
              taskCategoriesEnabled={taskCategoriesEnabled}
              filterParams={filterParams}
              pinnedObjectIds={pinnedObjectIdSet}
            />
          )}
          <div className="flex shrink-0 flex-wrap items-center gap-3 px-4 pb-4 pt-3 md:px-8">
            <output className="text-xs text-fg-dim" aria-live="polite">
              {`${effectiveRows.length} loaded of ${totalCount}`}
            </output>
            {canLoadMore ? (
              <button
                type="button"
                onClick={loadMoreTasks}
                disabled={loadingMore}
                className="h-8 rounded-sm border border-border bg-bg px-3 text-xs font-medium hover:bg-signal-soft disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loadingMore ? 'Loading…' : 'Load older tasks'}
              </button>
            ) : null}
            {loadError ? (
              <span className="text-xs text-danger" role="alert">
                {loadError}
              </span>
            ) : null}
          </div>
        </div>
      </DndContext>
      {selectedTask ? (
        <TaskDetailPanel
          task={selectedTask}
          connectedWork={selectedTaskContext}
          initialPinned={selectedTaskPinned}
          columns={allColumns}
          members={members}
          projects={projects}
          taskCategoriesEnabled={taskCategoriesEnabled}
          primaryProject={
            hydratedPrimaryProjects.find((project) => project.taskId === selectedTask.id) ?? null
          }
          closeHref={closeHref(view, filterParams)}
          objectHref={objectDetailHref(
            selectedTask.id,
            view === 'kanban'
              ? taskHref(selectedTask.id, filterParams)
              : taskViewHref(view, selectedTask.id, filterParams),
          )}
          onUpdate={updateTask}
          onProjectChange={(project) => {
            updatePrimaryProject(selectedTask.id, project);
          }}
          onProjectChangeCommitted={() => {
            commitPrimaryProject(selectedTask.id);
          }}
          onProjectChangeReverted={() => {
            revertPrimaryProject(selectedTask.id);
          }}
        />
      ) : null}
    </div>
  );
}

// react-doctor-disable-next-line react-doctor/no-multi-comp -- Task board subviews share task patch types, column state, and local selection behavior; moving them is a separate file-layout migration.
function TaskListView({
  rows,
  columns,
  members,
  primaryProjects,
  selectedTaskId,
  selectedIds,
  setSelectedIds,
  onUpdateTask,
  onUpdateTasks,
  onUpdateTaskCategories,
  taskCategoriesEnabled,
  filterParams,
  pinnedObjectIds,
}: {
  rows: objects.ObjectRow[];
  columns: string[];
  members: TaskMemberOption[];
  primaryProjects: objects.TaskPrimaryProjectRow[];
  selectedTaskId: string | null;
  selectedIds: ReadonlySet<string>;
  setSelectedIds: Dispatch<SetStateAction<ReadonlySet<string>>>;
  onUpdateTask: (id: string, patch: TaskPatch) => Promise<{ ok?: boolean; error?: string }>;
  onUpdateTasks: (ids: string[], patch: TaskPatch) => Promise<{ failed: number }>;
  onUpdateTaskCategories: (
    ids: string[],
    category: TaskCategory | 'automatic',
  ) => Promise<{ failed: number }>;
  taskCategoriesEnabled: boolean;
  filterParams: Record<string, string>;
  pinnedObjectIds: ReadonlySet<string>;
}) {
  if (rows.length === 0) {
    return (
      <p className="mx-4 rounded-sm border border-border bg-surface py-10 text-center text-xs text-fg-dim md:mx-8">
        No visible tasks
      </p>
    );
  }

  const renderedRows = rows.slice(0, TASK_BOARD_LIST_RENDER_LIMIT);
  const hiddenRows = rows.length - renderedRows.length;
  const allVisibleSelected = renderedRows.every((row) => selectedIds.has(row.id));

  function toggleAll(checked: boolean): void {
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const row of renderedRows) {
        if (checked) next.add(row.id);
        else next.delete(row.id);
      }
      return next;
    });
  }

  function toggleOne(id: string, checked: boolean): void {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 pb-4 md:px-8">
      <TaskBulkToolbar
        columns={columns}
        members={members}
        selectedIds={selectedIds}
        setSelectedIds={setSelectedIds}
        onUpdateTasks={onUpdateTasks}
        onUpdateTaskCategories={onUpdateTaskCategories}
        taskCategoriesEnabled={taskCategoriesEnabled}
      />
      <div className="min-h-0 flex-1 overflow-auto rounded-sm border border-border bg-surface">
        <table
          className={cn(
            'w-full text-sm',
            taskCategoriesEnabled ? 'min-w-[780px]' : 'min-w-[620px]',
          )}
        >
          <thead className="sticky top-0 z-10 border-b border-border bg-bg text-left text-xs text-fg-dim">
            <tr>
              <th className="w-10 px-3 py-2 font-normal">
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  onChange={(event) => {
                    toggleAll(event.currentTarget.checked);
                  }}
                  aria-label="Select all visible tasks"
                  className="size-4 rounded-sm border-border"
                />
              </th>
              <th className="px-3 py-2 font-normal">Task</th>
              <th className="px-3 py-2 font-normal">Status</th>
              {taskCategoriesEnabled ? <th className="px-3 py-2 font-normal">Category</th> : null}
              <th className="px-3 py-2 font-normal">Assignee</th>
              <th className="px-3 py-2 font-normal">Due</th>
              <th className="px-3 py-2 font-normal">Priority</th>
              <th className="w-10 px-2 py-2 font-normal">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {renderedRows.map((row) => (
              <TaskListRow
                key={row.id}
                row={row}
                columns={columns}
                members={members}
                primaryProject={
                  primaryProjects.find((project) => project.taskId === row.id) ?? null
                }
                selected={selectedIds.has(row.id)}
                highlighted={row.id === selectedTaskId}
                onSelectedChange={(checked) => {
                  toggleOne(row.id, checked);
                }}
                onUpdateTask={onUpdateTask}
                taskCategoriesEnabled={taskCategoriesEnabled}
                filterParams={filterParams}
                pinned={pinnedObjectIds.has(row.id)}
              />
            ))}
            {hiddenRows > 0 ? (
              <tr>
                <td
                  colSpan={taskCategoriesEnabled ? 8 : 7}
                  className="bg-bg px-3 py-3 text-center text-xs text-fg-dim"
                >
                  {hiddenRows} loaded tasks hidden. Narrow the filter to inspect them.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// react-doctor-disable-next-line react-doctor/no-multi-comp -- Inline row editor is tightly coupled to task board patch semantics and tested through the board.
function TaskListRow({
  row,
  columns,
  members,
  primaryProject,
  selected,
  highlighted,
  onSelectedChange,
  onUpdateTask,
  taskCategoriesEnabled,
  filterParams,
  pinned,
}: {
  row: objects.ObjectRow;
  columns: string[];
  members: TaskMemberOption[];
  primaryProject: objects.TaskPrimaryProjectRow | null;
  selected: boolean;
  highlighted: boolean;
  onSelectedChange: (checked: boolean) => void;
  onUpdateTask: (id: string, patch: TaskPatch) => Promise<{ ok?: boolean; error?: string }>;
  taskCategoriesEnabled: boolean;
  filterParams: Record<string, string>;
  pinned: boolean;
}) {
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const timezone = useWorkspaceTimezone();
  const title = displayObjectTitle(row);

  function save(field: string, patch: TaskPatch): void {
    setSaving(field);
    setError(null);
    startTransition(async () => {
      try {
        const result = await onUpdateTask(row.id, patch);
        if ('error' in result && result.error) setError(result.error);
      } catch (err) {
        setError(errorMessage(err, 'Save failed'));
      } finally {
        setSaving(null);
      }
    });
  }

  return (
    <tr
      style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 52px' }}
      className={cn(
        'border-t border-border transition-colors hover:bg-bg',
        highlighted && 'bg-signal-soft',
      )}
    >
      <td className="px-3 py-2 align-top">
        <input
          type="checkbox"
          checked={selected}
          onChange={(event) => {
            onSelectedChange(event.currentTarget.checked);
          }}
          aria-label={`Select ${displayText(title)}`}
          className="size-4 rounded-sm border-border"
        />
      </td>
      <td className="min-w-72 px-3 py-2 align-top">
        <Link
          href={taskViewHref('list', row.id, filterParams)}
          className="block whitespace-normal break-words font-medium leading-snug hover:underline"
        >
          {displayText(title)}
        </Link>
        <div className="mt-1 text-[11px] text-fg-dim">
          Task{primaryProject ? ` · ${primaryProject.projectName}` : ''}
        </div>
        {saving || error ? (
          <div className="mt-1 text-[11px]">
            {saving ? <span className="text-fg-dim">Saving {saving}…</span> : null}
            {error ? <span className="text-danger">{error}</span> : null}
          </div>
        ) : null}
      </td>
      <td className="min-w-36 px-3 py-2 align-top">
        <select
          value={taskDisplayStatus(row.status)}
          onChange={(event) => {
            save('status', { status: event.currentTarget.value });
          }}
          className="h-8 w-full rounded-sm border border-border bg-bg px-2 text-xs"
          aria-label={`Status for ${displayText(title)}`}
        >
          {columns.map((column) => (
            <option key={column} value={column}>
              {statusLabel(column)}
            </option>
          ))}
          {!columns.includes(taskDisplayStatus(row.status)) ? (
            <option value={row.status}>{statusLabel(row.status)}</option>
          ) : null}
        </select>
      </td>
      {taskCategoriesEnabled ? (
        <td className="min-w-40 px-3 py-2 align-top">
          <TaskCategoryBadge category={row.taskCategory} status={row.taskCategoryStatus} />
        </td>
      ) : null}
      <td className="min-w-40 px-3 py-2 align-top">
        <select
          value={row.assigneeUserId ?? ''}
          onChange={(event) => {
            save('assignee', { assigneeUserId: event.currentTarget.value || null });
          }}
          className="h-8 w-full rounded-sm border border-border bg-bg px-2 text-xs"
          aria-label={`Assignee for ${displayText(title)}`}
        >
          <option value="">Unassigned</option>
          {members.map((member) => (
            <option key={member.id} value={member.id}>
              {member.label}
            </option>
          ))}
        </select>
      </td>
      <td className="min-w-36 px-3 py-2 align-top">
        <input
          type="date"
          value={row.dueAt ? dateInputValue(row.dueAt, timezone) : ''}
          onChange={(event) => {
            const value = event.currentTarget.value;
            save('due date', { dueAt: value ? new Date(`${value}T00:00:00.000Z`) : null });
          }}
          className="h-8 w-full rounded-sm border border-border bg-bg px-2 text-xs"
          aria-label={`Due date for ${displayText(title)}`}
        />
        <DueDateDisplay value={row.dueAt} variant="field-hint" className="mt-1 block" />
      </td>
      <td className="min-w-28 px-3 py-2 align-top">
        <select
          value={row.priority ?? ''}
          onChange={(event) => {
            save('priority', {
              priority: event.currentTarget.value ? Number(event.currentTarget.value) : null,
            });
          }}
          className="h-8 w-full rounded-sm border border-border bg-bg px-2 text-xs"
          aria-label={`Priority for ${displayText(title)}`}
        >
          <option value="">None</option>
          {[1, 2, 3, 4].map((priority) => (
            <option key={priority} value={priority}>
              P{priority}
            </option>
          ))}
        </select>
      </td>
      <td className="px-2 py-1.5 align-top">
        <PinOverflowMenu
          target={{ kind: 'object', key: row.id }}
          title={displayText(title)}
          initialPinned={pinned}
        />
      </td>
    </tr>
  );
}

// react-doctor-disable-next-line react-doctor/no-multi-comp -- Bulk controls are local to the task list view and share the same selected-id contract.
function TaskBulkToolbar({
  columns,
  members,
  selectedIds,
  setSelectedIds,
  onUpdateTasks,
  onUpdateTaskCategories,
  taskCategoriesEnabled,
}: {
  columns: string[];
  members: TaskMemberOption[];
  selectedIds: ReadonlySet<string>;
  setSelectedIds: Dispatch<SetStateAction<ReadonlySet<string>>>;
  onUpdateTasks: (ids: string[], patch: TaskPatch) => Promise<{ failed: number }>;
  onUpdateTaskCategories: (
    ids: string[],
    category: TaskCategory | 'automatic',
  ) => Promise<{ failed: number }>;
  taskCategoriesEnabled: boolean;
}) {
  const [bulk, dispatchBulk] = useReducer(bulkReducer, columns[0] ?? 'todo', (status) => ({
    field: 'assignee' as const,
    status,
    assignee: '',
    due: '',
    priority: '',
    category: 'automatic' as const,
    message: null,
  }));
  const [pending, startTransition] = useTransition();
  const dialog = useAppDialog();
  const selectedCount = selectedIds.size;

  function currentPatch(): TaskPatch {
    if (bulk.field === 'status') return { status: bulk.status };
    if (bulk.field === 'assignee') return { assigneeUserId: bulk.assignee || null };
    if (bulk.field === 'due') {
      return { dueAt: bulk.due ? new Date(`${bulk.due}T00:00:00.000Z`) : null };
    }
    return { priority: bulk.priority ? Number(bulk.priority) : null };
  }

  async function applyBulk(): Promise<void> {
    if (selectedCount === 0) return;
    dispatchBulk({ type: 'message', message: null });
    const ids = [...selectedIds];
    if (
      bulk.field === 'category' &&
      bulk.category === 'automatic' &&
      !(await dialog.confirm({
        title: 'Use automatic category?',
        description: `${ids.length} selected ${ids.length === 1 ? 'task' : 'tasks'} will enqueue ${ids.length} model ${ids.length === 1 ? 'job' : 'jobs'}.`,
        confirmLabel: 'Use automatic',
      }))
    ) {
      return;
    }
    const patch = currentPatch();
    startTransition(async () => {
      const result =
        bulk.field === 'category'
          ? await onUpdateTaskCategories(ids, bulk.category)
          : await onUpdateTasks(ids, patch);
      if (result.failed > 0) {
        dispatchBulk({
          type: 'message',
          message: `${result.failed} of ${ids.length} updates failed.`,
        });
        return;
      }
      setSelectedIds(new Set());
      dispatchBulk({
        type: 'message',
        message: `Updated ${ids.length} ${ids.length === 1 ? 'task' : 'tasks'}.`,
      });
    });
  }

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 rounded-sm border border-border bg-surface px-3 py-2">
      <output className="mr-auto text-xs text-fg-dim" aria-live="polite">
        {selectedCount === 0
          ? 'Select tasks to edit'
          : `${selectedCount} ${selectedCount === 1 ? 'task' : 'tasks'} selected`}
      </output>
      <select
        value={bulk.field}
        onChange={(event) => {
          dispatchBulk({ type: 'field', field: event.currentTarget.value as BulkField });
        }}
        className="h-8 rounded-sm border border-border bg-bg px-2 text-xs"
        aria-label="Bulk field"
      >
        <option value="assignee">Assignee</option>
        <option value="due">Due date</option>
        <option value="priority">Priority</option>
        <option value="status">Status</option>
        {taskCategoriesEnabled ? <option value="category">Category</option> : null}
      </select>
      {bulk.field === 'status' ? (
        <select
          value={bulk.status}
          onChange={(event) => {
            dispatchBulk({ type: 'status', status: event.currentTarget.value });
          }}
          className="h-8 rounded-sm border border-border bg-bg px-2 text-xs"
          aria-label="Bulk status"
        >
          {columns.map((column) => (
            <option key={column} value={column}>
              {statusLabel(column)}
            </option>
          ))}
        </select>
      ) : null}
      {bulk.field === 'assignee' ? (
        <select
          value={bulk.assignee}
          onChange={(event) => {
            dispatchBulk({ type: 'assignee', assignee: event.currentTarget.value });
          }}
          className="h-8 rounded-sm border border-border bg-bg px-2 text-xs"
          aria-label="Bulk assignee"
        >
          <option value="">Unassigned</option>
          {members.map((member) => (
            <option key={member.id} value={member.id}>
              {member.label}
            </option>
          ))}
        </select>
      ) : null}
      {bulk.field === 'due' ? (
        <input
          type="date"
          value={bulk.due}
          onChange={(event) => {
            dispatchBulk({ type: 'due', due: event.currentTarget.value });
          }}
          className="h-8 rounded-sm border border-border bg-bg px-2 text-xs"
          aria-label="Bulk due date"
        />
      ) : null}
      {bulk.field === 'priority' ? (
        <select
          value={bulk.priority}
          onChange={(event) => {
            dispatchBulk({ type: 'priority', priority: event.currentTarget.value });
          }}
          className="h-8 rounded-sm border border-border bg-bg px-2 text-xs"
          aria-label="Bulk priority"
        >
          <option value="">None</option>
          {[1, 2, 3, 4].map((value) => (
            <option key={value} value={value}>
              P{value}
            </option>
          ))}
        </select>
      ) : null}
      {taskCategoriesEnabled && bulk.field === 'category' ? (
        <select
          value={bulk.category}
          onChange={(event) => {
            dispatchBulk({
              type: 'category',
              category: event.currentTarget.value as TaskCategory | 'automatic',
            });
          }}
          className="h-8 rounded-sm border border-border bg-bg px-2 text-xs"
          aria-label="Bulk category"
        >
          <option value="automatic">Use automatic category</option>
          {TASK_CATEGORY_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : null}
      <button
        type="button"
        disabled={selectedCount === 0 || pending}
        onClick={() => void applyBulk()}
        className="h-8 rounded-sm border border-border bg-bg px-3 text-xs font-medium hover:bg-signal-soft disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? 'Applying…' : 'Apply'}
      </button>
      {selectedCount > 0 ? (
        <button
          type="button"
          onClick={() => {
            setSelectedIds(new Set());
          }}
          className="h-8 rounded-sm border border-border bg-bg px-3 text-xs font-medium hover:bg-bg"
        >
          Clear
        </button>
      ) : null}
      {bulk.message ? <span className="text-xs text-fg-dim">{bulk.message}</span> : null}
      {dialog.node}
    </div>
  );
}

function bulkReducer(state: BulkState, action: BulkAction): BulkState {
  switch (action.type) {
    case 'field':
      return { ...state, field: action.field, message: null };
    case 'status':
      return { ...state, status: action.status, message: null };
    case 'assignee':
      return { ...state, assignee: action.assignee, message: null };
    case 'due':
      return { ...state, due: action.due, message: null };
    case 'priority':
      return { ...state, priority: action.priority, message: null };
    case 'category':
      return { ...state, category: action.category, message: null };
    case 'message':
      return { ...state, message: action.message };
  }
}

// react-doctor-disable-next-line react-doctor/no-multi-comp -- Kanban columns are local task-board presentation, not reusable app components.
function TaskColumn({
  id,
  rows,
  selectedTaskId,
  savingCardIds,
  cardErrors,
  members,
  primaryProjects,
  taskHref,
  pinnedObjectIds,
}: {
  id: string;
  rows: objects.ObjectRow[];
  selectedTaskId: string | null;
  savingCardIds: ReadonlySet<string>;
  cardErrors: Record<string, string>;
  members: TaskMemberOption[];
  primaryProjects: objects.TaskPrimaryProjectRow[];
  taskHref: (taskId: string) => string;
  pinnedObjectIds: ReadonlySet<string>;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  const renderedRows = rows.slice(0, TASK_BOARD_COLUMN_RENDER_LIMIT);
  const hiddenRows = rows.length - renderedRows.length;
  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex h-full w-[290px] shrink-0 flex-col rounded-sm border border-border bg-surface p-3',
        isOver && 'border-signal/40 bg-signal-soft',
      )}
    >
      <div className="mb-3 flex shrink-0 items-baseline justify-between">
        <h3 className="text-xs text-fg-dim">{statusLabel(id)}</h3>
        <span className="text-xs text-fg">{rows.length}</span>
      </div>
      <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
        {renderedRows.map((row) => (
          <TaskCard
            key={row.id}
            row={row}
            href={taskHref(row.id)}
            selected={row.id === selectedTaskId}
            saving={savingCardIds.has(row.id)}
            error={cardErrors[row.id]}
            members={members}
            primaryProject={primaryProjects.find((project) => project.taskId === row.id) ?? null}
            pinned={pinnedObjectIds.has(row.id)}
          />
        ))}
        {hiddenRows > 0 ? (
          <li className="rounded-sm border border-border bg-bg px-3 py-2 text-center text-xs text-fg-dim">
            {hiddenRows} loaded tasks hidden. Narrow filter.
          </li>
        ) : null}
      </ul>
    </div>
  );
}

// react-doctor-disable-next-line react-doctor/no-multi-comp -- Cards depend on task-board drag state and patch rendering conventions.
function TaskCard({
  row,
  href,
  selected,
  saving,
  error,
  members,
  primaryProject,
  pinned,
}: {
  row: objects.ObjectRow;
  href: string;
  selected: boolean;
  saving: boolean;
  error?: string;
  members: TaskMemberOption[];
  primaryProject: objects.TaskPrimaryProjectRow | null;
  pinned: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: row.id,
    disabled: saving,
  });
  const style = transform
    ? { transform: `translate3d(${String(transform.x)}px,${String(transform.y)}px,0)` }
    : undefined;
  const title = displayObjectTitle(row);
  return (
    <li
      ref={setNodeRef}
      style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 112px', ...style }}
      {...attributes}
      {...listeners}
      className={cn(
        'cursor-grab rounded-sm border border-border bg-bg px-3 py-2 text-sm transition-colors hover:border-border-strong',
        selected && 'border-signal bg-signal-soft shadow-[inset_3px_0_0_var(--color-signal)]',
        isDragging && 'opacity-50',
        saving && 'cursor-progress opacity-80',
        error && 'border-danger/50',
      )}
    >
      <div className="flex min-w-0 items-start gap-1">
        <Link
          href={href}
          className="min-w-0 flex-1 whitespace-normal break-words font-medium leading-snug hover:underline"
        >
          {displayText(title)}
        </Link>
        <PinOverflowMenu
          target={{ kind: 'object', key: row.id }}
          title={displayText(title)}
          initialPinned={pinned}
        />
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-fg-dim">
        <span>Task</span>
        <TaskCategoryBadge category={row.taskCategory} status={row.taskCategoryStatus} />
        {primaryProject ? (
          <span className="max-w-full truncate" title={primaryProject.projectName}>
            {primaryProject.projectName}
            {primaryProject.archivedAt ? ' · Archived' : ''}
          </span>
        ) : null}
      </div>
      <div className="mt-2 grid grid-cols-3 gap-px overflow-hidden rounded-sm border border-border bg-border text-[11px]">
        <CardMeta value={memberLabel(row.assigneeUserId, members)} missing={!row.assigneeUserId} />
        <CardMeta value={<DueDateDisplay value={row.dueAt} variant="compact" />} />
        <CardMeta
          value={row.priority ? `P${row.priority}` : 'No priority'}
          missing={!row.priority}
        />
      </div>
      {error ? <p className="mt-2 text-xs text-danger">{error}</p> : null}
    </li>
  );
}

// react-doctor-disable-next-line react-doctor/no-multi-comp -- The side panel is the task board's selected-row editor and shares the same update path.
function TaskDetailPanel({
  task,
  connectedWork,
  initialPinned,
  columns,
  members,
  projects,
  taskCategoriesEnabled,
  primaryProject,
  closeHref,
  objectHref,
  onUpdate,
  onProjectChange,
  onProjectChangeCommitted,
  onProjectChangeReverted,
}: {
  task: objects.ObjectRow;
  connectedWork?: objects.ObjectDetail['connectedWork'] | null;
  initialPinned: boolean;
  columns: string[];
  members: TaskMemberOption[];
  projects: TaskMemberOption[];
  taskCategoriesEnabled: boolean;
  primaryProject: objects.TaskPrimaryProjectRow | null;
  closeHref: string;
  objectHref: string;
  onUpdate: (id: string, patch: TaskPatch) => Promise<{ ok?: boolean; error?: string }>;
  onProjectChange: (project: { id: string; label: string } | null) => void;
  onProjectChangeCommitted: () => void;
  onProjectChangeReverted: () => void;
}) {
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timezone = useWorkspaceTimezone();
  const title = displayObjectTitle(task);

  function save(field: string, patch: TaskPatch): void {
    setSaving(field);
    setError(null);
    void onUpdate(task.id, patch)
      .then((result) => {
        if ('error' in result && result.error) setError(result.error);
      })
      .catch((err: unknown) => {
        setError(errorMessage(err, 'Save failed'));
      })
      .finally(() => {
        setSaving(null);
      });
  }

  return (
    <aside
      className="h-full overflow-y-auto rounded-sm border border-border bg-bg"
      aria-label="Task detail"
    >
      <div className="border-b border-border p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="whitespace-normal break-words text-lg font-semibold leading-snug text-fg">
              {displayText(title)}
            </h2>
            <p className="mt-1 text-xs text-fg-dim">Task · side panel</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <ObjectPinButton
              key={task.id}
              objectId={task.id}
              initialPinned={initialPinned}
              compact
            />
            <Link href={closeHref} className="text-xs text-fg-muted hover:text-fg hover:underline">
              Close
            </Link>
          </div>
        </div>
      </div>
      <div className="grid border-b border-border sm:grid-cols-2">
        <TaskField label="Project">
          <TaskProjectSelect
            taskId={task.id}
            projectId={primaryProject?.projectId ?? null}
            currentProjectLabel={primaryProject?.projectName}
            projectArchived={Boolean(primaryProject?.archivedAt)}
            projects={projects}
            onProjectChange={onProjectChange}
            onProjectChangeCommitted={onProjectChangeCommitted}
            onProjectChangeReverted={onProjectChangeReverted}
          />
        </TaskField>
        {taskCategoriesEnabled ? (
          <TaskField label="Category">
            <TaskCategorySelect
              taskId={task.id}
              category={task.taskCategory}
              mode={task.taskCategoryMode}
              status={task.taskCategoryStatus}
              updatedAt={task.taskCategoryUpdatedAt}
            />
          </TaskField>
        ) : null}
        <TaskField label="Status">
          <select
            value={taskDisplayStatus(task.status)}
            onChange={(event) => {
              save('status', { status: event.currentTarget.value });
            }}
            className="h-9 w-full rounded-sm border border-border bg-bg px-2 text-sm"
          >
            {columns.map((column) => (
              <option key={column} value={column}>
                {statusLabel(column)}
              </option>
            ))}
            {!columns.includes(taskDisplayStatus(task.status)) ? (
              <option value={task.status}>{statusLabel(task.status)}</option>
            ) : null}
          </select>
        </TaskField>
        <TaskField label="Assignee">
          <select
            value={task.assigneeUserId ?? ''}
            onChange={(event) => {
              save('assignee', { assigneeUserId: event.currentTarget.value || null });
            }}
            className="h-9 w-full rounded-sm border border-border bg-bg px-2 text-sm"
            aria-label="Task assignee"
          >
            <option value="">Unassigned</option>
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.label}
              </option>
            ))}
          </select>
        </TaskField>
        <TaskField label="Due">
          <input
            type="date"
            value={task.dueAt ? dateInputValue(task.dueAt, timezone) : ''}
            onChange={(event) => {
              const value = event.currentTarget.value;
              save('due date', { dueAt: value ? new Date(`${value}T00:00:00.000Z`) : null });
            }}
            className="h-9 w-full rounded-sm border border-border bg-bg px-2 text-sm"
            aria-label="Task due date"
          />
          <DueDateDisplay value={task.dueAt} variant="field-hint" className="mt-1 block" />
        </TaskField>
        <TaskField label="Priority">
          <select
            value={task.priority ?? ''}
            onChange={(event) => {
              save('priority', {
                priority: event.currentTarget.value ? Number(event.currentTarget.value) : null,
              });
            }}
            className="h-9 w-full rounded-sm border border-border bg-bg px-2 text-sm"
            aria-label="Task priority"
          >
            <option value="">No priority</option>
            {[1, 2, 3, 4].map((priority) => (
              <option key={priority} value={priority}>
                P{priority}
              </option>
            ))}
          </select>
        </TaskField>
      </div>
      <div className="grid border-b border-border sm:grid-cols-2">
        <Detail label="Current assignee" value={memberLabel(task.assigneeUserId, members)} />
        <Detail
          label="Current due"
          value={<DueDateDisplay value={task.dueAt} variant="inline" />}
        />
        <Detail label="Current priority" value={task.priority ? `P${task.priority}` : '-'} />
        <Detail label="Updated" value={dateLabel(task.updatedAt)} />
      </div>
      {saving || error ? (
        <div className="border-b border-border px-4 py-3 text-xs">
          {saving ? <span className="text-fg-dim">Saving {saving}…</span> : null}
          {error ? <span className="text-danger">{error}</span> : null}
        </div>
      ) : null}
      <ObjectRelatedContext connectedWork={connectedWork} compact />
      <div className="flex flex-wrap gap-2 p-4">
        <Link
          href={objectHref}
          className="rounded-sm border border-border px-3 py-2 text-sm font-medium hover:bg-surface"
        >
          Open object
        </Link>
      </div>
    </aside>
  );
}

// react-doctor-disable-next-line react-doctor/no-multi-comp -- Tiny local field wrapper for the task detail panel.
function TaskField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="border-b border-r border-border p-4">
      <span className="mb-2 block text-xs text-fg-dim">{label}</span>
      {children}
    </label>
  );
}

// react-doctor-disable-next-line react-doctor/no-multi-comp -- Tiny local read-only field wrapper for the task detail panel.
function Detail({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="border-b border-r border-border p-4">
      <div className="text-xs text-fg-dim">{label}</div>
      <div className="mt-2 text-sm text-fg">
        {typeof value === 'string' ? displayText(value) : value}
      </div>
    </div>
  );
}

// react-doctor-disable-next-line react-doctor/no-multi-comp -- Tiny local card metadata cell for task cards.
function CardMeta({
  value,
  missing,
  danger = false,
}: {
  value: ReactNode;
  missing?: boolean;
  danger?: boolean;
}) {
  return (
    <span
      className={cn(
        'truncate bg-bg px-1.5 py-1 text-fg',
        missing && 'text-fg-dim',
        danger && 'text-danger',
      )}
    >
      {typeof value === 'string' ? displayText(value) : value}
    </span>
  );
}

function memberLabel(userId: string | null, members: TaskMemberOption[]): string {
  if (!userId) return 'Unassigned';
  return members.find((member) => member.id === userId)?.label ?? 'Assigned';
}

function dateInputValue(value: Date, timezone: string): string {
  return presentDueDate(value, { timezone }).dateKey ?? '';
}

function dateLabel(value: Date): string {
  return new Date(value).toISOString().slice(0, 10);
}

'use client';

import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { useQueries } from '@tanstack/react-query';
import { TASK_CATEGORY_OPTIONS, type TaskCategory } from '@timeline/shared/task-categories/types';
import { presentDueDate } from '@timeline/shared/time';
import { GripVertical } from 'lucide-react';
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
import { ChatViewContextBinder } from '@/components/chat/chat-view-context';
import { CollectionGroup } from '@/components/collections/collection-group';
import { CollectionRow } from '@/components/collections/collection-row';
import {
  CollectionStatus,
  priorityTone,
  statusTone,
} from '@/components/collections/collection-status';
import { EditableMetadata } from '@/components/collections/editable-metadata';
import { InfiniteScroll } from '@/components/collections/infinite-scroll';
import { MetadataDateEditor } from '@/components/collections/metadata-date-editor';
import { SelectionBar } from '@/components/collections/selection-bar';
import { VirtualList } from '@/components/collections/virtual-list';
import { DueDateDisplay } from '@/components/due-date-display';
import { ObjectPinButton } from '@/components/objects/object-pin-button';
import { ObjectRelatedContext } from '@/components/objects/object-related-context';
import { PinOverflowMenu } from '@/components/pins/pin-overflow-menu';
import { TaskCategoryBadge } from '@/components/tasks/task-category-badge';
import { useTaskCategoryPolling } from '@/components/tasks/task-category-polling';
import { TaskCategorySelect } from '@/components/tasks/task-category-select';
import { TaskProjectSelect } from '@/components/tasks/task-project-select';
import { taskViewHref, type TaskView } from '@/components/tasks/task-view';
import { useAppDialog } from '@/components/ui/app-dialog';
import { ItemActionGroup } from '@/components/ui/item-actions';
import { useWorkspaceTimezone } from '@/components/workspace-timezone-context';
import { chatViewLabel } from '@/lib/chat-view';
import { displayText } from '@/lib/display-dates';
import { kanbanCollisionDetection } from '@/lib/kanban-collision';
import { objectDetailHref } from '@/lib/object-links';
import { displayObjectTitle } from '@/lib/object-title';
import { statusLabel } from '@/lib/status-labels';
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
  const { rowPatches } = boardState;
  const loadError = boardState.loadErrorFilterKey === filterKey ? boardState.loadError : null;
  const selectedIds =
    boardState.selectedFilterKey === filterKey ? boardState.selectedIds : EMPTY_SELECTED_IDS;
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
  const visibleRows = effectiveRows;
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
  const canLoadMore = Boolean(cursor);

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
    loadError,
    loadingMore,
    loadMoreTasks,
    moveErrors,
    moveUi,
    onDragEnd,
    selectedTask,
    selectedVisibleIds,
    sensors,
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
  setSelectedIds,
  filterParams = EMPTY_FILTER_PARAMS,
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
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const activeDragRow = activeDragId
    ? (effectiveRows.find((row) => row.id === activeDragId) ?? null)
    : null;

  function handleDragStart(event: DragStartEvent): void {
    setActiveDragId(String(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent): void {
    setActiveDragId(null);
    onDragEnd(event);
  }

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
        collisionDetection={kanbanCollisionDetection}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="flex h-full min-h-0 min-w-0 flex-col">
          {moveUi.saveState !== 'idle' ? (
            <output className="shrink-0 px-2 py-1.5 text-xs text-fg-dim sm:px-3" aria-live="polite">
              {moveUi.saveState === 'saving'
                ? `Saving${moveUi.savingCount > 1 ? ` ${moveUi.savingCount} moves` : ''}...`
                : 'Saved'}
            </output>
          ) : null}
          {moveErrors.length > 0 ? (
            <p
              className="mx-2 mb-3 shrink-0 rounded-sm border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger sm:mx-3"
              role="alert"
            >
              {moveErrors.length === 1
                ? moveErrors[0]
                : `${moveErrors.length} task moves failed. Clear the filter to inspect affected cards.`}
            </p>
          ) : null}
          {view === 'kanban' ? (
            <section
              aria-label="Task status columns"
              className="flex min-h-0 flex-1 gap-3 overflow-x-auto overflow-y-hidden px-2 pb-2 sm:px-3"
            >
              {allColumns.map((column) => (
                <TaskColumn
                  key={column}
                  id={column}
                  rows={byStatus.get(column) ?? []}
                  selectedTaskId={selectedTaskId}
                  savingCardIds={moveUi.savingCardIds}
                  cardErrors={moveUi.cardErrors}
                  members={members}
                  projects={projects}
                  primaryProjects={hydratedPrimaryProjects}
                  taskCategoriesEnabled={taskCategoriesEnabled}
                  onUpdateTask={updateTask}
                  onProjectChange={updatePrimaryProject}
                  onProjectChangeCommitted={commitPrimaryProject}
                  onProjectChangeReverted={revertPrimaryProject}
                  taskHref={(taskId) => taskHref(taskId, filterParams)}
                  pinnedObjectIds={pinnedObjectIdSet}
                  canLoadMore={canLoadMore}
                  loadingMore={loadingMore}
                  loadError={loadError}
                  onLoadMore={loadMoreTasks}
                />
              ))}
            </section>
          ) : (
            <TaskListView
              rows={visibleRows}
              columns={allColumns}
              members={members}
              projects={projects}
              primaryProjects={hydratedPrimaryProjects}
              selectedTaskId={selectedTaskId}
              selectedIds={selectedVisibleIds}
              setSelectedIds={setSelectedIds}
              onUpdateTask={updateTask}
              onUpdateTasks={updateTasks}
              onUpdateTaskCategories={updateTaskCategories}
              onProjectChange={updatePrimaryProject}
              onProjectChangeCommitted={commitPrimaryProject}
              onProjectChangeReverted={revertPrimaryProject}
              taskCategoriesEnabled={taskCategoriesEnabled}
              filterParams={filterParams}
              pinnedObjectIds={pinnedObjectIdSet}
              canLoadMore={canLoadMore}
              loadingMore={loadingMore}
              loadError={loadError}
              onLoadMore={loadMoreTasks}
            />
          )}
          {view === 'kanban' &&
          effectiveRows.length > 0 &&
          !canLoadMore &&
          !loadingMore &&
          !loadError ? (
            <p role="status" className="shrink-0 px-4 py-2 text-center text-xs text-fg-dim md:px-8">
              No more matching tasks
            </p>
          ) : null}
        </div>
        <DragOverlay>
          {activeDragRow ? (
            <div className="rounded-sm border border-signal bg-bg px-2.5 py-2 text-sm shadow-md">
              {displayObjectTitle(activeDragRow)}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
      {selectedTask ? (
        <ChatViewContextBinder
          viewKey={`task:${selectedTask.id}`}
          kind="task"
          href={
            view === 'kanban'
              ? taskHref(selectedTask.id, filterParams)
              : taskViewHref(view, selectedTask.id, filterParams)
          }
          label={chatViewLabel(displayObjectTitle(selectedTask), 'Task')}
          taskId={selectedTask.id}
        />
      ) : null}
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
  projects,
  primaryProjects,
  selectedTaskId,
  selectedIds,
  setSelectedIds,
  onUpdateTask,
  onUpdateTasks,
  onUpdateTaskCategories,
  onProjectChange,
  onProjectChangeCommitted,
  onProjectChangeReverted,
  taskCategoriesEnabled,
  filterParams,
  pinnedObjectIds,
  canLoadMore,
  loadingMore,
  loadError,
  onLoadMore,
}: {
  rows: objects.ObjectRow[];
  columns: string[];
  members: TaskMemberOption[];
  projects: TaskMemberOption[];
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
  onProjectChange: (taskId: string, project: TaskMemberOption | null) => void;
  onProjectChangeCommitted: (taskId: string) => void;
  onProjectChangeReverted: (taskId: string) => void;
  taskCategoriesEnabled: boolean;
  filterParams: Record<string, string>;
  pinnedObjectIds: ReadonlySet<string>;
  canLoadMore: boolean;
  loadingMore: boolean;
  loadError: string | null;
  onLoadMore: () => void;
}) {
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  if (rows.length === 0) {
    return (
      <p className="rounded-sm border-y border-border bg-surface py-10 text-center text-xs text-fg-dim">
        No visible tasks
      </p>
    );
  }

  const orderedStatuses = Array.from(
    new Set([...columns, ...rows.map((row) => taskDisplayStatus(row.status))]),
  );
  const groupedRows = orderedStatuses.flatMap((status) => {
    const groupRows = rows.filter((row) => taskDisplayStatus(row.status) === status);
    return groupRows.length > 0 ? [{ status, rows: groupRows }] : [];
  });

  function toggleOne(id: string, checked: boolean): void {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  return (
    <div data-task-list className="flex min-h-0 flex-1 flex-col">
      <TaskBulkToolbar
        columns={columns}
        members={members}
        selectedIds={selectedIds}
        setSelectedIds={setSelectedIds}
        onUpdateTasks={onUpdateTasks}
        onUpdateTaskCategories={onUpdateTaskCategories}
        taskCategoriesEnabled={taskCategoriesEnabled}
      />
      <div ref={setScrollEl} className="min-h-0 flex-1 overflow-y-auto bg-bg">
        {groupedRows.map((group) => {
          const groupSelected = group.rows.every((row) => selectedIds.has(row.id));
          return (
            <CollectionGroup
              key={group.status}
              title={statusLabel(group.status)}
              count={group.rows.length}
              tone={statusTone(group.status)}
              icon={
                <CollectionStatus value={group.status} label={statusLabel(group.status)} compact />
              }
              actions={
                <label className="flex min-h-10 items-center px-2">
                  <span className="sr-only">Select all {statusLabel(group.status)} tasks</span>
                  <input
                    type="checkbox"
                    checked={groupSelected}
                    onChange={(event) => {
                      const checked = event.currentTarget.checked;
                      setSelectedIds((current) => {
                        const next = new Set(current);
                        for (const row of group.rows) {
                          if (checked) next.add(row.id);
                          else next.delete(row.id);
                        }
                        return next;
                      });
                    }}
                    className="size-4 rounded-sm border-border"
                  />
                </label>
              }
            >
              <VirtualList
                items={group.rows}
                getItemKey={(row) => row.id}
                estimateSize={48}
                getScrollElement={() => scrollEl}
                renderItem={(row) => (
                  <TaskListRow
                    row={row}
                    columns={columns}
                    members={members}
                    projects={projects}
                    primaryProject={
                      primaryProjects.find((project) => project.taskId === row.id) ?? null
                    }
                    selected={selectedIds.has(row.id)}
                    highlighted={row.id === selectedTaskId}
                    onSelectedChange={(checked) => {
                      toggleOne(row.id, checked);
                    }}
                    onUpdateTask={onUpdateTask}
                    onProjectChange={onProjectChange}
                    onProjectChangeCommitted={onProjectChangeCommitted}
                    onProjectChangeReverted={onProjectChangeReverted}
                    taskCategoriesEnabled={taskCategoriesEnabled}
                    filterParams={filterParams}
                    pinned={pinnedObjectIds.has(row.id)}
                  />
                )}
              />
            </CollectionGroup>
          );
        })}
        <InfiniteScroll
          hasMore={canLoadMore}
          loading={loadingMore}
          error={loadError}
          onLoadMore={onLoadMore}
          boundLabel="No more matching tasks"
          root={scrollEl}
        />
      </div>
    </div>
  );
}

// react-doctor-disable-next-line react-doctor/no-multi-comp -- Inline row editor is tightly coupled to task board patch semantics and tested through the board.
function TaskListRow({
  row,
  columns,
  members,
  projects,
  primaryProject,
  selected,
  highlighted,
  onSelectedChange,
  onUpdateTask,
  onProjectChange,
  onProjectChangeCommitted,
  onProjectChangeReverted,
  taskCategoriesEnabled,
  filterParams,
  pinned,
}: {
  row: objects.ObjectRow;
  columns: string[];
  members: TaskMemberOption[];
  projects: TaskMemberOption[];
  primaryProject: objects.TaskPrimaryProjectRow | null;
  selected: boolean;
  highlighted: boolean;
  onSelectedChange: (checked: boolean) => void;
  onUpdateTask: (id: string, patch: TaskPatch) => Promise<{ ok?: boolean; error?: string }>;
  onProjectChange: (taskId: string, project: TaskMemberOption | null) => void;
  onProjectChangeCommitted: (taskId: string) => void;
  onProjectChangeReverted: (taskId: string) => void;
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

  const assignee = members.find((member) => member.id === row.assigneeUserId);

  return (
    <div style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 44px' }}>
      <CollectionRow
        selected={highlighted || selected}
        leading={
          <input
            type="checkbox"
            checked={selected}
            onChange={(event) => {
              onSelectedChange(event.currentTarget.checked);
            }}
            aria-label={`Select ${displayText(title)}`}
            className={cn(
              'size-4 rounded-sm border-border transition-opacity md:opacity-0 md:group-hover/collection-row:opacity-100 md:focus:opacity-100',
              selected && 'md:opacity-100',
            )}
          />
        }
        title={
          <Link
            href={taskViewHref('list', row.id, filterParams)}
            className="block truncate hover:underline"
          >
            {displayText(title)}
          </Link>
        }
        context={
          error ? (
            <span className="text-danger" role="alert">
              {error}
            </span>
          ) : saving ? (
            <span>Saving {saving}…</span>
          ) : undefined
        }
        metadata={
          <>
            <EditableMetadata
              label={`Status for ${displayText(title)}`}
              pending={saving === 'status'}
              value={
                <CollectionStatus
                  value={row.status}
                  label={statusLabel(taskDisplayStatus(row.status))}
                />
              }
              editor={
                <select
                  value={taskDisplayStatus(row.status)}
                  onChange={(event) => {
                    save('status', { status: event.currentTarget.value });
                  }}
                  className="h-10 w-full rounded-sm border border-border bg-bg px-2 text-xs"
                  aria-label="Status"
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
              }
            />
            {taskCategoriesEnabled ? (
              <EditableMetadata
                label={`Category for ${displayText(title)}`}
                value={
                  <TaskCategoryBadge category={row.taskCategory} status={row.taskCategoryStatus} />
                }
                editor={
                  <TaskCategorySelect
                    taskId={row.id}
                    category={row.taskCategory}
                    mode={row.taskCategoryMode}
                    status={row.taskCategoryStatus}
                    updatedAt={row.taskCategoryUpdatedAt}
                  />
                }
              />
            ) : null}
            <EditableMetadata
              label={`Project for ${displayText(title)}`}
              value={primaryProject?.projectName ?? 'No project'}
              editor={
                <TaskProjectSelect
                  taskId={row.id}
                  projectId={primaryProject?.projectId ?? null}
                  currentProjectLabel={primaryProject?.projectName}
                  projectArchived={Boolean(primaryProject?.archivedAt)}
                  projects={projects}
                  onProjectChange={(project) => {
                    onProjectChange(row.id, project);
                  }}
                  onProjectChangeCommitted={() => {
                    onProjectChangeCommitted(row.id);
                  }}
                  onProjectChangeReverted={() => {
                    onProjectChangeReverted(row.id);
                  }}
                />
              }
            />
            <EditableMetadata
              label={`Assignee for ${displayText(title)}`}
              pending={saving === 'assignee'}
              value={assignee?.label ?? 'Unassigned'}
              editor={
                <select
                  value={row.assigneeUserId ?? ''}
                  onChange={(event) => {
                    save('assignee', { assigneeUserId: event.currentTarget.value || null });
                  }}
                  className="h-10 w-full rounded-sm border border-border bg-bg px-2 text-xs"
                  aria-label="Assignee"
                >
                  <option value="">Unassigned</option>
                  {members.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.label}
                    </option>
                  ))}
                </select>
              }
            />
            <EditableMetadata
              label={`Due date for ${displayText(title)}`}
              pending={saving === 'due date'}
              value={<DueDateDisplay value={row.dueAt} variant="field-hint" />}
              editor={
                <MetadataDateEditor
                  defaultValue={row.dueAt ? dateInputValue(row.dueAt, timezone) : ''}
                  onApply={(value) => {
                    save('due date', {
                      dueAt: value ? new Date(`${value}T00:00:00.000Z`) : null,
                    });
                  }}
                />
              }
            />
            <EditableMetadata
              label={`Priority for ${displayText(title)}`}
              pending={saving === 'priority'}
              value={
                <CollectionStatus
                  value={row.priority ? `p${row.priority}` : 'none'}
                  tone={priorityTone(row.priority)}
                  label={row.priority ? `P${row.priority}` : 'No priority'}
                />
              }
              editor={
                <select
                  value={row.priority ?? ''}
                  onChange={(event) => {
                    save('priority', {
                      priority: event.currentTarget.value
                        ? Number(event.currentTarget.value)
                        : null,
                    });
                  }}
                  className="h-10 w-full rounded-sm border border-border bg-bg px-2 text-xs"
                  aria-label="Priority"
                >
                  <option value="">None</option>
                  {[1, 2, 3, 4].map((priority) => (
                    <option key={priority} value={priority}>
                      P{priority}
                    </option>
                  ))}
                </select>
              }
            />
          </>
        }
        actions={
          <ItemActionGroup label={`Actions for ${displayText(title)}`}>
            <PinOverflowMenu
              target={{ kind: 'object', key: row.id }}
              title={displayText(title)}
              initialPinned={pinned}
            />
          </ItemActionGroup>
        }
      />
    </div>
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
    <>
      <SelectionBar
        count={selectedCount}
        label={selectedCount === 1 ? 'task selected' : 'tasks selected'}
        onClear={() => {
          setSelectedIds(new Set());
        }}
        className="shrink-0"
        actions={
          <>
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
              disabled={pending}
              onClick={() => void applyBulk()}
              className="h-8 rounded-sm border border-border bg-bg px-3 text-xs font-medium hover:bg-signal-soft disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pending ? 'Applying…' : 'Apply'}
            </button>
            {dialog.node}
          </>
        }
      />
      {bulk.message ? (
        <p className="px-3 py-1.5 text-xs text-fg-dim" role="status">
          {bulk.message}
        </p>
      ) : null}
    </>
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
  projects,
  primaryProjects,
  taskCategoriesEnabled,
  onUpdateTask,
  onProjectChange,
  onProjectChangeCommitted,
  onProjectChangeReverted,
  taskHref,
  pinnedObjectIds,
  canLoadMore,
  loadingMore,
  loadError,
  onLoadMore,
}: {
  id: string;
  rows: objects.ObjectRow[];
  selectedTaskId: string | null;
  savingCardIds: ReadonlySet<string>;
  cardErrors: Record<string, string>;
  members: TaskMemberOption[];
  projects: TaskMemberOption[];
  primaryProjects: objects.TaskPrimaryProjectRow[];
  taskCategoriesEnabled: boolean;
  onUpdateTask: (id: string, patch: TaskPatch) => Promise<{ ok?: boolean; error?: string }>;
  onProjectChange: (taskId: string, project: TaskMemberOption | null) => void;
  onProjectChangeCommitted: (taskId: string) => void;
  onProjectChangeReverted: (taskId: string) => void;
  taskHref: (taskId: string) => string;
  pinnedObjectIds: ReadonlySet<string>;
  canLoadMore: boolean;
  loadingMore: boolean;
  loadError: string | null;
  onLoadMore: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  const headingId = useId();
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  return (
    <section
      ref={setNodeRef}
      aria-labelledby={headingId}
      className={cn(
        'flex h-full w-[min(260px,calc(100vw-2.5rem))] shrink-0 flex-col rounded-sm border border-border bg-surface p-2',
        isOver && 'border-signal/40 bg-signal-soft',
      )}
    >
      <div className="mb-2 flex shrink-0 items-baseline justify-between px-0.5">
        <h3 id={headingId} className="text-xs text-fg-dim">
          {statusLabel(id)}
        </h3>
        <span className="text-xs text-fg">{rows.length}</span>
      </div>
      <div ref={setScrollEl} className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <VirtualList
          items={rows}
          getItemKey={(row) => row.id}
          estimateSize={120}
          gap={8}
          getScrollElement={() => scrollEl}
          renderItem={(row) => (
            <TaskCard
              row={row}
              href={taskHref(row.id)}
              selected={row.id === selectedTaskId}
              saving={savingCardIds.has(row.id)}
              error={cardErrors[row.id]}
              members={members}
              projects={projects}
              primaryProject={primaryProjects.find((project) => project.taskId === row.id) ?? null}
              taskCategoriesEnabled={taskCategoriesEnabled}
              onUpdateTask={onUpdateTask}
              onProjectChange={onProjectChange}
              onProjectChangeCommitted={onProjectChangeCommitted}
              onProjectChangeReverted={onProjectChangeReverted}
              pinned={pinnedObjectIds.has(row.id)}
            />
          )}
        />
        <InfiniteScroll
          hasMore={canLoadMore}
          loading={loadingMore}
          error={loadError}
          onLoadMore={onLoadMore}
          boundLabel="No more matching tasks"
          hideBound
          root={scrollEl}
        />
      </div>
    </section>
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
  projects,
  primaryProject,
  taskCategoriesEnabled,
  onUpdateTask,
  onProjectChange,
  onProjectChangeCommitted,
  onProjectChangeReverted,
  pinned,
}: {
  row: objects.ObjectRow;
  href: string;
  selected: boolean;
  saving: boolean;
  error?: string;
  members: TaskMemberOption[];
  projects: TaskMemberOption[];
  primaryProject: objects.TaskPrimaryProjectRow | null;
  taskCategoriesEnabled: boolean;
  onUpdateTask: (id: string, patch: TaskPatch) => Promise<{ ok?: boolean; error?: string }>;
  onProjectChange: (taskId: string, project: TaskMemberOption | null) => void;
  onProjectChangeCommitted: (taskId: string) => void;
  onProjectChangeReverted: (taskId: string) => void;
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
  const [metadataSaving, setMetadataSaving] = useState(false);
  const [metadataError, setMetadataError] = useState<string | null>(null);
  const saveMetadata = (patch: TaskPatch) => {
    setMetadataSaving(true);
    setMetadataError(null);
    void onUpdateTask(row.id, patch)
      .then((result) => {
        if (result.error) setMetadataError(result.error);
      })
      .catch((cause: unknown) => {
        setMetadataError(errorMessage(cause, 'Save failed'));
      })
      .finally(() => {
        setMetadataSaving(false);
      });
  };
  return (
    <article
      ref={setNodeRef}
      style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 76px', ...style }}
      className={cn(
        'rounded-sm border border-border/80 bg-bg px-2 py-1.5 text-sm transition-colors hover:bg-surface',
        selected && 'border-signal bg-signal-soft shadow-[inset_3px_0_0_var(--color-signal)]',
        isDragging && 'opacity-50',
        saving && 'opacity-80',
        error && 'border-danger/50',
      )}
    >
      <div className="flex min-w-0 items-start gap-0.5">
        <button
          type="button"
          {...attributes}
          {...listeners}
          disabled={saving}
          className="-ml-1 inline-flex size-8 shrink-0 cursor-grab items-center justify-center rounded-sm text-fg-dim hover:bg-surface-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/50 active:cursor-grabbing disabled:cursor-progress"
          aria-label={`Drag ${displayText(title)}`}
        >
          <GripVertical aria-hidden="true" className="size-3.5" />
        </button>
        <Link
          href={href}
          className="min-w-0 flex-1 line-clamp-2 whitespace-normal break-words font-medium leading-snug hover:underline"
        >
          {displayText(title)}
        </Link>
        <ItemActionGroup label={`Actions for ${displayText(title)}`} className="w-auto shrink-0">
          <PinOverflowMenu
            target={{ kind: 'object', key: row.id }}
            title={displayText(title)}
            initialPinned={pinned}
          />
        </ItemActionGroup>
      </div>
      <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-0 text-[11px]">
        {taskCategoriesEnabled ? (
          <EditableMetadata
            label={`Category for ${displayText(title)}`}
            value={
              <TaskCategoryBadge category={row.taskCategory} status={row.taskCategoryStatus} />
            }
            editor={
              <TaskCategorySelect
                taskId={row.id}
                category={row.taskCategory}
                mode={row.taskCategoryMode}
                status={row.taskCategoryStatus}
                updatedAt={row.taskCategoryUpdatedAt}
              />
            }
          />
        ) : null}
        <EditableMetadata
          label={`Project for ${displayText(title)}`}
          value={primaryProject?.projectName ?? 'No project'}
          editor={
            <TaskProjectSelect
              taskId={row.id}
              projectId={primaryProject?.projectId ?? null}
              currentProjectLabel={primaryProject?.projectName}
              projectArchived={Boolean(primaryProject?.archivedAt)}
              projects={projects}
              onProjectChange={(project) => {
                onProjectChange(row.id, project);
              }}
              onProjectChangeCommitted={() => {
                onProjectChangeCommitted(row.id);
              }}
              onProjectChangeReverted={() => {
                onProjectChangeReverted(row.id);
              }}
            />
          }
        />
        <EditableMetadata
          label={`Assignee for ${displayText(title)}`}
          value={memberLabel(row.assigneeUserId, members)}
          pending={metadataSaving}
          editor={
            <select
              value={row.assigneeUserId ?? ''}
              onChange={(event) => {
                saveMetadata({ assigneeUserId: event.currentTarget.value || null });
              }}
              className="h-10 w-full rounded-sm border border-border bg-bg px-2 text-xs"
            >
              <option value="">Unassigned</option>
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.label}
                </option>
              ))}
            </select>
          }
        />
        <EditableMetadata
          label={`Due date for ${displayText(title)}`}
          value={<DueDateDisplay value={row.dueAt} variant="compact" />}
          pending={metadataSaving}
          editor={
            <MetadataDateEditor
              defaultValue={row.dueAt ? row.dueAt.toISOString().slice(0, 10) : ''}
              onApply={(value) => {
                saveMetadata({
                  dueAt: value ? new Date(`${value}T00:00:00.000Z`) : null,
                });
              }}
            />
          }
        />
        <EditableMetadata
          label={`Priority for ${displayText(title)}`}
          value={
            <CollectionStatus
              value={row.priority ? `p${row.priority}` : 'none'}
              tone={priorityTone(row.priority)}
              label={row.priority ? `P${row.priority}` : 'No priority'}
            />
          }
          pending={metadataSaving}
          editor={
            <select
              value={row.priority ?? ''}
              onChange={(event) => {
                saveMetadata({
                  priority: event.currentTarget.value ? Number(event.currentTarget.value) : null,
                });
              }}
              className="h-10 rounded-sm border border-border bg-bg px-2 text-xs"
            >
              <option value="">None</option>
              {[1, 2, 3, 4].map((priority) => (
                <option key={priority} value={priority}>
                  P{priority}
                </option>
              ))}
            </select>
          }
        />
      </div>
      {metadataError ? (
        <p className="mt-1 text-xs text-danger" role="alert">
          {metadataError}
        </p>
      ) : null}
      {error ? <p className="mt-2 text-xs text-danger">{error}</p> : null}
    </article>
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

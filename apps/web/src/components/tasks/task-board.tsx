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

import { updateObjectAction } from '@/app/actions/objects';
import { ObjectTextFilter } from '@/components/boards/object-text-filter';
import { displayText } from '@/lib/display-dates';
import { filterObjectsByText } from '@/lib/object-filter';
import { objectDetailHref } from '@/lib/object-links';
import { displayObjectTitle } from '@/lib/object-title';
import { cn, errorMessage } from '@/lib/utils';

interface TaskMemberOption {
  id: string;
  label: string;
}

interface Props {
  rows: objects.ObjectRow[];
  columns: string[];
  selectedTaskId: string | null;
  view: TaskView;
  members: TaskMemberOption[];
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
type BulkField = 'status' | 'assignee' | 'due' | 'priority';

interface BulkState {
  field: BulkField;
  status: string;
  assignee: string;
  due: string;
  priority: string;
  message: string | null;
}

type BulkAction =
  | { type: 'field'; field: BulkField }
  | { type: 'status'; status: string }
  | { type: 'assignee'; assignee: string }
  | { type: 'due'; due: string }
  | { type: 'priority'; priority: string }
  | { type: 'message'; message: string | null };

interface MoveUiState {
  saveState: SaveState;
  savingCount: number;
  cardErrors: Record<string, string>;
  savingCardIds: ReadonlySet<string>;
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

const INITIAL_MOVE_UI: MoveUiState = {
  saveState: 'idle',
  savingCount: 0,
  cardErrors: {},
  savingCardIds: new Set(),
};

function taskHref(taskId: string): string {
  return `/app/tasks?task=${encodeURIComponent(taskId)}`;
}

function closeHref(view: TaskView): string {
  return view === 'kanban' ? '/app/tasks' : taskViewHref(view, null);
}

function taskViewHref(view: TaskView, taskId: string | null): string {
  const params = new URLSearchParams({ view });
  if (taskId) params.set('task', taskId);
  return `/app/tasks?${params.toString()}`;
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

export function TaskBoard({ rows, columns, selectedTaskId, view, members }: Props) {
  const dndContextId = useId();
  const router = useRouter();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const [optimisticRows, applyMove] = useOptimistic(
    rows,
    (state, move: { id: string; status: string }) =>
      state.map((row) => (row.id === move.id ? { ...row, status: move.status } : row)),
  );
  const [, startTransition] = useTransition();
  const [moveUi, dispatchMoveUi] = useReducer(moveUiReducer, INITIAL_MOVE_UI);
  const [filterQuery, setFilterQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const [rowPatches, setRowPatches] = useState<Record<string, TaskPatchOverlay>>({});
  const savingCountRef = useRef(0);
  const savingCardIdsRef = useRef<Set<string> | null>(null);
  const batchHadFailureRef = useRef(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const effectiveRows = useMemo(
    () => optimisticRows.map((row) => applyTaskPatch(row, rowPatches[row.id])),
    [optimisticRows, rowPatches],
  );
  const visibleRows = useMemo(
    () => filterObjectsByText(effectiveRows, filterQuery, { groupBy: 'status' }),
    [effectiveRows, filterQuery],
  );
  const selectedTask = selectedTaskId
    ? (effectiveRows.find((row) => row.id === selectedTaskId) ?? null)
    : null;
  const allColumns = Array.from(new Set([...columns, ...effectiveRows.map((row) => row.status)]));
  const byStatus = new Map<string, objects.ObjectRow[]>();
  for (const column of allColumns) byStatus.set(column, []);
  for (const row of visibleRows) {
    const list = byStatus.get(row.status) ?? [];
    list.push(row);
    byStatus.set(row.status, list);
  }
  const moveErrors = Object.values(moveUi.cardErrors);
  const selectedVisibleIds = useMemo(() => {
    const visibleIds = new Set(visibleRows.map((row) => row.id));
    return new Set([...selectedIds].filter((id) => visibleIds.has(id)));
  }, [selectedIds, visibleRows]);

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
    if (!row || row.status === status) return;
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
    const results = await Promise.allSettled(ids.map((id) => updateTask(id, patch)));
    return {
      failed: results.filter(
        (result) =>
          result.status === 'rejected' || ('error' in result.value && Boolean(result.value.error)),
      ).length,
    };
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
                <output
                  className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-dim"
                  aria-live="polite"
                >
                  {moveUi.saveState === 'saving'
                    ? `Saving${moveUi.savingCount > 1 ? ` ${moveUi.savingCount} moves` : ''}...`
                    : 'Saved'}
                </output>
              ) : null}
              <nav className="inline-flex overflow-hidden rounded-sm border border-border">
                {(['kanban', 'list'] as const).map((nextView) => (
                  <Link
                    key={nextView}
                    href={taskViewHref(nextView, selectedTaskId)}
                    className={`px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] ${
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
              className="mx-4 mb-3 shrink-0 rounded-sm border border-danger/30 bg-danger/10 px-3 py-2 font-mono text-[11px] uppercase tracking-[0.1em] text-danger md:mx-8"
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
                  taskHref={taskHref}
                />
              ))}
            </div>
          ) : (
            <TaskListView
              rows={visibleRows}
              columns={allColumns}
              members={members}
              selectedTaskId={selectedTaskId}
              selectedIds={selectedVisibleIds}
              setSelectedIds={setSelectedIds}
              onUpdateTask={updateTask}
              onUpdateTasks={updateTasks}
            />
          )}
        </div>
      </DndContext>
      {selectedTask ? (
        <TaskDetailPanel
          task={selectedTask}
          columns={allColumns}
          members={members}
          closeHref={closeHref(view)}
          objectHref={objectDetailHref(
            selectedTask.id,
            view === 'kanban' ? taskHref(selectedTask.id) : taskViewHref(view, selectedTask.id),
          )}
          onUpdate={updateTask}
        />
      ) : null}
    </div>
  );
}

function TaskListView({
  rows,
  columns,
  members,
  selectedTaskId,
  selectedIds,
  setSelectedIds,
  onUpdateTask,
  onUpdateTasks,
}: {
  rows: objects.ObjectRow[];
  columns: string[];
  members: TaskMemberOption[];
  selectedTaskId: string | null;
  selectedIds: ReadonlySet<string>;
  setSelectedIds: Dispatch<SetStateAction<ReadonlySet<string>>>;
  onUpdateTask: (id: string, patch: TaskPatch) => Promise<{ ok?: boolean; error?: string }>;
  onUpdateTasks: (ids: string[], patch: TaskPatch) => Promise<{ failed: number }>;
}) {
  if (rows.length === 0) {
    return (
      <p className="mx-4 rounded-sm border border-border bg-surface py-10 text-center font-mono text-xs uppercase tracking-[0.12em] text-fg-dim md:mx-8">
        No visible tasks
      </p>
    );
  }

  const allVisibleSelected = rows.every((row) => selectedIds.has(row.id));

  function toggleAll(checked: boolean): void {
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const row of rows) {
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
      />
      <div className="min-h-0 flex-1 overflow-auto rounded-sm border border-border bg-surface">
        <table className="w-full min-w-[780px] text-sm">
          <thead className="sticky top-0 z-10 border-b border-border bg-bg text-left font-mono text-[11px] uppercase tracking-[0.12em] text-fg-dim">
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
              <th className="px-3 py-2 font-normal">Assignee</th>
              <th className="px-3 py-2 font-normal">Due</th>
              <th className="px-3 py-2 font-normal">Priority</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <TaskListRow
                key={row.id}
                row={row}
                columns={columns}
                members={members}
                selected={selectedIds.has(row.id)}
                highlighted={row.id === selectedTaskId}
                onSelectedChange={(checked) => {
                  toggleOne(row.id, checked);
                }}
                onUpdateTask={onUpdateTask}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TaskListRow({
  row,
  columns,
  members,
  selected,
  highlighted,
  onSelectedChange,
  onUpdateTask,
}: {
  row: objects.ObjectRow;
  columns: string[];
  members: TaskMemberOption[];
  selected: boolean;
  highlighted: boolean;
  onSelectedChange: (checked: boolean) => void;
  onUpdateTask: (id: string, patch: TaskPatch) => Promise<{ ok?: boolean; error?: string }>;
}) {
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
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
          href={taskViewHref('list', row.id)}
          className="block whitespace-normal break-words font-medium leading-snug hover:underline"
        >
          {displayText(title)}
        </Link>
        <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.1em] text-fg-dim">
          Task
          {row.agentSuggested && row.status === 'suggested' ? (
            <span className="text-signal"> · Suggested</span>
          ) : null}
        </div>
        {saving || error ? (
          <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.1em]">
            {saving ? <span className="text-fg-dim">Saving {saving}...</span> : null}
            {error ? <span className="text-danger">{error}</span> : null}
          </div>
        ) : null}
      </td>
      <td className="min-w-36 px-3 py-2 align-top">
        <select
          value={row.status}
          onChange={(event) => {
            save('status', { status: event.currentTarget.value });
          }}
          className="h-8 w-full rounded-sm border border-border bg-bg px-2 text-xs"
          aria-label={`Status for ${displayText(title)}`}
        >
          {columns.map((column) => (
            <option key={column} value={column}>
              {column}
            </option>
          ))}
          {!columns.includes(row.status) ? <option value={row.status}>{row.status}</option> : null}
        </select>
      </td>
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
          value={row.dueAt ? dateInputValue(row.dueAt) : ''}
          onChange={(event) => {
            const value = event.currentTarget.value;
            save('due date', { dueAt: value ? new Date(`${value}T00:00:00.000Z`) : null });
          }}
          className="h-8 w-full rounded-sm border border-border bg-bg px-2 text-xs"
          aria-label={`Due date for ${displayText(title)}`}
        />
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
    </tr>
  );
}

function TaskBulkToolbar({
  columns,
  members,
  selectedIds,
  setSelectedIds,
  onUpdateTasks,
}: {
  columns: string[];
  members: TaskMemberOption[];
  selectedIds: ReadonlySet<string>;
  setSelectedIds: Dispatch<SetStateAction<ReadonlySet<string>>>;
  onUpdateTasks: (ids: string[], patch: TaskPatch) => Promise<{ failed: number }>;
}) {
  const [bulk, dispatchBulk] = useReducer(bulkReducer, columns[0] ?? 'todo', (status) => ({
    field: 'assignee' as const,
    status,
    assignee: '',
    due: '',
    priority: '',
    message: null,
  }));
  const [pending, startTransition] = useTransition();
  const selectedCount = selectedIds.size;

  function currentPatch(): TaskPatch {
    if (bulk.field === 'status') return { status: bulk.status };
    if (bulk.field === 'assignee') return { assigneeUserId: bulk.assignee || null };
    if (bulk.field === 'due') {
      return { dueAt: bulk.due ? new Date(`${bulk.due}T00:00:00.000Z`) : null };
    }
    return { priority: bulk.priority ? Number(bulk.priority) : null };
  }

  function applyBulk(): void {
    if (selectedCount === 0) return;
    dispatchBulk({ type: 'message', message: null });
    const ids = [...selectedIds];
    const patch = currentPatch();
    startTransition(async () => {
      const result = await onUpdateTasks(ids, patch);
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
      <output
        className="mr-auto font-mono text-[11px] uppercase tracking-[0.12em] text-fg-dim"
        aria-live="polite"
      >
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
              {column}
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
      <button
        type="button"
        disabled={selectedCount === 0 || pending}
        onClick={applyBulk}
        className="h-8 rounded-sm border border-border bg-bg px-3 text-xs font-medium hover:bg-signal-soft disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? 'Applying...' : 'Apply'}
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
      {bulk.message ? (
        <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-fg-dim">
          {bulk.message}
        </span>
      ) : null}
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
    case 'message':
      return { ...state, message: action.message };
  }
}

function TaskColumn({
  id,
  rows,
  selectedTaskId,
  savingCardIds,
  cardErrors,
  members,
  taskHref,
}: {
  id: string;
  rows: objects.ObjectRow[];
  selectedTaskId: string | null;
  savingCardIds: ReadonlySet<string>;
  cardErrors: Record<string, string>;
  members: TaskMemberOption[];
  taskHref: (taskId: string) => string;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex h-full w-[290px] shrink-0 flex-col rounded-sm border border-border bg-surface p-3',
        isOver && 'border-signal/40 bg-signal-soft',
      )}
    >
      <div className="mb-3 flex shrink-0 items-baseline justify-between">
        <h3 className="font-mono text-[11px] uppercase tracking-[0.14em] text-fg-dim">{id}</h3>
        <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg">
          {rows.length}
        </span>
      </div>
      <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
        {rows.map((row) => (
          <TaskCard
            key={row.id}
            row={row}
            href={taskHref(row.id)}
            selected={row.id === selectedTaskId}
            saving={savingCardIds.has(row.id)}
            error={cardErrors[row.id]}
            members={members}
          />
        ))}
      </ul>
    </div>
  );
}

function TaskCard({
  row,
  href,
  selected,
  saving,
  error,
  members,
}: {
  row: objects.ObjectRow;
  href: string;
  selected: boolean;
  saving: boolean;
  error?: string;
  members: TaskMemberOption[];
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: row.id,
    disabled: saving,
  });
  const style = transform
    ? { transform: `translate3d(${String(transform.x)}px,${String(transform.y)}px,0)` }
    : undefined;
  const due = dueState(row.dueAt);
  const title = displayObjectTitle(row);
  return (
    <li
      ref={setNodeRef}
      style={style}
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
      <Link
        href={href}
        className="block min-w-0 whitespace-normal break-words font-medium leading-snug hover:underline"
      >
        {displayText(title)}
      </Link>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-fg-dim">
        <span>Task</span>
        {row.agentSuggested && row.status === 'suggested' ? (
          <span className="text-signal">Suggested</span>
        ) : null}
      </div>
      <div className="mt-2 grid grid-cols-3 gap-px overflow-hidden rounded-sm border border-border bg-border font-mono text-[10px] uppercase tracking-[0.08em]">
        <CardMeta value={memberLabel(row.assigneeUserId, members)} missing={!row.assigneeUserId} />
        <CardMeta value={due.label} missing={!row.dueAt} danger={due.tone === 'danger'} />
        <CardMeta
          value={row.priority ? `P${row.priority}` : 'No priority'}
          missing={!row.priority}
        />
      </div>
      {error ? (
        <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.1em] text-danger">{error}</p>
      ) : null}
    </li>
  );
}

function TaskDetailPanel({
  task,
  columns,
  members,
  closeHref,
  objectHref,
  onUpdate,
}: {
  task: objects.ObjectRow;
  columns: string[];
  members: TaskMemberOption[];
  closeHref: string;
  objectHref: string;
  onUpdate: (id: string, patch: TaskPatch) => Promise<{ ok?: boolean; error?: string }>;
}) {
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
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
            <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.12em] text-fg-dim">
              Task · side panel
            </p>
          </div>
          <Link
            href={closeHref}
            className="shrink-0 font-mono text-[11px] uppercase tracking-[0.12em] text-fg-muted hover:text-fg hover:underline"
          >
            Close
          </Link>
        </div>
      </div>
      <div className="grid border-b border-border sm:grid-cols-2">
        <TaskField label="Status">
          <select
            value={task.status}
            onChange={(event) => {
              save('status', { status: event.currentTarget.value });
            }}
            className="h-9 w-full rounded-sm border border-border bg-bg px-2 text-sm"
          >
            {columns.map((column) => (
              <option key={column} value={column}>
                {column}
              </option>
            ))}
            {!columns.includes(task.status) ? (
              <option value={task.status}>{task.status}</option>
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
            value={task.dueAt ? dateInputValue(task.dueAt) : ''}
            onChange={(event) => {
              const value = event.currentTarget.value;
              save('due date', { dueAt: value ? new Date(`${value}T00:00:00.000Z`) : null });
            }}
            className="h-9 w-full rounded-sm border border-border bg-bg px-2 text-sm"
            aria-label="Task due date"
          />
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
        <Detail label="Current due" value={task.dueAt ? dateLabel(task.dueAt) : '-'} />
        <Detail label="Current priority" value={task.priority ? `P${task.priority}` : '-'} />
        <Detail label="Updated" value={dateLabel(task.updatedAt)} />
      </div>
      {saving || error ? (
        <div className="border-b border-border px-4 py-3 font-mono text-[11px] uppercase tracking-[0.1em]">
          {saving ? <span className="text-fg-dim">Saving {saving}...</span> : null}
          {error ? <span className="text-danger">{error}</span> : null}
        </div>
      ) : null}
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

function TaskField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="border-b border-r border-border p-4">
      <span className="mb-2 block font-mono text-[11px] uppercase tracking-[0.12em] text-fg-dim">
        {label}
      </span>
      {children}
    </label>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-b border-r border-border p-4">
      <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-dim">{label}</div>
      <div className="mt-2 text-sm text-fg">{displayText(value)}</div>
    </div>
  );
}

function CardMeta({
  value,
  missing,
  danger = false,
}: {
  value: string;
  missing: boolean;
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
      {displayText(value)}
    </span>
  );
}

function memberLabel(userId: string | null, members: TaskMemberOption[]): string {
  if (!userId) return 'Unassigned';
  return members.find((member) => member.id === userId)?.label ?? 'Assigned';
}

function dateInputValue(value: Date): string {
  return new Date(value).toISOString().slice(0, 10);
}

function dateLabel(value: Date): string {
  return new Date(value).toISOString().slice(0, 10);
}

function dueState(value: Date | null): { label: string; tone: 'danger' | 'neutral' } {
  if (!value) return { label: 'No due', tone: 'neutral' };
  const due = new Date(value);
  if (due.getTime() < Date.now()) return { label: `Overdue ${dateLabel(due)}`, tone: 'danger' };
  return { label: `Due ${dateLabel(due)}`, tone: 'neutral' };
}

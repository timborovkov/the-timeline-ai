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
import type * as objects from '@timeline/shared/objects';
import type { ReactNode } from 'react';

import { updateObjectAction } from '@/app/actions/objects';
import { ObjectTextFilter } from '@/components/boards/object-text-filter';
import { displayText } from '@/lib/display-dates';
import { filterObjectsByText } from '@/lib/object-filter';
import { objectDetailHref } from '@/lib/object-links';
import { cn, errorMessage } from '@/lib/utils';

interface TaskMemberOption {
  id: string;
  label: string;
}

interface Props {
  rows: objects.ObjectRow[];
  columns: string[];
  selectedTaskId: string | null;
  members: TaskMemberOption[];
}

type TaskPatch = Partial<
  Pick<objects.ObjectRow, 'status' | 'assigneeUserId' | 'dueAt' | 'priority'>
>;

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

function closeHref(): string {
  return '/app/tasks';
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

export function TaskBoard({ rows, columns, selectedTaskId, members }: Props) {
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
  const savingCountRef = useRef(0);
  const savingCardIdsRef = useRef<Set<string> | null>(null);
  const batchHadFailureRef = useRef(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const visibleRows = useMemo(
    () => filterObjectsByText(optimisticRows, filterQuery, { groupBy: 'status' }),
    [filterQuery, optimisticRows],
  );
  const selectedTask = selectedTaskId
    ? (optimisticRows.find((row) => row.id === selectedTaskId) ?? null)
    : null;
  const allColumns = Array.from(new Set([...columns, ...optimisticRows.map((row) => row.status)]));
  const byStatus = new Map<string, objects.ObjectRow[]>();
  for (const column of allColumns) byStatus.set(column, []);
  for (const row of visibleRows) {
    const list = byStatus.get(row.status) ?? [];
    list.push(row);
    byStatus.set(row.status, list);
  }
  const moveErrors = Object.values(moveUi.cardErrors);

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
    const row = optimisticRows.find((candidate) => candidate.id === id);
    if (!row || row.status === status) return;
    startTransition(async () => {
      applyMove({ id, status });
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
          dispatchMoveUi({ type: 'move-fail', id, message: result.error });
        }
      } catch (err) {
        batchHadFailureRef.current = true;
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
    const dueAt = patch.dueAt === undefined ? undefined : (patch.dueAt?.toISOString() ?? null);
    const result = await updateObjectAction({
      id,
      ...patch,
      ...(dueAt !== undefined ? { dueAt } : {}),
    });
    router.refresh();
    return result;
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
        <div className="flex h-full min-h-0 min-w-0 flex-col gap-3">
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
            <ObjectTextFilter
              query={filterQuery}
              onQueryChange={setFilterQuery}
              resultCount={visibleRows.length}
              totalCount={optimisticRows.length}
            />
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
          </div>
          {moveErrors.length > 0 ? (
            <p
              className="shrink-0 rounded-sm border border-danger/30 bg-danger/10 px-3 py-2 font-mono text-[11px] uppercase tracking-[0.1em] text-danger"
              role="alert"
            >
              {moveErrors.length === 1
                ? moveErrors[0]
                : `${moveErrors.length} task moves failed. Clear the filter to inspect affected cards.`}
            </p>
          ) : null}
          <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto pb-2">
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
        </div>
      </DndContext>
      {selectedTask ? (
        <TaskDetailPanel
          task={selectedTask}
          columns={allColumns}
          members={members}
          closeHref={closeHref()}
          objectHref={objectDetailHref(selectedTask.id, taskHref(selectedTask.id))}
          onUpdate={updateTask}
        />
      ) : null}
    </div>
  );
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
  const title = taskTitle(row);
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
      <Link href={href} className="block min-w-0 truncate font-medium hover:underline">
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
  const title = taskTitle(task);

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
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold text-fg">{displayText(title)}</h2>
            <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.12em] text-fg-dim">
              Task · side panel
            </p>
          </div>
          <Link
            href={closeHref}
            className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-muted hover:text-fg hover:underline"
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

function metadataString(metadata: Record<string, unknown>, key: string): string | null {
  const value = metadata[key];
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value).replace(/\s+/g, ' ').trim();
  return text || null;
}

function taskTitle(row: objects.ObjectRow): string {
  const explicit = metadataString(row.metadata, 'display_title');
  if (explicit) return explicit;
  if (metadataString(row.metadata, 'integration_provider') !== 'github') return row.canonicalName;

  const match = /^(.+?)#(?:issue:)?\d+:\s*(.+)$/.exec(row.canonicalName);
  if (!match) return row.canonicalName;
  const [, canonicalRepo, title] = match;
  if (!canonicalRepo || !title) return row.canonicalName;

  const externalId = metadataString(row.metadata, 'integration_external_id');
  const repo = externalId?.split('#')[0] ?? canonicalRepo;
  const repoName = repo.split('/').pop() ?? repo;
  return repoName ? `${repoName}: ${title}` : title;
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

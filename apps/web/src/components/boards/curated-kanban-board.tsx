'use client';

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type ScreenReaderInstructions,
} from '@dnd-kit/core';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useOptimistic,
  useRef,
  useState,
  useTransition,
} from 'react';

import type { BoardMemberOption } from '@/components/boards/board-detail-client';
import type * as boards from '@timeline/shared/boards';
import type { ReactNode } from 'react';

import { updateBoardItemAction } from '@/app/actions/boards';
import {
  curatedKanbanSaveState,
  type CuratedKanbanSaveState,
} from '@/components/boards/curated-kanban-state';
import { DueDateDisplay } from '@/components/due-date-display';
import { LiveTaskCategoryBadge } from '@/components/tasks/task-category-badge';
import { boardViewHref } from '@/lib/board-links';
import { displayText } from '@/lib/display-dates';
import { displayObjectTitle } from '@/lib/object-title';
import { statusLabel } from '@/lib/status-labels';
import { cn, errorMessage } from '@/lib/utils';

interface Props {
  boardId: string;
  lanes: boards.BoardLaneRow[];
  items: boards.BoardItemRow[];
  selectedItemId: string | null;
  members: BoardMemberOption[];
  filterParams?: Record<string, string>;
}

const EMPTY_FILTER_PARAMS: Record<string, string> = {};
type MoveControlFocus = { id: string; laneValue: string } | null;
const DRAG_INSTRUCTIONS: ScreenReaderInstructions = {
  draggable:
    'Press Space or Enter to pick up a card. Use the arrow keys to move it, then press Space or Enter again to drop it, or Escape to cancel. To move directly between lanes with the keyboard, tab to the card’s Move to lane menu.',
};

export function CuratedKanbanBoard({
  boardId,
  lanes,
  items,
  selectedItemId,
  members,
  filterParams = EMPTY_FILTER_PARAMS,
}: Props) {
  const dndContextId = useId();
  const router = useRouter();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor),
  );
  const [optimisticItems, moveOptimistic] = useOptimistic(
    items,
    (state, move: { id: string; laneId: string | null }) =>
      state.map((item) => (item.id === move.id ? { ...item, laneId: move.laneId } : item)),
  );
  const [, startTransition] = useTransition();
  const [savingIds, setSavingIds] = useState<ReadonlySet<string>>(() => new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saveState, setSaveState] = useState<CuratedKanbanSaveState>('idle');
  const savingRef = useRef<Set<string> | null>(null);
  const pendingMoveControlFocusRef = useRef<MoveControlFocus>(null);
  savingRef.current ??= new Set<string>();
  const batchHadFailureRef = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearSaveTimer = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  useEffect(() => {
    return clearSaveTimer;
  }, [clearSaveTimer]);

  function resetSaveTimer() {
    clearSaveTimer();
    timer.current = setTimeout(() => {
      setSaveState('idle');
    }, 1600);
  }

  const laneIdSet = useMemo(() => new Set(lanes.map((lane) => lane.id)), [lanes]);
  const byLane = new Map<string | null, boards.BoardItemRow[]>();
  for (const lane of lanes) byLane.set(lane.id, []);
  byLane.set(null, []);
  for (const item of optimisticItems) {
    const laneId = item.laneId && laneIdSet.has(item.laneId) ? item.laneId : null;
    const list = byLane.get(laneId) ?? [];
    list.push(item);
    byLane.set(laneId, list);
  }
  const visibleLanes = useMemo(() => {
    const hasUnsetItems = optimisticItems.some(
      (item) => !item.laneId || !laneIdSet.has(item.laneId),
    );
    if (!hasUnsetItems) return lanes;
    return [
      ...lanes,
      {
        id: 'unset',
        boardId,
        name: 'Unset',
        position: 999,
        kind: null,
        archivedAt: null,
      },
    ];
  }, [boardId, laneIdSet, lanes, optimisticItems]);

  const registerMoveControl = useCallback(
    (id: string, laneValue: string, node: HTMLSelectElement | null) => {
      if (!node) return;
      const pendingFocus = pendingMoveControlFocusRef.current;
      if (pendingFocus?.id !== id || pendingFocus.laneValue !== laneValue) return;
      pendingMoveControlFocusRef.current = null;
      node.focus();
    },
    [],
  );

  const cardLabel = useCallback(
    (id: string) => {
      const item = optimisticItems.find((candidate) => candidate.id === id);
      return item ? displayText(displayObjectTitle(item.object)) : 'Card';
    },
    [optimisticItems],
  );
  const laneLabel = useCallback(
    (id: string | null | undefined) => {
      if (!id) return 'no lane';
      return visibleLanes.find((lane) => lane.id === id)?.name ?? 'an unknown lane';
    },
    [visibleLanes],
  );
  const dragAnnouncements = useMemo<Announcements>(
    () => ({
      onDragStart: ({ active }) =>
        `Picked up ${cardLabel(String(active.id))}. Use the arrow keys to move it over a lane, then Space or Enter to drop it, or Escape to cancel.`,
      onDragOver: ({ active, over }) =>
        over
          ? `${cardLabel(String(active.id))} is over ${laneLabel(String(over.id))}.`
          : `${cardLabel(String(active.id))} is not over a lane.`,
      onDragEnd: ({ active, over }) =>
        over
          ? `Moved ${cardLabel(String(active.id))} to ${laneLabel(String(over.id))}.`
          : `Did not move ${cardLabel(String(active.id))}.`,
      onDragCancel: ({ active }) => `Cancelled moving ${cardLabel(String(active.id))}.`,
    }),
    [cardLabel, laneLabel],
  );

  function savingSet(): Set<string> {
    savingRef.current ??= new Set<string>();
    return savingRef.current;
  }

  function markSaving(id: string, saving: boolean, failed = false) {
    const currentSaving = savingSet();
    if (saving) {
      if (timer.current) clearTimeout(timer.current);
      if (currentSaving.size === 0) batchHadFailureRef.current = false;
      currentSaving.add(id);
    } else {
      if (failed) batchHadFailureRef.current = true;
      currentSaving.delete(id);
    }
    setSavingIds(new Set(currentSaving));
    const nextSaveState = curatedKanbanSaveState(currentSaving.size, batchHadFailureRef.current);
    setSaveState(nextSaveState);
    if (!saving && currentSaving.size === 0) {
      if (!batchHadFailureRef.current) {
        resetSaveTimer();
      }
    }
  }

  function moveItem(id: string, laneId: string | null, focusMoveControl = false): void {
    if (savingSet().has(id)) return;
    const item = optimisticItems.find((candidate) => candidate.id === id);
    if (!item || item.laneId === laneId) return;
    if (focusMoveControl) {
      pendingMoveControlFocusRef.current = { id, laneValue: laneId ?? 'unset' };
    }
    setErrors((current) => {
      const { [id]: _cleared, ...rest } = current;
      return rest;
    });
    startTransition(async () => {
      moveOptimistic({ id, laneId });
      markSaving(id, true);
      let failed = false;
      try {
        const result = await updateBoardItemAction({ id, laneId });
        failed = 'error' in result && Boolean(result.error);
        if ('error' in result && result.error) {
          if (focusMoveControl) {
            pendingMoveControlFocusRef.current = { id, laneValue: item.laneId ?? 'unset' };
          }
          moveOptimistic({ id, laneId: item.laneId });
          setErrors((current) => ({ ...current, [id]: result.error ?? 'Move failed' }));
        }
      } catch (err) {
        failed = true;
        if (focusMoveControl) {
          pendingMoveControlFocusRef.current = { id, laneValue: item.laneId ?? 'unset' };
        }
        moveOptimistic({ id, laneId: item.laneId });
        setErrors((current) => ({ ...current, [id]: errorMessage(err, 'Move failed') }));
      } finally {
        markSaving(id, false, failed);
        router.refresh();
      }
    });
  }

  function onDragEnd(event: DragEndEvent): void {
    const overId = event.over?.id ? String(event.over.id) : null;
    if (!overId) return;
    moveItem(String(event.active.id), overId === 'unset' ? null : overId);
  }

  return (
    <DndContext
      id={dndContextId}
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={onDragEnd}
      accessibility={{
        announcements: dragAnnouncements,
        screenReaderInstructions: DRAG_INSTRUCTIONS,
      }}
    >
      <div className="flex h-full min-h-0 min-w-0 flex-col">
        <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto overflow-y-hidden px-4 pb-2 md:px-8">
          {visibleLanes.map((lane) => (
            <KanbanColumn
              key={lane.id}
              boardId={boardId}
              lane={lane}
              items={byLane.get(lane.id === 'unset' ? null : lane.id) ?? []}
              savingIds={savingIds}
              errors={errors}
              selectedItemId={selectedItemId}
              members={members}
              filterParams={filterParams}
              moveTargets={visibleLanes}
              onMoveItem={moveItem}
              onMoveControlRef={registerMoveControl}
            />
          ))}
        </div>
        {saveState !== 'idle' ? (
          <output className="px-4 pb-2 text-xs text-fg-dim md:px-8" aria-live="polite">
            {saveState === 'saving' ? 'Saving…' : 'Saved'}
          </output>
        ) : null}
      </div>
    </DndContext>
  );
}

function KanbanColumn({
  boardId,
  lane,
  items,
  savingIds,
  errors,
  selectedItemId,
  members,
  filterParams,
  moveTargets,
  onMoveItem,
  onMoveControlRef,
}: {
  boardId: string;
  lane: boards.BoardLaneRow;
  items: boards.BoardItemRow[];
  savingIds: ReadonlySet<string>;
  errors: Record<string, string>;
  selectedItemId: string | null;
  members: BoardMemberOption[];
  filterParams: Record<string, string>;
  moveTargets: boards.BoardLaneRow[];
  onMoveItem: (id: string, laneId: string | null, focusMoveControl?: boolean) => void;
  onMoveControlRef: (id: string, laneValue: string, node: HTMLSelectElement | null) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: lane.id });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex h-full w-[min(290px,calc(100vw-4rem))] shrink-0 flex-col rounded-sm border border-border bg-surface p-3',
        isOver && 'border-signal/40 bg-signal-soft',
      )}
    >
      <div className="mb-3 flex shrink-0 items-baseline justify-between">
        <h3 className="text-xs text-fg-dim">{lane.name}</h3>
        <span className="text-xs text-fg">{items.length}</span>
      </div>
      <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
        {items.map((item) => (
          <KanbanCard
            key={item.id}
            boardId={boardId}
            item={item}
            lane={lane}
            saving={savingIds.has(item.id)}
            error={errors[item.id]}
            selected={item.id === selectedItemId}
            members={members}
            filterParams={filterParams}
            moveTargets={moveTargets}
            onMoveItem={onMoveItem}
            onMoveControlRef={onMoveControlRef}
          />
        ))}
      </ul>
    </div>
  );
}

function KanbanCard({
  boardId,
  item,
  lane,
  saving,
  error,
  selected,
  members,
  filterParams,
  moveTargets,
  onMoveItem,
  onMoveControlRef,
}: {
  boardId: string;
  item: boards.BoardItemRow;
  lane: boards.BoardLaneRow;
  saving: boolean;
  error?: string;
  selected: boolean;
  members: BoardMemberOption[];
  filterParams: Record<string, string>;
  moveTargets: boards.BoardLaneRow[];
  onMoveItem: (id: string, laneId: string | null, focusMoveControl?: boolean) => void;
  onMoveControlRef: (id: string, laneValue: string, node: HTMLSelectElement | null) => void;
}) {
  const optimistic = item.id.startsWith('optimistic-');
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: item.id,
    disabled: saving || optimistic,
  });
  const style = transform
    ? { transform: `translate3d(${String(transform.x)}px,${String(transform.y)}px,0)` }
    : undefined;
  const blocked = lane.kind === 'blocked';
  const title = displayObjectTitle(item.object);
  const titleId = `board-card-${item.id}-title`;
  const moveControlId = `board-card-${item.id}-move-lane`;
  const errorId = `board-card-${item.id}-move-error`;
  const registerMoveControl = useCallback(
    (node: HTMLSelectElement | null) => {
      onMoveControlRef(item.id, lane.id, node);
    },
    [item.id, lane.id, onMoveControlRef],
  );
  return (
    <li
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={cn(
        'cursor-grab rounded-sm border border-border bg-bg px-3 py-2 text-sm transition-colors hover:border-border-strong',
        'focus-visible:border-signal/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/40 focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
        selected && 'border-signal bg-signal-soft shadow-[inset_3px_0_0_var(--color-signal)]',
        blocked && 'border-danger/50',
        isDragging && 'opacity-50',
        saving && 'cursor-progress opacity-80',
        optimistic && 'cursor-wait opacity-80',
        error && 'border-danger/50',
      )}
    >
      {optimistic ? (
        <span className="block min-w-0 whitespace-normal break-words font-medium leading-snug">
          {displayText(title)}
        </span>
      ) : (
        <Link
          id={titleId}
          href={boardViewHref(boardId, 'kanban', item.id, filterParams)}
          className="block min-w-0 whitespace-normal break-words font-medium leading-snug hover:underline"
        >
          {displayText(title)}
        </Link>
      )}
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-fg-dim">
        <span>{statusLabel(item.object.type)}</span>
        {item.object.type === 'task' ? (
          <LiveTaskCategoryBadge
            taskId={item.object.id}
            category={item.object.taskCategory}
            status={item.object.taskCategoryStatus}
            updatedAt={item.object.taskCategoryUpdatedAt}
          />
        ) : null}
        {blocked ? <span className="text-danger">Blocked</span> : null}
      </div>
      <div className="mt-2 grid grid-cols-3 gap-px overflow-hidden rounded-sm border border-border bg-border text-[11px]">
        <CardMeta
          value={ownerLabel(item.responsibleUserId, members)}
          missing={!item.responsibleUserId}
        />
        <CardMeta value={<DueDateDisplay value={item.dueAt} variant="compact" />} />
        <CardMeta
          value={item.priority ? `P${item.priority}` : 'No priority'}
          missing={!item.priority}
        />
      </div>
      {item.nextStep ? (
        <p className="mt-2 line-clamp-2 text-xs text-fg-muted">{displayText(item.nextStep)}</p>
      ) : null}
      {!optimistic ? (
        <div className="mt-2 min-w-0">
          <label htmlFor={moveControlId} className="mb-1 block text-[11px] text-fg-dim">
            Move to lane
          </label>
          <select
            id={moveControlId}
            ref={registerMoveControl}
            value={lane.id}
            disabled={saving}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${titleId} ${errorId}` : titleId}
            onPointerDown={(event) => {
              event.stopPropagation();
            }}
            onChange={(event) => {
              const nextLaneId =
                event.currentTarget.value === 'unset' ? null : event.currentTarget.value;
              onMoveItem(item.id, nextLaneId, true);
            }}
            className="h-9 w-full min-w-0 rounded-sm border border-border bg-surface px-2 text-base text-fg transition-colors focus-visible:border-signal/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/40 focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:cursor-progress disabled:opacity-60 sm:text-sm"
          >
            {moveTargets.map((target) => (
              <option key={target.id} value={target.id}>
                {target.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      {error ? (
        <p id={errorId} className="mt-2 text-xs text-danger" role="alert">
          Unable to move {displayText(title)}. {error} Choose a lane to try again.
        </p>
      ) : null}
    </li>
  );
}

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
      {value}
    </span>
  );
}

function ownerLabel(userId: string | null, members: BoardMemberOption[]): string {
  if (!userId) return 'Unassigned';
  return members.find((member) => member.id === userId)?.label ?? 'Assigned';
}

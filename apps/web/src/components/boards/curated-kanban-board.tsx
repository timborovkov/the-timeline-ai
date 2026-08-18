'use client';

import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragStartEvent,
  type ScreenReaderInstructions,
} from '@dnd-kit/core';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useId, useMemo, useOptimistic, useRef, useState, useTransition } from 'react';

import type {
  BoardItemOptimisticPatch,
  BoardMemberOption,
} from '@/components/boards/board-detail-client';
import type * as boards from '@timeline/shared/boards';

import { updateBoardItemAction } from '@/app/actions/boards';
import { CollectionStatus } from '@/components/collections/collection-status';
import { priorityTone } from '@/components/collections/collection-status-tone';
import { EditableMetadata } from '@/components/collections/editable-metadata';
import { MetadataDateEditor } from '@/components/collections/metadata-date-editor';
import { VirtualList } from '@/components/collections/virtual-list';
import { DueDateDisplay } from '@/components/due-date-display';
import { LiveTaskCategoryBadge } from '@/components/tasks/task-category-badge';
import { boardViewHref } from '@/lib/board-links';
import { displayText } from '@/lib/display-dates';
import { kanbanCollisionDetection } from '@/lib/kanban-collision';
import { notifyAction } from '@/lib/notify';
import { displayObjectTitle } from '@/lib/object-title';
import { statusLabel } from '@/lib/status-labels';
import { cn } from '@/lib/utils';

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
    (state, update: { id: string; patch: BoardItemOptimisticPatch }) =>
      state.map((item) => (item.id === update.id ? { ...item, ...update.patch } : item)),
  );
  const [, startTransition] = useTransition();
  const [savingIds, setSavingIds] = useState<ReadonlySet<string>>(() => new Set());
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const activeDragItem = activeDragId
    ? (optimisticItems.find((item) => item.id === activeDragId) ?? null)
    : null;
  const savingRef = useRef<Set<string> | null>(null);
  const pendingMoveControlFocusRef = useRef<MoveControlFocus>(null);
  savingRef.current ??= new Set<string>();

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
    (id: string, laneValue: string, node: HTMLButtonElement | null) => {
      if (!node || node.disabled) return;
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

  function markSaving(id: string, saving: boolean) {
    const currentSaving = savingSet();
    if (saving) currentSaving.add(id);
    else currentSaving.delete(id);
    setSavingIds(new Set(currentSaving));
  }

  function moveItem(id: string, laneId: string | null, focusMoveControl = false): void {
    if (savingSet().has(id)) return;
    const item = optimisticItems.find((candidate) => candidate.id === id);
    if (!item || item.laneId === laneId) return;
    if (focusMoveControl) {
      pendingMoveControlFocusRef.current = { id, laneValue: laneId ?? 'unset' };
    }
    markSaving(id, true);
    startTransition(async () => {
      moveOptimistic({ id, patch: { laneId } });
      const previousLaneId = item.laneId;
      const result = await notifyAction({
        id: `board-item:${id}`,
        loading: 'Updating status…',
        success: 'Status updated',
        error: 'Couldn’t update status',
        run: () => updateBoardItemAction({ id, laneId }),
        undo: {
          run: async () => {
            moveOptimistic({ id, patch: { laneId: previousLaneId } });
            const undoResult = await updateBoardItemAction({ id, laneId: previousLaneId });
            if (!undoResult.error) router.refresh();
            return undoResult;
          },
        },
      });
      const failed = Boolean(result.error);
      if (failed) {
        if (focusMoveControl) {
          pendingMoveControlFocusRef.current = { id, laneValue: previousLaneId ?? 'unset' };
        }
        moveOptimistic({ id, patch: { laneId: previousLaneId } });
      }
      markSaving(id, false);
      router.refresh();
    });
  }

  function updateItem(id: string, patch: BoardItemOptimisticPatch): void {
    if (savingSet().has(id)) return;
    const item = optimisticItems.find((candidate) => candidate.id === id);
    if (!item) return;
    const baseline = Object.fromEntries(
      Object.keys(patch).map((key) => [key, item[key as keyof boards.BoardItemRow]]),
    ) as BoardItemOptimisticPatch;
    markSaving(id, true);
    startTransition(async () => {
      moveOptimistic({ id, patch });
      const label =
        Object.keys(patch)[0] === 'dueAt' ? 'due date' : (Object.keys(patch)[0] ?? 'item');
      const result = await notifyAction({
        id: `board-item:${id}`,
        loading: `Updating ${label}…`,
        success: `${label.slice(0, 1).toUpperCase()}${label.slice(1)} updated`,
        error: `Couldn’t update ${label}`,
        run: () =>
          updateBoardItemAction({
            id,
            ...patch,
            ...(patch.dueAt !== undefined
              ? { dueAt: patch.dueAt ? patch.dueAt.toISOString() : null }
              : {}),
          }),
        undo: {
          run: async () => {
            moveOptimistic({ id, patch: baseline });
            const undoResult = await updateBoardItemAction({
              id,
              ...baseline,
              ...(baseline.dueAt !== undefined
                ? { dueAt: baseline.dueAt ? baseline.dueAt.toISOString() : null }
                : {}),
            });
            if (!undoResult.error) router.refresh();
            return undoResult;
          },
        },
      });
      const failed = Boolean(result.error);
      if (failed) moveOptimistic({ id, patch: baseline });
      markSaving(id, false);
      router.refresh();
    });
  }

  function onDragStart(event: DragStartEvent): void {
    setActiveDragId(String(event.active.id));
  }

  function onDragEnd(event: DragEndEvent): void {
    setActiveDragId(null);
    const overId = event.over?.id ? String(event.over.id) : null;
    if (!overId) return;
    moveItem(String(event.active.id), overId === 'unset' ? null : overId);
  }

  return (
    <DndContext
      id={dndContextId}
      sensors={sensors}
      collisionDetection={kanbanCollisionDetection}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      accessibility={{
        announcements: dragAnnouncements,
        screenReaderInstructions: DRAG_INSTRUCTIONS,
      }}
    >
      <div className="flex h-full min-h-0 min-w-0 flex-col">
        <section
          aria-label="Board columns"
          className="flex min-h-0 flex-1 gap-3 overflow-x-auto overflow-y-hidden px-4 pb-2 md:px-8"
        >
          {visibleLanes.map((lane, index) => (
            <KanbanColumn
              key={lane.id}
              boardId={boardId}
              lane={lane}
              ordinal={index + 1}
              items={byLane.get(lane.id === 'unset' ? null : lane.id) ?? []}
              savingIds={savingIds}
              selectedItemId={selectedItemId}
              members={members}
              filterParams={filterParams}
              moveTargets={visibleLanes}
              onMoveItem={moveItem}
              onUpdateItem={updateItem}
              onMoveControlRef={registerMoveControl}
            />
          ))}
        </section>
      </div>
      <DragOverlay>
        {activeDragItem ? (
          <div className="rounded-sm border border-signal bg-bg px-2.5 py-2 text-sm shadow-md">
            {displayText(displayObjectTitle(activeDragItem.object))}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function KanbanColumn({
  boardId,
  lane,
  ordinal,
  items,
  savingIds,
  selectedItemId,
  members,
  filterParams,
  moveTargets,
  onMoveItem,
  onUpdateItem,
  onMoveControlRef,
}: {
  boardId: string;
  lane: boards.BoardLaneRow;
  ordinal: number;
  items: boards.BoardItemRow[];
  savingIds: ReadonlySet<string>;
  selectedItemId: string | null;
  members: BoardMemberOption[];
  filterParams: Record<string, string>;
  moveTargets: boards.BoardLaneRow[];
  onMoveItem: (id: string, laneId: string | null, focusMoveControl?: boolean) => void;
  onUpdateItem: (id: string, patch: BoardItemOptimisticPatch) => void;
  onMoveControlRef: (id: string, laneValue: string, node: HTMLButtonElement | null) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: lane.id });
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  return (
    <section
      ref={setNodeRef}
      aria-label={`${lane.name}, board column ${ordinal}`}
      className={cn(
        'flex h-full w-[min(290px,calc(100vw-4rem))] shrink-0 flex-col rounded-sm border border-border bg-surface p-3',
        isOver && 'border-signal/40 bg-signal-soft',
      )}
    >
      <div className="mb-3 flex shrink-0 items-baseline justify-between">
        <h3 className="text-xs text-fg-dim">{lane.name}</h3>
        <span className="text-xs text-fg">{items.length}</span>
      </div>
      <div ref={setScrollEl} className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <VirtualList
          items={items}
          getItemKey={(item) => item.id}
          estimateSize={120}
          gap={8}
          getScrollElement={() => scrollEl}
          renderItem={(item) => (
            <KanbanCard
              boardId={boardId}
              item={item}
              lane={lane}
              saving={savingIds.has(item.id)}
              selected={item.id === selectedItemId}
              members={members}
              filterParams={filterParams}
              moveTargets={moveTargets}
              onMoveItem={onMoveItem}
              onUpdateItem={onUpdateItem}
              onMoveControlRef={onMoveControlRef}
            />
          )}
        />
      </div>
    </section>
  );
}

function KanbanCard({
  boardId,
  item,
  lane,
  saving,
  selected,
  members,
  filterParams,
  moveTargets,
  onMoveItem,
  onUpdateItem,
  onMoveControlRef,
}: {
  boardId: string;
  item: boards.BoardItemRow;
  lane: boards.BoardLaneRow;
  saving: boolean;
  selected: boolean;
  members: BoardMemberOption[];
  filterParams: Record<string, string>;
  moveTargets: boards.BoardLaneRow[];
  onMoveItem: (id: string, laneId: string | null, focusMoveControl?: boolean) => void;
  onUpdateItem: (id: string, patch: BoardItemOptimisticPatch) => void;
  onMoveControlRef: (id: string, laneValue: string, node: HTMLButtonElement | null) => void;
}) {
  const optimistic = item.id.startsWith('optimistic-');
  const { attributes, listeners, setActivatorNodeRef, setNodeRef, transform, isDragging } =
    useDraggable({
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
  const registerMoveControl = useCallback(
    (node: HTMLButtonElement | null) => {
      if (saving) return;
      onMoveControlRef(item.id, lane.id, node);
    },
    [item.id, lane.id, onMoveControlRef, saving],
  );
  return (
    <article
      ref={setNodeRef}
      style={style}
      className={cn(
        'rounded-sm border border-border bg-bg px-3 py-2 text-sm transition-colors hover:border-border-strong',
        selected && 'border-signal bg-signal-soft shadow-[inset_3px_0_0_var(--color-signal)]',
        blocked && 'border-danger/50',
        isDragging && 'opacity-50',
        saving && 'cursor-progress opacity-80',
        optimistic && 'cursor-wait opacity-80',
      )}
    >
      <div className="flex min-w-0 items-start gap-1">
        {optimistic ? (
          <span className="min-w-0 flex-1 whitespace-normal break-words font-medium leading-snug">
            {displayText(title)}
          </span>
        ) : (
          <Link
            id={titleId}
            href={boardViewHref(boardId, 'kanban', item.id, filterParams)}
            aria-current={selected ? 'true' : undefined}
            className="min-w-0 flex-1 whitespace-normal break-words font-medium leading-snug hover:underline"
          >
            {displayText(title)}
          </Link>
        )}
        <button
          ref={setActivatorNodeRef}
          type="button"
          {...attributes}
          {...listeners}
          aria-label={`Drag ${displayText(title)}`}
          disabled={saving || optimistic}
          className="inline-flex size-8 shrink-0 touch-none cursor-grab items-center justify-center rounded-sm text-base leading-none text-fg-dim transition-colors hover:bg-surface-raised hover:text-fg active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/40 focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:cursor-progress disabled:opacity-60"
        >
          <span aria-hidden="true">⠿</span>
        </button>
      </div>
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
      <div className="mt-1 flex flex-wrap items-center gap-0.5">
        <EditableMetadata
          label={`Responsible person for ${displayText(title)}`}
          pending={saving}
          disabled={optimistic}
        >
          <EditableMetadata.Value>
            {ownerLabel(item.responsibleUserId, members)}
          </EditableMetadata.Value>
          <EditableMetadata.Editor>
            <select
              value={item.responsibleUserId ?? ''}
              onChange={(event) => {
                onUpdateItem(item.id, { responsibleUserId: event.currentTarget.value || null });
              }}
              className="h-10 w-full rounded-sm border border-border bg-bg px-2 text-xs"
              aria-label="Responsible person"
            >
              <option value="">Unassigned</option>
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.label}
                </option>
              ))}
            </select>
          </EditableMetadata.Editor>
        </EditableMetadata>
        <EditableMetadata
          label={`Due date for ${displayText(title)}`}
          pending={saving}
          disabled={optimistic}
        >
          <EditableMetadata.Value>
            <DueDateDisplay value={item.dueAt} variant="compact" />
          </EditableMetadata.Value>
          <EditableMetadata.Editor>
            <MetadataDateEditor
              defaultValue={item.dueAt ? item.dueAt.toISOString().slice(0, 10) : ''}
              onApply={(value) => {
                onUpdateItem(item.id, {
                  dueAt: value ? new Date(`${value}T00:00:00.000Z`) : null,
                });
              }}
            />
          </EditableMetadata.Editor>
        </EditableMetadata>
        <EditableMetadata
          label={`Priority for ${displayText(title)}`}
          pending={saving}
          disabled={optimistic}
        >
          <EditableMetadata.Value>
            <CollectionStatus
              value={item.priority ? `p${item.priority}` : 'none'}
              tone={priorityTone(item.priority)}
              label={item.priority ? `P${item.priority}` : 'No priority'}
            />
          </EditableMetadata.Value>
          <EditableMetadata.Editor>
            <select
              value={item.priority ?? ''}
              onChange={(event) => {
                onUpdateItem(item.id, {
                  priority: event.currentTarget.value ? Number(event.currentTarget.value) : null,
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
          </EditableMetadata.Editor>
        </EditableMetadata>
        <EditableMetadata
          label={`Next step for ${displayText(title)}`}
          pending={saving}
          disabled={optimistic}
        >
          <EditableMetadata.Value>{item.nextStep ?? 'No next step'}</EditableMetadata.Value>
          <EditableMetadata.Editor>
            <form
              action={(formData) => {
                const rawNextStep = formData.get('nextStep');
                const nextStep = (typeof rawNextStep === 'string' ? rawNextStep : '').trim();
                onUpdateItem(item.id, { nextStep: nextStep || null });
              }}
              className="flex items-center gap-2"
            >
              <input
                name="nextStep"
                defaultValue={item.nextStep ?? ''}
                className="h-10 min-w-56 rounded-sm border border-border bg-bg px-2 text-xs"
                aria-label="Next step"
              />
              <button
                type="submit"
                className="min-h-10 rounded-sm bg-signal px-3 text-xs font-medium text-signal-fg"
              >
                Apply
              </button>
            </form>
          </EditableMetadata.Editor>
        </EditableMetadata>
      </div>
      {!optimistic ? (
        <EditableMetadata
          label={`Lane for ${displayText(title)}`}
          pending={saving}
          className="mt-1"
          triggerRef={registerMoveControl}
        >
          <EditableMetadata.Value>{lane.name}</EditableMetadata.Value>
          <EditableMetadata.Editor>
            <select
              id={moveControlId}
              value={lane.id}
              disabled={saving}
              aria-label="Move to lane"
              aria-describedby={titleId}
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
          </EditableMetadata.Editor>
        </EditableMetadata>
      ) : null}
    </article>
  );
}

function ownerLabel(userId: string | null, members: BoardMemberOption[]): string {
  if (!userId) return 'Unassigned';
  return members.find((member) => member.id === userId)?.label ?? 'Assigned';
}

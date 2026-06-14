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

import { updateBoardItemAction } from '@/app/actions/boards';
import {
  curatedKanbanSaveState,
  type CuratedKanbanSaveState,
} from '@/components/boards/curated-kanban-state';
import { displayText } from '@/lib/display-dates';
import { cn, errorMessage } from '@/lib/utils';

interface Props {
  boardId: string;
  lanes: boards.BoardLaneRow[];
  items: boards.BoardItemRow[];
  selectedItemId: string | null;
  members: BoardMemberOption[];
}

export function CuratedKanbanBoard({ boardId, lanes, items, selectedItemId, members }: Props) {
  const dndContextId = useId();
  const router = useRouter();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
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

  function onDragEnd(event: DragEndEvent): void {
    const id = String(event.active.id);
    const overId = event.over?.id ? String(event.over.id) : null;
    if (!overId) return;
    const laneId = overId === 'unset' ? null : overId;
    if (savingSet().has(id)) return;
    const item = optimisticItems.find((candidate) => candidate.id === id);
    if (!item || item.laneId === laneId) return;
    startTransition(async () => {
      moveOptimistic({ id, laneId });
      setErrors((current) => {
        const { [id]: _cleared, ...rest } = current;
        return rest;
      });
      markSaving(id, true);
      let failed = false;
      try {
        const result = await updateBoardItemAction({ id, laneId });
        failed = 'error' in result && Boolean(result.error);
        if ('error' in result && result.error) {
          setErrors((current) => ({ ...current, [id]: result.error ?? 'Move failed' }));
        }
      } catch (err) {
        failed = true;
        setErrors((current) => ({ ...current, [id]: errorMessage(err, 'Move failed') }));
      } finally {
        markSaving(id, false, failed);
        router.refresh();
      }
    });
  }

  return (
    <DndContext
      id={dndContextId}
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={onDragEnd}
    >
      <div className="flex h-full min-h-0 min-w-0 flex-col">
        <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto overflow-y-hidden px-4 pb-2 md:px-8">
          {lanes.map((lane) => (
            <KanbanColumn
              key={lane.id}
              boardId={boardId}
              lane={lane}
              items={byLane.get(lane.id) ?? []}
              savingIds={savingIds}
              errors={errors}
              selectedItemId={selectedItemId}
              members={members}
            />
          ))}
          {(byLane.get(null)?.length ?? 0) > 0 ? (
            <KanbanColumn
              boardId={boardId}
              lane={{
                id: 'unset',
                boardId,
                name: 'Unset',
                position: 999,
                kind: null,
                archivedAt: null,
              }}
              items={byLane.get(null) ?? []}
              savingIds={savingIds}
              errors={errors}
              selectedItemId={selectedItemId}
              members={members}
            />
          ) : null}
        </div>
        {saveState !== 'idle' ? (
          <output className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-dim">
            {saveState === 'saving' ? 'Saving...' : 'Saved'}
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
}: {
  boardId: string;
  lane: boards.BoardLaneRow;
  items: boards.BoardItemRow[];
  savingIds: ReadonlySet<string>;
  errors: Record<string, string>;
  selectedItemId: string | null;
  members: BoardMemberOption[];
}) {
  const { setNodeRef, isOver } = useDroppable({ id: lane.id });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex h-full w-[290px] shrink-0 flex-col rounded-sm border border-border bg-surface p-3',
        isOver && 'border-signal/40 bg-signal-soft',
      )}
    >
      <div className="mb-3 flex shrink-0 items-baseline justify-between">
        <h3 className="font-mono text-[11px] uppercase tracking-[0.14em] text-fg-dim">
          {lane.name}
        </h3>
        <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg">
          {items.length}
        </span>
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
}: {
  boardId: string;
  item: boards.BoardItemRow;
  lane: boards.BoardLaneRow;
  saving: boolean;
  error?: string;
  selected: boolean;
  members: BoardMemberOption[];
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
  const due = dueState(item.dueAt);
  return (
    <li
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={cn(
        'cursor-grab rounded-sm border border-border bg-bg px-3 py-2 text-sm transition-colors hover:border-border-strong',
        selected && 'border-signal bg-signal-soft shadow-[inset_3px_0_0_var(--color-signal)]',
        blocked && 'border-danger/50',
        isDragging && 'opacity-50',
        saving && 'cursor-progress opacity-80',
        optimistic && 'cursor-wait opacity-80',
        error && 'border-danger/50',
      )}
    >
      {optimistic ? (
        <span className="block min-w-0 truncate font-medium">
          {displayText(item.object.canonicalName)}
        </span>
      ) : (
        <Link
          href={`/app/boards/${boardId}?item=${item.id}`}
          className="block min-w-0 truncate font-medium hover:underline"
        >
          {displayText(item.object.canonicalName)}
        </Link>
      )}
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-fg-dim">
        <span>{item.object.type}</span>
        {blocked ? <span className="text-danger">Blocked</span> : null}
      </div>
      <div className="mt-2 grid grid-cols-3 gap-px overflow-hidden rounded-sm border border-border bg-border font-mono text-[10px] uppercase tracking-[0.08em]">
        <CardMeta
          value={ownerLabel(item.responsibleUserId, members)}
          missing={!item.responsibleUserId}
        />
        <CardMeta value={due.label} missing={!item.dueAt} danger={due.tone === 'danger'} />
        <CardMeta
          value={item.priority ? `P${item.priority}` : 'No priority'}
          missing={!item.priority}
        />
      </div>
      {item.nextStep ? (
        <p className="mt-2 line-clamp-2 text-xs text-fg-muted">{displayText(item.nextStep)}</p>
      ) : null}
      {error ? (
        <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.1em] text-danger">{error}</p>
      ) : null}
    </li>
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
      {value}
    </span>
  );
}

function ownerLabel(userId: string | null, members: BoardMemberOption[]): string {
  if (!userId) return 'Unassigned';
  return members.find((member) => member.id === userId)?.label ?? 'Assigned';
}

function dateLabel(value: Date): string {
  return new Date(value).toLocaleDateString('en-CA');
}

function dueState(value: Date | null): { label: string; tone: 'danger' | 'neutral' } {
  if (!value) return { label: 'No due', tone: 'neutral' };
  const due = new Date(value);
  if (due.getTime() < Date.now()) return { label: `Overdue ${dateLabel(due)}`, tone: 'danger' };
  return { label: `Due ${dateLabel(due)}`, tone: 'neutral' };
}

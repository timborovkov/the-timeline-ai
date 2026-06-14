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
import { useId, useOptimistic, useRef, useState, useTransition } from 'react';

import type * as boards from '@timeline/shared/boards';

import { updateBoardItemAction } from '@/app/actions/boards';
import {
  curatedKanbanSaveState,
  type CuratedKanbanSaveState,
} from '@/components/boards/curated-kanban-state';
import { cn, errorMessage } from '@/lib/utils';

interface Props {
  boardId: string;
  lanes: boards.BoardLaneRow[];
  items: boards.BoardItemRow[];
}

export function CuratedKanbanBoard({ boardId, lanes, items }: Props) {
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
  const savingSet = savingRef.current;
  const batchHadFailureRef = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const laneIds = new Set(lanes.map((lane) => lane.id));
  const byLane = new Map<string | null, boards.BoardItemRow[]>();
  for (const lane of lanes) byLane.set(lane.id, []);
  byLane.set(null, []);
  for (const item of optimisticItems) {
    const laneId = item.laneId && laneIds.has(item.laneId) ? item.laneId : null;
    const list = byLane.get(laneId) ?? [];
    list.push(item);
    byLane.set(laneId, list);
  }

  function markSaving(id: string, saving: boolean, failed = false) {
    if (saving) {
      if (timer.current) clearTimeout(timer.current);
      if (savingSet.size === 0) batchHadFailureRef.current = false;
      savingSet.add(id);
    } else {
      if (failed) batchHadFailureRef.current = true;
      savingSet.delete(id);
    }
    setSavingIds(new Set(savingSet));
    const nextSaveState = curatedKanbanSaveState(savingSet.size, batchHadFailureRef.current);
    setSaveState(nextSaveState);
    if (!saving && savingSet.size === 0) {
      if (timer.current) clearTimeout(timer.current);
      if (!batchHadFailureRef.current) {
        timer.current = setTimeout(() => {
          setSaveState('idle');
        }, 1600);
      }
    }
  }

  function onDragEnd(event: DragEndEvent): void {
    const id = String(event.active.id);
    const overId = event.over?.id ? String(event.over.id) : null;
    if (!overId) return;
    const laneId = overId === 'unset' ? null : overId;
    if (savingSet.has(id)) return;
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
        <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto overflow-y-hidden pb-2">
          {lanes.map((lane) => (
            <KanbanColumn
              key={lane.id}
              boardId={boardId}
              lane={lane}
              items={byLane.get(lane.id) ?? []}
              savingIds={savingIds}
              errors={errors}
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
}: {
  boardId: string;
  lane: boards.BoardLaneRow;
  items: boards.BoardItemRow[];
  savingIds: ReadonlySet<string>;
  errors: Record<string, string>;
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
            saving={savingIds.has(item.id)}
            error={errors[item.id]}
          />
        ))}
      </ul>
    </div>
  );
}

function KanbanCard({
  boardId,
  item,
  saving,
  error,
}: {
  boardId: string;
  item: boards.BoardItemRow;
  saving: boolean;
  error?: string;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: item.id,
    disabled: saving,
  });
  const style = transform
    ? { transform: `translate3d(${String(transform.x)}px,${String(transform.y)}px,0)` }
    : undefined;
  return (
    <li
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={cn(
        'cursor-grab rounded-sm border border-border bg-bg px-3 py-2 text-sm transition-colors hover:border-border-strong',
        isDragging && 'opacity-50',
        saving && 'cursor-progress opacity-80',
        error && 'border-danger/50',
      )}
    >
      <Link
        href={`/app/boards/${boardId}?item=${item.id}`}
        className="block min-w-0 truncate font-medium hover:underline"
      >
        {item.object.canonicalName}
      </Link>
      <div className="mt-1.5 flex flex-wrap items-center gap-2 font-mono text-[11px] uppercase tracking-[0.1em] text-fg-dim">
        <span>{item.object.type}</span>
        {item.responsibleUserId ? <span>· owner</span> : null}
        {item.dueAt ? <span>· due {new Date(item.dueAt).toLocaleDateString('en-CA')}</span> : null}
        {item.priority ? <span>· p{item.priority}</span> : null}
      </div>
      {item.nextStep ? (
        <p className="mt-2 line-clamp-2 text-xs text-fg-muted">{item.nextStep}</p>
      ) : null}
      {error ? (
        <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.1em] text-danger">{error}</p>
      ) : null}
    </li>
  );
}

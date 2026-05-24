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
import { type objects } from '@timeline/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useOptimistic, useTransition } from 'react';

import { updateObjectAction } from '@/app/actions/objects';
import { cn } from '@/lib/utils';

type GroupKey = 'status' | 'stage' | 'priority';

interface Props {
  rows: objects.ObjectRow[];
  groupBy?: GroupKey;
  /** Preferred column order; extra values seen on rows get appended. */
  columns?: string[];
}

// Sensible defaults so a board with no configured columns still renders. The
// user can edit board.groupBy to point at any column the rows share.
const DEFAULT_STATUS_COLS = ['todo', 'doing', 'done', 'blocked'];

function colValue(row: objects.ObjectRow, key: GroupKey): string {
  const v = row[key];
  if (v === null) return 'unset';
  return String(v);
}

export function KanbanBoard({ rows, groupBy = 'status', columns }: Props) {
  // Only apply DEFAULT_STATUS_COLS when actually grouping by status — for
  // `stage` or `priority` the default would render four empty
  // todo/doing/done/blocked columns next to the real ones. When no
  // explicit columns are configured for non-status groupBy, fall back to
  // the union of values seen on rows (computed below).
  const cols = columns ?? (groupBy === 'status' ? DEFAULT_STATUS_COLS : []);
  const router = useRouter();
  // `useOptimistic` shows the drop instantly while the server action
  // resolves, then snaps back to the underlying `rows` prop. Because
  // `updateObjectAction` only revalidates the object detail paths (not
  // `/app/boards/[id]` or `/app/tasks`), we call `router.refresh()` after
  // the action so the server component re-fetches and the new rows
  // replace the snapped-back ones. Without the refresh, every drop
  // visually reverts to its original column even though the DB has the
  // new status.
  const [items, applyMove] = useOptimistic(
    rows,
    (state: objects.ObjectRow[], move: { id: string; col: string }) =>
      state.map((r) => (r.id === move.id ? { ...r, [groupBy]: move.col } : r)),
  );
  const [, startTransition] = useTransition();

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const allCols = Array.from(new Set([...cols, ...items.map((r) => colValue(r, groupBy))]));
  const byCol = new Map<string, objects.ObjectRow[]>();
  for (const c of allCols) byCol.set(c, []);
  for (const r of items) {
    const c = colValue(r, groupBy);
    const list = byCol.get(c) ?? [];
    list.push(r);
    byCol.set(c, list);
  }

  function onDragEnd(e: DragEndEvent): void {
    const id = e.active.id as string;
    const col = e.over?.id as string | undefined;
    if (!col) return;
    const row = items.find((r) => r.id === id);
    if (!row || colValue(row, groupBy) === col) return;
    // `startTransition` is required to call setState (via useOptimistic) and
    // the server action from a non-form handler.
    // Status is a non-null text column, so the synthetic 'unset' column
    // would never legitimately receive a drop. Skip rather than write a
    // bogus 'unset' string. Priority and stage are nullable — map 'unset'
    // back to null instead of NaN/'unset'.
    if (groupBy === 'status' && col === 'unset') return;
    startTransition(async () => {
      applyMove({ id, col });
      const patch =
        groupBy === 'priority'
          ? { id, priority: col === 'unset' ? null : Number(col) }
          : groupBy === 'stage'
            ? { id, stage: col === 'unset' ? null : col }
            : { id, status: col };
      await updateObjectAction(patch);
      // Refresh the server component for this route so the underlying
      // `rows` prop reflects the new column before useOptimistic snaps
      // back. See the `useOptimistic` comment above.
      router.refresh();
    });
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <div className="grid auto-cols-[minmax(240px,1fr)] grid-flow-col gap-3 overflow-x-auto pb-2">
        {allCols.map((c) => (
          <Column key={c} id={c} rows={byCol.get(c) ?? []} />
        ))}
      </div>
    </DndContext>
  );
}

function Column({ id, rows }: { id: string; rows: objects.ObjectRow[] }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex min-w-0 flex-col rounded-xl border bg-card/40 p-3',
        isOver && 'border-primary/40 bg-primary/5',
      )}
    >
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="text-xs font-medium uppercase tracking-wide">{id}</h3>
        <span className="text-[11px] text-muted-foreground">{rows.length}</span>
      </div>
      <ul className="flex flex-col gap-2">
        {rows.map((r) => (
          <Card key={r.id} row={r} />
        ))}
      </ul>
    </div>
  );
}

function Card({ row }: { row: objects.ObjectRow }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: row.id });
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
        'cursor-grab rounded-lg border bg-card px-3 py-2 text-sm shadow-sm',
        isDragging && 'opacity-50',
      )}
    >
      <Link
        href={`/app/objects/${row.id}`}
        onPointerDown={(e) => {
          // Stop dnd from swallowing the click when the user just wants to
          // open the object detail. Pointer-down on the anchor still lets the
          // browser handle the navigation if no drag started.
          e.stopPropagation();
        }}
        className="block min-w-0 truncate font-medium hover:underline"
      >
        {row.canonicalName}
      </Link>
      <div className="mt-1 flex items-center gap-2 text-[11px] uppercase tracking-wide text-muted-foreground">
        <span>{row.type}</span>
        {row.dueAt && <span>· due {new Date(row.dueAt).toLocaleDateString()}</span>}
        {row.agentSuggested && (
          <span className="rounded-full bg-amber-500/10 px-1.5 py-0.5 text-amber-700">
            suggested
          </span>
        )}
      </div>
    </li>
  );
}

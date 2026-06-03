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
import { useEffect, useId, useOptimistic, useRef, useState, useTransition } from 'react';

import type { SaveState } from '@/lib/utils';
import type * as objects from '@timeline/shared/objects';

import { updateObjectAction } from '@/app/actions/objects';
import { cn, errorMessage } from '@/lib/utils';

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
  const dndContextId = useId();
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
  // Coerce the column id back into the row field's real shape so
  // optimistic state matches what the server will return. `col` is always
  // a string (droppable ids) but `priority` is `number | null` and
  // `stage` is `string | null` — without coercion any future code that
  // sorted by priority within a column would compare strings.
  const applyOptimistic = (
    state: objects.ObjectRow[],
    move: { id: string; col: string },
  ): objects.ObjectRow[] =>
    state.map((r) => {
      if (r.id !== move.id) return r;
      if (groupBy === 'priority') {
        return { ...r, priority: move.col === 'unset' ? null : Number(move.col) };
      }
      if (groupBy === 'stage') {
        return { ...r, stage: move.col === 'unset' ? null : move.col };
      }
      return { ...r, status: move.col };
    });
  const [items, applyMove] = useOptimistic(rows, applyOptimistic);
  const [, startTransition] = useTransition();
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [savingCount, setSavingCount] = useState(0);
  const [cardErrors, setCardErrors] = useState<Record<string, string>>({});
  const [savingCardIds, setSavingCardIds] = useState<ReadonlySet<string>>(() => new Set());
  const savingCountRef = useRef(0);
  const savingCardIdsRef = useRef<Set<string> | null>(null);
  const batchHadFailureRef = useRef(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function activeSavingCardIds() {
    savingCardIdsRef.current ??= new Set();
    return savingCardIdsRef.current;
  }

  useEffect(() => {
    return () => {
      if (savedTimer.current) clearTimeout(savedTimer.current);
    };
  }, []);

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
    if (activeSavingCardIds().has(id)) return;
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
      if (savedTimer.current) clearTimeout(savedTimer.current);
      setSaveState('saving');
      if (savingCountRef.current === 0) batchHadFailureRef.current = false;
      savingCountRef.current += 1;
      activeSavingCardIds().add(id);
      setSavingCount(savingCountRef.current);
      setSavingCardIds(new Set(activeSavingCardIds()));
      setCardErrors((errors) => {
        const { [id]: _cleared, ...rest } = errors;
        return rest;
      });
      const patch =
        groupBy === 'priority'
          ? { id, priority: col === 'unset' ? null : Number(col) }
          : groupBy === 'stage'
            ? { id, stage: col === 'unset' ? null : col }
            : { id, status: col };
      try {
        const result = await updateObjectAction(patch);
        const failed = 'error' in result && result.error;
        if (failed) {
          batchHadFailureRef.current = true;
          setCardErrors((errors) => ({ ...errors, [id]: result.error ?? 'Move failed' }));
        }
      } catch (err) {
        batchHadFailureRef.current = true;
        setCardErrors((errors) => ({ ...errors, [id]: errorMessage(err, 'Move failed') }));
      } finally {
        savingCountRef.current = Math.max(0, savingCountRef.current - 1);
        activeSavingCardIds().delete(id);
        setSavingCount(savingCountRef.current);
        setSavingCardIds(new Set(activeSavingCardIds()));
        if (savingCountRef.current === 0) {
          if (batchHadFailureRef.current) {
            setSaveState('idle');
          } else {
            setSaveState('saved');
            savedTimer.current = setTimeout(() => {
              setSaveState('idle');
            }, 1600);
          }
        }
        // Always refresh: on success the new column persists; on failure
        // useOptimistic snaps back to the unchanged server rows.
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
      {saveState !== 'idle' && (
        <output
          className="mb-2 text-right font-mono text-[11px] uppercase tracking-[0.12em] text-fg-dim"
          aria-live="polite"
        >
          {saveState === 'saving'
            ? `Saving${savingCount > 1 ? ` ${savingCount} moves` : ''}…`
            : 'Saved'}
        </output>
      )}
      {/* Flex row with FIXED column widths. The previous
          `grid auto-cols-[minmax(240px,1fr)]` made each column compete for
          a 1fr share of the container — five columns squeezed below their
          min-width and the last one clipped on narrow viewports. Fixed
          width + horizontal overflow gives every column its full size and
          a normal scroll fallback. `h-full` propagates the parent's
          height so each column can host its own vertical scroll. */}
      <div className="flex h-full gap-3 overflow-x-auto pb-2">
        {allCols.map((c) => (
          <Column
            key={c}
            id={c}
            rows={byCol.get(c) ?? []}
            cardErrors={cardErrors}
            savingCardIds={savingCardIds}
          />
        ))}
      </div>
    </DndContext>
  );
}

function Column({
  id,
  rows,
  cardErrors,
  savingCardIds,
}: {
  id: string;
  rows: objects.ObjectRow[];
  cardErrors: Record<string, string>;
  savingCardIds: ReadonlySet<string>;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex h-full w-[280px] shrink-0 flex-col rounded-sm border border-border bg-surface p-3',
        isOver && 'border-signal/40 bg-signal-soft',
      )}
    >
      <div className="mb-3 flex shrink-0 items-baseline justify-between">
        <h3 className="font-mono text-[11px] uppercase tracking-[0.14em] text-fg-dim">{id}</h3>
        <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg">
          {rows.length}
        </span>
      </div>
      {/* `min-h-0` is the magic that lets a flex child actually shrink
          enough for overflow-y-auto to kick in — without it the column
          would push its parent and only the page would scroll. */}
      <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
        {rows.map((r) => (
          <Card key={r.id} row={r} error={cardErrors[r.id]} saving={savingCardIds.has(r.id)} />
        ))}
      </ul>
    </div>
  );
}

function Card({ row, error, saving }: { row: objects.ObjectRow; error?: string; saving: boolean }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: row.id,
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
        href={`/app/objects/${row.id}`}
        // No `stopPropagation` on pointer-down: dnd-kit's PointerSensor uses
        // `activationConstraint: { distance: 4 }`, so a click that doesn't
        // move past 4px still resolves as a normal Link click and navigates.
        // Stopping propagation here would prevent drags from initiating on
        // the title area, which is where users naturally grab the card.
        className="block min-w-0 truncate font-medium hover:underline"
      >
        {row.canonicalName}
      </Link>
      <div className="mt-1.5 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.1em] text-fg-dim">
        <span>{row.type}</span>
        {row.dueAt && <span>· due {new Date(row.dueAt).toLocaleDateString('en-CA')}</span>}
        {/* Badge tracks the live review state, not provenance.
            agentSuggested stays true forever; status leaves 'suggested'
            on accept/reject. */}
        {row.agentSuggested && row.status === 'suggested' && (
          <span className="rounded-sm border border-signal/40 bg-signal-soft px-1.5 py-0.5 text-signal">
            suggested
          </span>
        )}
      </div>
      {error ? (
        <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.1em] text-danger">{error}</p>
      ) : null}
    </li>
  );
}

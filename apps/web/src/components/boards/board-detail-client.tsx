'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

import type { BoardLayout } from '@/lib/board-links';
import type * as boards from '@timeline/shared/boards';
import type * as objects from '@timeline/shared/objects';

import { BoardAddItemForm } from '@/components/boards/board-add-item-form';
import { BoardCardDetail } from '@/components/boards/board-card-detail';
import { BoardPinButton } from '@/components/boards/board-pin-button';
import { CuratedBoardList, CuratedBoardTable } from '@/components/boards/curated-board-views';
import { CuratedKanbanBoard } from '@/components/boards/curated-kanban-board';
import { DeleteBoardButton } from '@/components/boards/delete-board-button';
import { HistoryBackLink } from '@/components/history-back-link';
import { IndexStrip } from '@/components/index-strip';
import { boardViewHref } from '@/lib/board-links';

interface Props {
  boardId: string;
  boardName: string;
  templateKind: boards.BoardTemplateKind;
  purpose: string | null;
  pinned: boolean;
  view: BoardLayout;
  lanes: boards.BoardLaneRow[];
  initialItems: boards.BoardItemRow[];
  initialCandidates: objects.ObjectRow[];
  recommendedTypes: objects.ObjectType[];
  defaultLaneId: string | null;
  selectedItemId: string | null;
  history: boards.BoardItemChangeRow[];
}

export function BoardDetailClient({
  boardId,
  boardName,
  templateKind,
  purpose,
  pinned,
  view,
  lanes,
  initialItems,
  initialCandidates,
  recommendedTypes,
  defaultLaneId,
  selectedItemId,
  history,
}: Props) {
  const router = useRouter();
  const [items, setItems] = useState(initialItems);
  const [candidates, setCandidates] = useState(initialCandidates);
  const selectedItem = selectedItemId
    ? (items.find((item) => item.id === selectedItemId) ?? null)
    : null;
  const availableCandidates = useMemo(() => {
    const itemEntityIds = new Set(items.map((item) => item.entityId));
    return candidates.filter((candidate) => !itemEntityIds.has(candidate.id));
  }, [candidates, items]);

  function addOptimisticItem(item: boards.BoardItemRow): void {
    setItems((current) => [...current, item]);
  }

  function commitAddedItem(item: boards.BoardItemRow, optimisticId: string): void {
    setItems((current) => current.map((row) => (row.id === optimisticId ? item : row)));
    setCandidates((current) =>
      current.some((candidate) => candidate.id === item.object.id)
        ? current
        : [...current, item.object],
    );
    router.refresh();
  }

  function rollbackAddedItem(item: boards.BoardItemRow): void {
    setItems((current) => current.filter((row) => row.id !== item.id));
  }

  return (
    <>
      <IndexStrip
        srLabel={`${boardName} · ${templateKind} · ${items.length} board items`}
        segments={[
          { value: 'BOARD' },
          { label: 'kind', value: templateKind.replace('_', ' ') },
          { label: 'name', value: boardName, signal: true },
          { label: 'items', value: items.length },
        ]}
        className={view === 'kanban' ? 'shrink-0 px-4 md:px-8' : 'mb-4 shrink-0'}
      >
        <span className="inline-flex items-center gap-2">
          <HistoryBackLink fallbackHref="/app/boards" label="Back" />
          <BoardPinButton id={boardId} pinned={pinned} />
          <DeleteBoardButton id={boardId} />
        </span>
      </IndexStrip>

      <div
        className={
          view === 'kanban'
            ? 'flex shrink-0 flex-wrap items-center justify-between gap-3 px-4 py-4 md:px-8'
            : 'mb-4 flex shrink-0 flex-wrap items-center justify-between gap-3'
        }
      >
        <p className="max-w-3xl text-sm text-fg-muted">
          {purpose ?? 'A curated board over workspace objects.'}
        </p>
        <nav className="inline-flex overflow-hidden rounded-sm border border-border">
          {(['kanban', 'table', 'list'] as const).map((nextView) => (
            <Link
              key={nextView}
              href={boardViewHref(boardId, nextView, selectedItemId)}
              className={`px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] ${
                view === nextView ? 'bg-signal text-signal-fg' : 'bg-bg text-fg-muted hover:text-fg'
              }`}
            >
              {nextView}
            </Link>
          ))}
        </nav>
      </div>

      <div className={view === 'kanban' ? 'shrink-0 px-4 pb-4 md:px-8' : 'mb-4 shrink-0'}>
        <BoardAddItemForm
          boardId={boardId}
          defaultLaneId={defaultLaneId}
          candidates={availableCandidates}
          recommendedTypes={recommendedTypes}
          onOptimisticItem={addOptimisticItem}
          onItemAdded={commitAddedItem}
          onItemAddFailed={rollbackAddedItem}
        />
      </div>

      <div
        className={
          selectedItem
            ? 'grid min-h-0 flex-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(22rem,0.35fr)]'
            : 'min-h-0 flex-1'
        }
      >
        <div className={view === 'kanban' ? 'h-full min-h-0 min-w-0' : 'min-h-0'}>
          {view === 'kanban' && (
            <CuratedKanbanBoard boardId={boardId} lanes={lanes} items={items} />
          )}
          {view === 'table' && <CuratedBoardTable boardId={boardId} view={view} items={items} />}
          {view === 'list' && <CuratedBoardList boardId={boardId} view={view} items={items} />}
        </div>
        {selectedItem ? (
          <BoardCardDetail boardId={boardId} view={view} item={selectedItem} history={history} />
        ) : null}
      </div>
    </>
  );
}

'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useMemo, useState } from 'react';

import type { BoardLayout } from '@/lib/board-links';
import type * as boards from '@timeline/shared/boards';
import type * as objects from '@timeline/shared/objects';

import { updateBoardItemAction } from '@/app/actions/boards';
import { BoardActionsMenu } from '@/components/boards/board-actions-menu';
import { BoardAddItemForm } from '@/components/boards/board-add-item-form';
import { BoardCardDetail } from '@/components/boards/board-card-detail';
import { CuratedBoardList, CuratedBoardTable } from '@/components/boards/curated-board-views';
import { CuratedKanbanBoard } from '@/components/boards/curated-kanban-board';
import { HistoryBackLink } from '@/components/history-back-link';
import { IndexStrip } from '@/components/index-strip';
import { visibleBoardDescription } from '@/lib/board-description';
import { boardViewHref } from '@/lib/board-links';

export interface BoardMemberOption {
  id: string;
  label: string;
}

export type BoardItemOptimisticPatch = Partial<
  Pick<boards.BoardItemRow, 'responsibleUserId' | 'dueAt' | 'priority' | 'nextStep' | 'notes'>
>;

interface BoardItemPatchOverlay {
  patch: BoardItemOptimisticPatch;
  submittedAt: number;
}

interface Props {
  boardId: string;
  boardName: string;
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
  members: BoardMemberOption[];
}

export function BoardDetailClient({
  boardId,
  boardName,
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
  members,
}: Props) {
  const router = useRouter();
  const [localItems, setLocalItems] = useState<boards.BoardItemRow[]>([]);
  const [localCandidates, setLocalCandidates] = useState<objects.ObjectRow[]>([]);
  const [itemPatches, setItemPatches] = useState<Record<string, BoardItemPatchOverlay>>({});
  const serverItemsById = useMemo(
    () => new Map(initialItems.map((item) => [item.id, item])),
    [initialItems],
  );
  const effectiveItemPatches = useMemo(
    () => reconcileItemPatches(itemPatches, serverItemsById),
    [itemPatches, serverItemsById],
  );
  const items = useMemo(() => {
    const serverEntityIds = new Set(initialItems.map((item) => item.entityId));
    const pendingItems = localItems.filter(
      (item) => !serverItemsById.has(item.id) && !serverEntityIds.has(item.entityId),
    );
    return [...initialItems, ...pendingItems].map((item) => ({
      ...item,
      ...(effectiveItemPatches[item.id] ?? {}),
    }));
  }, [effectiveItemPatches, initialItems, localItems, serverItemsById]);
  const candidates = useMemo(() => {
    const serverCandidateIds = new Set(initialCandidates.map((candidate) => candidate.id));
    const pendingCandidates = localCandidates.filter(
      (candidate) => !serverCandidateIds.has(candidate.id),
    );
    return [...initialCandidates, ...pendingCandidates];
  }, [initialCandidates, localCandidates]);
  const selectedItem = selectedItemId
    ? (items.find((item) => item.id === selectedItemId) ?? null)
    : null;
  const availableCandidates = useMemo(() => {
    const itemEntityIds = new Set(items.map((item) => item.entityId));
    return candidates.filter((candidate) => !itemEntityIds.has(candidate.id));
  }, [candidates, items]);

  function addOptimisticItem(item: boards.BoardItemRow): void {
    setLocalItems((current) => [...current, item]);
  }

  function commitAddedItem(item: boards.BoardItemRow, optimisticId: string): void {
    setLocalItems((current) => current.map((row) => (row.id === optimisticId ? item : row)));
    setLocalCandidates((current) =>
      current.some((candidate) => candidate.id === item.object.id)
        ? current
        : [...current, item.object],
    );
    router.refresh();
  }

  function rollbackAddedItem(item: boards.BoardItemRow): void {
    setLocalItems((current) => current.filter((row) => row.id !== item.id));
  }

  const updateItem = useCallback(
    async (itemId: string, patch: BoardItemOptimisticPatch) => {
      const previousItem = items.find((item) => item.id === itemId);
      setItemPatches((current) => {
        const reconciled = reconcilePatchOverlays(current, serverItemsById);
        return {
          ...reconciled,
          [itemId]: {
            patch: {
              ...(reconciled[itemId]?.patch ?? {}),
              ...patch,
            },
            submittedAt: Date.now(),
          },
        };
      });

      const dueAt = patch.dueAt === undefined ? undefined : (patch.dueAt?.toISOString() ?? null);
      const result = await updateBoardItemAction({
        id: itemId,
        ...patch,
        ...(dueAt !== undefined ? { dueAt } : {}),
      });
      if ('error' in result && result.error) {
        setItemPatches((current) => {
          const reconciled = reconcilePatchOverlays(current, serverItemsById);
          let nextForItem = { ...(reconciled[itemId]?.patch ?? {}) };
          for (const key of Object.keys(patch) as (keyof BoardItemOptimisticPatch)[]) {
            if (previousItem) {
              nextForItem = { ...nextForItem, [key]: previousItem[key] };
            } else {
              nextForItem = omitPatchKey(nextForItem, key);
            }
          }
          if (Object.keys(nextForItem).length === 0) {
            const { [itemId]: _removed, ...rest } = reconciled;
            return rest;
          }
          return { ...reconciled, [itemId]: { patch: nextForItem, submittedAt: Date.now() } };
        });
        return result;
      }
      router.refresh();
      return result;
    },
    [items, router, serverItemsById],
  );

  const description = visibleBoardDescription(purpose);

  const boardHeaderLeading = useMemo(
    () => <HistoryBackLink fallbackHref="/app/boards" label="Back" />,
    [],
  );
  const boardHeaderTrailing = useMemo(
    () => (
      <BoardActionsMenu
        id={boardId}
        name={boardName}
        purpose={purpose ?? ''}
        pinned={pinned}
        lanes={lanes}
      />
    ),
    [boardId, boardName, lanes, pinned, purpose],
  );

  return (
    <>
      <IndexStrip
        srLabel={`Board · ${boardName}`}
        segments={[{ value: 'BOARD' }, { value: boardName, signal: true }]}
        leading={boardHeaderLeading}
        className={view === 'kanban' ? 'shrink-0 px-4 md:px-8' : 'mb-4 shrink-0'}
        trailing={boardHeaderTrailing}
      />

      <div
        className={
          view === 'kanban'
            ? 'flex shrink-0 flex-wrap items-center justify-between gap-3 px-4 py-4 md:px-8'
            : 'mb-4 flex shrink-0 flex-wrap items-center justify-between gap-3'
        }
      >
        {description ? <p className="max-w-3xl text-sm text-fg-muted">{description}</p> : <span />}
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
            <CuratedKanbanBoard
              boardId={boardId}
              lanes={lanes}
              items={items}
              selectedItemId={selectedItemId}
              members={members}
            />
          )}
          {view === 'table' && <CuratedBoardTable boardId={boardId} view={view} items={items} />}
          {view === 'list' && <CuratedBoardList boardId={boardId} view={view} items={items} />}
        </div>
        {selectedItem ? (
          <BoardCardDetail
            key={selectedItem.id}
            boardId={boardId}
            view={view}
            item={selectedItem}
            history={history}
            members={members}
            onUpdateItem={updateItem}
          />
        ) : null}
      </div>
    </>
  );
}

function omitPatchKey(
  patch: BoardItemOptimisticPatch,
  key: keyof BoardItemOptimisticPatch,
): BoardItemOptimisticPatch {
  const { [key]: _removed, ...rest } = patch;
  return rest;
}

function reconcileItemPatches(
  overlays: Record<string, BoardItemPatchOverlay>,
  serverItemsById: ReadonlyMap<string, boards.BoardItemRow>,
): Record<string, BoardItemOptimisticPatch> {
  const reconciled = reconcilePatchOverlays(overlays, serverItemsById);
  return Object.fromEntries(
    Object.entries(reconciled).map(([itemId, overlay]) => [itemId, overlay.patch]),
  );
}

function reconcilePatchOverlays(
  overlays: Record<string, BoardItemPatchOverlay>,
  serverItemsById: ReadonlyMap<string, boards.BoardItemRow>,
): Record<string, BoardItemPatchOverlay> {
  let changed = false;
  const next: Record<string, BoardItemPatchOverlay> = {};
  for (const [itemId, overlay] of Object.entries(overlays)) {
    const serverItem = serverItemsById.get(itemId);
    if (!serverItem) {
      next[itemId] = overlay;
      continue;
    }
    const serverUpdatedAt = dateMillis(serverItem.updatedAt);
    if (serverUpdatedAt !== null && serverUpdatedAt >= overlay.submittedAt) {
      changed = true;
      continue;
    }
    const patch = overlay.patch;
    let nextPatch = patch;
    for (const key of Object.keys(patch) as (keyof BoardItemOptimisticPatch)[]) {
      if (patchValueMatchesServer(serverItem[key], patch[key])) {
        nextPatch = omitPatchKey(nextPatch, key);
        changed = true;
      }
    }
    if (Object.keys(nextPatch).length > 0) next[itemId] = { ...overlay, patch: nextPatch };
  }
  return changed ? next : overlays;
}

function patchValueMatchesServer(
  serverValue: boards.BoardItemRow[keyof BoardItemOptimisticPatch],
  patchValue: BoardItemOptimisticPatch[keyof BoardItemOptimisticPatch],
): boolean {
  const serverDate = dateMillis(serverValue);
  const patchDate = dateMillis(patchValue);
  if (serverDate !== null || patchDate !== null) {
    return serverDate === patchDate;
  }
  return serverValue === patchValue;
}

function dateMillis(value: unknown): number | null {
  if (value instanceof Date) return value.getTime();
  if (typeof value !== 'string') return null;
  const millis = Date.parse(value);
  return Number.isNaN(millis) ? null : millis;
}

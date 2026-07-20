'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useMemo, useState } from 'react';

import type { BoardLayout } from '@/lib/board-links';
import type { WorkFilterState } from '@/lib/work-filters';
import type * as boards from '@timeline/shared/boards';
import type * as objects from '@timeline/shared/objects/types';

import { updateBoardItemAction } from '@/app/actions/boards';
import { BoardActionsMenu } from '@/components/boards/board-actions-menu';
import { BoardAddItemForm } from '@/components/boards/board-add-item-form';
import { BoardCardDetail } from '@/components/boards/board-card-detail';
import { CuratedBoardList, CuratedBoardTable } from '@/components/boards/curated-board-views';
import { CuratedKanbanBoard } from '@/components/boards/curated-kanban-board';
import { ContextualAskLink } from '@/components/chat/contextual-ask-link';
import { HistoryBackLink } from '@/components/history-back-link';
import { PageHeader } from '@/components/page-header';
import { PinButton } from '@/components/pins/pin-button';
import { TaskCategoryPollingProvider } from '@/components/tasks/task-category-badge';
import { WorkFilterBar } from '@/components/work-filter-bar';
import { WorkSubnav } from '@/components/work-subnav';
import { visibleBoardDescription } from '@/lib/board-description';
import { boardViewHref } from '@/lib/board-links';

export interface BoardMemberOption {
  id: string;
  label: string;
}

export type BoardItemOptimisticPatch = Partial<
  Pick<
    boards.BoardItemRow,
    'laneId' | 'responsibleUserId' | 'dueAt' | 'priority' | 'nextStep' | 'notes'
  >
>;

interface BoardItemPatchOverlay {
  patch: BoardItemOptimisticPatch;
  submittedAt: number;
}

interface Props {
  teamId?: string;
  boardId: string;
  boardName: string;
  purpose: string | null;
  pinned: boolean;
  itemCount?: number;
  view: BoardLayout;
  lanes: boards.BoardLaneRow[];
  initialItems: boards.BoardItemRow[];
  initialCandidates: objects.ObjectRow[];
  projectOptions?: { id: string; label: string }[];
  recommendedTypes: objects.ObjectType[];
  defaultLaneId: string | null;
  selectedItemId: string | null;
  selectedObjectContext?: objects.ObjectDetail['connectedWork'] | null;
  history: boards.BoardItemChangeRow[];
  members: BoardMemberOption[];
  filters?: WorkFilterState;
  activeFilters?: boolean;
  filterParams?: Record<string, string>;
  typeLabels?: Record<string, string>;
}

const EMPTY_FILTERS: WorkFilterState = {
  q: '',
  type: '',
  status: '',
  category: '',
  project: '',
  stage: '',
  owner: '',
  assignee: '',
  responsible: '',
  lane: '',
  priority: '',
  due: '',
  dueFrom: '',
  dueTo: '',
  createdFrom: '',
  createdTo: '',
  updatedFrom: '',
  updatedTo: '',
};
const EMPTY_FILTER_PARAMS: Record<string, string> = {};
const EMPTY_TYPE_LABELS: Record<string, string> = {};

export function BoardDetailClient({
  teamId,
  boardId,
  boardName,
  purpose,
  pinned,
  itemCount,
  view,
  lanes,
  initialItems,
  initialCandidates,
  projectOptions: providedProjectOptions,
  recommendedTypes,
  defaultLaneId,
  selectedItemId,
  selectedObjectContext = null,
  history,
  members,
  filters = EMPTY_FILTERS,
  activeFilters = false,
  filterParams = EMPTY_FILTER_PARAMS,
  typeLabels = EMPTY_TYPE_LABELS,
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
  const categoryPollingTasks = useMemo(
    () =>
      items.flatMap((item) =>
        item.object.type === 'task'
          ? [
              {
                id: item.object.id,
                status: item.object.taskCategoryStatus,
                updatedAt: item.object.taskCategoryUpdatedAt,
              },
            ]
          : [],
      ),
    [items],
  );

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

  function removeLocalItem(itemId: string, entityId: string): void {
    setLocalItems((current) =>
      current.filter((row) => row.id !== itemId && row.entityId !== entityId),
    );
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
  const derivedProjectOptions = useMemo(() => {
    const options: { id: string; label: string }[] = [];
    for (const candidate of initialCandidates) {
      if (candidate.type === 'project') {
        options.push({ id: candidate.id, label: candidate.canonicalName });
      }
    }
    return options;
  }, [initialCandidates]);
  const projectOptions = providedProjectOptions ?? derivedProjectOptions;

  const boardHeaderLeading = useMemo(
    () => <HistoryBackLink fallbackHref="/app/boards" label="Back" />,
    [],
  );
  const boardHeaderTrailing = useMemo(
    () => (
      <div className="flex items-center gap-2">
        {teamId ? (
          <ContextualAskLink
            teamId={teamId}
            context={{ pathname: `/app/boards/${boardId}`, routeKind: 'board', boardId }}
            label="Ask about board"
          />
        ) : null}
        <PinButton target={{ kind: 'board', key: boardId }} initialPinned={pinned} compact />
        <BoardActionsMenu
          id={boardId}
          name={boardName}
          purpose={purpose ?? ''}
          pinned={pinned}
          lanes={lanes}
        />
      </div>
    ),
    [boardId, boardName, lanes, pinned, purpose, teamId],
  );

  return (
    <TaskCategoryPollingProvider tasks={categoryPollingTasks}>
      <PageHeader
        title={boardName}
        subtitle={description ?? undefined}
        leading={boardHeaderLeading}
        className={view === 'kanban' ? 'w-full shrink-0 px-4 md:px-8' : 'mb-4 shrink-0'}
        trailing={boardHeaderTrailing}
      />
      <WorkSubnav
        current={`/app/boards/${boardId}`}
        className={view === 'kanban' ? 'shrink-0 px-4 md:px-8' : 'mb-4 shrink-0'}
      />

      <BoardViewNavigation
        boardId={boardId}
        view={view}
        selectedItemId={selectedItemId}
        filterParams={filterParams}
      />

      <WorkFilterBar
        mode="board"
        basePath={`/app/boards/${boardId}`}
        filters={filters}
        active={activeFilters}
        resultCount={items.length}
        totalCount={itemCount ?? items.length}
        hiddenParams={{ view }}
        members={members}
        projects={projectOptions}
        lanes={lanes}
        typeLabels={typeLabels}
        className={view === 'kanban' ? 'shrink-0' : 'mb-4'}
      />

      <div className={view === 'kanban' ? 'w-full shrink-0 px-4 py-4 md:px-8' : 'mb-4 shrink-0'}>
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
              filterParams={filterParams}
            />
          )}
          {view === 'table' && (
            <CuratedBoardTable
              boardId={boardId}
              view={view}
              lanes={lanes}
              items={items}
              members={members}
              onUpdateItem={updateItem}
              filterParams={filterParams}
            />
          )}
          {view === 'list' && (
            <CuratedBoardList
              boardId={boardId}
              view={view}
              lanes={lanes}
              items={items}
              members={members}
              onUpdateItem={updateItem}
              filterParams={filterParams}
            />
          )}
        </div>
        {selectedItem ? (
          <BoardCardDetail
            key={selectedItem.id}
            teamId={teamId}
            boardId={boardId}
            view={view}
            item={selectedItem}
            connectedWork={selectedObjectContext}
            history={history}
            lanes={lanes}
            members={members}
            onUpdateItem={updateItem}
            onItemRemoved={removeLocalItem}
            filterParams={filterParams}
          />
        ) : null}
      </div>
    </TaskCategoryPollingProvider>
  );
}

function BoardViewNavigation({
  boardId,
  view,
  selectedItemId,
  filterParams,
}: {
  boardId: string;
  view: BoardLayout;
  selectedItemId: string | null;
  filterParams: Record<string, string>;
}) {
  return (
    <div
      className={
        view === 'kanban'
          ? 'flex w-full shrink-0 justify-end px-4 py-4 md:px-8'
          : 'mb-4 flex shrink-0 justify-end'
      }
    >
      <nav className="inline-flex overflow-hidden rounded-sm border border-border">
        {(['kanban', 'table', 'list'] as const).map((nextView) => (
          <Link
            key={nextView}
            href={boardViewHref(boardId, nextView, selectedItemId, filterParams)}
            className={`px-3 py-1.5 text-xs ${
              view === nextView ? 'bg-signal text-signal-fg' : 'bg-bg text-fg-muted hover:text-fg'
            }`}
          >
            {nextView}
          </Link>
        ))}
      </nav>
    </div>
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

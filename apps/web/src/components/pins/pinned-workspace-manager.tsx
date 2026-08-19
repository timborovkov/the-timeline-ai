'use client';

import { ArrowDown, ArrowUp, ChevronsDown, ChevronsUp, GripVertical, Pin } from 'lucide-react';
import Link from 'next/link';
import { useReducer, useRef, useTransition } from 'react';

import type { PinPage, PinTargetKind, PinnedItem } from '@timeline/shared/pins';

import { CollectionToolbar } from '@/components/collections/collection-toolbar';
import { InfiniteScroll } from '@/components/collections/infinite-scroll';
import { VirtualList } from '@/components/collections/virtual-list';
import { EmptyState } from '@/components/empty-state';
import { PinnedItemRow } from '@/components/pins/pinned-item-row';
import { Button } from '@/components/ui/button';
import { notifyAction, notifyError } from '@/lib/notify';
import { readJson } from '@/lib/paginated-api';
import { cn } from '@/lib/utils';

const FILTERS: { label: string; kinds?: PinTargetKind[]; value: string }[] = [
  { label: 'All', value: 'all' },
  { label: 'Objects', value: 'objects', kinds: ['object'] },
  { label: 'Boards', value: 'boards', kinds: ['board'] },
  { label: 'Documents', value: 'documents', kinds: ['document'] },
  { label: 'Meetings', value: 'meetings', kinds: ['meeting', 'saved_meeting'] },
  { label: 'Calendar', value: 'calendar', kinds: ['calendar_event'] },
  { label: 'Timeline', value: 'timeline', kinds: ['timeline_moment'] },
];

async function movePin(input: {
  pinId: string;
  beforePinId?: string;
  afterPinId?: string;
  edge?: 'top' | 'bottom';
}) {
  const { movePinAction } = await import('@/app/actions/pins');
  return movePinAction(input);
}

function restorePinOrder(
  previous: PinnedItem[],
  pinId: string,
): { beforePinId?: string; afterPinId?: string; edge?: 'top' | 'bottom' } {
  const index = previous.findIndex((item) => item.pinId === pinId);
  if (index <= 0) return { edge: 'top' };
  const before = previous[index - 1];
  return before ? { afterPinId: before.pinId } : { edge: 'top' };
}

function reorder(items: PinnedItem[], from: number, to: number): PinnedItem[] {
  if (from === to) return items;
  const next = [...items];
  const [moved] = next.splice(from, 1);
  if (!moved) return items;
  next.splice(to, 0, moved);
  return next;
}

interface ManagerState {
  items: PinnedItem[];
  nextCursor: string | null;
  reorderMode: boolean;
  announcement: string;
  error: string | null;
}

type ManagerAction =
  | { type: 'toggle-reorder' }
  | { type: 'optimistic-move'; items: PinnedItem[] }
  | { type: 'move-failed'; items: PinnedItem[]; error: string }
  | { type: 'move-succeeded'; title: string }
  | { type: 'replace-page'; page: PinPage }
  | { type: 'append-page'; page: PinPage }
  | { type: 'remove'; pinId: string }
  | { type: 'error'; error: string };

function managerReducer(state: ManagerState, action: ManagerAction): ManagerState {
  switch (action.type) {
    case 'toggle-reorder':
      return { ...state, reorderMode: !state.reorderMode };
    case 'optimistic-move':
      return { ...state, items: action.items, error: null };
    case 'move-failed':
      return { ...state, items: action.items, error: action.error };
    case 'move-succeeded':
      return { ...state, announcement: `Moved ${action.title}`, error: null };
    case 'replace-page':
      return { ...state, items: action.page.items, nextCursor: action.page.nextCursor };
    case 'append-page':
      return {
        ...state,
        items: [...state.items, ...action.page.items],
        nextCursor: action.page.nextCursor,
      };
    case 'remove':
      return {
        ...state,
        items: state.items.filter((item) => item.pinId !== action.pinId),
      };
    case 'error':
      return { ...state, error: action.error };
  }
}

export function PinnedWorkspaceManager({
  initialPage,
  filter,
}: {
  initialPage: PinPage;
  filter: string;
}) {
  const [state, dispatch] = useReducer(
    managerReducer,
    initialPage,
    (page): ManagerState => ({
      items: page.items,
      nextCursor: page.nextCursor,
      reorderMode: false,
      announcement: '',
      error: null,
    }),
  );
  const draggedIdRef = useRef<string | null>(null);
  const [pending, startTransition] = useTransition();
  const canReorder = filter === 'all';
  const { items, nextCursor, reorderMode, announcement, error } = state;

  function loadMorePins(): void {
    if (!nextCursor || pending) return;
    startTransition(() => {
      const params = new URLSearchParams({ cursor: nextCursor });
      if (filter !== 'all') params.set('kind', filter);
      void fetch(`/api/pins?${params.toString()}`)
        .then((response) => readJson<PinPage>(response))
        .then((page) => {
          dispatch({ type: 'append-page', page });
        })
        .catch(() => {
          dispatch({ type: 'error', error: 'Could not load more pinned items.' });
          notifyError('pins:load', 'Couldn’t load more pinned items');
        });
    });
  }

  async function reloadFirstPage(): Promise<void> {
    try {
      const page = await readJson<PinPage>(await fetch('/api/pins?limit=50'));
      dispatch({ type: 'replace-page', page });
    } catch {
      // The persisted move already succeeded. Keep the optimistic order until
      // the next navigation if this non-critical refresh fails.
    }
  }

  function commitMove(
    item: PinnedItem,
    input: { beforePinId?: string; afterPinId?: string; edge?: 'top' | 'bottom' },
    nextItems: PinnedItem[],
  ): void {
    const previous = items;
    dispatch({ type: 'optimistic-move', items: nextItems });
    startTransition(async () => {
      const result = await notifyAction({
        id: `pin:${item.pinId}:move`,
        loading: 'Reordering pin…',
        success: 'Pin reordered',
        error: 'Couldn’t reorder pin',
        run: () => movePin({ pinId: item.pinId, ...input }),
        undo: {
          run: async () => {
            dispatch({ type: 'optimistic-move', items: previous });
            const undone = await movePin({
              pinId: item.pinId,
              ...restorePinOrder(previous, item.pinId),
            });
            if (undone.error) dispatch({ type: 'optimistic-move', items: nextItems });
            return undone;
          },
        },
      });
      if (result.error) {
        dispatch({ type: 'move-failed', items: previous, error: result.error });
        return;
      }
      dispatch({ type: 'move-succeeded', title: item.title });
      await reloadFirstPage();
    });
  }

  function moveBy(index: number, direction: 'up' | 'down' | 'top' | 'bottom'): void {
    const item = items[index];
    if (!item) return;
    if (direction === 'top') {
      commitMove(item, { edge: 'top' }, reorder(items, index, 0));
      return;
    }
    if (direction === 'bottom') {
      commitMove(item, { edge: 'bottom' }, reorder(items, index, items.length - 1));
      return;
    }
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    const target = items[targetIndex];
    if (!target) {
      if (direction !== 'down' || !nextCursor) return;
      const previous = items;
      startTransition(() => {
        const params = new URLSearchParams({ cursor: nextCursor, limit: '1' });
        void fetch(`/api/pins?${params.toString()}`)
          .then((response) => readJson<PinPage>(response))
          .then(async (page) => {
            const adjacent = page.items[0];
            if (!adjacent) return;
            const expanded = [...items, ...page.items];
            dispatch({
              type: 'replace-page',
              page: { items: reorder(expanded, index, index + 1), nextCursor: page.nextCursor },
            });
            const result = await notifyAction({
              id: `pin:${item.pinId}:move`,
              loading: 'Reordering pin…',
              success: 'Pin reordered',
              error: 'Couldn’t reorder pin',
              run: () => movePin({ pinId: item.pinId, afterPinId: adjacent.pinId }),
              undo: {
                run: async () => {
                  dispatch({ type: 'optimistic-move', items: previous });
                  const undone = await movePin({
                    pinId: item.pinId,
                    ...restorePinOrder(previous, item.pinId),
                  });
                  if (undone.error) {
                    dispatch({ type: 'optimistic-move', items: expanded });
                  }
                  return undone;
                },
              },
            });
            if (result.error) {
              dispatch({ type: 'move-failed', items: previous, error: result.error });
            } else {
              dispatch({ type: 'move-succeeded', title: item.title });
              await reloadFirstPage();
            }
          })
          .catch(() => {
            dispatch({ type: 'error', error: 'Could not load the next pinned item.' });
            notifyError('pins:load', 'Couldn’t load the next pinned item');
          });
      });
      return;
    }
    commitMove(
      item,
      direction === 'up' ? { beforePinId: target.pinId } : { afterPinId: target.pinId },
      reorder(items, index, targetIndex),
    );
  }

  return (
    <PinnedWorkspacePanel
      items={items}
      nextCursor={nextCursor}
      filter={filter}
      canReorder={canReorder}
      reorderMode={reorderMode}
      pending={pending}
      error={error}
      announcement={announcement}
      draggedIdRef={draggedIdRef}
      onToggleReorder={() => {
        dispatch({ type: 'toggle-reorder' });
      }}
      onLoadMore={loadMorePins}
      onRemoved={(pinId) => {
        dispatch({ type: 'remove', pinId });
      }}
      onCommitMove={commitMove}
      onMoveBy={moveBy}
    />
  );
}

function PinnedWorkspacePanel({
  items,
  nextCursor,
  filter,
  canReorder,
  reorderMode,
  pending,
  error,
  announcement,
  draggedIdRef,
  onToggleReorder,
  onLoadMore,
  onRemoved,
  onCommitMove,
  onMoveBy,
}: {
  items: PinnedItem[];
  nextCursor: string | null;
  filter: string;
  canReorder: boolean;
  reorderMode: boolean;
  pending: boolean;
  error: string | null;
  announcement: string;
  draggedIdRef: { current: string | null };
  onToggleReorder: () => void;
  onLoadMore: () => void;
  onRemoved: (pinId: string) => void;
  onCommitMove: (
    item: PinnedItem,
    placement: { beforePinId?: string; afterPinId?: string; edge?: 'top' | 'bottom' },
    nextItems: PinnedItem[],
  ) => void;
  onMoveBy: (index: number, direction: 'up' | 'down' | 'top' | 'bottom') => void;
}) {
  return (
    <section aria-labelledby="pinned-work-title">
      <h2 id="pinned-work-title" className="sr-only">
        Pinned work
      </h2>
      <CollectionToolbar>
        <CollectionToolbar.View>
          <nav aria-label="Pinned work filters" className="flex items-center gap-0.5">
            {FILTERS.map((entry) => (
              <Link
                key={entry.value}
                href={
                  entry.value === 'all'
                    ? '/app/work?view=pinned'
                    : `/app/work?view=pinned&kind=${entry.value}`
                }
                aria-current={filter === entry.value ? 'page' : undefined}
                className={cn(
                  'min-h-9 rounded-sm px-2.5 py-2 text-xs font-medium text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg',
                  filter === entry.value && 'bg-surface-2 text-fg',
                )}
              >
                {entry.label}
              </Link>
            ))}
          </nav>
        </CollectionToolbar.View>
        <CollectionToolbar.Actions>
          {canReorder && items.length > 1 ? (
            <Button variant="ghost" size="sm" onClick={onToggleReorder}>
              <GripVertical aria-hidden="true" />
              {reorderMode ? 'Done reordering' : 'Reorder'}
            </Button>
          ) : null}
        </CollectionToolbar.Actions>
      </CollectionToolbar>

      {items.length === 0 ? (
        <EmptyState
          icon={Pin}
          title="Nothing pinned yet"
          body="Pin an item from its detail page or overflow menu to keep it close on Home and Work."
        />
      ) : (
        <VirtualList
          items={items}
          getItemKey={(item) => item.pinId}
          estimateSize={52}
          renderItem={(item, index) => (
            <PinnedItemRow
              item={item}
              draggable={reorderMode}
              onDragStart={() => {
                draggedIdRef.current = item.pinId;
              }}
              onDragOver={(event) => {
                event.preventDefault();
              }}
              onDrop={() => {
                const from = items.findIndex(
                  (candidate) => candidate.pinId === draggedIdRef.current,
                );
                if (from < 0 || from === index) return;
                const moving = items[from];
                if (!moving) return;
                onCommitMove(
                  moving,
                  from < index ? { afterPinId: item.pinId } : { beforePinId: item.pinId },
                  reorder(items, from, index),
                );
                draggedIdRef.current = null;
              }}
              onRemoved={() => {
                onRemoved(item.pinId);
              }}
              actions={
                reorderMode ? (
                  <span className="flex items-center gap-0.5">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      disabled={pending || index === 0}
                      onClick={() => {
                        onMoveBy(index, 'up');
                      }}
                      aria-label={`Move ${item.title} up`}
                    >
                      <ArrowUp />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      disabled={pending || (index === items.length - 1 && !nextCursor)}
                      onClick={() => {
                        onMoveBy(index, 'down');
                      }}
                      aria-label={`Move ${item.title} down`}
                    >
                      <ArrowDown />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      disabled={pending || index === 0}
                      onClick={() => {
                        onMoveBy(index, 'top');
                      }}
                      aria-label={`Move ${item.title} to top`}
                    >
                      <ChevronsUp />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      disabled={pending || (index === items.length - 1 && !nextCursor)}
                      onClick={() => {
                        onMoveBy(index, 'bottom');
                      }}
                      aria-label={`Move ${item.title} to bottom`}
                    >
                      <ChevronsDown />
                    </Button>
                  </span>
                ) : null
              }
            />
          )}
        />
      )}

      <InfiniteScroll
        hasMore={Boolean(nextCursor)}
        loading={pending}
        error={error === 'Could not load more pinned items.' ? error : null}
        onLoadMore={onLoadMore}
        boundLabel="No more matching pins"
        hideBound={items.length === 0}
      />
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
      {error && error !== 'Could not load more pinned items.' ? (
        <p className="sr-only">{error}</p>
      ) : null}
    </section>
  );
}

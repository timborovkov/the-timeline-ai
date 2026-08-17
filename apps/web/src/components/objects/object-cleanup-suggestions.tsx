'use client';

import { Archive, GitMerge, RefreshCw, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useReducer } from 'react';

import type * as objects from '@timeline/shared/objects/types';

import { findObjectCleanupSuggestionsAction } from '@/app/actions/objects';
import { acceptSuggestionItemAction, rejectSuggestionItemAction } from '@/app/actions/suggestions';
import { InfiniteScroll } from '@/components/collections/infinite-scroll';
import { VirtualList } from '@/components/collections/virtual-list';
import { ObjectMergeForm } from '@/components/objects/object-merge-form';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { displayText } from '@/lib/display-dates';
import { isActionableSuggestionStatus } from '@/lib/suggestion-status';

interface SuggestionItem {
  id: string;
  status: string;
  operation: string;
  targetKind: string;
  targetId: string | null;
  title: string;
  description: string | null;
  proposedPayload: Record<string, unknown>;
}

interface SuggestionBundle {
  id: string;
  title: string;
  summary: string | null;
  confidence: string;
  items: SuggestionItem[];
}

interface Props {
  suggestions: SuggestionBundle[];
  mergePreviewsByItemId?: Record<string, objects.ObjectMergePreview>;
}

const EMPTY_MERGE_PREVIEWS: Record<string, objects.ObjectMergePreview> = {};

interface CleanupReviewState {
  message: string | null;
  resolvedItemIds: Set<string>;
  busyItemIds: Set<string>;
  findingSuggestions: boolean;
  reviewingItemId: string | null;
}

type CleanupReviewAction =
  | { type: 'message'; message: string | null }
  | { type: 'resolve_item'; itemId: string }
  | { type: 'restore_item'; itemId: string }
  | { type: 'start_item_action'; itemId: string }
  | { type: 'finish_item_action'; itemId: string }
  | { type: 'start_find' }
  | { type: 'finish_find' }
  | { type: 'review_item'; itemId: string | null };

function cleanupReviewReducer(
  state: CleanupReviewState,
  action: CleanupReviewAction,
): CleanupReviewState {
  switch (action.type) {
    case 'message':
      return { ...state, message: action.message };
    case 'resolve_item': {
      const resolvedItemIds = new Set(state.resolvedItemIds).add(action.itemId);
      return {
        ...state,
        resolvedItemIds,
        reviewingItemId: state.reviewingItemId === action.itemId ? null : state.reviewingItemId,
      };
    }
    case 'restore_item': {
      const resolvedItemIds = new Set(state.resolvedItemIds);
      resolvedItemIds.delete(action.itemId);
      return { ...state, resolvedItemIds };
    }
    case 'start_item_action':
      return { ...state, busyItemIds: new Set(state.busyItemIds).add(action.itemId) };
    case 'finish_item_action': {
      const busyItemIds = new Set(state.busyItemIds);
      busyItemIds.delete(action.itemId);
      return { ...state, busyItemIds };
    }
    case 'start_find':
      return { ...state, findingSuggestions: true };
    case 'finish_find':
      return { ...state, findingSuggestions: false };
    case 'review_item':
      return { ...state, message: null, reviewingItemId: action.itemId };
  }
}

function initialCleanupReviewState(): CleanupReviewState {
  return {
    message: null,
    resolvedItemIds: new Set(),
    busyItemIds: new Set(),
    findingSuggestions: false,
    reviewingItemId: null,
  };
}

function objectIdsForMerge(item: SuggestionItem): string[] {
  const objectIds = item.proposedPayload.objectIds;
  if (!Array.isArray(objectIds)) return [];
  const ids = objectIds.filter((value): value is string => typeof value === 'string');
  const survivorId =
    typeof item.proposedPayload.survivorId === 'string' ? item.proposedPayload.survivorId : null;
  if (!survivorId || !ids.includes(survivorId)) return ids;
  return [survivorId, ...ids.filter((id) => id !== survivorId)];
}

function objectMergeSuggestionHref(item: SuggestionItem, ids: string[]): string {
  const params = new URLSearchParams({ ids: ids.join(','), suggestionItemId: item.id });
  return `/app/objects/merge?${params.toString()}`;
}

export function ObjectCleanupSuggestions({
  suggestions,
  mergePreviewsByItemId = EMPTY_MERGE_PREVIEWS,
}: Props) {
  const router = useRouter();
  const [state, dispatch] = useReducer(cleanupReviewReducer, undefined, initialCleanupReviewState);
  const pendingItems = useMemo(() => {
    const items: { bundle: SuggestionBundle; item: SuggestionItem }[] = [];
    for (const bundle of suggestions) {
      for (const item of bundle.items) {
        if (isActionableSuggestionStatus(item.status) && !state.resolvedItemIds.has(item.id)) {
          items.push({ bundle, item });
        }
      }
    }
    return items;
  }, [state.resolvedItemIds, suggestions]);
  const reviewingEntry = state.reviewingItemId
    ? pendingItems.find(({ item }) => item.id === state.reviewingItemId)
    : undefined;
  const reviewingPreview = state.reviewingItemId
    ? mergePreviewsByItemId[state.reviewingItemId]
    : undefined;

  function resolveItem(itemId: string) {
    dispatch({ type: 'resolve_item', itemId });
  }

  function restoreItem(itemId: string) {
    dispatch({ type: 'restore_item', itemId });
  }

  function rejectItem(itemId: string) {
    void run(() => rejectSuggestionItemAction({ itemId }), itemId);
  }

  async function run(
    action: () => Promise<{ ok?: boolean; error?: string; message?: string }>,
    optimisticItemId?: string,
  ) {
    dispatch({ type: 'message', message: null });
    if (optimisticItemId && state.busyItemIds.has(optimisticItemId)) return;
    if (optimisticItemId) resolveItem(optimisticItemId);
    if (optimisticItemId) {
      dispatch({ type: 'start_item_action', itemId: optimisticItemId });
    } else {
      dispatch({ type: 'start_find' });
    }
    try {
      const result = await action();
      if (result.error && optimisticItemId) restoreItem(optimisticItemId);
      dispatch({ type: 'message', message: result.error ?? result.message ?? null });
      router.refresh();
    } catch (err) {
      if (optimisticItemId) restoreItem(optimisticItemId);
      dispatch({ type: 'message', message: err instanceof Error ? err.message : 'Action failed' });
    } finally {
      if (optimisticItemId) {
        dispatch({ type: 'finish_item_action', itemId: optimisticItemId });
      } else {
        dispatch({ type: 'finish_find' });
      }
    }
  }

  return (
    <section className="border-y border-border py-4">
      <details>
        <summary className="cursor-pointer list-none">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <h2 className="text-xs text-fg">Cleanup suggestions</h2>
              <p className="mt-1 text-sm text-fg-muted">
                {pendingItems.length > 0
                  ? `${pendingItems.length} pending cleanup ${pendingItems.length === 1 ? 'suggestion' : 'suggestions'}`
                  : 'No cleanup suggestions pending'}
              </p>
            </div>
            <span className="text-xs text-fg-dim">Open</span>
          </div>
        </summary>

        <div className="mt-4 flex justify-end">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={state.findingSuggestions}
            onClick={() => {
              void run(findObjectCleanupSuggestionsAction);
            }}
          >
            <RefreshCw className="size-4" />
            Find suggestions
          </Button>
        </div>

        {state.message ? <p className="mt-3 text-sm text-fg-muted">{state.message}</p> : null}

        {pendingItems.length > 0 ? (
          <VirtualList
            items={pendingItems}
            getItemKey={({ item }) => item.id}
            estimateSize={96}
            className="mt-4"
            renderItem={({ bundle, item }) => {
              const mergeIds = item.targetKind === 'object_merge' ? objectIdsForMerge(item) : [];
              const itemBusy = state.busyItemIds.has(item.id);
              return (
                <div className="grid gap-3 border border-border bg-bg p-3 md:grid-cols-[minmax(0,1fr)_auto]">
                  <div className="min-w-0">
                    <div className="text-xs text-fg-dim">
                      {item.targetKind === 'object_merge' ? 'merge' : 'archive'} ·{' '}
                      {bundle.confidence}
                    </div>
                    <div className="mt-1 font-medium text-fg">{displayText(item.title)}</div>
                    <p className="mt-1 truncate text-sm text-fg-muted">
                      {displayText(
                        item.description ?? bundle.summary ?? 'Review this cleanup suggestion.',
                      )}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-1.5">
                    {item.targetKind === 'object_merge' ? (
                      mergePreviewsByItemId[item.id] ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={itemBusy || mergeIds.length < 2}
                          onClick={() => {
                            dispatch({ type: 'review_item', itemId: item.id });
                          }}
                        >
                          <GitMerge className="size-4" />
                          Review
                        </Button>
                      ) : itemBusy || mergeIds.length < 2 ? (
                        <Button type="button" size="sm" variant="outline" disabled>
                          <GitMerge className="size-4" />
                          Review
                        </Button>
                      ) : (
                        <Button asChild size="sm" variant="outline">
                          <Link href={objectMergeSuggestionHref(item, mergeIds)}>
                            <GitMerge className="size-4" />
                            Review
                          </Link>
                        </Button>
                      )
                    ) : (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={itemBusy || !item.targetId}
                        onClick={() => {
                          if (!item.targetId) return;
                          void run(() => acceptSuggestionItemAction({ itemId: item.id }), item.id);
                        }}
                      >
                        <Archive className="size-4" />
                        Archive
                      </Button>
                    )}
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={itemBusy}
                      onClick={() => {
                        rejectItem(item.id);
                      }}
                    >
                      <X className="size-4" />
                      Dismiss
                    </Button>
                  </div>
                </div>
              );
            }}
          />
        ) : null}
        <InfiniteScroll
          hasMore={false}
          onLoadMore={() => undefined}
          boundLabel="No more matching suggestions"
          hideBound={pendingItems.length === 0}
        />
      </details>

      <Dialog
        open={Boolean(state.reviewingItemId)}
        onOpenChange={(open) => {
          if (!open) dispatch({ type: 'review_item', itemId: null });
        }}
      >
        <DialogContent className="max-h-[min(760px,calc(100vh-2rem))] overflow-y-auto border-border bg-bg sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>Review merge</DialogTitle>
            <DialogDescription>
              Choose the object to keep, then merge the duplicate into it.
            </DialogDescription>
          </DialogHeader>
          {reviewingEntry && reviewingPreview ? (
            <ObjectMergeForm
              objects={reviewingPreview.objects}
              initialSurvivorId={reviewingPreview.survivorId}
              countsBySurvivorId={reviewingPreview.countsBySurvivorId}
              factSamplesByObjectId={reviewingPreview.factSamplesByObjectId}
              suggestionItemId={reviewingEntry.item.id}
              onCancel={() => {
                dispatch({ type: 'review_item', itemId: null });
              }}
              onReject={() => {
                rejectItem(reviewingEntry.item.id);
              }}
              onMerged={() => {
                resolveItem(reviewingEntry.item.id);
                dispatch({ type: 'message', message: 'Objects merged.' });
                router.refresh();
              }}
            />
          ) : (
            <p className="text-sm text-fg-muted">
              This merge suggestion is no longer available. Close this dialog and refresh
              suggestions.
            </p>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}

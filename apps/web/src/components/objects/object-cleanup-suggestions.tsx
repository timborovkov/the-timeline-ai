'use client';

import { Archive, GitMerge, RefreshCw, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';

import type * as objects from '@timeline/shared/objects';

import { findObjectCleanupSuggestionsAction } from '@/app/actions/objects';
import { acceptSuggestionItemAction, rejectSuggestionItemAction } from '@/app/actions/suggestions';
import { ObjectMergeForm } from '@/components/objects/object-merge-form';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

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
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [resolvedItemIds, setResolvedItemIds] = useState<Set<string>>(() => new Set());
  const [reviewingItemId, setReviewingItemId] = useState<string | null>(null);
  const pendingItems = useMemo(() => {
    const items: { bundle: SuggestionBundle; item: SuggestionItem }[] = [];
    for (const bundle of suggestions) {
      for (const item of bundle.items) {
        if (
          (item.status === 'pending' || item.status === 'failed') &&
          !resolvedItemIds.has(item.id)
        ) {
          items.push({ bundle, item });
        }
      }
    }
    return items;
  }, [resolvedItemIds, suggestions]);
  const reviewingEntry = reviewingItemId
    ? pendingItems.find(({ item }) => item.id === reviewingItemId)
    : undefined;
  const reviewingPreview = reviewingItemId ? mergePreviewsByItemId[reviewingItemId] : undefined;

  function resolveItem(itemId: string) {
    setResolvedItemIds((current) => new Set(current).add(itemId));
    if (reviewingItemId === itemId) setReviewingItemId(null);
  }

  function restoreItem(itemId: string) {
    setResolvedItemIds((current) => {
      const next = new Set(current);
      next.delete(itemId);
      return next;
    });
  }

  function run(
    action: () => Promise<{ ok?: boolean; error?: string; message?: string }>,
    optimisticItemId?: string,
  ) {
    setMessage(null);
    if (optimisticItemId) resolveItem(optimisticItemId);
    startTransition(async () => {
      const result = await action();
      if (result.error && optimisticItemId) restoreItem(optimisticItemId);
      setMessage(result.error ?? result.message ?? null);
      router.refresh();
    });
  }

  return (
    <section className="border-y border-border py-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="font-mono text-[11px] uppercase tracking-[0.14em] text-fg">
            Cleanup suggestions
          </h2>
          <p className="mt-1 text-sm text-fg-muted">
            {pendingItems.length > 0
              ? `${pendingItems.length} pending cleanup ${pendingItems.length === 1 ? 'suggestion' : 'suggestions'}`
              : 'No cleanup suggestions pending'}
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => {
            run(findObjectCleanupSuggestionsAction);
          }}
        >
          <RefreshCw className="size-4" />
          Find suggestions
        </Button>
      </div>

      {message ? <p className="mt-3 text-sm text-fg-muted">{message}</p> : null}

      {pendingItems.length > 0 ? (
        <ul className="mt-4 divide-y divide-border border border-border">
          {pendingItems.slice(0, 5).map(({ bundle, item }) => {
            const mergeIds = item.targetKind === 'object_merge' ? objectIdsForMerge(item) : [];
            return (
              <li key={item.id} className="grid gap-3 bg-bg p-3 md:grid-cols-[1fr_auto]">
                <div className="min-w-0">
                  <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-dim">
                    {item.targetKind === 'object_merge' ? 'merge' : 'archive'} · {bundle.confidence}
                  </div>
                  <div className="mt-1 font-medium text-fg">{item.title}</div>
                  <p className="mt-1 text-sm text-fg-muted">
                    {item.description ?? bundle.summary ?? 'Review this cleanup suggestion.'}
                  </p>
                </div>
                <div className="flex flex-wrap items-start gap-2">
                  {item.targetKind === 'object_merge' ? (
                    mergePreviewsByItemId[item.id] ? (
                      <Button
                        type="button"
                        size="sm"
                        disabled={pending || mergeIds.length < 2}
                        onClick={() => {
                          setMessage(null);
                          setReviewingItemId(item.id);
                        }}
                      >
                        <GitMerge className="size-4" />
                        Review
                      </Button>
                    ) : pending || mergeIds.length < 2 ? (
                      <Button type="button" size="sm" disabled>
                        <GitMerge className="size-4" />
                        Review
                      </Button>
                    ) : (
                      <Button asChild size="sm">
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
                      disabled={pending || !item.targetId}
                      onClick={() => {
                        if (!item.targetId) return;
                        run(() => acceptSuggestionItemAction({ itemId: item.id }), item.id);
                      }}
                    >
                      <Archive className="size-4" />
                      Archive
                    </Button>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() => {
                      run(() => rejectSuggestionItemAction({ itemId: item.id }), item.id);
                    }}
                  >
                    <X className="size-4" />
                    Dismiss
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}

      <Dialog
        open={Boolean(reviewingItemId)}
        onOpenChange={(open) => {
          if (!open) setReviewingItemId(null);
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
              suggestionItemId={reviewingEntry.item.id}
              onCancel={() => {
                setReviewingItemId(null);
              }}
              onMerged={() => {
                resolveItem(reviewingEntry.item.id);
                setMessage('Objects merged.');
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

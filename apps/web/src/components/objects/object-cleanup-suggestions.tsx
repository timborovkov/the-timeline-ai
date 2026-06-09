'use client';

import { Archive, GitMerge, RefreshCw, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';

import { findObjectCleanupSuggestionsAction } from '@/app/actions/objects';
import { acceptSuggestionItemAction, rejectSuggestionItemAction } from '@/app/actions/suggestions';
import { Button } from '@/components/ui/button';

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

export function ObjectCleanupSuggestions({ suggestions }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const pendingItems = useMemo(() => {
    const items: { bundle: SuggestionBundle; item: SuggestionItem }[] = [];
    for (const bundle of suggestions) {
      for (const item of bundle.items) {
        if (item.status === 'pending' || item.status === 'failed') items.push({ bundle, item });
      }
    }
    return items;
  }, [suggestions]);

  function run(action: () => Promise<{ ok?: boolean; error?: string }>, success?: string) {
    setMessage(null);
    startTransition(async () => {
      const result = await action();
      setMessage(result.error ?? success ?? null);
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
            run(findObjectCleanupSuggestionsAction, 'Scan queued');
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
                    <Button asChild size="sm" disabled={pending || mergeIds.length < 2}>
                      <Link
                        href={`/app/objects/merge?ids=${mergeIds.join(',')}&suggestionItemId=${item.id}`}
                      >
                        <GitMerge className="size-4" />
                        Review
                      </Link>
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      disabled={pending || !item.targetId}
                      onClick={() => {
                        if (!item.targetId) return;
                        run(() => acceptSuggestionItemAction({ itemId: item.id }));
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
                      run(() => rejectSuggestionItemAction({ itemId: item.id }));
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
    </section>
  );
}

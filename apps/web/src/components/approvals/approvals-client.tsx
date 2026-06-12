'use client';

import { Check, CheckCheck, ExternalLink, GitMerge, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import {
  acceptAllSuggestionAction,
  acceptSuggestionItemAction,
  rejectSuggestionItemAction,
} from '@/app/actions/suggestions';
import { EmptyAction } from '@/components/empty-action';
import { Button } from '@/components/ui/button';
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
  failureReason: string | null;
  supersededByItemId?: string | null;
  supersededReason?: string | null;
}

interface SuggestionBundle {
  id: string;
  source: string;
  status: string;
  title: string;
  summary: string | null;
  reason: string | null;
  confidence: string;
  createdAt: string;
  items: SuggestionItem[];
  evidence: {
    rawEventId: string;
    quote: string | null;
    occurredAt: string | null;
    source: string | null;
  }[];
}

interface Props {
  suggestions: SuggestionBundle[];
  allowBulkAccept?: boolean;
}

function formatPayload(payload: Record<string, unknown>): string {
  return Object.entries(payload)
    .filter(
      ([key, value]) =>
        value !== null &&
        value !== undefined &&
        value !== '' &&
        key !== 'localRef' &&
        key !== 'fromRef' &&
        key !== 'toRef' &&
        !key.toLowerCase().endsWith('id') &&
        !key.toLowerCase().endsWith('ids'),
    )
    .slice(0, 6)
    .map(([key, value]) => `${key}: ${formatPayloadValue(value)}`)
    .join(' · ');
}

function itemActionLabel(item: SuggestionItem): string {
  const operation = item.operation.replace(/_/g, ' ');
  const kind = itemKindLabel(item.targetKind);
  return `${operation} ${kind}`;
}

function itemKindLabel(kind: string): string {
  if (kind === 'task') return 'task';
  if (kind === 'calendar_event') return 'calendar event';
  if (kind === 'object_merge') return 'duplicate records';
  if (kind === 'object_relationship') return 'relationship';
  if (kind === 'object') return 'workspace memory';
  if (kind === 'document') return 'document record';
  return kind.replace(/_/g, ' ');
}

function itemStatusLabel(status: string): string {
  if (status === 'failed') return 'needs retry';
  return status.replace(/_/g, ' ');
}

function evidenceHref(rawEventId: string): string {
  return `/app/timeline?event=${rawEventId}#ev-${rawEventId}`;
}

function formatPayloadValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString();
  return JSON.stringify(value);
}

function objectMergeHref(item: SuggestionItem): string {
  const objectIds = item.proposedPayload.objectIds;
  const ids = Array.isArray(objectIds)
    ? objectIds.filter((value): value is string => typeof value === 'string')
    : [];
  const survivorId =
    typeof item.proposedPayload.survivorId === 'string' ? item.proposedPayload.survivorId : null;
  const orderedIds =
    survivorId && ids.includes(survivorId)
      ? [survivorId, ...ids.filter((id) => id !== survivorId)]
      : ids;
  return `/app/objects/merge?ids=${orderedIds.join(',')}&suggestionItemId=${item.id}`;
}

function localRefLabel(bundle: SuggestionBundle, ref: string): string {
  const normalizedRef = ref.trim().toLowerCase();
  const item = bundle.items.find(
    (candidate) =>
      typeof candidate.proposedPayload.localRef === 'string' &&
      candidate.proposedPayload.localRef.trim().toLowerCase() === normalizedRef,
  );
  if (!item) return ref;
  return typeof item.proposedPayload.canonicalName === 'string'
    ? item.proposedPayload.canonicalName
    : item.title;
}

function relationshipPayloadSummary(item: SuggestionItem, bundle: SuggestionBundle): string | null {
  if (item.targetKind !== 'object_relationship') return null;
  const from =
    typeof item.proposedPayload.fromRef === 'string'
      ? localRefLabel(bundle, item.proposedPayload.fromRef)
      : 'existing object';
  const to =
    typeof item.proposedPayload.toRef === 'string'
      ? localRefLabel(bundle, item.proposedPayload.toRef)
      : 'existing object';
  const kind =
    typeof item.proposedPayload.kind === 'string' ? item.proposedPayload.kind : 'related';
  if (from === 'existing object' && to === 'existing object') {
    return `${item.title} · ${kind}`;
  }
  return `${from} ↔ ${to} · ${kind}`;
}

export function ApprovalsClient({ suggestions, allowBulkAccept = true }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(action: () => Promise<{ ok?: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (result.error) setError(result.error);
      router.refresh();
    });
  }

  if (suggestions.length === 0) {
    return (
      <EmptyAction
        title="No pending approvals"
        body="When the agent proposes tasks, objects, calendar items, or document changes, they will queue here before becoming canonical."
        href="/app"
        action="Back to home"
      />
    );
  }

  return (
    <div className="space-y-3">
      {error ? (
        <div className="border border-danger/40 px-3 py-2 font-mono text-xs uppercase tracking-[0.12em] text-danger">
          {error}
        </div>
      ) : null}

      {suggestions.map((bundle) => {
        const pendingItems = bundle.items.filter((item) =>
          isActionableSuggestionStatus(item.status),
        );
        const bulkAcceptItems = pendingItems.filter((item) => item.targetKind !== 'object_merge');
        return (
          <article key={bundle.id} className="border-y border-border py-4">
            <div className="flex flex-wrap items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-dim">
                  {bundle.source} · {bundle.confidence} ·{' '}
                  {new Date(bundle.createdAt).toLocaleString()}
                </div>
                <h2 className="mt-1 text-lg font-semibold tracking-tight text-fg">
                  {bundle.title}
                </h2>
                {bundle.summary ? (
                  <p className="mt-1 text-sm text-fg-muted">{bundle.summary}</p>
                ) : null}
                {bundle.reason ? (
                  <p className="mt-1 max-w-3xl text-xs leading-5 text-fg-dim">{bundle.reason}</p>
                ) : null}
              </div>
              {allowBulkAccept && bulkAcceptItems.length > 1 ? (
                <Button
                  type="button"
                  size="sm"
                  disabled={pending}
                  onClick={() => {
                    run(() => acceptAllSuggestionAction({ suggestionId: bundle.id }));
                  }}
                >
                  <CheckCheck className="size-4" />
                  Accept all
                </Button>
              ) : null}
            </div>

            <ul className="mt-4 divide-y divide-border border border-border bg-bg">
              {bundle.items.map((item) => (
                <li key={item.id} className="grid gap-3 p-3 md:grid-cols-[1fr_auto]">
                  <div className="min-w-0">
                    <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-dim">
                      Proposal · {itemStatusLabel(item.status)}
                    </div>
                    <div className="mt-1 font-medium text-fg">{item.title}</div>
                    <div className="mt-1 text-xs text-fg-muted">{itemActionLabel(item)}</div>
                    {item.description ? (
                      <p className="mt-1 text-sm text-fg-muted">{item.description}</p>
                    ) : null}
                    {(relationshipPayloadSummary(item, bundle) ??
                    formatPayload(item.proposedPayload)) ? (
                      <p className="mt-1 truncate font-mono text-[11px] text-fg-dim">
                        {relationshipPayloadSummary(item, bundle) ??
                          formatPayload(item.proposedPayload)}
                      </p>
                    ) : null}
                    {item.failureReason ? (
                      <p className="mt-1 text-xs text-danger">{item.failureReason}</p>
                    ) : null}
                  </div>
                  {isActionableSuggestionStatus(item.status) ? (
                    <div className="flex items-start gap-2">
                      {item.targetKind === 'object_merge' ? (
                        <Button asChild size="sm" disabled={pending}>
                          <Link href={objectMergeHref(item)}>
                            <GitMerge className="size-4" />
                            Review merge
                          </Link>
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          size="sm"
                          disabled={pending}
                          onClick={() => {
                            run(() => acceptSuggestionItemAction({ itemId: item.id }));
                          }}
                        >
                          <Check className="size-4" />
                          Accept
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
                        Reject
                      </Button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>

            {bundle.evidence.length > 0 ? (
              <div className="mt-3 border-l border-border pl-3">
                <div className="mb-1 font-mono text-[11px] uppercase tracking-[0.12em] text-fg-dim">
                  Evidence
                </div>
                {bundle.evidence.map((ev) => (
                  <Link
                    key={ev.rawEventId}
                    href={evidenceHref(ev.rawEventId)}
                    className="group grid gap-1 py-1 text-xs text-fg-dim transition-colors hover:text-fg"
                  >
                    <span className="inline-flex items-center gap-1.5 font-mono uppercase tracking-[0.1em]">
                      <ExternalLink className="size-3" />
                      Timeline evidence · {ev.source ?? 'source'} · {ev.rawEventId.slice(0, 8)}
                    </span>
                    <span className="line-clamp-2 text-fg-muted group-hover:text-fg">
                      {ev.quote ?? 'Open the source event on the timeline.'}
                    </span>
                  </Link>
                ))}
              </div>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}

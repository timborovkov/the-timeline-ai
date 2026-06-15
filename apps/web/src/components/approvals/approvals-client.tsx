'use client';

import { Check, CheckCheck, ExternalLink, GitMerge, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useRef, useState, useTransition } from 'react';

import {
  acceptAllSuggestionAction,
  acceptSuggestionItemAction,
  acceptVisibleSuggestionsAction,
  rejectSuggestionItemAction,
} from '@/app/actions/suggestions';
import { EmptyAction } from '@/components/empty-action';
import { EvidenceLink } from '@/components/evidence-link';
import { Button } from '@/components/ui/button';
import { displayText, formatDisplayDateTime } from '@/lib/display-dates';
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

type ApprovalAction = (
  action: () => Promise<{ ok?: boolean; error?: string }>,
  optimisticItemIds: string[],
) => void;

interface Props {
  suggestions: SuggestionBundle[];
  allowBulkAccept?: boolean;
  folded?: {
    title: string;
    summary: {
      singular: string;
      plural: string;
    };
    className: string;
    summaryClassName?: string;
    bodyClassName?: string;
    titleClassName?: string;
    countClassName?: string;
    openLabelClassName?: string;
  };
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function suggestionItemSignature(item: SuggestionItem): string {
  return stableJson({
    id: item.id,
    status: item.status,
    operation: item.operation,
    targetKind: item.targetKind,
    targetId: item.targetId,
    title: item.title,
    description: item.description,
    proposedPayload: item.proposedPayload,
    failureReason: item.failureReason,
    supersededByItemId: item.supersededByItemId ?? null,
    supersededReason: item.supersededReason ?? null,
  });
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

function formatPayloadValue(value: unknown): string {
  if (typeof value === 'string') return displayText(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString();
  return displayText(JSON.stringify(value));
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
  if (!item) return displayText(ref);
  return typeof item.proposedPayload.canonicalName === 'string'
    ? displayText(item.proposedPayload.canonicalName)
    : displayText(item.title);
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
    return displayText(`${item.title} · ${kind}`);
  }
  return displayText(`${from} ↔ ${to} · ${kind}`);
}

function foldedSummaryText(
  count: number,
  summary: NonNullable<Props['folded']>['summary'],
): string {
  return `${count} ${count === 1 ? summary.singular : summary.plural}`;
}

export function ApprovalsClient({ suggestions, allowBulkAccept = true, folded }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [resolvedItemSignatures, setResolvedItemSignatures] = useState<Map<string, string>>(
    () => new Map(),
  );
  const [busyItemIds, setBusyItemIds] = useState<Set<string>>(() => new Set());
  const inFlightItemIdsRef = useRef<Set<string> | null>(null);
  inFlightItemIdsRef.current ??= new Set();
  const serverItemSignatures = useMemo(
    () =>
      new Map(
        suggestions.flatMap((bundle) =>
          bundle.items.map((item) => [item.id, suggestionItemSignature(item)] as const),
        ),
      ),
    [suggestions],
  );
  const effectiveResolvedItemIds = useMemo(() => {
    const next = new Set<string>();
    for (const [id, signature] of resolvedItemSignatures) {
      if (serverItemSignatures.get(id) === signature) next.add(id);
    }
    return next;
  }, [resolvedItemSignatures, serverItemSignatures]);
  const visibleSuggestions = useMemo(
    () =>
      suggestions.flatMap((bundle) => {
        const items = bundle.items.filter((item) => !effectiveResolvedItemIds.has(item.id));
        return items.length > 0 ? [{ ...bundle, items }] : [];
      }),
    [effectiveResolvedItemIds, suggestions],
  );
  const bulkAcceptSuggestions = visibleSuggestions.flatMap((bundle) => {
    const itemIds = bundle.items.reduce<string[]>((ids, item) => {
      if (isActionableSuggestionStatus(item.status) && item.targetKind !== 'object_merge') {
        ids.push(item.id);
      }
      return ids;
    }, []);
    return itemIds.length > 0 ? [{ suggestionId: bundle.id, itemIds }] : [];
  });
  const bulkAcceptItemCount = bulkAcceptSuggestions.reduce(
    (sum, suggestion) => sum + suggestion.itemIds.length,
    0,
  );
  const visiblePendingItemCount = visibleSuggestions.reduce(
    (sum, bundle) =>
      sum +
      bundle.items.filter(
        (item) => isActionableSuggestionStatus(item.status) && item.targetKind !== 'object_merge',
      ).length,
    0,
  );

  function markBusy(itemIds: string[]) {
    if (itemIds.length === 0) return;
    setBusyItemIds((previous) => new Set([...previous, ...itemIds]));
  }

  function clearBusy(itemIds: string[]) {
    if (itemIds.length === 0) return;
    setBusyItemIds((previous) => {
      const next = new Set(previous);
      for (const id of itemIds) next.delete(id);
      return next;
    });
  }

  function resolveItems(itemIds: string[]) {
    if (itemIds.length === 0) return;
    setResolvedItemSignatures((previous) => {
      const next = new Map(previous);
      for (const id of itemIds) {
        const signature = serverItemSignatures.get(id);
        if (signature) next.set(id, signature);
      }
      return next;
    });
  }

  function restoreItems(itemIds: string[]) {
    if (itemIds.length === 0) return;
    setResolvedItemSignatures((previous) => {
      const next = new Map(previous);
      for (const id of itemIds) next.delete(id);
      return next;
    });
  }

  function run(
    action: () => Promise<{ ok?: boolean; error?: string }>,
    optimisticItemIds: string[],
  ) {
    const inFlightItemIds = inFlightItemIdsRef.current;
    if (!inFlightItemIds) return;
    if (optimisticItemIds.some((id) => inFlightItemIds.has(id))) return;
    for (const id of optimisticItemIds) inFlightItemIds.add(id);
    setError(null);
    resolveItems(optimisticItemIds);
    markBusy(optimisticItemIds);
    startTransition(async () => {
      try {
        const result = await action();
        if (result.error) {
          restoreItems(optimisticItemIds);
          setError(result.error);
        }
      } catch (err) {
        restoreItems(optimisticItemIds);
        setError(err instanceof Error ? err.message : 'Approval action failed');
      } finally {
        for (const id of optimisticItemIds) inFlightItemIdsRef.current?.delete(id);
        clearBusy(optimisticItemIds);
        router.refresh();
      }
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

  const body = (
    <ApprovalListBody
      allowBulkAccept={allowBulkAccept}
      bulkAcceptItemCount={bulkAcceptItemCount}
      bulkAcceptSuggestions={bulkAcceptSuggestions}
      busyItemIds={busyItemIds}
      error={error}
      pending={pending}
      run={run}
      visibleSuggestions={visibleSuggestions}
    />
  );

  if (!folded) return body;

  return (
    <details className={folded.className}>
      <summary className={folded.summaryClassName ?? 'cursor-pointer list-none'}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2
              className={
                folded.titleClassName ?? 'font-mono text-[11px] uppercase tracking-[0.14em] text-fg'
              }
            >
              {folded.title}
            </h2>
            <p className={folded.countClassName ?? 'mt-1 text-sm text-fg-muted'}>
              {foldedSummaryText(visiblePendingItemCount, folded.summary)}
            </p>
          </div>
          <span
            className={
              folded.openLabelClassName ??
              'font-mono text-[11px] uppercase tracking-[0.12em] text-fg-dim'
            }
          >
            Open
          </span>
        </div>
      </summary>
      <div className={folded.bodyClassName ?? 'mt-4'}>{body}</div>
    </details>
  );
}

function ApprovalListBody({
  allowBulkAccept,
  bulkAcceptItemCount,
  bulkAcceptSuggestions,
  busyItemIds,
  error,
  pending,
  run,
  visibleSuggestions,
}: {
  allowBulkAccept: boolean;
  bulkAcceptItemCount: number;
  bulkAcceptSuggestions: { suggestionId: string; itemIds: string[] }[];
  busyItemIds: Set<string>;
  error: string | null;
  pending: boolean;
  run: ApprovalAction;
  visibleSuggestions: SuggestionBundle[];
}) {
  return (
    <div className="space-y-3">
      {error ? <ApprovalError message={error} /> : null}
      {allowBulkAccept && bulkAcceptItemCount > 1 ? (
        <PageBulkAccept
          bulkAcceptSuggestions={bulkAcceptSuggestions}
          disabled={pending}
          run={run}
        />
      ) : null}
      {visibleSuggestions.map((bundle) => (
        <ApprovalBundleRow
          allowBulkAccept={allowBulkAccept}
          bundle={bundle}
          busyItemIds={busyItemIds}
          key={bundle.id}
          pending={pending}
          run={run}
        />
      ))}
    </div>
  );
}

function ApprovalError({ message }: { message: string }) {
  return (
    <div className="border border-danger/40 px-3 py-2 font-mono text-xs uppercase tracking-[0.12em] text-danger">
      {message}
    </div>
  );
}

function PageBulkAccept({
  bulkAcceptSuggestions,
  disabled,
  run,
}: {
  bulkAcceptSuggestions: { suggestionId: string; itemIds: string[] }[];
  disabled: boolean;
  run: ApprovalAction;
}) {
  return (
    <div className="flex justify-end">
      <Button
        type="button"
        size="sm"
        disabled={disabled}
        onClick={() => {
          run(
            () => acceptVisibleSuggestionsAction({ suggestions: bulkAcceptSuggestions }),
            bulkAcceptSuggestions.flatMap((suggestion) => suggestion.itemIds),
          );
        }}
      >
        <CheckCheck className="size-4" />
        Accept all visible
      </Button>
    </div>
  );
}

function ApprovalBundleRow({
  allowBulkAccept,
  bundle,
  busyItemIds,
  pending,
  run,
}: {
  allowBulkAccept: boolean;
  bundle: SuggestionBundle;
  busyItemIds: Set<string>;
  pending: boolean;
  run: ApprovalAction;
}) {
  const pendingItems = bundle.items.filter((item) => isActionableSuggestionStatus(item.status));
  const bulkAcceptItems = pendingItems.filter((item) => item.targetKind !== 'object_merge');
  return (
    <article className="border-t border-border py-3">
      <div className="flex flex-wrap items-center gap-3">
        <ApprovalBundleHeader bundle={bundle} />
        {allowBulkAccept && bulkAcceptItems.length > 1 ? (
          <Button
            type="button"
            size="sm"
            disabled={pending}
            onClick={() => {
              run(
                () => acceptAllSuggestionAction({ suggestionId: bundle.id }),
                bulkAcceptItems.map((item) => item.id),
              );
            }}
          >
            <CheckCheck className="size-4" />
            Accept all
          </Button>
        ) : null}
      </div>
      <ul className="mt-3 divide-y divide-border border border-border bg-bg">
        {bundle.items.map((item) => (
          <ApprovalItemRow
            bundle={bundle}
            busy={busyItemIds.has(item.id)}
            item={item}
            key={item.id}
            pending={pending}
            run={run}
          />
        ))}
      </ul>
      <ApprovalEvidence bundle={bundle} />
    </article>
  );
}

function ApprovalBundleHeader({ bundle }: { bundle: SuggestionBundle }) {
  return (
    <div className="min-w-0 flex-1">
      <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-dim">
        {bundle.source} · {bundle.confidence} · {formatDisplayDateTime(bundle.createdAt)}
      </div>
      <h2 className="mt-1 text-base font-semibold tracking-tight text-fg">
        {displayText(bundle.title)}
      </h2>
      {bundle.summary ? (
        <p className="mt-1 text-sm text-fg-muted">{displayText(bundle.summary)}</p>
      ) : null}
      {bundle.reason ? (
        <p className="mt-1 max-w-3xl text-xs leading-5 text-fg-dim">{displayText(bundle.reason)}</p>
      ) : null}
    </div>
  );
}

function ApprovalItemRow({
  bundle,
  busy,
  item,
  pending,
  run,
}: {
  bundle: SuggestionBundle;
  busy: boolean;
  item: SuggestionItem;
  pending: boolean;
  run: ApprovalAction;
}) {
  return (
    <li className="grid gap-3 p-3 md:grid-cols-[minmax(0,1.3fr)_minmax(10rem,0.8fr)_minmax(9rem,auto)]">
      <ApprovalItemMain item={item} />
      <ApprovalItemPayload bundle={bundle} item={item} />
      {isActionableSuggestionStatus(item.status) ? (
        <ApprovalItemActions busy={busy} item={item} pending={pending} run={run} />
      ) : null}
    </li>
  );
}

function ApprovalItemMain({ item }: { item: SuggestionItem }) {
  return (
    <div className="min-w-0 self-center">
      <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-dim">
        Proposal · {itemStatusLabel(item.status)}
      </div>
      <div className="mt-1 font-medium text-fg">{displayText(item.title)}</div>
      {item.description ? (
        <p className="mt-1 text-sm text-fg-muted">{displayText(item.description)}</p>
      ) : null}
    </div>
  );
}

function ApprovalItemPayload({ bundle, item }: { bundle: SuggestionBundle; item: SuggestionItem }) {
  const summary = relationshipPayloadSummary(item, bundle) ?? formatPayload(item.proposedPayload);
  return (
    <div className="min-w-0 self-center">
      <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-dim">
        {itemActionLabel(item)}
      </div>
      {summary ? (
        <p className="mt-1 truncate font-mono text-[11px] text-fg-dim">{summary}</p>
      ) : null}
      {item.failureReason ? (
        <p className="mt-1 text-xs text-danger">{displayText(item.failureReason)}</p>
      ) : null}
    </div>
  );
}

function ApprovalItemActions({
  busy,
  item,
  pending,
  run,
}: {
  busy: boolean;
  item: SuggestionItem;
  pending: boolean;
  run: ApprovalAction;
}) {
  return (
    <div className="flex items-center justify-end gap-1.5">
      {item.targetKind === 'object_merge' ? (
        <Button asChild size="sm" variant="outline" disabled={pending}>
          <Link href={objectMergeHref(item)}>
            <GitMerge className="size-4" />
            Review merge
          </Link>
        </Button>
      ) : (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => {
            run(() => acceptSuggestionItemAction({ itemId: item.id }), [item.id]);
          }}
        >
          <Check className="size-4" />
          Accept
        </Button>
      )}
      <Button
        type="button"
        size="sm"
        variant="ghost"
        disabled={busy}
        onClick={() => {
          run(() => rejectSuggestionItemAction({ itemId: item.id }), [item.id]);
        }}
      >
        <X className="size-4" />
        Reject
      </Button>
    </div>
  );
}

function ApprovalEvidence({ bundle }: { bundle: SuggestionBundle }) {
  if (bundle.evidence.length === 0) return null;
  return (
    <details className="mt-2 border-l border-border pl-3">
      <summary className="cursor-pointer font-mono text-[11px] uppercase tracking-[0.12em] text-fg-dim hover:text-fg">
        Evidence · {bundle.evidence.length}
      </summary>
      {bundle.evidence.map((ev) => (
        <EvidenceLink
          key={ev.rawEventId}
          eventId={ev.rawEventId}
          previewText={ev.quote}
          source={ev.source}
          occurredAt={ev.occurredAt}
          className="group grid gap-1 py-1 text-xs text-fg-dim transition-colors hover:text-fg"
        >
          <span className="inline-flex items-center gap-1.5 font-mono uppercase tracking-[0.1em]">
            <ExternalLink className="size-3" />
            Timeline evidence · {ev.source ?? 'source'} · {ev.rawEventId.slice(0, 8)}
          </span>
          <span className="line-clamp-2 text-fg-muted group-hover:text-fg">
            {ev.quote ? displayText(ev.quote) : 'Open the source event on the timeline.'}
          </span>
        </EvidenceLink>
      ))}
    </details>
  );
}

'use client';

import {
  TASK_CATEGORY_OPTIONS,
  taskCategoryLabel,
  type TaskCategory,
} from '@timeline/shared/task-categories/types';
import {
  AlertTriangle,
  CalendarClock,
  CalendarPlus,
  CalendarX,
  Check,
  CheckCheck,
  ExternalLink,
  GitMerge,
  MoveRight,
  Pencil,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useRef, useState, useTransition } from 'react';

import {
  acceptAllSuggestionAction,
  acceptSuggestionItemAction,
  acceptVisibleSuggestionsAction,
  rejectSuggestionItemAction,
  rejectVisibleSuggestionsAction,
  reviseTaskSuggestionItemAction,
} from '@/app/actions/suggestions';
import { EmptyAction } from '@/components/empty-action';
import { EvidenceLink } from '@/components/evidence-link';
import { Button } from '@/components/ui/button';
import { useProjectSearch } from '@/hooks/use-project-search';
import { displayText, formatDisplayDate, formatDisplayDateTime } from '@/lib/display-dates';
import { isActionableSuggestionStatus } from '@/lib/suggestion-status';

function stableJson(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;

  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(',')}}`;
}

interface SuggestionItem {
  id: string;
  status: string;
  operation: string;
  targetKind: string;
  targetId: string | null;
  title: string;
  description: string | null;
  proposedPayload: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  failureReason: string | null;
  supersededByItemId?: string | null;
  supersededReason?: string | null;
  calendarResolutionHint?: CalendarResolutionHint | null;
}

interface CalendarResolutionEvent {
  id: string;
  title: string;
  description: string | null;
  startAt: string;
  endAt: string;
  timezone: string;
  allDay: boolean;
  location: string | null;
  showAs: string;
  visibility: string;
  rrule: string | null;
}

type CalendarResolutionHint =
  | { kind: 'new_event' }
  | { kind: 'exact_duplicate_reuse'; event: CalendarResolutionEvent }
  | { kind: 'semantic_update_candidate'; event: CalendarResolutionEvent }
  | { kind: 'ambiguous_match'; events: CalendarResolutionEvent[] }
  | { kind: 'target_event'; event: CalendarResolutionEvent }
  | { kind: 'missing_target' };

interface SuggestionBundle {
  id: string;
  source: string;
  status: string;
  title: string;
  summary: string | null;
  reason: string | null;
  confidence: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  items: SuggestionItem[];
  evidence: {
    rawEventId: string;
    quote: string | null;
    occurredAt: string | null;
    source: string | null;
    metadata?: Record<string, unknown>;
  }[];
}

type ApprovalAction = (
  action: () => Promise<{ ok?: boolean; error?: string; failedItemIds?: string[] }>,
  optimisticItemIds: string[],
) => void;

interface Props {
  suggestions: SuggestionBundle[];
  allowBulkAccept?: boolean;
  allowBulkReject?: boolean;
  timezone?: string;
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
    calendarResolutionHint: item.calendarResolutionHint ?? null,
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
        key !== 'fromName' &&
        key !== 'toName' &&
        !key.startsWith('taskCategory') &&
        key !== 'projectName' &&
        key !== 'createProjectName' &&
        !key.toLowerCase().endsWith('id') &&
        !key.toLowerCase().endsWith('ids'),
    )
    .slice(0, 6)
    .map(([key, value]) => `${key}: ${formatPayloadValue(value)}`)
    .join(' · ');
}

function itemActionLabel(item: SuggestionItem): string {
  const operation = item.operation.replace(/_/g, ' ');
  if (item.targetKind === 'object') {
    const type = payloadString(item.proposedPayload, 'type');
    if (type === 'person') return `${operation} person`;
    if (type) return `${operation} ${type.replace(/_/g, ' ')}`;
  }
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

function payloadString(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === 'string' && value.trim() ? value : null;
}

function payloadBoolean(payload: Record<string, unknown>, key: string): boolean | null {
  const value = payload[key];
  return typeof value === 'boolean' ? value : null;
}

function localActionFailureReason(item: SuggestionItem): string | null {
  if (
    item.targetKind === 'calendar_event' &&
    item.operation === 'create' &&
    (!payloadString(item.proposedPayload, 'startAt') ||
      !payloadString(item.proposedPayload, 'endAt'))
  ) {
    return 'Calendar proposal is missing a start or end time. Reject it or revise the source details before accepting.';
  }
  return null;
}

function metadataString(metadata: Record<string, unknown>, key: string): string | null {
  const value = metadata[key];
  return typeof value === 'string' && value.trim() ? value : null;
}

function metadataStringArray(metadata: Record<string, unknown>, key: string): string[] {
  const value = metadata[key];
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '');
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

function itemReconciliationOutputId(item: SuggestionItem): string | null {
  return metadataString(item.metadata ?? {}, 'reconciliation_output_id');
}

function itemReconciliationClusterId(item: SuggestionItem): string | null {
  return metadataString(item.metadata ?? {}, 'reconciliation_cluster_id');
}

function bundleReconciliationOutputIds(bundle: SuggestionBundle): string[] {
  return uniqueStrings([
    ...metadataStringArray(bundle.metadata ?? {}, 'reconciliation_output_ids'),
    ...bundle.items.flatMap((item) => {
      const outputId = itemReconciliationOutputId(item);
      return outputId ? [outputId] : [];
    }),
  ]);
}

function bundleReconciliationClusterIds(bundle: SuggestionBundle): string[] {
  return uniqueStrings([
    ...metadataStringArray(bundle.metadata ?? {}, 'reconciliation_cluster_ids'),
    ...bundle.items.flatMap((item) => {
      const clusterId = itemReconciliationClusterId(item);
      return clusterId ? [clusterId] : [];
    }),
  ]);
}

function calendarRangeLabel(input: {
  startAt: string | null;
  endAt: string | null;
  allDay?: boolean | null;
  timezone?: string;
}): string | null {
  if (!input.startAt || !input.endAt) return null;
  if (input.allDay) {
    const end = new Date(input.endAt);
    const displayEnd = Number.isNaN(end.getTime()) ? input.endAt : new Date(end.getTime() - 1);
    const startLabel = formatDisplayDate(input.startAt, { timezone: input.timezone });
    const endLabel = formatDisplayDate(displayEnd, { timezone: input.timezone });
    return startLabel === endLabel ? startLabel : `${startLabel} - ${endLabel}`;
  }
  return `${formatDisplayDateTime(input.startAt, {
    timezone: input.timezone,
  })} -> ${formatDisplayDateTime(input.endAt, { timezone: input.timezone })}`;
}

function proposedCalendarRange(item: SuggestionItem, timezone?: string): string | null {
  const eventTimezone = payloadString(item.proposedPayload, 'timezone') ?? timezone;
  return calendarRangeLabel({
    startAt: payloadString(item.proposedPayload, 'startAt'),
    endAt: payloadString(item.proposedPayload, 'endAt'),
    allDay: payloadBoolean(item.proposedPayload, 'allDay'),
    timezone: eventTimezone,
  });
}

function calendarEventRange(event: CalendarResolutionEvent, timezone?: string): string {
  return (
    calendarRangeLabel({
      startAt: event.startAt,
      endAt: event.endAt,
      allDay: event.allDay,
      timezone: event.timezone || timezone,
    }) ?? event.startAt
  );
}

function calendarActionSummary(item: SuggestionItem): {
  label: string;
  icon: typeof CalendarClock;
  tone: 'default' | 'warning' | 'danger';
} {
  const role = payloadString(item.proposedPayload, 'proposalRole');
  if (item.operation === 'archive_or_cancel') {
    return { label: 'Cancel', icon: CalendarX, tone: 'danger' };
  }
  if (item.operation === 'update' && role === 'selected_slot') {
    return { label: 'Confirm slot', icon: CalendarClock, tone: 'default' };
  }
  if (item.operation === 'update') {
    const moves =
      payloadString(item.proposedPayload, 'startAt') ??
      payloadString(item.proposedPayload, 'endAt');
    return {
      label: moves ? 'Move' : 'Update',
      icon: moves ? MoveRight : CalendarClock,
      tone: 'default',
    };
  }
  if (item.calendarResolutionHint?.kind === 'exact_duplicate_reuse') {
    return { label: 'Reuse existing', icon: CalendarClock, tone: 'warning' };
  }
  if (item.calendarResolutionHint?.kind === 'semantic_update_candidate') {
    return { label: 'Possible match', icon: AlertTriangle, tone: 'warning' };
  }
  if (item.calendarResolutionHint?.kind === 'ambiguous_match') {
    return { label: 'Needs review', icon: AlertTriangle, tone: 'warning' };
  }
  return { label: 'Create', icon: CalendarPlus, tone: 'default' };
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
      : typeof item.proposedPayload.fromName === 'string'
        ? displayText(item.proposedPayload.fromName)
        : null;
  const to =
    typeof item.proposedPayload.toRef === 'string'
      ? localRefLabel(bundle, item.proposedPayload.toRef)
      : typeof item.proposedPayload.toName === 'string'
        ? displayText(item.proposedPayload.toName)
        : null;
  const kind =
    typeof item.proposedPayload.kind === 'string' ? item.proposedPayload.kind : 'related';
  if (!from || !to) return displayText(`${item.title} · ${kind}`);
  return displayText(`${from} ↔ ${to} · ${kind}`);
}

function approvalEffectText(item: SuggestionItem): string {
  const action = item.operation.replace(/_/g, ' ');
  const kind = itemKindLabel(item.targetKind);
  if (item.operation === 'create') return `Accept will create ${articleFor(kind)} ${kind}.`;
  if (item.operation === 'update') {
    return item.targetId ? `Accept will update this ${kind}.` : `Accept will update ${kind}.`;
  }
  if (item.operation === 'archive_or_cancel') {
    return `Accept will archive or cancel this ${kind}.`;
  }
  if (item.operation === 'merge') return `Accept will merge these ${kind}.`;
  if (item.operation === 'link') return `Accept will link this ${kind}.`;
  if (item.operation === 'unlink') return `Accept will unlink this ${kind}.`;
  return `Accept will ${action} ${kind}.`;
}

function approvalAuthorityText(item: SuggestionItem): string {
  const source = metadataString(item.metadata ?? {}, 'reconciliation_authority_reason');
  if (source) return displayText(source);
  if (item.targetKind === 'calendar_event') {
    return 'Review required before Timeline changes calendar state from captured evidence.';
  }
  if (item.targetKind === 'board_membership' || item.targetKind === 'board_item_update') {
    return 'Review required before Timeline changes board state from captured evidence.';
  }
  return 'Review required before Timeline writes workspace memory from captured evidence.';
}

function approvalDependencyText(item: SuggestionItem, bundle: SuggestionBundle): string | null {
  const refs = [
    typeof item.proposedPayload.fromRef === 'string' ? item.proposedPayload.fromRef : null,
    typeof item.proposedPayload.toRef === 'string' ? item.proposedPayload.toRef : null,
    typeof item.proposedPayload.localRef === 'string' ? item.proposedPayload.localRef : null,
  ].filter((ref): ref is string => !!ref && ref.trim().length > 0);
  const dependencyLabels: string[] = [];
  for (const ref of refs) {
    if (ref !== item.proposedPayload.localRef) dependencyLabels.push(localRefLabel(bundle, ref));
  }
  const uniqueDependencyLabels = uniqueStrings(dependencyLabels);
  if (uniqueDependencyLabels.length === 0) return null;
  return `Depends on ${uniqueDependencyLabels.join(' and ')} in this bundle.`;
}

function articleFor(value: string): string {
  return /^[aeiou]/i.test(value) ? 'an' : 'a';
}

function foldedSummaryText(
  count: number,
  summary: NonNullable<Props['folded']>['summary'],
): string {
  return `${count} ${count === 1 ? summary.singular : summary.plural}`;
}

export function ApprovalsClient({
  suggestions,
  allowBulkAccept = true,
  allowBulkReject = true,
  timezone,
  folded,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [resolvedItemSignatures, setResolvedItemSignatures] = useState<Map<string, string>>(
    () => new Map(),
  );
  const [busyItemIds, setBusyItemIds] = useState<Set<string>>(() => new Set());
  const [actionFailedItemIds, setActionFailedItemIds] = useState<Set<string>>(() => new Set());
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
  const mergeReviewItemCount = visibleSuggestions.reduce(
    (sum, bundle) =>
      sum +
      bundle.items.filter(
        (item) => isActionableSuggestionStatus(item.status) && item.targetKind === 'object_merge',
      ).length,
    0,
  );
  const bulkRejectSuggestions = visibleSuggestions.flatMap((bundle) => {
    const itemIds = bundle.items.reduce<string[]>((ids, item) => {
      if (isActionableSuggestionStatus(item.status)) ids.push(item.id);
      return ids;
    }, []);
    return itemIds.length > 0 ? [{ suggestionId: bundle.id, itemIds }] : [];
  });
  const bulkRejectItemCount = bulkRejectSuggestions.reduce(
    (sum, suggestion) => sum + suggestion.itemIds.length,
    0,
  );
  const visiblePendingItemCount = visibleSuggestions.reduce(
    (sum, bundle) =>
      sum + bundle.items.filter((item) => isActionableSuggestionStatus(item.status)).length,
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

  function clearActionFailures(itemIds: string[]) {
    if (itemIds.length === 0) return;
    setActionFailedItemIds((previous) => {
      const next = new Set(previous);
      for (const id of itemIds) next.delete(id);
      return next;
    });
  }

  function markActionFailures(itemIds: string[]) {
    if (itemIds.length === 0) return;
    setActionFailedItemIds((previous) => new Set([...previous, ...itemIds]));
  }

  function run(
    action: () => Promise<{ ok?: boolean; error?: string; failedItemIds?: string[] }>,
    optimisticItemIds: string[],
  ) {
    const inFlightItemIds = inFlightItemIdsRef.current;
    if (!inFlightItemIds) return;
    if (optimisticItemIds.some((id) => inFlightItemIds.has(id))) return;
    for (const id of optimisticItemIds) inFlightItemIds.add(id);
    setError(null);
    clearActionFailures(optimisticItemIds);
    resolveItems(optimisticItemIds);
    markBusy(optimisticItemIds);
    startTransition(async () => {
      let shouldRefresh = true;
      try {
        const result = await action();
        if (result.error) {
          shouldRefresh = false;
          const failedItemIds =
            result.failedItemIds?.filter((id) => optimisticItemIds.includes(id)) ?? [];
          const restoreItemIds = failedItemIds.length > 0 ? failedItemIds : optimisticItemIds;
          restoreItems(restoreItemIds);
          markActionFailures(restoreItemIds);
          setError(result.error);
        }
      } catch (err) {
        shouldRefresh = false;
        restoreItems(optimisticItemIds);
        markActionFailures(optimisticItemIds);
        setError(err instanceof Error ? err.message : 'Approval action failed');
      } finally {
        for (const id of optimisticItemIds) inFlightItemIdsRef.current?.delete(id);
        clearBusy(optimisticItemIds);
        if (shouldRefresh) router.refresh();
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
      allowBulkReject={allowBulkReject}
      bulkAcceptItemCount={bulkAcceptItemCount}
      bulkAcceptSuggestions={bulkAcceptSuggestions}
      mergeReviewItemCount={mergeReviewItemCount}
      bulkRejectItemCount={bulkRejectItemCount}
      bulkRejectSuggestions={bulkRejectSuggestions}
      actionFailedItemIds={actionFailedItemIds}
      busyItemIds={busyItemIds}
      error={error}
      pending={pending}
      run={run}
      timezone={timezone}
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
  allowBulkReject,
  bulkAcceptItemCount,
  bulkAcceptSuggestions,
  mergeReviewItemCount,
  bulkRejectItemCount,
  bulkRejectSuggestions,
  actionFailedItemIds,
  busyItemIds,
  error,
  pending,
  run,
  timezone,
  visibleSuggestions,
}: {
  allowBulkAccept: boolean;
  allowBulkReject: boolean;
  bulkAcceptItemCount: number;
  bulkAcceptSuggestions: { suggestionId: string; itemIds: string[] }[];
  mergeReviewItemCount: number;
  bulkRejectItemCount: number;
  bulkRejectSuggestions: { suggestionId: string; itemIds: string[] }[];
  actionFailedItemIds: Set<string>;
  busyItemIds: Set<string>;
  error: string | null;
  pending: boolean;
  run: ApprovalAction;
  timezone?: string;
  visibleSuggestions: SuggestionBundle[];
}) {
  return (
    <div className="space-y-3">
      {error ? <ApprovalError message={error} /> : null}
      {(allowBulkAccept && bulkAcceptItemCount > 1) ||
      (allowBulkReject && bulkRejectItemCount > 1) ? (
        <PageBulkActions
          bulkAcceptSuggestions={bulkAcceptSuggestions}
          bulkRejectSuggestions={bulkRejectSuggestions}
          canAccept={allowBulkAccept && bulkAcceptItemCount > 1}
          canReject={allowBulkReject && bulkRejectItemCount > 1}
          disabled={pending}
          mergeReviewItemCount={mergeReviewItemCount}
          run={run}
        />
      ) : null}
      {pending && visibleSuggestions.length === 0 ? <ApprovalUpdatingState /> : null}
      {visibleSuggestions.map((bundle) => (
        <ApprovalBundleRow
          allowBulkAccept={allowBulkAccept}
          actionFailedItemIds={actionFailedItemIds}
          bundle={bundle}
          busyItemIds={busyItemIds}
          key={bundle.id}
          pending={pending}
          run={run}
          timezone={timezone}
        />
      ))}
    </div>
  );
}

function ApprovalUpdatingState() {
  return (
    <output className="border border-border bg-muted/30 px-3 py-2 font-mono text-xs uppercase tracking-[0.12em] text-fg-dim">
      Updating approvals...
    </output>
  );
}

function ApprovalError({ message }: { message: string }) {
  return (
    <div className="border border-danger/40 px-3 py-2 font-mono text-xs uppercase tracking-[0.12em] text-danger">
      {message}
    </div>
  );
}

function PageBulkActions({
  bulkAcceptSuggestions,
  bulkRejectSuggestions,
  canAccept,
  canReject,
  disabled,
  mergeReviewItemCount,
  run,
}: {
  bulkAcceptSuggestions: { suggestionId: string; itemIds: string[] }[];
  bulkRejectSuggestions: { suggestionId: string; itemIds: string[] }[];
  canAccept: boolean;
  canReject: boolean;
  disabled: boolean;
  mergeReviewItemCount: number;
  run: ApprovalAction;
}) {
  const bulkAcceptItemCount = bulkAcceptSuggestions.reduce(
    (sum, suggestion) => sum + suggestion.itemIds.length,
    0,
  );
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {canAccept && mergeReviewItemCount > 0 ? (
        <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-dim">
          {mergeReviewItemCount} merge{' '}
          {mergeReviewItemCount === 1 ? 'proposal needs' : 'proposals need'} review
        </span>
      ) : null}
      {canReject ? (
        <Button
          type="button"
          size="sm"
          variant="destructive"
          disabled={disabled}
          onClick={() => {
            run(
              () => rejectVisibleSuggestionsAction({ suggestions: bulkRejectSuggestions }),
              bulkRejectSuggestions.flatMap((suggestion) => suggestion.itemIds),
            );
          }}
        >
          <X className="size-4" />
          Reject all visible
        </Button>
      ) : null}
      {canAccept ? (
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
          {mergeReviewItemCount > 0
            ? `Accept ${bulkAcceptItemCount} visible`
            : 'Accept all visible'}
        </Button>
      ) : null}
    </div>
  );
}

function ApprovalBundleRow({
  allowBulkAccept,
  actionFailedItemIds,
  bundle,
  busyItemIds,
  pending,
  run,
  timezone,
}: {
  allowBulkAccept: boolean;
  actionFailedItemIds: Set<string>;
  bundle: SuggestionBundle;
  busyItemIds: Set<string>;
  pending: boolean;
  run: ApprovalAction;
  timezone?: string;
}) {
  const pendingItems = bundle.items.filter((item) => isActionableSuggestionStatus(item.status));
  const bulkAcceptItems = pendingItems.filter((item) => item.targetKind !== 'object_merge');
  const mergeReviewCount = pendingItems.length - bulkAcceptItems.length;
  return (
    <article className="border-t border-border py-3">
      <div className="flex flex-wrap items-center gap-3">
        <ApprovalBundleHeader bundle={bundle} timezone={timezone} />
        {allowBulkAccept && bulkAcceptItems.length > 1 ? (
          <Button
            type="button"
            size="sm"
            disabled={pending}
            onClick={() => {
              run(
                () =>
                  acceptAllSuggestionAction({
                    suggestionId: bundle.id,
                    itemIds: bulkAcceptItems.map((item) => item.id),
                  }),
                bulkAcceptItems.map((item) => item.id),
              );
            }}
          >
            <CheckCheck className="size-4" />
            {mergeReviewCount > 0 ? `Accept ${bulkAcceptItems.length}` : 'Accept all'}
          </Button>
        ) : null}
      </div>
      <ul className="mt-3 divide-y divide-border border border-border bg-bg">
        {bundle.items.map((item) => (
          <ApprovalItemRow
            bundle={bundle}
            actionFailed={actionFailedItemIds.has(item.id)}
            busy={busyItemIds.has(item.id)}
            item={item}
            key={item.id}
            pending={pending}
            run={run}
            timezone={timezone}
          />
        ))}
      </ul>
      <ApprovalReconciliationContext bundle={bundle} />
      <ApprovalEvidence bundle={bundle} />
    </article>
  );
}

function ApprovalBundleHeader({
  bundle,
  timezone,
}: {
  bundle: SuggestionBundle;
  timezone?: string;
}) {
  return (
    <div className="min-w-0 flex-1">
      <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-dim">
        {bundle.source} · {bundle.confidence} ·{' '}
        {formatDisplayDateTime(bundle.createdAt, { timezone })}
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
  actionFailed,
  bundle,
  busy,
  item,
  pending,
  run,
  timezone,
}: {
  actionFailed: boolean;
  bundle: SuggestionBundle;
  busy: boolean;
  item: SuggestionItem;
  pending: boolean;
  run: ApprovalAction;
  timezone?: string;
}) {
  return (
    <li className="grid gap-3 p-3 md:grid-cols-[minmax(0,1.3fr)_minmax(10rem,0.8fr)_minmax(9rem,auto)]">
      <ApprovalItemMain actionFailed={actionFailed} item={item} />
      <ApprovalItemPayload bundle={bundle} item={item} timezone={timezone} />
      {isActionableSuggestionStatus(item.status) ? (
        <ApprovalItemActions busy={busy} item={item} pending={pending} run={run} />
      ) : null}
    </li>
  );
}

function ApprovalItemMain({ actionFailed, item }: { actionFailed: boolean; item: SuggestionItem }) {
  const actionFailureReason = actionFailed ? localActionFailureReason(item) : null;
  return (
    <div className="min-w-0 self-center">
      <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-dim">
        Proposal · {itemStatusLabel(item.status)}
      </div>
      <div className="mt-1 font-medium text-fg">{displayText(item.title)}</div>
      {item.description ? (
        <p className="mt-1 text-sm text-fg-muted">{displayText(item.description)}</p>
      ) : null}
      {actionFailed ? (
        <p className="mt-1 text-xs text-danger">Action failed. Review and try again.</p>
      ) : null}
      {actionFailureReason ? (
        <p className="mt-1 text-xs text-danger">{actionFailureReason}</p>
      ) : null}
      <ApprovalItemReconciliationLink item={item} />
    </div>
  );
}

function ApprovalItemReconciliationLink({ item }: { item: SuggestionItem }) {
  const outputId = itemReconciliationOutputId(item);
  if (!outputId) return null;
  const clusterId = itemReconciliationClusterId(item);
  const href = clusterId
    ? `/app/team/reconciliation/clusters/${clusterId}`
    : '/app/team/reconciliation';
  return (
    <Link
      href={href}
      className="mt-1 inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-[0.1em] text-fg-dim hover:text-signal"
    >
      <ExternalLink className="size-3" />
      Reconciliation output {shortId(outputId)}
    </Link>
  );
}

function ApprovalItemPayload({
  bundle,
  item,
  timezone,
}: {
  bundle: SuggestionBundle;
  item: SuggestionItem;
  timezone?: string;
}) {
  if (item.targetKind === 'calendar_event') {
    return <CalendarApprovalPayload item={item} timezone={timezone} />;
  }
  if (item.targetKind === 'task' && item.operation === 'create') {
    return <TaskApprovalPayload bundle={bundle} item={item} />;
  }
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
      <ApprovalItemEffect item={item} bundle={bundle} />
    </div>
  );
}

function TaskApprovalPayload({ bundle, item }: { bundle: SuggestionBundle; item: SuggestionItem }) {
  const router = useRouter();
  const [saving, startSaving] = useTransition();
  const { query, setQuery, projects } = useProjectSearch();
  const [error, setError] = useState<string | null>(null);
  const category = payloadString(item.proposedPayload, 'taskCategory') as TaskCategory | null;
  const categoryMode = payloadString(item.proposedPayload, 'taskCategoryMode');
  const projectName =
    payloadString(item.proposedPayload, 'projectName') ??
    payloadString(item.proposedPayload, 'createProjectName');
  const createsProject = Boolean(payloadString(item.proposedPayload, 'createProjectName'));

  function revise(input: {
    category?: TaskCategory | 'automatic';
    project?:
      | { kind: 'none' }
      | { kind: 'existing'; projectId: string }
      | { kind: 'create'; projectName: string };
  }): void {
    setError(null);
    startSaving(async () => {
      const result = await reviseTaskSuggestionItemAction({ itemId: item.id, ...input });
      if (result.error) setError(result.error);
      else router.refresh();
    });
  }

  return (
    <div className="min-w-0 self-center space-y-2">
      <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-dim">
        {itemActionLabel(item)}
      </div>
      <div className="flex flex-wrap gap-1.5">
        <span className="rounded-sm border border-border bg-muted/30 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.1em] text-fg">
          Category · {category ? taskCategoryLabel(category) : 'Automatic after accept'}
        </span>
        <span className="rounded-sm border border-border bg-muted/30 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.1em] text-fg">
          Project · {projectName ? `${createsProject ? 'Create ' : ''}${projectName}` : 'None'}
        </span>
      </div>
      {category && categoryMode !== 'manual' ? (
        <p className="text-xs text-fg-dim">
          AI-proposed category; accepting applies it only if context still matches.
        </p>
      ) : null}
      <details className="group border-l border-border pl-2">
        <summary className="inline-flex cursor-pointer items-center gap-1 font-mono text-[10px] uppercase tracking-[0.1em] text-fg-dim hover:text-fg">
          <Pencil className="size-3" /> Edit category or project
        </summary>
        <div className="mt-2 grid gap-2">
          <label className="grid gap-1 text-xs text-fg-muted">
            Category
            <select
              aria-label={`Category for ${item.title}`}
              value={
                categoryMode === 'manual' && category
                  ? category
                  : category
                    ? 'suggested'
                    : 'automatic'
              }
              disabled={saving}
              onChange={(event) => {
                revise({ category: event.currentTarget.value as TaskCategory | 'automatic' });
              }}
              className="h-8 rounded-sm border border-border bg-bg px-2 text-xs text-fg"
            >
              {category && categoryMode !== 'manual' ? (
                <option value="suggested" disabled>
                  AI suggestion — {taskCategoryLabel(category)}
                </option>
              ) : null}
              <option value="automatic">Automatic after accept</option>
              {TASK_CATEGORY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-xs text-fg-muted">
            Find or name a project
            <input
              type="search"
              value={query}
              disabled={saving}
              onChange={(event) => {
                setQuery(event.currentTarget.value);
              }}
              placeholder="Search projects or type a new name"
              className="h-8 rounded-sm border border-border bg-bg px-2 text-xs text-fg"
            />
          </label>
          {query.trim() ? (
            <div className="flex flex-wrap gap-1">
              {projects.map((project) => (
                <button
                  key={project.id}
                  type="button"
                  disabled={saving}
                  onClick={() => {
                    revise({ project: { kind: 'existing', projectId: project.id } });
                  }}
                  className="rounded-sm border border-border px-2 py-1 text-xs text-fg hover:border-signal"
                >
                  Use {displayText(project.label)}
                </button>
              ))}
              <button
                type="button"
                disabled={saving}
                onClick={() => {
                  revise({ project: { kind: 'create', projectName: query.trim() } });
                }}
                className="rounded-sm border border-border px-2 py-1 text-xs text-fg hover:border-signal"
              >
                Create “{displayText(query.trim())}”
              </button>
            </div>
          ) : null}
          <button
            type="button"
            disabled={saving}
            onClick={() => {
              revise({ project: { kind: 'none' } });
            }}
            className="w-fit font-mono text-[10px] uppercase tracking-[0.1em] text-fg-dim hover:text-danger"
          >
            No project
          </button>
        </div>
      </details>
      {error ? <p className="text-xs text-danger">{error}</p> : null}
      {item.failureReason ? (
        <p className="text-xs text-danger">{displayText(item.failureReason)}</p>
      ) : null}
      <ApprovalItemEffect item={item} bundle={bundle} />
    </div>
  );
}

function ApprovalItemEffect({ item, bundle }: { item: SuggestionItem; bundle: SuggestionBundle }) {
  const dependency = approvalDependencyText(item, bundle);
  return (
    <div className="mt-2 space-y-1 border-l border-border pl-2 text-xs text-fg-dim">
      <p>{approvalEffectText(item)}</p>
      <p>{approvalAuthorityText(item)}</p>
      {dependency ? <p>{dependency}</p> : null}
    </div>
  );
}

function CalendarApprovalPayload({ item, timezone }: { item: SuggestionItem; timezone?: string }) {
  const action = calendarActionSummary(item);
  const Icon = action.icon;
  const proposedRange = proposedCalendarRange(item, timezone);
  const showAs = payloadString(item.proposedPayload, 'showAs');
  const recurrenceEditMode = payloadString(item.proposedPayload, 'recurrenceEditMode');
  const proposalGroupId = payloadString(item.proposedPayload, 'proposalGroupId');
  const proposalStatus = payloadString(item.proposedPayload, 'proposalStatus');
  const proposalRole = payloadString(item.proposedPayload, 'proposalRole');
  const cancelsSiblingSlots =
    item.operation === 'update' &&
    proposalGroupId !== null &&
    (proposalStatus === 'confirmed' || proposalRole === 'selected_slot');
  const toneClass =
    action.tone === 'danger'
      ? 'border-danger/40 bg-danger/5 text-danger'
      : action.tone === 'warning'
        ? 'border-warning/50 bg-warning/10 text-fg'
        : 'border-border bg-muted/30 text-fg';

  return (
    <div className="min-w-0 self-center space-y-2">
      <div
        className={`inline-flex items-center gap-1.5 rounded-sm border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] ${toneClass}`}
      >
        <Icon className="size-3" />
        {action.label}
      </div>
      <div className="space-y-1 text-xs text-fg-muted">
        <CalendarResolutionLine item={item} proposedRange={proposedRange} timezone={timezone} />
        {showAs ? <p>Availability: {displayText(showAs)}</p> : null}
        {recurrenceEditMode ? <p>Recurrence: {displayText(recurrenceEditMode)}</p> : null}
        {cancelsSiblingSlots ? (
          <p>Accepting one slot can cancel sibling tentative slots in this group.</p>
        ) : null}
      </div>
      {item.failureReason ? (
        <p className="mt-1 text-xs text-danger">{displayText(item.failureReason)}</p>
      ) : null}
    </div>
  );
}

function CalendarResolutionLine({
  item,
  proposedRange,
  timezone,
}: {
  item: SuggestionItem;
  proposedRange: string | null;
  timezone?: string;
}) {
  const hint = item.calendarResolutionHint;
  if (hint?.kind === 'exact_duplicate_reuse') {
    return (
      <p>
        Matches existing event "{displayText(hint.event.title)}" at{' '}
        {calendarEventRange(hint.event, timezone)}. Accept will reuse it instead of creating a
        duplicate.
      </p>
    );
  }
  if (hint?.kind === 'semantic_update_candidate') {
    return (
      <p>
        Looks related to "{displayText(hint.event.title)}" at{' '}
        {calendarEventRange(hint.event, timezone)}. Accept will create a new event unless this
        proposal is revised to target that event.
      </p>
    );
  }
  if (hint?.kind === 'ambiguous_match') {
    return (
      <p>
        Could match {hint.events.length} existing events; Accept will create a new event unless the
        proposal is revised.
      </p>
    );
  }
  if (hint?.kind === 'target_event') {
    return (
      <p>
        Target: "{displayText(hint.event.title)}" at {calendarEventRange(hint.event, timezone)}.
        {proposedRange ? ` Proposed: ${proposedRange}.` : ''}
      </p>
    );
  }
  if (hint?.kind === 'missing_target') {
    return <p>The target event is no longer available.</p>;
  }
  return (
    <p>{proposedRange ? `Scheduled for ${proposedRange}.` : formatPayload(item.proposedPayload)}</p>
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

function ApprovalReconciliationContext({ bundle }: { bundle: SuggestionBundle }) {
  const outputIds = bundleReconciliationOutputIds(bundle);
  const clusterIds = bundleReconciliationClusterIds(bundle);
  if (outputIds.length === 0 && clusterIds.length === 0) return null;
  const primaryClusterId = clusterIds[0] ?? null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 border-l border-border pl-3 text-xs text-fg-dim">
      <span className="font-mono uppercase tracking-[0.1em]">Reconciliation</span>
      {primaryClusterId ? (
        <Link
          href={`/app/team/reconciliation/clusters/${primaryClusterId}`}
          className="inline-flex items-center gap-1 font-mono uppercase tracking-[0.1em] hover:text-signal"
        >
          <ExternalLink className="size-3" />
          Cluster {shortId(primaryClusterId)}
        </Link>
      ) : (
        <Link
          href="/app/team/reconciliation"
          className="inline-flex items-center gap-1 font-mono uppercase tracking-[0.1em] hover:text-signal"
        >
          <ExternalLink className="size-3" />
          Dashboard
        </Link>
      )}
      {outputIds.length > 0 ? (
        <span className="font-mono">
          outputs {outputIds.slice(0, 3).map(shortId).join(', ')}
          {outputIds.length > 3 ? ` +${outputIds.length - 3}` : ''}
        </span>
      ) : null}
    </div>
  );
}

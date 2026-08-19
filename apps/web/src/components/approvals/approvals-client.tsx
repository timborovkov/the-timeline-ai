'use client';

import { taskCategoryLabel, type TaskCategory } from '@timeline/shared/task-categories/types';
import { presentDueDate } from '@timeline/shared/time';
import { Check, ExternalLink, Eye, GitMerge, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useReducer, useRef, useState, useTransition } from 'react';

import { loadSuggestionsPageAction } from '@/app/actions/collection-pages';
import {
  acceptSuggestionItemAction,
  acceptVisibleSuggestionsAction,
  rejectSuggestionItemAction,
  rejectVisibleSuggestionsAction,
} from '@/app/actions/suggestions';
import { ApprovalPreviewDialog } from '@/components/approvals/approval-preview-dialog';
import { SuggestionChangeDialog } from '@/components/approvals/suggestion-change-dialog';
import { CollectionGroup } from '@/components/collections/collection-group';
import { CollectionRow } from '@/components/collections/collection-row';
import { InfiniteScroll } from '@/components/collections/infinite-scroll';
import { SelectionBar } from '@/components/collections/selection-bar';
import { VirtualList } from '@/components/collections/virtual-list';
import { EmptyAction } from '@/components/empty-action';
import { EvidenceLink } from '@/components/evidence-link';
import { Button } from '@/components/ui/button';
import { ItemActionGroup, ItemIconButton } from '@/components/ui/item-actions';
import { useWorkspaceTimezone } from '@/components/workspace-timezone-context';
import { displayText, formatDisplayDate, formatDisplayDateTime } from '@/lib/display-dates';
import { evidenceSourceContextLabel, evidenceSourceLabel } from '@/lib/evidence-source-label';
import { notifyAction } from '@/lib/notify';
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
  evidence?: SuggestionEvidence[];
  evidenceStatus?: 'legacy' | 'current' | 'stale';
}

interface SuggestionEvidence {
  rawEventId: string;
  quote: string | null;
  occurredAt: string | null;
  source: string | null;
  senderName?: string | null;
  senderHandle?: string | null;
  senderTimelineName?: string | null;
  conversationName?: string | null;
  metadata?: Record<string, unknown>;
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
  evidence: SuggestionEvidence[];
}

type ApprovalAction = (
  action: () => Promise<{ ok?: boolean; error?: string; failedItemIds?: string[] }>,
  optimisticItemIds: string[],
  messages: { id: string; loading: string; success: string; error?: string },
) => void;

interface ApprovalsQueueState {
  error: string | null;
  selectedIds: Set<string>;
  previewItem: { bundle: SuggestionBundle; item: SuggestionItem } | null;
  resolvedItemSignatures: Map<string, string>;
  busyItemIds: Set<string>;
  actionFailedItemIds: Set<string>;
}

type ApprovalsQueueAction =
  | { type: 'setError'; error: string | null }
  | { type: 'selectChange'; itemId: string; checked: boolean }
  | { type: 'selectMany'; itemIds: string[]; checked: boolean }
  | { type: 'clearSelection' }
  | { type: 'openPreview'; bundle: SuggestionBundle; item: SuggestionItem }
  | { type: 'closePreview' }
  | { type: 'beginRun'; itemIds: string[]; signatures: Map<string, string> }
  | { type: 'clearBusy'; itemIds: string[] }
  | { type: 'restoreItems'; itemIds: string[] }
  | { type: 'markFailures'; itemIds: string[] };

function mutateSet(source: Set<string>, itemIds: string[], add: boolean): Set<string> {
  const next = new Set(source);
  for (const id of itemIds) {
    if (add) next.add(id);
    else next.delete(id);
  }
  return next;
}

function approvalsQueueReducer(
  state: ApprovalsQueueState,
  action: ApprovalsQueueAction,
): ApprovalsQueueState {
  switch (action.type) {
    case 'setError':
      return { ...state, error: action.error };
    case 'selectChange': {
      const selectedIds = new Set(state.selectedIds);
      if (action.checked) selectedIds.add(action.itemId);
      else selectedIds.delete(action.itemId);
      return { ...state, selectedIds };
    }
    case 'selectMany':
      return {
        ...state,
        selectedIds: mutateSet(state.selectedIds, action.itemIds, action.checked),
      };
    case 'clearSelection':
      return { ...state, selectedIds: new Set() };
    case 'openPreview':
      return { ...state, previewItem: { bundle: action.bundle, item: action.item } };
    case 'closePreview':
      return { ...state, previewItem: null };
    case 'beginRun': {
      const resolvedItemSignatures = new Map(state.resolvedItemSignatures);
      for (const id of action.itemIds) {
        const signature = action.signatures.get(id);
        if (signature) resolvedItemSignatures.set(id, signature);
      }
      const selectedIds = mutateSet(state.selectedIds, action.itemIds, false);
      const previewItem =
        state.previewItem && action.itemIds.includes(state.previewItem.item.id)
          ? null
          : state.previewItem;
      return {
        ...state,
        error: null,
        actionFailedItemIds: mutateSet(state.actionFailedItemIds, action.itemIds, false),
        resolvedItemSignatures,
        busyItemIds: mutateSet(state.busyItemIds, action.itemIds, true),
        selectedIds,
        previewItem,
      };
    }
    case 'clearBusy':
      return { ...state, busyItemIds: mutateSet(state.busyItemIds, action.itemIds, false) };
    case 'restoreItems': {
      const resolvedItemSignatures = new Map(state.resolvedItemSignatures);
      for (const id of action.itemIds) resolvedItemSignatures.delete(id);
      return { ...state, resolvedItemSignatures };
    }
    case 'markFailures':
      return {
        ...state,
        actionFailedItemIds: mutateSet(state.actionFailedItemIds, action.itemIds, true),
      };
  }
}

const INITIAL_APPROVALS_QUEUE: ApprovalsQueueState = {
  error: null,
  selectedIds: new Set(),
  previewItem: null,
  resolvedItemSignatures: new Map(),
  busyItemIds: new Set(),
  actionFailedItemIds: new Set(),
};

interface Props {
  suggestions: SuggestionBundle[];
  nextCursor?: string | null;
  status?: 'pending' | 'failed' | 'resolved' | 'all';
  taskCategoriesEnabled?: boolean;
  allowBulkAccept?: boolean;
  allowBulkReject?: boolean;
  timezone?: string;
  emptyState?: {
    title: string;
    body: string;
  };
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

interface FormattedPayloadField {
  key: string;
  label: string;
  value: string;
}

const MAX_INLINE_PAYLOAD_VALUE_LENGTH = 120;
const TOKEN_PAYLOAD_FIELDS = new Set([
  'field',
  'kind',
  'proposalRole',
  'proposalStatus',
  'recurrenceEditMode',
  'showAs',
  'stage',
  'type',
  'visibility',
]);
const CLEARABLE_PAYLOAD_FIELDS = new Set([
  'assigneeUserId',
  'description',
  'dueAt',
  'location',
  'ownerUserId',
  'priority',
  'reminderMinutes',
  'rrule',
  'stage',
  'visibilityUserIds',
]);

function formatPayloadFields(
  payload: Record<string, unknown>,
  timezone?: string,
  itemTitle?: string,
  operation?: string,
): FormattedPayloadField[] {
  const fields: FormattedPayloadField[] = [];
  const boardUpdateField =
    typeof payload.field === 'string' && Object.hasOwn(payload, 'newValue') ? payload.field : null;
  for (const [key, value] of Object.entries(payload)) {
    if (boardUpdateField && key === 'field') continue;
    if (boardUpdateField && key === 'newValue') {
      const displayNameKey =
        boardUpdateField === 'responsibleUserId'
          ? 'responsibleName'
          : boardUpdateField === 'laneId'
            ? 'laneName'
            : null;
      if (displayNameKey && payloadString(payload, displayNameKey)) {
        continue;
      }
      fields.push({
        key: boardUpdateField,
        label: payloadFieldLabel(boardUpdateField),
        value: formatBoardUpdateValue(boardUpdateField, value, timezone),
      });
      continue;
    }

    const normalizedKey = key.toLowerCase();
    const duplicatesItemTitle =
      (key === 'canonicalName' || key === 'title') &&
      typeof value === 'string' &&
      value.trim() === itemTitle?.trim();
    const displaysClearedValue =
      value === null && operation === 'update' && CLEARABLE_PAYLOAD_FIELDS.has(key);
    if (
      (value === null && !displaysClearedValue) ||
      value === undefined ||
      value === '' ||
      duplicatesItemTitle ||
      key === 'metadata' ||
      key === 'localRef' ||
      key === 'fromRef' ||
      key === 'toRef' ||
      key === 'fromName' ||
      key === 'toName' ||
      (!displaysClearedValue && (normalizedKey.endsWith('id') || normalizedKey.endsWith('ids')))
    ) {
      continue;
    }
    fields.push({
      key,
      label: payloadFieldLabel(key),
      value: displaysClearedValue
        ? clearedPayloadValue(key)
        : formatPayloadValue(key, value, timezone),
    });
  }
  return fields;
}

function payloadFieldText(field: FormattedPayloadField, compact = false): string {
  const value =
    compact && field.value.length > MAX_INLINE_PAYLOAD_VALUE_LENGTH
      ? `${field.value.slice(0, MAX_INLINE_PAYLOAD_VALUE_LENGTH - 1).trimEnd()}…`
      : field.value;
  return field.key === 'dueAt' ? value : `${field.label} ${value}`;
}

function payloadFieldLabel(key: string): string {
  const labels: Record<string, string> = {
    aliases: 'Also known as',
    allDay: 'All day',
    assigneeName: 'Assignee',
    assigneeUserId: 'Assignee',
    boardName: 'Board',
    canonicalName: 'Name',
    description: 'Details',
    dueAt: 'Due',
    endAt: 'Ends',
    entityName: 'Item',
    linkedEntityNames: 'Linked records',
    laneId: 'Lane',
    laneName: 'Lane',
    location: 'Location',
    nextStep: 'Next step',
    notes: 'Notes',
    ownerName: 'Owner',
    ownerUserId: 'Owner',
    parentName: 'Parent',
    position: 'Position',
    priority: 'Priority',
    reminderMinutes: 'Reminder',
    responsibleName: 'Responsible',
    responsibleUserId: 'Responsible',
    rrule: 'Recurrence',
    showAs: 'Show as',
    stage: 'Stage',
    startAt: 'Starts',
    status: 'Status',
    timezone: 'Time zone',
    title: 'Title',
    type: 'Type',
    visibilityUserIds: 'People with access',
    visibilityUserNames: 'People with access',
  };
  return labels[key] ?? humanizeToken(key);
}

function humanizeToken(value: string): string {
  const words = value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim();
  return words ? `${words.charAt(0).toUpperCase()}${words.slice(1)}` : value;
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

function formatPayloadValue(key: string, value: unknown, timezone?: string): string {
  if (key === 'dueAt' && (typeof value === 'string' || value === null)) {
    return formatDueDateValue(value, timezone);
  }
  if ((key === 'startAt' || key === 'endAt') && typeof value === 'string') {
    return formatDisplayDateTime(value, { timezone: timezone ?? 'UTC' });
  }
  if (key === 'status' && typeof value === 'string') {
    const labels: Record<string, string> = {
      accepted: 'Accepted',
      active: 'Active',
      cancelled: 'Cancelled',
      doing: 'In progress',
      done: 'Done',
      shipped: 'Shipped',
      todo: 'To do',
    };
    return labels[value] ?? humanizeToken(value);
  }
  if (TOKEN_PAYLOAD_FIELDS.has(key) && typeof value === 'string') return humanizeToken(value);
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    if (value.length === 0) return 'None';
    return value
      .map((entry) =>
        typeof entry === 'string' || typeof entry === 'number' || typeof entry === 'boolean'
          ? String(entry)
          : entry === undefined
            ? 'undefined'
            : JSON.stringify(entry),
      )
      .join(', ');
  }
  return JSON.stringify(value);
}

function clearedPayloadValue(key: string): string {
  if (key === 'dueAt') return 'No due date';
  return key === 'ownerUserId' || key === 'assigneeUserId' ? 'Unassigned' : 'None';
}

function formatBoardUpdateValue(field: string, value: unknown, timezone?: string): string {
  if (field === 'responsibleUserId') return value === null ? 'Unassigned' : 'Selected team member';
  if (field === 'laneId') return value === null ? 'No lane' : 'Selected lane';
  if (value === null) return field === 'dueAt' ? 'No due date' : 'None';
  return formatPayloadValue(field, value, timezone);
}

function formatDueDateValue(value: string | null, timezone?: string): string {
  const due = presentDueDate(value, { timezone: timezone ?? 'UTC' });
  if (due.status === 'invalid') return due.compactText;
  return due.dateLabel ? `${due.label} · ${due.dateLabel}` : due.compactText;
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

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function calendarRangeLabel(input: {
  startAt: string | null;
  endAt: string | null;
  allDay?: boolean | null;
  timezone: string;
}): string | null {
  if (input.allDay) {
    if (!input.startAt || !input.endAt) {
      if (input.startAt) {
        return `Starts ${formatDisplayDate(input.startAt, { timezone: input.timezone })}`;
      }
      if (input.endAt) {
        return `Ends ${formatDisplayDate(input.endAt, { timezone: input.timezone })}`;
      }
      return null;
    }
    const end = new Date(input.endAt);
    const displayEnd = Number.isNaN(end.getTime()) ? input.endAt : new Date(end.getTime() - 1);
    const startLabel = formatDisplayDate(input.startAt, { timezone: input.timezone });
    const endLabel = formatDisplayDate(displayEnd, { timezone: input.timezone });
    return startLabel === endLabel ? startLabel : `${startLabel} - ${endLabel}`;
  }
  if (input.startAt && input.endAt) {
    return `${formatDisplayDateTime(input.startAt, {
      timezone: input.timezone,
    })} -> ${formatDisplayDateTime(input.endAt, { timezone: input.timezone })}`;
  }
  if (input.startAt) {
    return `Starts ${formatDisplayDateTime(input.startAt, { timezone: input.timezone })}`;
  }
  if (input.endAt) {
    return `Ends ${formatDisplayDateTime(input.endAt, { timezone: input.timezone })}`;
  }
  return null;
}

function proposedCalendarRange(item: SuggestionItem, timezone: string): string | null {
  const eventTimezone = payloadString(item.proposedPayload, 'timezone') ?? timezone;
  return calendarRangeLabel({
    startAt: payloadString(item.proposedPayload, 'startAt'),
    endAt: payloadString(item.proposedPayload, 'endAt'),
    allDay: payloadBoolean(item.proposedPayload, 'allDay'),
    timezone: eventTimezone,
  });
}

function calendarEventRange(event: CalendarResolutionEvent, timezone: string): string {
  return (
    calendarRangeLabel({
      startAt: event.startAt,
      endAt: event.endAt,
      allDay: event.allDay,
      timezone: event.timezone || timezone,
    }) ?? event.startAt
  );
}

function approvalSourceLabel(bundle: SuggestionBundle): string {
  if (bundle.source === 'chat') return 'From Ask';
  const sources = uniqueStrings(
    bundle.evidence.flatMap((evidence) => (evidence.source ? [evidence.source] : [])),
  );
  return sources.length === 1 ? evidenceSourceLabel(sources[0] ?? null) : 'From captured work';
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
      : typeof item.proposedPayload.fromDisplayName === 'string'
        ? displayText(item.proposedPayload.fromDisplayName)
        : typeof item.proposedPayload.fromName === 'string'
          ? displayText(item.proposedPayload.fromName)
          : null;
  const to =
    typeof item.proposedPayload.toRef === 'string'
      ? localRefLabel(bundle, item.proposedPayload.toRef)
      : typeof item.proposedPayload.toDisplayName === 'string'
        ? displayText(item.proposedPayload.toDisplayName)
        : typeof item.proposedPayload.toName === 'string'
          ? displayText(item.proposedPayload.toName)
          : null;
  const kind =
    typeof item.proposedPayload.kind === 'string' ? item.proposedPayload.kind : 'related';
  if (!from || !to) return displayText(`${item.title} · ${kind}`);
  return displayText(`${from} ↔ ${to} · ${kind}`);
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

function foldedSummaryText(
  count: number,
  summary: NonNullable<Props['folded']>['summary'],
): string {
  return `${count} ${count === 1 ? summary.singular : summary.plural}`;
}

export function ApprovalsClient({
  suggestions,
  nextCursor = null,
  status = 'pending',
  taskCategoriesEnabled = true,
  allowBulkAccept = true,
  allowBulkReject = true,
  timezone,
  emptyState,
  folded,
}: Props) {
  const workspaceTimezone = useWorkspaceTimezone();
  const resolvedTimezone = timezone ?? workspaceTimezone;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [pageState, setPageState] = useState<{
    extraSuggestions: SuggestionBundle[];
    extraCursor: string | null;
    paged: boolean;
    loadError: string | null;
  }>({ extraSuggestions: [], extraCursor: null, paged: false, loadError: null });
  const [loadingMore, startLoadingMore] = useTransition();
  const pageCursor = pageState.paged ? pageState.extraCursor : nextCursor;
  const loadedSuggestions = useMemo(() => {
    const seen = new Set(suggestions.map((bundle) => bundle.id));
    return [...suggestions, ...pageState.extraSuggestions.filter((bundle) => !seen.has(bundle.id))];
  }, [pageState.extraSuggestions, suggestions]);
  const [
    { error, selectedIds, previewItem, resolvedItemSignatures, busyItemIds, actionFailedItemIds },
    dispatch,
  ] = useReducer(approvalsQueueReducer, INITIAL_APPROVALS_QUEUE);
  const inFlightItemIdsRef = useRef<Set<string> | null>(null);
  inFlightItemIdsRef.current ??= new Set();
  const serverItemSignatures = useMemo(
    () =>
      new Map(
        loadedSuggestions.flatMap((bundle) =>
          bundle.items.map((item) => [item.id, suggestionItemSignature(item)] as const),
        ),
      ),
    [loadedSuggestions],
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
      loadedSuggestions.flatMap((bundle) => {
        const items = bundle.items.filter((item) => !effectiveResolvedItemIds.has(item.id));
        return items.length > 0 ? [{ ...bundle, items }] : [];
      }),
    [effectiveResolvedItemIds, loadedSuggestions],
  );
  const visiblePendingItemCount = visibleSuggestions.reduce(
    (sum, bundle) =>
      sum + bundle.items.filter((item) => isActionableSuggestionStatus(item.status)).length,
    0,
  );

  function clearBusy(itemIds: string[]) {
    if (itemIds.length === 0) return;
    dispatch({ type: 'clearBusy', itemIds });
  }

  function restoreItems(itemIds: string[]) {
    if (itemIds.length === 0) return;
    dispatch({ type: 'restoreItems', itemIds });
  }

  function markActionFailures(itemIds: string[]) {
    if (itemIds.length === 0) return;
    dispatch({ type: 'markFailures', itemIds });
  }

  function run(
    action: () => Promise<{ ok?: boolean; error?: string; failedItemIds?: string[] }>,
    optimisticItemIds: string[],
    messages: { id: string; loading: string; success: string; error?: string },
  ) {
    const inFlightItemIds = inFlightItemIdsRef.current;
    if (!inFlightItemIds) return;
    if (optimisticItemIds.some((id) => inFlightItemIds.has(id))) return;
    for (const id of optimisticItemIds) inFlightItemIds.add(id);
    dispatch({
      type: 'beginRun',
      itemIds: optimisticItemIds,
      signatures: serverItemSignatures,
    });
    startTransition(async () => {
      try {
        const result = await notifyAction({
          id: messages.id,
          loading: messages.loading.endsWith('…') ? messages.loading : `${messages.loading}…`,
          success: messages.success,
          error: messages.error ?? 'Couldn’t finish this action',
          run: action,
        });
        if (result.error) {
          const failedItemIds =
            'failedItemIds' in result
              ? (result.failedItemIds ?? []).filter((id) => optimisticItemIds.includes(id))
              : [];
          const restoreItemIds = failedItemIds.length > 0 ? failedItemIds : optimisticItemIds;
          restoreItems(restoreItemIds);
          markActionFailures(restoreItemIds);
          dispatch({ type: 'setError', error: result.error });
        }
      } catch (err) {
        restoreItems(optimisticItemIds);
        markActionFailures(optimisticItemIds);
        dispatch({
          type: 'setError',
          error: err instanceof Error ? err.message : 'Approval action failed',
        });
      } finally {
        for (const id of optimisticItemIds) inFlightItemIdsRef.current?.delete(id);
        clearBusy(optimisticItemIds);
        router.refresh();
      }
    });
  }

  function loadMore(): void {
    if (!pageCursor || loadingMore) return;
    startLoadingMore(async () => {
      const page = await loadSuggestionsPageAction({ cursor: pageCursor, status });
      if (page.error) {
        setPageState((current) => ({
          ...current,
          loadError: page.error ?? 'Could not load more.',
        }));
        return;
      }
      setPageState((current) => {
        const seen = new Set(current.extraSuggestions.map((bundle) => bundle.id));
        return {
          extraSuggestions: [
            ...current.extraSuggestions,
            ...page.suggestions.filter((bundle) => !seen.has(bundle.id)),
          ],
          extraCursor: page.nextCursor,
          paged: true,
          loadError: null,
        };
      });
    });
  }

  if (loadedSuggestions.length === 0 && pageCursor === null) {
    return (
      <EmptyAction
        title={emptyState?.title ?? 'No pending approvals'}
        body={
          emptyState?.body ??
          'When the agent proposes tasks, objects, calendar items, or document changes, they will queue here before becoming canonical.'
        }
        href="/app"
        action="Back to home"
      />
    );
  }

  const body = (
    <>
      <ApprovalListBody
        allowBulkAccept={allowBulkAccept}
        allowBulkReject={allowBulkReject}
        actionFailedItemIds={actionFailedItemIds}
        busyItemIds={busyItemIds}
        error={error ?? pageState.loadError}
        hasMore={pageCursor !== null}
        loadingMore={loadingMore}
        onLoadMore={loadMore}
        pending={pending}
        run={run}
        selectedIds={selectedIds}
        timezone={resolvedTimezone}
        taskCategoriesEnabled={taskCategoriesEnabled}
        visibleSuggestions={visibleSuggestions}
        onPreview={(bundle, item) => {
          dispatch({ type: 'openPreview', bundle, item });
        }}
        onSelectedChange={(itemId, checked) => {
          dispatch({ type: 'selectChange', itemId, checked });
        }}
        onSelectedMany={(itemIds, checked) => {
          dispatch({ type: 'selectMany', itemIds, checked });
        }}
        onClearSelection={() => {
          dispatch({ type: 'clearSelection' });
        }}
      />
      {previewItem ? (
        <ApprovalPreviewDialog
          open
          onOpenChange={(open) => {
            if (!open) dispatch({ type: 'closePreview' });
          }}
          item={previewItem.item}
          timezone={resolvedTimezone}
          actionLabel={itemActionLabel(previewItem.item)}
          acceptDisabled={previewItem.item.evidenceStatus === 'stale'}
          busy={busyItemIds.has(previewItem.item.id)}
          pending={pending}
          mergeHref={
            previewItem.item.targetKind === 'object_merge'
              ? objectMergeHref(previewItem.item)
              : null
          }
          onAccept={() => {
            run(
              () => acceptSuggestionItemAction({ itemId: previewItem.item.id }),
              [previewItem.item.id],
              decisionMessages('accept', 1, previewItem.item.title, previewItem.item.id),
            );
          }}
          onReject={() => {
            run(
              () => rejectSuggestionItemAction({ itemId: previewItem.item.id }),
              [previewItem.item.id],
              decisionMessages('reject', 1, previewItem.item.title, previewItem.item.id),
            );
          }}
        />
      ) : null}
    </>
  );

  if (!folded) return body;

  return (
    <details className={folded.className}>
      <summary className={folded.summaryClassName ?? 'cursor-pointer list-none'}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className={folded.titleClassName ?? 'text-xs text-fg'}>{folded.title}</h2>
            <p className={folded.countClassName ?? 'mt-1 text-sm text-fg-muted'}>
              {foldedSummaryText(visiblePendingItemCount, folded.summary)}
            </p>
          </div>
          <span className={folded.openLabelClassName ?? 'text-xs text-fg-dim'}>Open</span>
        </div>
      </summary>
      <div className={folded.bodyClassName ?? 'mt-4'}>{body}</div>
    </details>
  );
}

function decisionMessages(
  kind: 'accept' | 'reject',
  count: number,
  title?: string,
  itemId?: string,
): { id: string; loading: string; success: string } {
  const id = count === 1 && itemId ? `approval:${itemId}:${kind}` : `approval:bulk-${kind}`;
  if (count === 1) {
    const label = displayText(title ?? 'proposal');
    return kind === 'accept'
      ? { id, loading: 'Accepting proposal', success: `Accepted ${label}` }
      : { id, loading: 'Rejecting proposal', success: `Rejected ${label}` };
  }
  return kind === 'accept'
    ? { id, loading: `Accepting ${count} proposals`, success: `Accepted ${count} proposals` }
    : { id, loading: `Rejecting ${count} proposals`, success: `Rejected ${count} proposals` };
}

function ApprovalListBody({
  allowBulkAccept,
  allowBulkReject,
  actionFailedItemIds,
  busyItemIds,
  error,
  hasMore,
  loadingMore,
  onLoadMore,
  pending,
  run,
  selectedIds,
  timezone,
  taskCategoriesEnabled,
  visibleSuggestions,
  onPreview,
  onSelectedChange,
  onSelectedMany,
  onClearSelection,
}: {
  allowBulkAccept: boolean;
  allowBulkReject: boolean;
  actionFailedItemIds: Set<string>;
  busyItemIds: Set<string>;
  error: string | null;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  pending: boolean;
  run: ApprovalAction;
  selectedIds: Set<string>;
  timezone: string;
  taskCategoriesEnabled: boolean;
  visibleSuggestions: SuggestionBundle[];
  onPreview: (bundle: SuggestionBundle, item: SuggestionItem) => void;
  onSelectedChange: (itemId: string, checked: boolean) => void;
  onSelectedMany: (itemIds: string[], checked: boolean) => void;
  onClearSelection: () => void;
}) {
  const selectable = allowBulkAccept || allowBulkReject;
  const selectedItems: SuggestionItem[] = [];
  const selectedAccept: SuggestionItem[] = [];
  const selectedByBundle: { suggestionId: string; itemIds: string[] }[] = [];
  const selectedAcceptByBundle: { suggestionId: string; itemIds: string[] }[] = [];
  const actionableIds: string[] = [];
  for (const bundle of visibleSuggestions) {
    const bundleItemIds: string[] = [];
    const acceptItemIds: string[] = [];
    for (const item of bundle.items) {
      if (!isActionableSuggestionStatus(item.status)) continue;
      actionableIds.push(item.id);
      if (!selectedIds.has(item.id)) continue;
      selectedItems.push(item);
      bundleItemIds.push(item.id);
      if (item.targetKind !== 'object_merge' && item.evidenceStatus !== 'stale') {
        selectedAccept.push(item);
        acceptItemIds.push(item.id);
      }
    }
    if (bundleItemIds.length > 0) {
      selectedByBundle.push({ suggestionId: bundle.id, itemIds: bundleItemIds });
    }
    if (acceptItemIds.length > 0) {
      selectedAcceptByBundle.push({ suggestionId: bundle.id, itemIds: acceptItemIds });
    }
  }
  const allVisibleSelected =
    actionableIds.length > 0 && actionableIds.every((id) => selectedIds.has(id));

  return (
    <div className="space-y-0">
      {error ? (
        <p className="sr-only" role="alert">
          {error}
        </p>
      ) : null}
      {selectable ? (
        <SelectionBar
          count={selectedItems.length}
          label={selectedItems.length === 1 ? 'proposal selected' : 'proposals selected'}
          onClear={onClearSelection}
          actions={
            <>
              {allowBulkReject ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={pending || selectedItems.length === 0}
                  onClick={() => {
                    run(
                      () => rejectVisibleSuggestionsAction({ suggestions: selectedByBundle }),
                      selectedItems.map((item) => item.id),
                      decisionMessages('reject', selectedItems.length),
                    );
                  }}
                >
                  <X className="size-4" />
                  Reject
                </Button>
              ) : null}
              {allowBulkAccept ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={pending || selectedAccept.length === 0}
                  onClick={() => {
                    run(
                      () => acceptVisibleSuggestionsAction({ suggestions: selectedAcceptByBundle }),
                      selectedAccept.map((item) => item.id),
                      decisionMessages('accept', selectedAccept.length),
                    );
                  }}
                >
                  <Check className="size-4" />
                  Accept
                </Button>
              ) : null}
            </>
          }
        />
      ) : null}
      {pending && visibleSuggestions.length === 0 ? <ApprovalUpdatingState /> : null}
      <div>
        {selectable && actionableIds.length > 0 ? (
          <div className="flex min-h-10 items-center border-b border-border bg-surface/70 px-1 sm:px-2">
            <ApprovalSelectAllControl
              checked={allVisibleSelected}
              count={actionableIds.length}
              label="Select all visible proposals"
              visibleLabel="Select all visible"
              onChange={(checked) => {
                onSelectedMany(actionableIds, checked);
              }}
            />
          </div>
        ) : null}
        <VirtualList
          items={visibleSuggestions}
          getItemKey={(bundle) => bundle.id}
          estimateSize={220}
          renderItem={(bundle) => (
            <ApprovalBundleRow
              actionFailedItemIds={actionFailedItemIds}
              bundle={bundle}
              busyItemIds={busyItemIds}
              pending={pending}
              run={run}
              selectable={selectable}
              selectedIds={selectedIds}
              selectionActive={selectedItems.length > 0}
              timezone={timezone}
              taskCategoriesEnabled={taskCategoriesEnabled}
              onPreview={onPreview}
              onSelectedChange={onSelectedChange}
              onSelectedMany={onSelectedMany}
            />
          )}
        />
      </div>
      <InfiniteScroll
        hasMore={hasMore}
        loading={loadingMore}
        error={null}
        onLoadMore={onLoadMore}
        boundLabel="No more matching approvals"
        hideBound={visibleSuggestions.length === 0 && !hasMore}
      />
    </div>
  );
}

function ApprovalUpdatingState() {
  return <output className="px-3 py-2 text-xs text-fg-dim">Updating approvals…</output>;
}

function ApprovalSelectAllControl({
  checked,
  count,
  label,
  onChange,
  visibleLabel,
}: {
  checked: boolean;
  count: number;
  label: string;
  onChange: (checked: boolean) => void;
  visibleLabel?: string;
}) {
  return (
    <label className="flex min-h-10 min-w-0 items-center gap-2 px-2">
      <input
        type="checkbox"
        checked={checked}
        disabled={count === 0}
        aria-label={label}
        className="size-4 rounded-sm border-border accent-signal"
        onChange={(event) => {
          onChange(event.currentTarget.checked);
        }}
      />
      {visibleLabel ? (
        <>
          <span aria-hidden="true" className="truncate text-xs font-medium text-fg">
            {visibleLabel}
          </span>
          <span aria-hidden="true" className="font-mono tabular-nums text-fg-dim">
            {count}
          </span>
        </>
      ) : null}
    </label>
  );
}

function ApprovalBundleRow({
  actionFailedItemIds,
  bundle,
  busyItemIds,
  pending,
  run,
  selectable,
  selectedIds,
  selectionActive,
  timezone,
  taskCategoriesEnabled,
  onPreview,
  onSelectedChange,
  onSelectedMany,
}: {
  actionFailedItemIds: Set<string>;
  bundle: SuggestionBundle;
  busyItemIds: Set<string>;
  pending: boolean;
  run: ApprovalAction;
  selectable: boolean;
  selectedIds: Set<string>;
  selectionActive: boolean;
  timezone: string;
  taskCategoriesEnabled: boolean;
  onPreview: (bundle: SuggestionBundle, item: SuggestionItem) => void;
  onSelectedChange: (itemId: string, checked: boolean) => void;
  onSelectedMany: (itemIds: string[], checked: boolean) => void;
}) {
  const bundleActionableIds: string[] = [];
  for (const item of bundle.items) {
    if (isActionableSuggestionStatus(item.status)) bundleActionableIds.push(item.id);
  }
  const bundleAllSelected =
    bundleActionableIds.length > 0 && bundleActionableIds.every((id) => selectedIds.has(id));
  const items = (
    <>
      {bundle.items.map((item) => (
        <ApprovalItemRow
          actionFailed={actionFailedItemIds.has(item.id)}
          bundle={bundle}
          busy={busyItemIds.has(item.id)}
          item={item}
          key={item.id}
          pending={pending}
          run={run}
          selectable={selectable}
          selected={selectedIds.has(item.id)}
          selectionActive={selectionActive}
          timezone={timezone}
          taskCategoriesEnabled={taskCategoriesEnabled}
          onPreview={() => {
            onPreview(bundle, item);
          }}
          onSelectedChange={(checked) => {
            onSelectedChange(item.id, checked);
          }}
        />
      ))}
      <div className="px-3">
        <ApprovalEvidence bundle={bundle} timezone={timezone} />
      </div>
    </>
  );
  if (bundle.items.length === 1) {
    return <article>{items}</article>;
  }
  const bundleTitle = displayText(bundle.title, { timezone });
  return (
    <article>
      <CollectionGroup
        count={bundle.items.length}
        title={bundleTitle}
        actions={
          selectable && bundleActionableIds.length > 0 ? (
            <ApprovalSelectAllControl
              checked={bundleAllSelected}
              count={bundleActionableIds.length}
              label={`Select all ${bundleTitle} proposals`}
              onChange={(checked) => {
                onSelectedMany(bundleActionableIds, checked);
              }}
            />
          ) : undefined
        }
      >
        {items}
      </CollectionGroup>
    </article>
  );
}

function ApprovalItemRow({
  actionFailed,
  bundle,
  busy,
  item,
  pending,
  run,
  selectable,
  selected,
  selectionActive,
  timezone,
  taskCategoriesEnabled,
  onPreview,
  onSelectedChange,
}: {
  actionFailed: boolean;
  bundle: SuggestionBundle;
  busy: boolean;
  item: SuggestionItem;
  pending: boolean;
  run: ApprovalAction;
  selectable: boolean;
  selected: boolean;
  selectionActive: boolean;
  timezone: string;
  taskCategoriesEnabled: boolean;
  onPreview: () => void;
  onSelectedChange: (checked: boolean) => void;
}) {
  const title = displayText(item.title, { timezone });
  const source = approvalSourceLabel(bundle);
  const context = `${itemActionLabel(item)} · ${source} · ${formatDisplayDateTime(bundle.createdAt, { timezone })}`;
  const actionFailureReason = actionFailed ? localActionFailureReason(item) : null;
  return (
    <div>
      <CollectionRow selected={selected} onActivate={onPreview} activateLabel={`Open ${title}`}>
        <CollectionRow.Leading>
          {selectable && isActionableSuggestionStatus(item.status) ? (
            <input
              type="checkbox"
              checked={selected}
              aria-label={`Select ${title}`}
              data-row-ignore=""
              className={`size-4 accent-signal ${
                selected || selectionActive
                  ? 'opacity-100'
                  : 'opacity-0 group-hover/collection-row:opacity-100 group-focus-within/collection-row:opacity-100'
              }`}
              onChange={(event) => {
                onSelectedChange(event.currentTarget.checked);
              }}
            />
          ) : (
            <span className="size-4" aria-hidden="true" />
          )}
        </CollectionRow.Leading>
        <CollectionRow.Title>{title}</CollectionRow.Title>
        <CollectionRow.Context>{context}</CollectionRow.Context>
        <CollectionRow.Metadata>
          <ApprovalRowMetadata
            bundle={bundle}
            item={item}
            timezone={timezone}
            taskCategoriesEnabled={taskCategoriesEnabled}
          />
        </CollectionRow.Metadata>
        <CollectionRow.Actions>
          {isActionableSuggestionStatus(item.status) ? (
            <ApprovalItemActions
              acceptDisabled={item.evidenceStatus === 'stale'}
              busy={busy}
              item={item}
              pending={pending}
              run={run}
              onPreview={onPreview}
            />
          ) : (
            <span className="text-[11px] text-fg-dim">{itemStatusLabel(item.status)}</span>
          )}
        </CollectionRow.Actions>
      </CollectionRow>
      {actionFailureReason ? (
        <p className="px-3 pb-2 text-xs text-danger">{actionFailureReason}</p>
      ) : actionFailed ? (
        <p className="px-3 pb-2 text-xs text-danger">Needs attention</p>
      ) : null}
      {item.failureReason ? (
        <p className="px-3 pb-2 text-xs text-danger">{displayText(item.failureReason)}</p>
      ) : null}
      <ApprovalCalendarHint item={item} timezone={timezone} />
      <ApprovalItemDependency item={item} bundle={bundle} />
      <ApprovalItemEvidence item={item} timezone={timezone} />
    </div>
  );
}

function ApprovalRowMetadata({
  bundle,
  item,
  timezone,
  taskCategoriesEnabled,
}: {
  bundle: SuggestionBundle;
  item: SuggestionItem;
  timezone: string;
  taskCategoriesEnabled: boolean;
}) {
  const relationship = relationshipPayloadSummary(item, bundle);
  if (relationship) {
    return <span className="text-[11px] text-fg-dim">{relationship}</span>;
  }
  const fields = formatPayloadFields(item.proposedPayload, timezone, item.title, item.operation)
    .filter((field) => {
      if (field.key === 'description' || field.key === 'notes') return false;
      if (
        item.targetKind === 'calendar_event' &&
        (field.key === 'startAt' ||
          field.key === 'endAt' ||
          field.key === 'startDate' ||
          field.key === 'endDate' ||
          field.key === 'timezone' ||
          field.key === 'allDay')
      ) {
        return false;
      }
      return true;
    })
    .slice(0, 3);
  const category =
    taskCategoriesEnabled && item.targetKind === 'task'
      ? (payloadString(item.proposedPayload, 'taskCategory') as TaskCategory | null)
      : null;
  const projectName =
    payloadString(item.proposedPayload, 'parentName') ??
    payloadString(item.proposedPayload, 'projectName') ??
    payloadString(item.proposedPayload, 'createProjectName');
  return (
    <>
      {category ? (
        <span className="text-[11px] text-fg-dim">{taskCategoryLabel(category)}</span>
      ) : null}
      {projectName ? <span className="text-[11px] text-fg-dim">{projectName}</span> : null}
      {fields.map((field) => (
        <span className="text-[11px] text-fg-dim" key={field.key}>
          {payloadFieldText(field, true)}
        </span>
      ))}
    </>
  );
}

function ApprovalItemDependency({
  item,
  bundle,
}: {
  item: SuggestionItem;
  bundle: SuggestionBundle;
}) {
  const dependency = approvalDependencyText(item, bundle);
  return dependency ? <p className="mt-2 text-xs text-fg-dim">{dependency}</p> : null;
}

function CalendarResolutionLine({
  item,
  proposedRange,
  timezone,
}: {
  item: SuggestionItem;
  proposedRange: string | null;
  timezone: string;
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
        {proposedRange ? ` Proposed: ${proposedRange}.` : ''}
      </p>
    );
  }
  if (hint?.kind === 'ambiguous_match') {
    return (
      <p>
        Could match {hint.events.length} existing events; Accept will create a new event unless the
        proposal is revised.
        {proposedRange ? ` Proposed: ${proposedRange}.` : ''}
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
  if (proposedRange?.startsWith('Starts ') || proposedRange?.startsWith('Ends ')) {
    return <p>{proposedRange}.</p>;
  }
  if (proposedRange) return <p>Scheduled for {proposedRange}.</p>;
  return null;
}

function ApprovalCalendarHint({ item, timezone }: { item: SuggestionItem; timezone: string }) {
  if (item.targetKind !== 'calendar_event') return null;
  const proposedRange = proposedCalendarRange(item, timezone);
  return (
    <div className="px-3 pb-2 text-xs text-fg-dim">
      <CalendarResolutionLine item={item} proposedRange={proposedRange} timezone={timezone} />
    </div>
  );
}

function ApprovalItemActions({
  acceptDisabled,
  busy,
  item,
  pending,
  run,
  onPreview,
}: {
  acceptDisabled: boolean;
  busy: boolean;
  item: SuggestionItem;
  pending: boolean;
  run: ApprovalAction;
  onPreview: () => void;
}) {
  const title = displayText(item.title);
  return (
    <ItemActionGroup label={`Decision actions for ${title}`}>
      {item.targetKind === 'object_merge' ? (
        <ItemIconButton asChild label={`Review merge for ${title}`} disabled={pending}>
          <Link href={objectMergeHref(item)}>
            <GitMerge />
          </Link>
        </ItemIconButton>
      ) : (
        <>
          <ItemIconButton
            label={`Accept ${title}`}
            disabled={busy || acceptDisabled}
            onClick={() => {
              run(
                () => acceptSuggestionItemAction({ itemId: item.id }),
                [item.id],
                decisionMessages('accept', 1, item.title, item.id),
              );
            }}
          >
            <Check />
          </ItemIconButton>
          <SuggestionChangeDialog
            compact
            itemId={item.id}
            title={title}
            disabled={busy || acceptDisabled}
          />
        </>
      )}
      <ItemIconButton label={`Preview ${title}`} disabled={busy} onClick={onPreview}>
        <Eye />
      </ItemIconButton>
      <ItemIconButton
        label={`Reject ${title}`}
        className="hover:text-danger"
        disabled={busy}
        onClick={() => {
          run(
            () => rejectSuggestionItemAction({ itemId: item.id }),
            [item.id],
            decisionMessages('reject', 1, item.title, item.id),
          );
        }}
      >
        <X />
      </ItemIconButton>
    </ItemActionGroup>
  );
}

function ApprovalItemEvidence({ item, timezone }: { item: SuggestionItem; timezone: string }) {
  if (item.evidenceStatus === 'stale') {
    return (
      <p className="md:col-span-3 text-xs text-danger" role="status">
        Required source evidence changed after this proposal was created. Regenerate the proposal
        before accepting this change.
      </p>
    );
  }
  if (!item.evidence || item.evidence.length === 0) return null;
  const evidenceBySurface = new Map<string, NonNullable<SuggestionItem['evidence']>[number][]>();
  for (const evidence of item.evidence) {
    const surface = evidence.metadata?.evidence_surface;
    const label =
      typeof surface === 'string' && surface.trim()
        ? surface.trim()
        : evidenceSourceLabel(evidence.source);
    evidenceBySurface.set(label, [...(evidenceBySurface.get(label) ?? []), evidence]);
  }
  return (
    <details className="px-3 pb-2 text-xs">
      <summary className="cursor-pointer text-fg-dim hover:text-fg">
        Why · {evidenceBySurface.size} {evidenceBySurface.size === 1 ? 'source' : 'sources'}
      </summary>
      <div className="mt-2 grid gap-2">
        {[...evidenceBySurface.entries()].map(([surface, evidence]) => (
          <section key={surface} aria-label={`${surface} evidence`}>
            <p className="text-fg-muted">
              {surface} · {evidence.length} {evidence.length === 1 ? 'citation' : 'citations'}
            </p>
            <div className="grid gap-1 sm:grid-cols-2">
              {evidence.map((ev) => (
                <EvidenceLink
                  key={ev.rawEventId}
                  eventId={ev.rawEventId}
                  previewText={ev.quote}
                  source={ev.source}
                  occurredAt={ev.occurredAt}
                  className="group grid min-w-0 gap-1 py-1 text-fg-dim transition-colors hover:text-fg"
                >
                  <span className="inline-flex items-center gap-1.5">
                    <ExternalLink className="size-3 shrink-0" />
                    Evidence from {evidenceSourceContextLabel(ev)}
                  </span>
                  <span className="line-clamp-2 text-fg-muted group-hover:text-fg">
                    {ev.quote
                      ? displayText(ev.quote, { timezone })
                      : 'Open the source event on the timeline.'}
                  </span>
                </EvidenceLink>
              ))}
            </div>
          </section>
        ))}
      </div>
    </details>
  );
}

function ApprovalEvidence({ bundle, timezone }: { bundle: SuggestionBundle; timezone: string }) {
  if (bundle.evidence.length === 0 && !bundle.reason) return null;
  return (
    <details className="pb-2 text-xs">
      <summary className="cursor-pointer text-fg-dim hover:text-fg">
        Why this was suggested
        {bundle.evidence.length > 0
          ? ` · ${bundle.evidence.length} ${bundle.evidence.length === 1 ? 'source' : 'sources'}`
          : ''}
      </summary>
      {bundle.reason ? (
        <p className="max-w-3xl py-2 text-xs leading-5 text-fg-muted">
          {displayText(bundle.reason, { timezone })}
        </p>
      ) : null}
      {bundle.evidence.map((ev) => (
        <EvidenceLink
          key={ev.rawEventId}
          eventId={ev.rawEventId}
          previewText={ev.quote}
          source={ev.source}
          occurredAt={ev.occurredAt}
          className="group grid gap-1 py-1 text-xs text-fg-dim transition-colors hover:text-fg"
        >
          <span className="inline-flex items-center gap-1.5 text-xs">
            <ExternalLink className="size-3" />
            Evidence from {evidenceSourceContextLabel(ev)}
          </span>
          <span className="line-clamp-2 text-fg-muted group-hover:text-fg">
            {ev.quote
              ? displayText(ev.quote, { timezone })
              : 'Open the source event on the timeline.'}
          </span>
        </EvidenceLink>
      ))}
    </details>
  );
}

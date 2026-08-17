'use client';

import { JOB_RECOVERY_ATTENTION_DAYS } from '@timeline/shared/job-recovery';
import { CheckCircle2, CircleAlert, LoaderCircle, RotateCcw, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useReducer, useRef, useState } from 'react';

import type * as jobRecovery from '@timeline/shared/job-recovery';

import { CollectionGroup } from '@/components/collections/collection-group';
import { CollectionStatus } from '@/components/collections/collection-status';
import { JobDashboard } from '@/components/jobs/job-dashboard';
import { TechnicalDetails } from '@/components/technical-details';
import { useAppDialog } from '@/components/ui/app-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ItemActionGroup } from '@/components/ui/item-actions';
import {
  type FinishedJobArchivePage,
  useFinishedJobsInfiniteQuery,
} from '@/lib/use-paginated-queries';
import { cn } from '@/lib/utils';

type JobRecoveryItem = jobRecovery.JobRecoveryItem;
type JobRecoveryKind = jobRecovery.JobRecoveryKind;
type ResuggestWindowDays = 7 | 30 | 90;

interface RetrySnapshot {
  startedAt: number;
  status: 'queued' | 'completed' | 'failed';
  error: string | null;
}

type RetryStates = Record<string, RetrySnapshot>;

interface RetryFailedResponse {
  retried?: number;
  failed?: number;
  failedIds?: string[];
}

interface DismissMatchingResponse {
  dismissed?: number;
  remaining?: number;
}

interface JobRecoveryListProps {
  items: JobRecoveryItem[];
  olderCount: number;
  defaultFilter?: JobRecoveryKind;
}

interface JobRecoveryUiState {
  actionError: string | null;
  busy: string | null;
  dismissedKeys: Set<string>;
  filter: JobRecoveryKind | 'all';
  retrySnapshots: RetryStates;
}

type JobRecoveryUiAction =
  | { type: 'busy'; busy: string | null }
  | { type: 'dismiss'; key: string }
  | { type: 'dismissMany'; keys: string[] }
  | { type: 'error'; error: string | null }
  | { type: 'filter'; filter: JobRecoveryKind | 'all' }
  | { type: 'retryQueued'; id: string; startedAt: number }
  | { type: 'retryQueuedMany'; ids: string[]; startedAt: number };

const FILTERS: { kind: JobRecoveryKind | 'all'; label: string }[] = [
  { kind: 'all', label: 'All' },
  { kind: 'transcription', label: 'Transcription' },
  { kind: 'extraction', label: 'Extraction' },
  { kind: 'embedding', label: 'Embedding' },
  { kind: 'document_processing', label: 'Documents' },
  { kind: 'meeting_finalization', label: 'Meetings' },
  { kind: 'integration_sync', label: 'Integrations' },
];

const initialJobRecoveryUiState: JobRecoveryUiState = {
  actionError: null,
  busy: null,
  dismissedKeys: new Set<string>(),
  filter: 'all',
  retrySnapshots: {},
};

function jobRecoveryUiReducer(
  state: JobRecoveryUiState,
  action: JobRecoveryUiAction,
): JobRecoveryUiState {
  switch (action.type) {
    case 'busy':
      return { ...state, busy: action.busy };
    case 'dismiss':
      return {
        ...state,
        dismissedKeys: new Set(state.dismissedKeys).add(action.key),
      };
    case 'dismissMany': {
      const dismissedKeys = new Set(state.dismissedKeys);
      for (const key of action.keys) dismissedKeys.add(key);
      return { ...state, dismissedKeys };
    }
    case 'error':
      return { ...state, actionError: action.error };
    case 'filter':
      return { ...state, filter: action.filter };
    case 'retryQueued':
      return {
        ...state,
        retrySnapshots: {
          ...state.retrySnapshots,
          [action.id]: { startedAt: action.startedAt, status: 'queued', error: null },
        },
      };
    case 'retryQueuedMany': {
      const retrySnapshots = { ...state.retrySnapshots };
      for (const id of action.ids) {
        retrySnapshots[id] = { startedAt: action.startedAt, status: 'queued', error: null };
      }
      return { ...state, retrySnapshots };
    }
  }
}

export function JobRecoveryList({ items, olderCount, defaultFilter }: JobRecoveryListProps) {
  const router = useRouter();
  const dialog = useAppDialog();
  const finishedJobs = useFinishedJobsInfiniteQuery();
  const [{ actionError, busy, dismissedKeys, filter, retrySnapshots }, dispatchUi] = useReducer(
    jobRecoveryUiReducer,
    initialJobRecoveryUiState,
    (initial): JobRecoveryUiState => ({ ...initial, filter: defaultFilter ?? 'all' }),
  );
  const refreshedRetrySnapshots = useRef<Set<string> | null>(null);

  const visibleItems = useMemo(
    () => items.filter((item) => !dismissedKeys.has(itemSnapshotKey(item))),
    [dismissedKeys, items],
  );

  const finishedArchiveItems = useMemo(
    () => finishedJobs.data?.pages.flatMap((page) => page.items) ?? [],
    [finishedJobs.data],
  );
  const finishedByIdentity = useMemo(() => {
    const byIdentity = new Map<string, FinishedJobArchivePage['items']>();
    for (const item of finishedArchiveItems) {
      if (!item.artifactKind || !item.artifactId) continue;
      const key = archiveIdentityKey(item.kind, item.artifactKind, item.artifactId, item.syncKind);
      const current = byIdentity.get(key) ?? [];
      current.push(item);
      byIdentity.set(key, current);
    }
    return byIdentity;
  }, [finishedArchiveItems]);
  const retryStates = useMemo(() => {
    const states: typeof retrySnapshots = {};
    for (const item of visibleItems) {
      const snapshot = retrySnapshots[item.id];
      if (!snapshot) continue;
      const matches =
        finishedByIdentity.get(
          archiveIdentityKey(item.kind, item.artifactKind, item.artifactId, item.syncKind),
        ) ?? [];
      let match: FinishedJobArchivePage['items'][number] | undefined;
      for (const finished of matches) {
        if (new Date(finished.finishedAt).getTime() >= snapshot.startedAt) {
          match = finished;
          break;
        }
      }
      states[item.id] = match
        ? {
            startedAt: snapshot.startedAt,
            status: match.status,
            error: match.error,
          }
        : snapshot;
    }
    return states;
  }, [finishedByIdentity, retrySnapshots, visibleItems]);

  useEffect(() => {
    const refreshed = refreshedRetrySnapshots.current ?? new Set<string>();
    refreshedRetrySnapshots.current = refreshed;
    for (const [id, snapshot] of Object.entries(retryStates)) {
      if (snapshot.status !== 'completed') continue;
      const key = `${id}:${String(snapshot.startedAt)}`;
      if (refreshed.has(key)) continue;
      refreshed.add(key);
      router.refresh();
      break;
    }
  }, [retryStates, router]);

  const filtered = useMemo(
    () => (filter === 'all' ? visibleItems : visibleItems.filter((item) => item.kind === filter)),
    [filter, visibleItems],
  );
  const failedItems = filtered.filter((item) => item.status === 'failed');
  const failedCount = failedItems.length;
  const hasQueuedFailedRetry = failedItems.some(
    (item) => retryStates[item.id]?.status === 'queued',
  );

  async function call(action: 'retry' | 'dismiss', id: string) {
    const retryStartedAt = Date.now();
    dispatchUi({ type: 'busy', busy: `${action}:${id}` });
    dispatchUi({ type: 'error', error: null });
    try {
      const res = await fetch(`/api/team/job-recovery/${encodeURIComponent(id)}/${action}`, {
        method: 'POST',
      });
      if (!res.ok) {
        const text = await res.text();
        dispatchUi({
          type: 'error',
          error: `${action === 'retry' ? 'Retry' : 'Dismiss'} failed: ${text}`,
        });
        return;
      }
      if (action === 'retry') {
        dispatchUi({ type: 'retryQueued', id, startedAt: retryStartedAt });
        void finishedJobs.refetch();
      } else {
        const dismissed = items.find((item) => item.id === id);
        if (dismissed) {
          dispatchUi({ type: 'dismiss', key: itemSnapshotKey(dismissed) });
        }
        router.refresh();
      }
    } finally {
      dispatchUi({ type: 'busy', busy: null });
    }
  }

  async function dismissVisible() {
    if (filtered.length === 0) return;
    const kindLabel = filter === 'all' ? '' : `${filter.replace(/_/g, ' ')} `;
    const jobWord = filtered.length === 1 ? 'job' : 'jobs';
    const confirmed = await dialog.confirm({
      title: 'Dismiss these jobs?',
      description: `Dismiss ${String(filtered.length)} ${kindLabel}${jobWord} from the last ${String(JOB_RECOVERY_ATTENTION_DAYS)} days? They leave this list. Timeline can still retry them in the background.`,
      confirmLabel: 'Dismiss all',
      destructive: true,
    });
    if (!confirmed) return;
    await dismissMatching('recent', 'dismiss-visible');
  }

  async function dismissOlder() {
    if (olderCount === 0) return;
    const confirmed = await dialog.confirm({
      title: 'Dismiss older jobs?',
      description: `Dismiss ${String(olderCount)} jobs older than ${String(JOB_RECOVERY_ATTENTION_DAYS)} days? Timeline will stop asking you to recover them. Background workers may still retry a few times, then give up.`,
      confirmLabel: 'Dismiss older jobs',
      destructive: true,
    });
    if (!confirmed) return;
    await dismissMatching('older', 'dismiss-older');
  }

  async function dismissMatching(window: 'recent' | 'older', busyKey: string) {
    dispatchUi({ type: 'busy', busy: busyKey });
    dispatchUi({ type: 'error', error: null });
    try {
      const res = await fetch('/api/team/job-recovery/dismiss-matching', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          window,
          ...(window === 'older' || filter === 'all' ? {} : { kind: filter }),
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        dispatchUi({ type: 'error', error: `Dismiss failed: ${text}` });
        return;
      }
      const body = (await res.json().catch(() => ({}))) as DismissMatchingResponse;
      if (window === 'recent') {
        dispatchUi({
          type: 'dismissMany',
          keys: filtered.map((item) => itemSnapshotKey(item)),
        });
      }
      if ((body.remaining ?? 0) > 0) {
        const remainingLabel = window === 'older' ? 'older jobs' : 'jobs';
        dispatchUi({
          type: 'error',
          error: `Dismissed ${String(body.dismissed ?? 0)} ${remainingLabel}; ${String(body.remaining)} remain. Dismiss again to continue.`,
        });
      }
      router.refresh();
    } finally {
      dispatchUi({ type: 'busy', busy: null });
    }
  }

  async function retryFailed() {
    if (failedCount === 0) return;
    const retryStartedAt = Date.now();
    dispatchUi({ type: 'busy', busy: 'retry-failed' });
    dispatchUi({ type: 'error', error: null });
    try {
      const res = await fetch('/api/team/job-recovery/retry-failed', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...(filter === 'all' ? {} : { kind: filter }),
          items: failedItems.map((item) => ({
            id: item.id,
            detectedAt: new Date(item.detectedAt).toISOString(),
          })),
          expectedCount: failedCount,
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        dispatchUi({ type: 'error', error: `Retry failed jobs failed: ${text}` });
        return;
      }
      const body = (await res.json().catch(() => ({}))) as RetryFailedResponse;
      const failedRetryIds = new Set(body.failedIds ?? []);
      const retryQueuedIds: string[] = [];
      for (const item of failedItems) {
        if (!failedRetryIds.has(item.id)) retryQueuedIds.push(item.id);
      }
      dispatchUi({
        type: 'retryQueuedMany',
        ids: retryQueuedIds,
        startedAt: retryStartedAt,
      });
      if ((body.failed ?? failedRetryIds.size) > 0) {
        dispatchUi({
          type: 'error',
          error: `Retried ${String(body.retried ?? failedCount - failedRetryIds.size)} failed jobs; ${String(
            body.failed ?? failedRetryIds.size,
          )} could not be queued.`,
        });
      }
      void finishedJobs.refetch();
      router.refresh();
    } finally {
      dispatchUi({ type: 'busy', busy: null });
    }
  }

  return (
    <section className="space-y-6">
      {olderCount > 0 ? (
        <div className="flex flex-col gap-3 rounded-sm border border-border bg-surface px-3 py-3 md:flex-row md:items-center md:justify-between">
          <div className="space-y-1">
            <p className="text-sm font-medium text-fg">
              <span className="font-mono tabular-nums">{olderCount.toLocaleString()}</span> older
              jobs are hidden
            </p>
            <p className="text-xs text-fg-muted">
              These are more than {String(JOB_RECOVERY_ATTENTION_DAYS)} days old. Workers retry them
              a few times, then stop. Dismiss them if you do not want them recovered.
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={busy !== null}
            onClick={() => {
              void dismissOlder();
            }}
          >
            {busy === 'dismiss-older' ? (
              <LoaderCircle aria-hidden="true" className="mr-1 size-3.5 animate-spin" />
            ) : (
              <X aria-hidden="true" className="mr-1 size-3.5" />
            )}
            {busy === 'dismiss-older' ? 'Dismissing older' : 'Dismiss older jobs'}
          </Button>
        </div>
      ) : null}

      {actionError ? (
        <div className="rounded-sm border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {actionError}
        </div>
      ) : null}

      <JobRecoveryToolbar
        busy={busy}
        failedCount={failedCount}
        filter={filter}
        hasQueuedFailedRetry={hasQueuedFailedRetry}
        visibleCount={filtered.length}
        onDismissVisible={dismissVisible}
        onRetryFailed={retryFailed}
        onSetFilter={(nextFilter) => {
          dispatchUi({ type: 'filter', filter: nextFilter });
        }}
      />

      <JobRecoveryItems busy={busy} items={filtered} onAction={call} retryStates={retryStates} />
      <AdvancedJobTools
        finishedItems={finishedArchiveItems}
        finishedQuery={finishedJobs}
        onQueued={() => {
          router.refresh();
        }}
      />
      {dialog.node}
    </section>
  );
}

function JobRecoveryToolbar({
  busy,
  failedCount,
  filter,
  hasQueuedFailedRetry,
  visibleCount,
  onDismissVisible,
  onRetryFailed,
  onSetFilter,
}: {
  busy: string | null;
  failedCount: number;
  filter: JobRecoveryKind | 'all';
  hasQueuedFailedRetry: boolean;
  visibleCount: number;
  onDismissVisible: () => Promise<void>;
  onRetryFailed: () => Promise<void>;
  onSetFilter: (filter: JobRecoveryKind | 'all') => void;
}) {
  return (
    <div className="flex flex-col gap-2 border-y border-border py-2 md:flex-row md:items-center md:justify-between">
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const active = filter === f.kind;
          return (
            <button
              key={f.kind}
              type="button"
              onClick={() => {
                onSetFilter(f.kind);
              }}
              className={cn(
                'rounded-sm border px-2 py-1 text-[11px] transition-colors',
                active
                  ? 'border-signal bg-signal/10 text-signal'
                  : 'border-border bg-surface text-fg-muted hover:border-border-strong hover:text-fg',
              )}
            >
              {f.label}
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-2 self-start md:self-auto">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={busy !== null || failedCount === 0 || hasQueuedFailedRetry}
          onClick={() => {
            void onRetryFailed();
          }}
        >
          {busy === 'retry-failed' ? (
            <LoaderCircle aria-hidden="true" className="mr-1 size-3.5 animate-spin" />
          ) : (
            <RotateCcw aria-hidden="true" className="mr-1 size-3.5" />
          )}
          {busy === 'retry-failed'
            ? 'Retrying failed'
            : `Retry failed${failedCount > 0 ? ` (${String(failedCount)})` : ''}`}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={busy !== null || visibleCount === 0}
          onClick={() => {
            void onDismissVisible();
          }}
        >
          <X aria-hidden="true" className="mr-1 size-3.5" />
          {busy === 'dismiss-visible'
            ? 'Dismissing'
            : `Dismiss all${visibleCount > 0 ? ` (${String(visibleCount)})` : ''}`}
        </Button>
      </div>
    </div>
  );
}

function JobRecoveryItems({
  busy,
  items,
  onAction,
  retryStates,
}: {
  busy: string | null;
  items: JobRecoveryItem[];
  onAction: (action: 'retry' | 'dismiss', id: string) => Promise<void>;
  retryStates: RetryStates;
}) {
  const failedItems = items.filter((item) => item.status === 'failed');
  const stuckItems = items.filter((item) => item.status !== 'failed');

  if (items.length === 0) {
    return (
      <p className="px-1 py-4 text-sm text-fg-muted">
        Nothing needs attention from the last {String(JOB_RECOVERY_ATTENTION_DAYS)} days.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {failedItems.length > 0 ? (
        <CollectionGroup title="Failed" count={failedItems.length} tone="danger">
          <JobRecoveryRows
            busy={busy}
            items={failedItems}
            onAction={onAction}
            retryStates={retryStates}
          />
        </CollectionGroup>
      ) : null}
      {stuckItems.length > 0 ? (
        <CollectionGroup title="Stuck" count={stuckItems.length} tone="progress">
          <JobRecoveryRows
            busy={busy}
            items={stuckItems}
            onAction={onAction}
            retryStates={retryStates}
          />
        </CollectionGroup>
      ) : null}
    </div>
  );
}

function JobRecoveryRows({
  busy,
  items,
  onAction,
  retryStates,
}: {
  busy: string | null;
  items: JobRecoveryItem[];
  onAction: (action: 'retry' | 'dismiss', id: string) => Promise<void>;
  retryStates: RetryStates;
}) {
  return (
    <ul>
      {items.map((item) => {
        const retry = retryStates[item.id];
        return (
          <li
            key={item.id}
            className="flex flex-col gap-2 border-b border-border/80 px-2 py-2 last:border-b-0 sm:flex-row sm:items-center sm:px-3"
          >
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <CollectionStatus
                  value={retry?.status === 'queued' ? 'retrying' : item.status}
                  tone={
                    retry?.status === 'queued'
                      ? 'progress'
                      : item.status === 'failed'
                        ? 'danger'
                        : 'progress'
                  }
                />
                <span className="truncate text-sm font-medium text-fg">{item.label}</span>
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-muted">
                <span>{new Date(item.detectedAt).toLocaleString()}</span>
                {item.error ? (
                  <span className="text-destructive">
                    Processing failed. Retry this job or dismiss it.
                  </span>
                ) : null}
              </div>
              {retry ? <RetryStatus snapshot={retry} /> : null}
              <TechnicalDetails
                items={[
                  { label: 'Job ID', value: item.id, copyValue: item.id },
                  {
                    label: 'Artifact ID',
                    value: item.artifactId,
                    copyValue: item.artifactId,
                  },
                  ...(item.error
                    ? [{ label: 'Raw error', value: item.error, copyValue: item.error }]
                    : []),
                  ...(retry?.status === 'failed' && retry.error
                    ? [
                        {
                          label: 'Raw retry error',
                          value: retry.error,
                          copyValue: retry.error,
                        },
                      ]
                    : []),
                ]}
              />
            </div>
            <JobRecoveryItemActions busy={busy} item={item} onAction={onAction} retry={retry} />
          </li>
        );
      })}
    </ul>
  );
}

function JobRecoveryItemActions({
  busy,
  item,
  onAction,
  retry,
}: {
  busy: string | null;
  item: JobRecoveryItem;
  onAction: (action: 'retry' | 'dismiss', id: string) => Promise<void>;
  retry: RetrySnapshot | undefined;
}) {
  return (
    <ItemActionGroup label={`Actions for ${item.label}`}>
      {item.retryable ? (
        <Button
          size="sm"
          variant="secondary"
          disabled={busy !== null || retry?.status === 'queued'}
          onClick={() => {
            void onAction('retry', item.id);
          }}
        >
          {retry?.status === 'queued' ? (
            <LoaderCircle aria-hidden="true" className="mr-1 size-3.5 animate-spin" />
          ) : (
            <RotateCcw aria-hidden="true" className="mr-1 size-3.5" />
          )}
          {busy === `retry:${item.id}` ? 'Retrying' : 'Retry'}
        </Button>
      ) : null}
      <Button
        size="sm"
        variant="ghost"
        disabled={busy !== null}
        onClick={() => {
          void onAction('dismiss', item.id);
        }}
      >
        <X aria-hidden="true" className="mr-1 size-3.5" />
        {busy === `dismiss:${item.id}` ? 'Dismissing' : 'Dismiss'}
      </Button>
    </ItemActionGroup>
  );
}

function AdvancedJobTools({
  finishedItems,
  finishedQuery,
  onQueued,
}: {
  finishedItems: FinishedJobArchivePage['items'];
  finishedQuery: ReturnType<typeof useFinishedJobsInfiniteQuery>;
  onQueued: () => void;
}) {
  return (
    <TechnicalDetails summary="Advanced tools">
      <div className="space-y-8">
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-fg">Unprocessed backlog</h2>
          <p className="text-xs text-fg-muted">
            These counts are events still waiting for extraction or embedding. They are not the
            recovery queue on this page. Workers keep retrying them automatically.
          </p>
          <JobDashboard />
        </section>
        <ConversationSuggestionRecovery onQueued={onQueued} />
        <FinishedJobsArchive items={finishedItems} query={finishedQuery} />
      </div>
    </TechnicalDetails>
  );
}

function ConversationSuggestionRecovery({ onQueued }: { onQueued: () => void }) {
  const [windowDays, setWindowDays] = useState<ResuggestWindowDays>(30);
  const [status, setStatus] = useState<string | null>(null);
  const [queueing, setQueueing] = useState(false);

  async function queueConversationSuggestions() {
    setQueueing(true);
    setStatus(null);
    try {
      const res = await fetch('/api/team/job-recovery/resuggest', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ windowDays, source: 'all' }),
      });
      if (!res.ok) {
        const text = await res.text();
        setStatus(`Queue suggestions failed: ${text}`);
        return;
      }
      const body = (await res.json()) as {
        enqueued?: number;
        scanned?: number;
        truncated?: boolean;
      };
      setStatus(
        `Queued ${String(body.enqueued ?? 0)} conversation reviews from ${String(body.scanned ?? 0)} events${
          body.truncated ? ' (conversation limit reached)' : ''
        }.`,
      );
      onQueued();
    } finally {
      setQueueing(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-sm border border-border bg-surface p-3 md:flex-row md:items-center md:justify-between">
      <div className="space-y-1">
        <h2 className="text-sm font-medium">Conversation suggestions</h2>
        {status ? <p className="text-xs text-fg-muted">{status}</p> : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={windowDays}
          onChange={(event) => {
            setWindowDays(Number(event.target.value) as ResuggestWindowDays);
          }}
          className="h-8 rounded-sm border border-border bg-bg px-2 text-sm text-fg"
          aria-label="Suggestion recovery window"
        >
          <option value={7}>7 days</option>
          <option value={30}>30 days</option>
          <option value={90}>90 days</option>
        </select>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={queueing}
          onClick={() => {
            void queueConversationSuggestions();
          }}
        >
          {queueing ? (
            <LoaderCircle aria-hidden="true" className="mr-1 size-3.5 animate-spin" />
          ) : (
            <RotateCcw aria-hidden="true" className="mr-1 size-3.5" />
          )}
          {queueing ? 'Queueing' : 'Queue suggestions'}
        </Button>
      </div>
    </div>
  );
}

function archiveIdentityKey(
  kind: string,
  artifactKind: string,
  artifactId: string,
  syncKind?: string,
) {
  return `${kind}:${artifactKind}:${artifactId}:${kind === 'integration_sync' ? (syncKind ?? 'incremental') : ''}`;
}

function itemSnapshotKey(item: Pick<JobRecoveryItem, 'detectedAt' | 'id'>) {
  return `${item.id}:${new Date(item.detectedAt).toISOString()}`;
}

function RetryStatus({ snapshot }: { snapshot: RetrySnapshot }) {
  if (snapshot.status === 'completed') {
    return (
      <p className="flex items-center gap-1 text-xs text-fg-muted">
        <CheckCircle2 aria-hidden="true" className="size-3.5" />
        Retry run completed. This item remains listed until recovery clears.
      </p>
    );
  }
  if (snapshot.status === 'failed') {
    return (
      <p className="flex items-center gap-1 text-xs text-destructive">
        <CircleAlert aria-hidden="true" className="size-3.5" />
        Retry failed. Review technical details, then retry the job or dismiss it.
      </p>
    );
  }
  return (
    <p className="flex items-center gap-1 text-xs text-fg-muted">
      <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />
      Retry queued.
    </p>
  );
}

function FinishedJobsArchive({
  items,
  query,
}: {
  items: FinishedJobArchivePage['items'];
  query: ReturnType<typeof useFinishedJobsInfiniteQuery>;
}) {
  return (
    <section className="space-y-3 pt-5">
      <div className="border-y border-border py-2">
        <h2 className="text-sm font-semibold text-fg-muted">Finished jobs</h2>
      </div>
      <div className="overflow-x-auto rounded-sm border border-border bg-surface">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="border-b border-border text-[11px] text-fg-dim">
            <tr>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Job</th>
              <th className="px-3 py-2 font-medium">Queue</th>
              <th className="px-3 py-2 font-medium">Attempts</th>
              <th className="px-3 py-2 font-medium">Finished</th>
              <th className="px-3 py-2 font-medium">Error</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {query.isPending ? (
              <tr>
                <td className="px-3 py-4 text-fg-muted" colSpan={6}>
                  Loading finished jobs…
                </td>
              </tr>
            ) : query.isError ? (
              <tr>
                <td className="px-3 py-4 text-destructive" colSpan={6}>
                  {query.error.message}
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td className="px-3 py-4 text-fg-muted" colSpan={6}>
                  No finished jobs are currently retained.
                </td>
              </tr>
            ) : (
              items.map((item) => (
                <tr key={item.id}>
                  <td className="px-3 py-2">
                    <Badge variant={item.status === 'failed' ? 'destructive' : 'outline'}>
                      {item.status}
                    </Badge>
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-medium">{item.label}</div>
                    <TechnicalDetails
                      className="mt-1"
                      items={[
                        { label: 'Job ID', value: item.id, copyValue: item.id },
                        ...(item.artifactId
                          ? [
                              {
                                label: 'Artifact ID',
                                value: item.artifactId,
                                copyValue: item.artifactId,
                              },
                            ]
                          : []),
                        ...(item.error
                          ? [{ label: 'Raw error', value: item.error, copyValue: item.error }]
                          : []),
                      ]}
                    />
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-fg-muted">{item.queue}</td>
                  <td className="px-3 py-2 text-fg-muted">{item.attemptsMade}</td>
                  <td className="px-3 py-2 text-fg-muted">
                    {new Date(item.finishedAt).toLocaleString()}
                  </td>
                  <td className="max-w-xs px-3 py-2 text-destructive">
                    {item.error ? 'Failed' : ''}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {query.hasNextPage ? (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={query.isFetchingNextPage}
          onClick={() => {
            void query.fetchNextPage();
          }}
        >
          {query.isFetchingNextPage ? 'Loading' : 'Load more'}
        </Button>
      ) : null}
    </section>
  );
}

'use client';

import { CheckCircle2, CircleAlert, LoaderCircle, RotateCcw, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore } from 'react';

import type * as jobRecovery from '@timeline/shared/job-recovery';

import { CollectionGroup } from '@/components/collections/collection-group';
import { CollectionRow } from '@/components/collections/collection-row';
import { CollectionStatus } from '@/components/collections/collection-status';
import { InfiniteScroll } from '@/components/collections/infinite-scroll';
import { jobRecoveryRowHint } from '@/components/job-recovery/job-recovery-row-hint';
import {
  DISMISS_MATCHING_CLIENT_MAX_ROUNDS,
  JOBS_ATTENTION_DAYS,
  JOB_RECOVERY_LIST_WINDOW_SIZE,
} from '@/components/job-recovery/jobs-attention';
import { JobsPageHeader } from '@/components/job-recovery/jobs-page-header';
import { jobsMutationToast, postJson } from '@/components/job-recovery/jobs-page-toast';
import { JobDashboard } from '@/components/jobs/job-dashboard';
import { TechnicalDetails } from '@/components/technical-details';
import { useAppDialog } from '@/components/ui/app-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { ItemActionGroup, ItemOverflowMenu } from '@/components/ui/item-actions';
import { useWorkspaceTimezone } from '@/components/workspace-timezone-context';
import { formatRelativeAge } from '@/lib/display-dates';
import { isoTimestamp } from '@/lib/iso-timestamp';
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
  teamName: string;
  items: JobRecoveryItem[];
  olderCount: number;
  defaultFilter?: JobRecoveryKind;
}

interface JobRecoveryUiState {
  busy: string | null;
  dismissedKeys: Set<string>;
  filter: JobRecoveryKind | 'all';
  retrySnapshots: RetryStates;
}

type JobRecoveryUiAction =
  | { type: 'busy'; busy: string | null }
  | { type: 'dismiss'; key: string }
  | { type: 'dismissMany'; keys: string[] }
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

export function JobRecoveryList({
  teamName,
  items,
  olderCount,
  defaultFilter,
}: JobRecoveryListProps) {
  const router = useRouter();
  const dialog = useAppDialog();
  const finishedJobs = useFinishedJobsInfiniteQuery();
  const [{ busy, dismissedKeys, filter, retrySnapshots }, dispatchUi] = useReducer(
    jobRecoveryUiReducer,
    initialJobRecoveryUiState,
    (initial): JobRecoveryUiState => ({ ...initial, filter: defaultFilter ?? 'all' }),
  );
  const refreshedRetrySnapshots = useRef<Set<string> | null>(null);
  const olderCountSeenRef = useRef(olderCount);
  const [olderDismissed, setOlderDismissed] = useState(0);
  const [listWindow, setListWindow] = useState(JOB_RECOVERY_LIST_WINDOW_SIZE);
  const listWindowKey = `${filter}:${String(items.length)}`;
  const listWindowKeyRef = useRef(listWindowKey);
  if (olderCountSeenRef.current !== olderCount) {
    olderCountSeenRef.current = olderCount;
    setOlderDismissed(0);
  }
  if (listWindowKeyRef.current !== listWindowKey) {
    listWindowKeyRef.current = listWindowKey;
    setListWindow(JOB_RECOVERY_LIST_WINDOW_SIZE);
  }
  const pendingOlderCount = Math.max(0, olderCount - olderDismissed);

  function reportOlderCount(count: number) {
    setOlderDismissed(Math.max(0, olderCount - count));
  }

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

  const presentKinds = useMemo(
    () => [...new Set(visibleItems.map((item) => item.kind))],
    [visibleItems],
  );
  const filterOptions = useMemo(
    () => FILTERS.filter((option) => option.kind === 'all' || presentKinds.includes(option.kind)),
    [presentKinds],
  );
  const showKindFilters = presentKinds.length > 1 || filter !== 'all';
  const filtered = useMemo(
    () => (filter === 'all' ? visibleItems : visibleItems.filter((item) => item.kind === filter)),
    [filter, visibleItems],
  );
  const failedItems = filtered.filter((item) => item.status === 'failed');
  const failedCount = failedItems.length;
  const hasQueuedFailedRetry = failedItems.some(
    (item) => retryStates[item.id]?.status === 'queued',
  );
  const shownItems = filtered.slice(0, listWindow);

  async function call(action: 'retry' | 'dismiss', id: string) {
    const retryStartedAt = Date.now();
    dispatchUi({ type: 'busy', busy: `${action}:${id}` });
    try {
      await jobsMutationToast(
        async () => {
          await postJson(`/api/team/job-recovery/${encodeURIComponent(id)}/${action}`);
        },
        {
          loading: action === 'retry' ? 'Retrying…' : 'Dismissing…',
          success: action === 'retry' ? 'Retry queued.' : 'Dismissed.',
        },
      );
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
    } catch {
      // Toast already shows the failure.
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
      description: `Dismiss ${String(filtered.length)} ${kindLabel}${jobWord} from the last ${String(JOBS_ATTENTION_DAYS)} days? They leave this list. Timeline can still retry them in the background.`,
      confirmLabel: 'Dismiss all',
      destructive: true,
    });
    if (!confirmed) return;
    await dismissMatching('recent', 'dismiss-visible');
  }

  async function dismissOlder() {
    if (pendingOlderCount === 0) return;
    const confirmed = await dialog.confirm({
      title: 'Dismiss older jobs?',
      description: `Dismiss ${String(pendingOlderCount)} jobs older than ${String(JOBS_ATTENTION_DAYS)} days? Timeline will stop asking you to recover them. Background workers may still retry a few times, then give up.`,
      confirmLabel: 'Dismiss older jobs',
      destructive: true,
    });
    if (!confirmed) return;
    await dismissMatching('older', 'dismiss-older');
  }

  async function dismissMatching(window: 'recent' | 'older', busyKey: string) {
    dispatchUi({ type: 'busy', busy: busyKey });
    const startOlder = pendingOlderCount;
    const recentKeys = filtered.map((item) => itemSnapshotKey(item));
    try {
      await jobsMutationToast(
        async (update) => {
          let dismissedTotal = 0;
          let remainingOlder = startOlder;
          for (let round = 0; round < DISMISS_MATCHING_CLIENT_MAX_ROUNDS; round += 1) {
            // Sequential on purpose: each write needs the previous remaining count.
            // react-doctor-disable-next-line react-doctor/async-await-in-loop
            const result = await postJson<DismissMatchingResponse>(
              '/api/team/job-recovery/dismiss-matching',
              {
                window,
                ...(window === 'older' || filter === 'all' ? {} : { kind: filter }),
              },
            );
            const dismissed = result.dismissed ?? 0;
            dismissedTotal += dismissed;
            if (window === 'recent') {
              dispatchUi({ type: 'dismissMany', keys: recentKeys });
            } else {
              remainingOlder =
                (result.remaining ?? 0) === 0 ? 0 : Math.max(0, remainingOlder - dismissed);
              reportOlderCount(remainingOlder);
              if (remainingOlder > 0) {
                update(
                  `Dismissed ${dismissedTotal.toLocaleString()} of ${startOlder.toLocaleString()} older jobs…`,
                );
              }
            }
            if (dismissed === 0 || (result.remaining ?? 0) === 0) {
              return { dismissedTotal, remainingOlder };
            }
          }
          return { dismissedTotal, remainingOlder };
        },
        {
          loading:
            window === 'older'
              ? `Dismissing ${startOlder.toLocaleString()} older jobs…`
              : 'Dismissing jobs…',
          success: (result) => {
            if (window === 'older') {
              const jobWord = result.dismissedTotal === 1 ? 'job' : 'jobs';
              if (result.remainingOlder > 0) {
                return `Dismissed ${result.dismissedTotal.toLocaleString()} older ${jobWord}. ${result.remainingOlder.toLocaleString()} still hidden — dismiss again to continue.`;
              }
              return `Dismissed ${result.dismissedTotal.toLocaleString()} older ${jobWord}.`;
            }
            const count = recentKeys.length;
            return `Dismissed ${count.toLocaleString()} ${count === 1 ? 'job' : 'jobs'}.`;
          },
          tone: (result) =>
            window === 'older' && result.remainingOlder > 0 ? 'warning' : 'success',
        },
      );
      router.refresh();
    } catch {
      // Toast already shows the failure.
    } finally {
      dispatchUi({ type: 'busy', busy: null });
    }
  }

  async function retryFailed() {
    if (failedCount === 0) return;
    const retryStartedAt = Date.now();
    dispatchUi({ type: 'busy', busy: 'retry-failed' });
    try {
      const body = await jobsMutationToast(
        async () =>
          postJson<RetryFailedResponse>('/api/team/job-recovery/retry-failed', {
            ...(filter === 'all' ? {} : { kind: filter }),
            items: failedItems.map((item) => ({
              id: item.id,
              detectedAt: new Date(item.detectedAt).toISOString(),
            })),
            expectedCount: failedCount,
          }),
        {
          loading: `Retrying ${String(failedCount)} failed jobs…`,
          success: (result) => {
            const failed = result.failed ?? result.failedIds?.length ?? 0;
            const retried = result.retried ?? failedCount - failed;
            if (failed > 0) {
              return `Retried ${String(retried)} failed jobs; ${String(failed)} could not be queued.`;
            }
            return `Retry queued for ${String(retried)} failed jobs.`;
          },
          tone: (result) =>
            (result.failed ?? result.failedIds?.length ?? 0) > 0 ? 'warning' : 'success',
        },
      );
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
      void finishedJobs.refetch();
      router.refresh();
    } catch {
      // Toast already shows the failure.
    } finally {
      dispatchUi({ type: 'busy', busy: null });
    }
  }

  return (
    <div className="space-y-8">
      <JobsPageHeader
        teamName={teamName}
        itemCount={visibleItems.length}
        olderCount={pendingOlderCount}
      />
      <section className="space-y-6" aria-busy={busy !== null}>
        {pendingOlderCount > 0 ? (
          <div className="flex flex-col gap-3 rounded-sm border border-border bg-surface px-3 py-3 md:flex-row md:items-center md:justify-between">
            <div className="space-y-1">
              <p className="text-sm font-medium text-fg">
                <span className="font-mono tabular-nums">{pendingOlderCount.toLocaleString()}</span>{' '}
                older jobs are hidden
              </p>
              <p className="text-xs text-fg-muted">
                These are more than {String(JOBS_ATTENTION_DAYS)} days old. Workers retry them a few
                times, then stop. Dismiss them if you do not want them recovered.
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

        <JobRecoveryToolbar
          busy={busy}
          failedCount={failedCount}
          filter={filter}
          filters={showKindFilters ? filterOptions : []}
          hasQueuedFailedRetry={hasQueuedFailedRetry}
          visibleCount={filtered.length}
          onDismissVisible={dismissVisible}
          onRetryFailed={retryFailed}
          onSetFilter={(nextFilter) => {
            dispatchUi({ type: 'filter', filter: nextFilter });
          }}
        />

        <JobRecoveryItems
          busy={busy}
          items={filtered}
          onAction={call}
          retryStates={retryStates}
          shownItems={shownItems}
        />
        <InfiniteScroll
          hasMore={filtered.length > shownItems.length}
          disabled={busy !== null}
          onLoadMore={() => {
            setListWindow((current) => current + JOB_RECOVERY_LIST_WINDOW_SIZE);
          }}
          boundLabel="No more jobs from the last 7 days"
          hideBound
        />
        <AdvancedJobTools
          finishedItems={finishedArchiveItems}
          finishedQuery={finishedJobs}
          onQueued={() => {
            router.refresh();
          }}
        />
        {dialog.node}
      </section>
    </div>
  );
}

function JobRecoveryToolbar({
  busy,
  failedCount,
  filter,
  filters,
  hasQueuedFailedRetry,
  visibleCount,
  onDismissVisible,
  onRetryFailed,
  onSetFilter,
}: {
  busy: string | null;
  failedCount: number;
  filter: JobRecoveryKind | 'all';
  filters: { kind: JobRecoveryKind | 'all'; label: string }[];
  hasQueuedFailedRetry: boolean;
  visibleCount: number;
  onDismissVisible: () => Promise<void>;
  onRetryFailed: () => Promise<void>;
  onSetFilter: (filter: JobRecoveryKind | 'all') => void;
}) {
  return (
    <div className="flex flex-col gap-2 border-y border-border py-2 md:flex-row md:items-center md:justify-between">
      {filters.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {filters.map((f) => {
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
      ) : (
        <p className="text-xs text-fg-muted">Failed and stuck jobs from the last 7 days.</p>
      )}
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
          {busy === 'dismiss-visible' ? (
            <LoaderCircle aria-hidden="true" className="mr-1 size-3.5 animate-spin" />
          ) : (
            <X aria-hidden="true" className="mr-1 size-3.5" />
          )}
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
  shownItems,
}: {
  busy: string | null;
  items: JobRecoveryItem[];
  onAction: (action: 'retry' | 'dismiss', id: string) => Promise<void>;
  retryStates: RetryStates;
  shownItems: JobRecoveryItem[];
}) {
  const failedItems = items.filter((item) => item.status === 'failed');
  const stuckItems = items.filter((item) => item.status !== 'failed');
  const shownFailed = shownItems.filter((item) => item.status === 'failed');
  const shownStuck = shownItems.filter((item) => item.status !== 'failed');

  if (items.length === 0) {
    return (
      <p className="px-1 py-4 text-sm text-fg-muted">
        Nothing needs attention from the last {String(JOBS_ATTENTION_DAYS)} days.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {failedItems.length > 0 && shownFailed.length > 0 ? (
        <CollectionGroup title="Failed" count={failedItems.length} tone="danger">
          <JobRecoveryRows
            busy={busy}
            items={shownFailed}
            onAction={onAction}
            retryStates={retryStates}
          />
        </CollectionGroup>
      ) : null}
      {stuckItems.length > 0 && shownStuck.length > 0 ? (
        <CollectionGroup title="Stuck" count={stuckItems.length} tone="progress">
          <JobRecoveryRows
            busy={busy}
            items={shownStuck}
            onAction={onAction}
            retryStates={retryStates}
          />
        </CollectionGroup>
      ) : null}
    </div>
  );
}

function unsubscribeClientRender(): void {
  return undefined;
}

function subscribeClientRender(): () => void {
  return unsubscribeClientRender;
}

function clientRenderSnapshot(): boolean {
  return true;
}

function serverRenderSnapshot(): boolean {
  return false;
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
  const timezone = useWorkspaceTimezone();
  const isClient = useSyncExternalStore(
    subscribeClientRender,
    clientRenderSnapshot,
    serverRenderSnapshot,
  );
  return (
    <ul>
      {items.map((item) => {
        const retry = retryStates[item.id];
        const hint = jobRecoveryRowHint(item, timezone);
        const iso = isoTimestamp(item.detectedAt);
        const relative = isClient && iso ? formatRelativeAge(iso) : '\u00a0';
        return (
          <li key={item.id}>
            <CollectionRow
              leading={
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
              }
              title={item.label}
              titleHint={hint}
              context={relative}
              contextTitle={isClient ? hint : undefined}
              metadata={retry ? <RetryStatus snapshot={retry} /> : null}
              actions={
                <JobRecoveryItemActions busy={busy} item={item} onAction={onAction} retry={retry} />
              }
            />
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
      <ItemOverflowMenu targetLabel={item.label}>
        {item.retryable ? (
          <DropdownMenuItem
            disabled={busy !== null || retry?.status === 'queued'}
            onSelect={() => {
              void onAction('retry', item.id);
            }}
          >
            Retry
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem
          disabled={busy !== null}
          className="text-destructive focus:text-destructive"
          onSelect={() => {
            void onAction('dismiss', item.id);
          }}
        >
          Dismiss
        </DropdownMenuItem>
      </ItemOverflowMenu>
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
    try {
      const body = await jobsMutationToast(
        async () =>
          postJson<{
            enqueued?: number;
            scanned?: number;
            truncated?: boolean;
          }>('/api/team/job-recovery/resuggest', { windowDays, source: 'all' }),
        {
          loading: 'Queueing conversation suggestions…',
          success: (result) =>
            `Queued ${String(result.enqueued ?? 0)} conversation reviews from ${String(result.scanned ?? 0)} events${
              result.truncated ? ' (conversation limit reached)' : ''
            }.`,
        },
      );
      setStatus(
        `Queued ${String(body.enqueued ?? 0)} conversation reviews from ${String(body.scanned ?? 0)} events${
          body.truncated ? ' (conversation limit reached)' : ''
        }.`,
      );
      onQueued();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Queue suggestions failed.');
    } finally {
      setQueueing(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-sm border border-border bg-surface p-3 md:flex-row md:items-center md:justify-between">
      <div className="space-y-1">
        <h2 className="text-sm font-medium">Conversation suggestions</h2>
        <p className="text-xs text-fg-muted">
          Re-queue reviews if suggestions did not appear. Leave this unless support asks.
        </p>
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
      <span className="flex items-center gap-1 text-xs text-fg-muted">
        <CheckCircle2 aria-hidden="true" className="size-3.5" />
        Retry completed
      </span>
    );
  }
  if (snapshot.status === 'failed') {
    return (
      <span className="flex items-center gap-1 text-xs text-destructive">
        <CircleAlert aria-hidden="true" className="size-3.5" />
        Retry failed
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 text-xs text-fg-muted">
      <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />
      Retry queued.
    </span>
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
      <InfiniteScroll
        hasMore={query.hasNextPage}
        loading={query.isFetchingNextPage}
        error={query.isFetchNextPageError ? 'Could not load more jobs.' : null}
        onLoadMore={() => {
          void query.fetchNextPage();
        }}
        boundLabel="No more matching jobs"
        hideBound={items.length === 0}
      />
    </section>
  );
}

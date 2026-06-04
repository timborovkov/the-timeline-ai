'use client';

import { CheckCircle2, CircleAlert, LoaderCircle, RotateCcw, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

import type * as jobRecovery from '@timeline/shared/job-recovery';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  type FinishedJobArchivePage,
  useFinishedJobsInfiniteQuery,
} from '@/lib/use-paginated-queries';
import { cn } from '@/lib/utils';

type JobRecoveryItem = jobRecovery.JobRecoveryItem;
type JobRecoveryKind = jobRecovery.JobRecoveryKind;

interface RetrySnapshot {
  startedAt: number;
  status: 'queued' | 'completed' | 'failed';
  error: string | null;
}

const FILTERS: { kind: JobRecoveryKind | 'all'; label: string }[] = [
  { kind: 'all', label: 'All' },
  { kind: 'transcription', label: 'Transcription' },
  { kind: 'extraction', label: 'Extraction' },
  { kind: 'embedding', label: 'Embedding' },
  { kind: 'document_processing', label: 'Documents' },
  { kind: 'meeting_finalization', label: 'Meetings' },
  { kind: 'integration_sync', label: 'Integrations' },
];

export function JobRecoveryList({ items }: { items: JobRecoveryItem[] }) {
  const router = useRouter();
  const finishedJobs = useFinishedJobsInfiniteQuery();
  const [filter, setFilter] = useState<JobRecoveryKind | 'all'>('all');
  const [busy, setBusy] = useState<string | null>(null);
  const [dismissedKeys, setDismissedKeys] = useState<Set<string>>(() => new Set());
  const [retrySnapshots, setRetrySnapshots] = useState<Record<string, RetrySnapshot>>({});

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
      const key = archiveIdentityKey(item.kind, item.artifactKind, item.artifactId);
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
        finishedByIdentity.get(archiveIdentityKey(item.kind, item.artifactKind, item.artifactId)) ??
        [];
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

  const filtered = useMemo(
    () => (filter === 'all' ? visibleItems : visibleItems.filter((item) => item.kind === filter)),
    [filter, visibleItems],
  );
  const failedItems = filtered.filter((item) => item.status === 'failed');
  const failedCount = failedItems.length;

  async function call(action: 'retry' | 'dismiss', id: string) {
    const retryStartedAt = Date.now();
    setBusy(`${action}:${id}`);
    try {
      const res = await fetch(`/api/team/job-recovery/${encodeURIComponent(id)}/${action}`, {
        method: 'POST',
      });
      if (!res.ok) {
        const text = await res.text();
        alert(`${action === 'retry' ? 'Retry' : 'Dismiss'} failed: ${text}`);
        return;
      }
      if (action === 'retry') {
        setRetrySnapshots((previous) => ({
          ...previous,
          [id]: { startedAt: retryStartedAt, status: 'queued', error: null },
        }));
        void finishedJobs.refetch();
      } else {
        const dismissed = items.find((item) => item.id === id);
        if (dismissed) {
          setDismissedKeys((previous) => new Set(previous).add(itemSnapshotKey(dismissed)));
        }
        router.refresh();
      }
    } finally {
      setBusy(null);
    }
  }

  async function dismissFailed() {
    if (failedCount === 0) return;
    const scopeLabel = filter === 'all' ? 'all failed jobs' : `failed ${filter.replace(/_/g, ' ')}`;
    const ok = window.confirm(`Dismiss ${String(failedCount)} ${scopeLabel}?`);
    if (!ok) return;
    setBusy('dismiss-failed');
    try {
      const res = await fetch('/api/team/job-recovery/dismiss-failed', {
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
        alert(`Dismiss failed jobs failed: ${text}`);
        return;
      }
      setDismissedKeys((previous) => {
        const next = new Set(previous);
        for (const item of failedItems) next.add(itemSnapshotKey(item));
        return next;
      });
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-col gap-2 border-y border-border py-2 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => {
            const active = filter === f.kind;
            return (
              <button
                key={f.kind}
                type="button"
                onClick={() => {
                  setFilter(f.kind);
                }}
                className={cn(
                  'rounded-sm border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] transition-colors',
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
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={busy !== null || failedCount === 0}
          onClick={() => {
            void dismissFailed();
          }}
          className="self-start md:self-auto"
        >
          <X aria-hidden="true" className="mr-1 size-3.5" />
          {busy === 'dismiss-failed'
            ? 'Dismissing failed'
            : `Dismiss failed${failedCount > 0 ? ` (${String(failedCount)})` : ''}`}
        </Button>
      </div>

      <ul className="divide-y divide-border rounded-sm border border-border bg-surface">
        {filtered.length === 0 ? (
          <li className="px-3 py-4 text-sm text-fg-muted">No jobs need attention in this view.</li>
        ) : (
          filtered.map((item) => {
            const retry = retryStates[item.id];
            return (
              <li key={item.id} className="flex flex-col gap-3 p-3 md:flex-row md:items-center">
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={item.status === 'failed' ? 'destructive' : 'outline'}>
                      {retry?.status === 'queued' ? 'retrying' : item.status}
                    </Badge>
                    <span className="truncate text-sm font-medium">{item.label}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-muted">
                    <span>{new Date(item.detectedAt).toLocaleString()}</span>
                    {item.error ? (
                      <span className="max-w-full truncate text-destructive md:max-w-lg">
                        {item.error}
                      </span>
                    ) : null}
                  </div>
                  {retry ? <RetryStatus snapshot={retry} /> : null}
                </div>
                <div className="flex shrink-0 gap-2">
                  {item.retryable ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy !== null || retry?.status === 'queued'}
                      onClick={() => {
                        void call('retry', item.id);
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
                      void call('dismiss', item.id);
                    }}
                  >
                    <X aria-hidden="true" className="mr-1 size-3.5" />
                    {busy === `dismiss:${item.id}` ? 'Dismissing' : 'Dismiss'}
                  </Button>
                </div>
              </li>
            );
          })
        )}
      </ul>
      <FinishedJobsArchive items={finishedArchiveItems} query={finishedJobs} />
    </section>
  );
}

function archiveIdentityKey(kind: string, artifactKind: string, artifactId: string) {
  return `${kind}:${artifactKind}:${artifactId}`;
}

function itemSnapshotKey(item: Pick<JobRecoveryItem, 'detectedAt' | 'id'>) {
  return `${item.id}:${new Date(item.detectedAt).toISOString()}`;
}

function RetryStatus({ snapshot }: { snapshot: RetrySnapshot }) {
  if (snapshot.status === 'completed') {
    return (
      <p className="flex items-center gap-1 text-xs text-signal">
        <CheckCircle2 aria-hidden="true" className="size-3.5" />
        Retry finished successfully.
      </p>
    );
  }
  if (snapshot.status === 'failed') {
    return (
      <p className="flex items-center gap-1 text-xs text-destructive">
        <CircleAlert aria-hidden="true" className="size-3.5" />
        Retry failed{snapshot.error ? `: ${snapshot.error}` : '.'}
      </p>
    );
  }
  return (
    <p className="flex items-center gap-1 text-xs text-fg-muted">
      <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />
      Retry queued. Watching finished jobs below.
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
        <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-fg-muted">
          Finished jobs
        </h2>
      </div>
      <div className="overflow-x-auto rounded-sm border border-border bg-surface">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="border-b border-border font-mono text-[10px] uppercase tracking-[0.14em] text-fg-dim">
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
                    <div className="font-mono text-[11px] text-fg-dim">{item.artifactId}</div>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-fg-muted">{item.queue}</td>
                  <td className="px-3 py-2 text-fg-muted">{item.attemptsMade}</td>
                  <td className="px-3 py-2 text-fg-muted">
                    {new Date(item.finishedAt).toLocaleString()}
                  </td>
                  <td className="max-w-xs truncate px-3 py-2 text-destructive">
                    {item.error ?? ''}
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

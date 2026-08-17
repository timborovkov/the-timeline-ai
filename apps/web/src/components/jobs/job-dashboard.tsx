'use client';

import { AlertTriangle, RefreshCw, RotateCw } from 'lucide-react';

import { TechnicalDetails } from '@/components/technical-details';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useJobDashboardQuery } from '@/lib/use-paginated-queries';

export function JobDashboard() {
  const query = useJobDashboardQuery();
  const retryDashboard = () => {
    void query.refetch();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {query.data ? (
          <p role="status" className="text-xs text-fg-dim">
            Unprocessed backlog, not the recovery queue. Updated{' '}
            <time dateTime={query.data.updatedAt} className="font-mono tabular-nums">
              {new Date(query.data.updatedAt).toLocaleTimeString()}
            </time>
          </p>
        ) : (
          <p className="text-xs text-fg-dim">Unprocessed backlog</p>
        )}
        <Button
          type="button"
          variant="ghost"
          onClick={retryDashboard}
          disabled={query.isFetching}
          aria-label="Refresh job dashboard"
        >
          <RefreshCw aria-hidden="true" className="size-4" />
          {query.isFetching ? 'Refreshing…' : 'Refresh'}
        </Button>
      </div>
      {query.isError ? (
        <JobDashboardFailure
          error={query.error}
          onRetry={retryDashboard}
          retrying={query.isFetching}
        />
      ) : null}
      {query.isPending ? <JobDashboardLoading /> : null}
      {query.data ? <JobDashboardSummaries summaries={query.data.summaries} /> : null}
    </div>
  );
}

function JobDashboardFailure({
  error,
  onRetry,
  retrying,
}: {
  error: Error;
  onRetry: () => void;
  retrying: boolean;
}) {
  const errorDetail = error.message || 'No error message was returned.';

  return (
    <div role="alert" className="rounded-lg border border-danger/40 bg-danger/10 p-4">
      <div className="flex items-start gap-3">
        <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-danger" />
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-medium text-fg">Unable to load the jobs dashboard</p>
          <p className="text-sm text-fg-muted">Check your connection and try again.</p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button type="button" onClick={onRetry} disabled={retrying}>
          <RotateCw aria-hidden="true" className="size-4" />
          {retrying ? 'Retrying dashboard…' : 'Retry dashboard'}
        </Button>
      </div>
      <TechnicalDetails
        className="mt-4 border-danger/30"
        items={[{ label: 'Dashboard request error', value: errorDetail, copyValue: errorDetail }]}
      />
    </div>
  );
}

function JobDashboardLoading() {
  return (
    <ul
      aria-busy="true"
      aria-label="Loading job dashboard"
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
    >
      {Array.from({ length: 6 }, (_, index) => (
        <li
          key={index}
          aria-hidden="true"
          className="rounded-lg border border-border bg-surface p-4"
        >
          <Skeleton className="h-3 w-28 motion-reduce:animate-none" />
          <Skeleton className="mt-3 h-8 w-12 motion-reduce:animate-none" />
          <Skeleton className="mt-2 h-3 w-32 motion-reduce:animate-none" />
        </li>
      ))}
    </ul>
  );
}

function JobDashboardSummaries({
  summaries,
}: {
  summaries: { kind: string; label: string; needsAttention: number }[];
}) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {summaries.map((summary) => (
        <li key={summary.kind} className="rounded-lg border border-border bg-surface p-4">
          <p className="text-sm font-medium text-fg">{summary.label}</p>
          <p className="mt-3 font-mono text-2xl font-semibold tabular-nums text-fg">
            {summary.needsAttention}
          </p>
          <p className="mt-1 text-xs text-fg-muted">
            {summary.needsAttention === 1 ? 'unprocessed event' : 'unprocessed events'}
          </p>
        </li>
      ))}
    </ul>
  );
}

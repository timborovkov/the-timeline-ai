'use client';

import { AlertTriangle, RefreshCw, RotateCw } from 'lucide-react';

import { CountList } from '@/components/collections/count-list';
import { SectionHeading } from '@/components/section-heading';
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
    <section className="space-y-3">
      <SectionHeading
        actions={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={retryDashboard}
            disabled={query.isFetching}
            aria-label="Refresh job dashboard"
          >
            <RefreshCw aria-hidden="true" className="size-4" />
            {query.isFetching ? 'Refreshing…' : 'Refresh'}
          </Button>
        }
      >
        Unprocessed backlog
      </SectionHeading>
      <p className="text-xs text-fg-muted">
        Events still waiting for extraction or embedding. They are not the recovery queue on this
        page. Workers keep retrying them automatically.
      </p>
      {query.data ? (
        <p role="status" className="text-xs text-fg-dim">
          Updated{' '}
          <time dateTime={query.data.updatedAt} className="font-mono tabular-nums">
            {new Date(query.data.updatedAt).toLocaleTimeString()}
          </time>
        </p>
      ) : null}
      {query.isError ? (
        <JobDashboardFailure
          error={query.error}
          onRetry={retryDashboard}
          retrying={query.isFetching}
        />
      ) : null}
      {query.isPending ? <JobDashboardLoading /> : null}
      {query.data ? <JobDashboardSummaries summaries={query.data.summaries} /> : null}
    </section>
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
    <div role="alert" className="rounded-sm border border-danger/40 bg-danger/10 p-4">
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
    <ul aria-busy="true" aria-label="Loading job dashboard" className="border-y border-border">
      {Array.from({ length: 6 }, (_, index) => (
        <li
          key={index}
          aria-hidden="true"
          className="flex min-h-11 items-center justify-between px-3"
        >
          <Skeleton className="h-4 w-32 motion-reduce:animate-none" />
          <Skeleton className="h-4 w-8 motion-reduce:animate-none" />
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
    <CountList
      items={summaries.map((summary) => ({
        danger: summary.needsAttention > 0,
        hint: `${summary.label} · ${String(summary.needsAttention)} unprocessed ${summary.needsAttention === 1 ? 'event' : 'events'}`,
        key: summary.kind,
        label: summary.label,
        value: summary.needsAttention,
      }))}
    />
  );
}

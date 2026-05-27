'use client';

import { RefreshCw } from 'lucide-react';

import { useJobDashboardQuery } from '@/lib/use-paginated-queries';

export function JobDashboard() {
  const query = useJobDashboardQuery();
  if (query.isPending) return <p className="text-sm text-muted-foreground">Loading...</p>;
  if (query.isError) return <p className="text-sm text-destructive">{query.error.message}</p>;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-dim">
          Updated {new Date(query.data.updatedAt).toLocaleTimeString()}
        </p>
        <button
          type="button"
          onClick={() => {
            void query.refetch();
          }}
          className="grid size-8 place-items-center rounded-sm text-fg-muted hover:bg-surface"
          aria-label="Refresh job dashboard"
        >
          <RefreshCw className="size-4" />
        </button>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {query.data.summaries.map((summary) => (
          <li key={summary.kind} className="rounded-sm border border-border bg-surface px-4 py-3">
            <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-dim">
              {summary.label}
            </div>
            <div className="mt-2 text-2xl font-semibold">{summary.needsAttention}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}

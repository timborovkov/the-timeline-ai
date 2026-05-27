'use client';

import { RotateCcw, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

import type { jobRecovery } from '@timeline/shared';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type JobRecoveryItem = jobRecovery.JobRecoveryItem;
type JobRecoveryKind = jobRecovery.JobRecoveryKind;

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
  const [filter, setFilter] = useState<JobRecoveryKind | 'all'>('all');
  const [busy, setBusy] = useState<string | null>(null);

  const filtered = useMemo(
    () => (filter === 'all' ? items : items.filter((item) => item.kind === filter)),
    [filter, items],
  );
  const failedItems = filtered.filter((item) => item.status === 'failed');
  const failedCount = failedItems.length;

  async function call(action: 'retry' | 'dismiss', id: string) {
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
      router.refresh();
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
          <li className="px-3 py-4 text-sm text-fg-muted">No recoverable jobs in this view.</li>
        ) : (
          filtered.map((item) => (
            <li key={item.id} className="flex flex-col gap-3 px-3 py-3 md:flex-row md:items-center">
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={item.status === 'failed' ? 'destructive' : 'outline'}>
                    {item.status}
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
              </div>
              <div className="flex shrink-0 gap-2">
                {item.retryable ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy !== null}
                    onClick={() => {
                      void call('retry', item.id);
                    }}
                  >
                    <RotateCcw aria-hidden="true" className="mr-1 size-3.5" />
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
          ))
        )}
      </ul>
    </section>
  );
}

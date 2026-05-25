'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { saveBoardAction } from '@/app/actions/boards';
import { OBJECT_TYPES } from '@/lib/object-types';

const KINDS = ['kanban', 'table', 'list'] as const;
const GROUP_BY_OPTIONS = ['status', 'stage', 'priority', 'type'] as const;

export function BoardCreateForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<(typeof KINDS)[number]>('kanban');
  const [filterType, setFilterType] = useState<string>('');
  const [groupBy, setGroupBy] = useState<(typeof GROUP_BY_OPTIONS)[number]>('status');

  function submit(): void {
    if (!name.trim()) return;
    setError(null);
    startTransition(async () => {
      const filter: Record<string, unknown> = { archived: false };
      if (filterType) filter.type = filterType;
      const result = await saveBoardAction({
        name: name.trim(),
        kind,
        filter,
        groupBy: kind === 'table' ? null : groupBy,
      });
      if ('error' in result && result.error) {
        setError(result.error);
        return;
      }
      if ('id' in result && result.id) router.push(`/app/boards/${result.id}`);
    });
  }

  return (
    <div className="rounded-xl border bg-card p-5">
      <h2 className="mb-4 text-sm font-medium tracking-tight">New board</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-[11px] uppercase tracking-wide text-muted-foreground">
            Name
          </span>
          <input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
            }}
            placeholder="e.g. Active deals"
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] uppercase tracking-wide text-muted-foreground">
            Layout
          </span>
          <select
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as (typeof KINDS)[number]);
            }}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          >
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] uppercase tracking-wide text-muted-foreground">
            Filter: type
          </span>
          <select
            value={filterType}
            onChange={(e) => {
              setFilterType(e.target.value);
            }}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          >
            <option value="">Any</option>
            {OBJECT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        {kind !== 'table' && (
          <label className="block">
            <span className="mb-1 block text-[11px] uppercase tracking-wide text-muted-foreground">
              Group by
            </span>
            <select
              value={groupBy}
              onChange={(e) => {
                setGroupBy(e.target.value as (typeof GROUP_BY_OPTIONS)[number]);
              }}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            >
              {GROUP_BY_OPTIONS.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
      <button
        type="button"
        onClick={submit}
        disabled={pending || !name.trim()}
        className="mt-4 rounded-md border border-primary/40 bg-primary/10 px-3 py-1.5 text-sm font-medium text-primary hover:bg-primary/20 disabled:opacity-50"
      >
        {pending ? 'Creating…' : 'Create board'}
      </button>
    </div>
  );
}

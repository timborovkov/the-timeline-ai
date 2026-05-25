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
    <div>
      <h2 className="mb-3 font-mono text-[11px] uppercase tracking-[0.14em] text-fg-dim">
        New board
      </h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block font-mono text-[11px] uppercase tracking-[0.12em] text-fg-dim">
            Name
          </span>
          <input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
            }}
            placeholder="e.g. Active deals"
            className="w-full rounded-sm border border-border bg-bg px-3 py-2 text-sm focus:border-border-strong focus:outline-none"
          />
        </label>
        <label className="block">
          <span className="mb-1 block font-mono text-[11px] uppercase tracking-[0.12em] text-fg-dim">
            Layout
          </span>
          <select
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as (typeof KINDS)[number]);
            }}
            className="w-full rounded-sm border border-border bg-bg px-3 py-2 text-sm focus:border-border-strong focus:outline-none"
          >
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block font-mono text-[11px] uppercase tracking-[0.12em] text-fg-dim">
            Filter: type
          </span>
          <select
            value={filterType}
            onChange={(e) => {
              setFilterType(e.target.value);
            }}
            className="w-full rounded-sm border border-border bg-bg px-3 py-2 text-sm focus:border-border-strong focus:outline-none"
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
            <span className="mb-1 block font-mono text-[11px] uppercase tracking-[0.12em] text-fg-dim">
              Group by
            </span>
            <select
              value={groupBy}
              onChange={(e) => {
                setGroupBy(e.target.value as (typeof GROUP_BY_OPTIONS)[number]);
              }}
              className="w-full rounded-sm border border-border bg-bg px-3 py-2 text-sm focus:border-border-strong focus:outline-none"
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
      {error && (
        <p role="alert" className="mt-3 font-mono text-[11px] uppercase tracking-[0.12em] text-danger">
          {error}
        </p>
      )}
      <button
        type="button"
        onClick={submit}
        disabled={pending || !name.trim()}
        className="mt-4 rounded-sm bg-signal px-3 py-1.5 text-sm font-medium text-signal-fg hover:opacity-90 disabled:opacity-40"
      >
        {pending ? 'Creating…' : 'Create board'}
      </button>
    </div>
  );
}

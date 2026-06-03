'use client';

import { useRouter } from 'next/navigation';
import { useReducer, useTransition } from 'react';

import { saveBoardAction } from '@/app/actions/boards';
import { OBJECT_TYPES } from '@/lib/object-types';

const KINDS = ['kanban', 'table', 'list'] as const;
const GROUP_BY_OPTIONS = ['status', 'stage', 'priority', 'type'] as const;
type BoardKind = (typeof KINDS)[number];
type BoardGroupBy = (typeof GROUP_BY_OPTIONS)[number];
interface BoardFormState {
  error: string | null;
  name: string;
  kind: BoardKind;
  filterType: string;
  groupBy: BoardGroupBy;
}
type BoardFormAction =
  | { type: 'error'; error: string | null }
  | { type: 'name'; name: string }
  | { type: 'kind'; kind: BoardKind }
  | { type: 'filterType'; filterType: string }
  | { type: 'groupBy'; groupBy: BoardGroupBy };

function boardFormReducer(state: BoardFormState, action: BoardFormAction): BoardFormState {
  switch (action.type) {
    case 'error':
      return { ...state, error: action.error };
    case 'name':
      return { ...state, name: action.name };
    case 'kind':
      return { ...state, kind: action.kind };
    case 'filterType':
      return { ...state, filterType: action.filterType };
    case 'groupBy':
      return { ...state, groupBy: action.groupBy };
  }
}

export function BoardCreateForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [{ error, name, kind, filterType, groupBy }, dispatch] = useReducer(boardFormReducer, {
    error: null,
    name: '',
    kind: 'kanban',
    filterType: '',
    groupBy: 'status',
  });

  function submit(): void {
    if (!name.trim()) return;
    dispatch({ type: 'error', error: null });
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
        dispatch({ type: 'error', error: result.error });
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
              dispatch({ type: 'name', name: e.target.value });
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
              dispatch({ type: 'kind', kind: e.target.value as BoardKind });
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
              dispatch({ type: 'filterType', filterType: e.target.value });
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
                dispatch({ type: 'groupBy', groupBy: e.target.value as BoardGroupBy });
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
        <p
          role="alert"
          className="mt-3 font-mono text-[11px] uppercase tracking-[0.12em] text-danger"
        >
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

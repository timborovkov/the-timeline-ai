'use client';

import { Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo, useReducer, useTransition } from 'react';

import type * as objects from '@timeline/shared/objects';

import { addBoardItemAction, quickCreateBoardItemAction } from '@/app/actions/boards';
import { OBJECT_TYPES } from '@/lib/object-types';

interface Props {
  boardId: string;
  defaultLaneId: string | null;
  candidates: objects.ObjectRow[];
  recommendedTypes: objects.ObjectType[];
}

interface State {
  mode: 'existing' | 'new';
  query: string;
  entityId: string;
  type: objects.ObjectType;
  canonicalName: string;
  error: string | null;
}

type Action =
  | { type: 'mode'; mode: State['mode'] }
  | { type: 'query'; query: string }
  | { type: 'entityId'; entityId: string }
  | { type: 'objectType'; objectType: objects.ObjectType }
  | { type: 'canonicalName'; canonicalName: string }
  | { type: 'error'; error: string | null };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'mode':
      return { ...state, mode: action.mode, error: null };
    case 'query':
      return { ...state, query: action.query };
    case 'entityId':
      return { ...state, entityId: action.entityId };
    case 'objectType':
      return { ...state, type: action.objectType };
    case 'canonicalName':
      return { ...state, canonicalName: action.canonicalName };
    case 'error':
      return { ...state, error: action.error };
  }
}

export function BoardAddItemForm({ boardId, defaultLaneId, candidates, recommendedTypes }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [state, dispatch] = useReducer(reducer, {
    mode: 'existing',
    query: '',
    entityId: '',
    type: recommendedTypes[0] ?? 'task',
    canonicalName: '',
    error: null,
  });
  const visibleCandidates = useMemo(() => {
    const q = state.query.trim().toLowerCase();
    const typeRank = new Set(recommendedTypes);
    return candidates
      .filter((row) => {
        if (!q) return true;
        return `${row.canonicalName} ${row.type} ${row.aliases.join(' ')}`
          .toLowerCase()
          .includes(q);
      })
      .sort((a, b) => Number(typeRank.has(b.type)) - Number(typeRank.has(a.type)))
      .slice(0, 40);
  }, [candidates, recommendedTypes, state.query]);

  function submit(): void {
    dispatch({ type: 'error', error: null });
    startTransition(async () => {
      const result =
        state.mode === 'existing'
          ? await addBoardItemAction({
              boardId,
              entityId: state.entityId,
              laneId: defaultLaneId,
            })
          : await quickCreateBoardItemAction({
              boardId,
              type: state.type,
              canonicalName: state.canonicalName,
              laneId: defaultLaneId,
            });
      if ('error' in result && result.error) {
        dispatch({ type: 'error', error: result.error });
        return;
      }
      dispatch({ type: 'query', query: '' });
      dispatch({ type: 'entityId', entityId: '' });
      dispatch({ type: 'canonicalName', canonicalName: '' });
      router.refresh();
    });
  }

  const disabled =
    pending ||
    (state.mode === 'existing' ? !state.entityId : !state.canonicalName.trim() || !state.type);

  return (
    <div className="rounded-sm border border-border bg-surface p-3">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.14em] text-fg-dim">Add item</h2>
        <div className="inline-flex overflow-hidden rounded-sm border border-border">
          {(['existing', 'new'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => {
                dispatch({ type: 'mode', mode });
              }}
              className={`px-2 py-1 font-mono text-[10px] uppercase tracking-[0.1em] ${
                state.mode === mode ? 'bg-signal text-signal-fg' : 'bg-bg text-fg-muted'
              }`}
            >
              {mode}
            </button>
          ))}
        </div>
      </div>
      {state.mode === 'existing' ? (
        <div className="grid gap-2 sm:grid-cols-[1fr_1.3fr]">
          <input
            value={state.query}
            onChange={(e) => {
              dispatch({ type: 'query', query: e.target.value });
            }}
            placeholder="Search objects..."
            className="rounded-sm border border-border bg-bg px-3 py-2 text-sm focus:border-border-strong focus:outline-none"
          />
          <select
            value={state.entityId}
            onChange={(e) => {
              dispatch({ type: 'entityId', entityId: e.target.value });
            }}
            className="rounded-sm border border-border bg-bg px-3 py-2 text-sm focus:border-border-strong focus:outline-none"
          >
            <option value="">Select object</option>
            {visibleCandidates.map((row) => (
              <option key={row.id} value={row.id}>
                {row.canonicalName} · {row.type}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-[0.75fr_1.5fr]">
          <select
            value={state.type}
            onChange={(e) => {
              dispatch({ type: 'objectType', objectType: e.target.value as objects.ObjectType });
            }}
            className="rounded-sm border border-border bg-bg px-3 py-2 text-sm focus:border-border-strong focus:outline-none"
          >
            {OBJECT_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
          <input
            value={state.canonicalName}
            onChange={(e) => {
              dispatch({ type: 'canonicalName', canonicalName: e.target.value });
            }}
            placeholder="Object name"
            className="rounded-sm border border-border bg-bg px-3 py-2 text-sm focus:border-border-strong focus:outline-none"
          />
        </div>
      )}
      {state.error ? (
        <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.1em] text-danger">
          {state.error}
        </p>
      ) : null}
      <button
        type="button"
        onClick={submit}
        disabled={disabled}
        className="mt-3 inline-flex items-center gap-2 rounded-sm bg-signal px-3 py-1.5 text-sm font-medium text-signal-fg hover:opacity-90 disabled:opacity-40"
      >
        <Plus className="size-3.5" aria-hidden="true" />
        {pending ? 'Adding...' : 'Add to board'}
      </button>
    </div>
  );
}

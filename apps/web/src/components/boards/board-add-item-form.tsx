'use client';

import { Check, ChevronDown, Plus, Search, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useId, useMemo, useReducer, useState, useTransition } from 'react';

import type * as objects from '@timeline/shared/objects';

import { addBoardItemAction, quickCreateBoardItemAction } from '@/app/actions/boards';
import { filterObjectsByText } from '@/lib/object-filter';
import { OBJECT_TYPES } from '@/lib/object-types';
import { cn } from '@/lib/utils';

interface Props {
  boardId: string;
  defaultLaneId: string | null;
  candidates: objects.ObjectRow[];
  recommendedTypes: objects.ObjectType[];
}

interface State {
  mode: 'existing' | 'new';
  query: string;
  existingType: objects.ObjectType | 'all';
  entityId: string;
  type: objects.ObjectType;
  canonicalName: string;
  error: string | null;
}

type Action =
  | { type: 'mode'; mode: State['mode'] }
  | { type: 'query'; query: string }
  | { type: 'existingType'; existingType: State['existingType'] }
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
    case 'existingType':
      return { ...state, existingType: action.existingType, entityId: '' };
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
  const panelId = useId();
  const [pending, startTransition] = useTransition();
  const [expanded, setExpanded] = useState(false);
  const [state, dispatch] = useReducer(reducer, {
    mode: 'existing',
    query: '',
    existingType: 'all',
    entityId: '',
    type: recommendedTypes[0] ?? 'task',
    canonicalName: '',
    error: null,
  });
  const existingTypeOptions = useMemo(() => {
    const typeRank = new Set(recommendedTypes);
    return Array.from(new Set(candidates.map((row) => row.type))).sort(
      (a, b) =>
        Number(typeRank.has(b)) - Number(typeRank.has(a)) ||
        OBJECT_TYPES.indexOf(a) - OBJECT_TYPES.indexOf(b),
    );
  }, [candidates, recommendedTypes]);
  const selectableCandidates = useMemo(() => {
    const typeRank = new Set(recommendedTypes);
    const typedCandidates =
      state.existingType === 'all'
        ? candidates
        : candidates.filter((row) => row.type === state.existingType);
    return filterObjectsByText(typedCandidates, state.query)
      .slice()
      .sort((a, b) => Number(typeRank.has(b.type)) - Number(typeRank.has(a.type)));
  }, [candidates, recommendedTypes, state.existingType, state.query]);
  const selectedCandidate = candidates.find((row) => row.id === state.entityId) ?? null;

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
        setExpanded(true);
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
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.14em] text-fg-dim">Add item</h2>
        <button
          type="button"
          onClick={() => {
            setExpanded((current) => !current);
          }}
          disabled={pending}
          className="inline-flex size-8 items-center justify-center rounded-sm border border-border bg-bg text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
          aria-expanded={expanded}
          aria-controls={expanded ? panelId : undefined}
          aria-label={expanded ? 'Collapse add item' : 'Expand add item'}
          title={expanded ? 'Collapse add item' : 'Expand add item'}
        >
          <ChevronDown
            className={cn('size-4 transition-transform', expanded && 'rotate-180')}
            aria-hidden="true"
          />
        </button>
      </div>
      {expanded ? (
        <div id={panelId} className="mt-3 border-t border-border pt-3">
          <div className="mb-3 flex justify-end">
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
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <label className="relative min-w-0 flex-1 basis-full sm:basis-0">
                  <span className="sr-only">Search existing objects</span>
                  <Search
                    className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-fg-dim"
                    aria-hidden="true"
                  />
                  <input
                    type="search"
                    value={state.query}
                    onChange={(e) => {
                      dispatch({ type: 'query', query: e.target.value });
                    }}
                    placeholder="Search existing objects..."
                    className="h-9 w-full rounded-sm border border-border bg-bg py-2 pl-8 pr-8 text-sm focus:border-border-strong focus:outline-none"
                  />
                  {state.query.trim() ? (
                    <button
                      type="button"
                      onClick={() => {
                        dispatch({ type: 'query', query: '' });
                      }}
                      className="absolute right-1.5 top-1/2 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded-sm text-fg-dim transition-colors hover:bg-surface-2 hover:text-fg"
                      aria-label="Clear object search"
                    >
                      <X className="size-3.5" aria-hidden="true" />
                    </button>
                  ) : null}
                </label>
                <output
                  className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-dim"
                  aria-live="polite"
                >
                  {selectableCandidates.length} / {candidates.length}
                </output>
              </div>

              {existingTypeOptions.length > 1 ? (
                <div
                  className="flex flex-wrap gap-1.5 font-mono text-[10px] uppercase tracking-[0.12em]"
                  aria-label="Filter existing objects by type"
                >
                  {(['all', ...existingTypeOptions] as const).map((type) => {
                    const active = state.existingType === type;
                    return (
                      <button
                        key={type}
                        type="button"
                        onClick={() => {
                          dispatch({ type: 'existingType', existingType: type });
                        }}
                        className={cn(
                          'rounded-sm border px-2 py-1 transition-colors',
                          active
                            ? 'border-signal/40 bg-signal-soft text-signal'
                            : 'border-border text-fg-muted hover:bg-surface-2 hover:text-fg',
                        )}
                        aria-pressed={active}
                      >
                        {type}
                      </button>
                    );
                  })}
                </div>
              ) : null}

              <div className="max-h-56 overflow-y-auto rounded-sm border border-border bg-bg">
                {selectableCandidates.length > 0 ? (
                  <ul className="divide-y divide-border">
                    {selectableCandidates.map((row) => {
                      const selected = row.id === state.entityId;
                      return (
                        <li key={row.id}>
                          <button
                            type="button"
                            onClick={() => {
                              dispatch({ type: 'entityId', entityId: row.id });
                            }}
                            aria-pressed={selected}
                            className={cn(
                              'grid w-full grid-cols-[1fr_auto] items-center gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-surface-2 focus:bg-surface-2 focus:outline-none',
                              selected && 'bg-signal-soft',
                            )}
                          >
                            <span className="min-w-0">
                              <span className="block truncate font-medium text-fg">
                                {row.canonicalName}
                              </span>
                              <span className="block truncate font-mono text-[10px] uppercase tracking-[0.12em] text-fg-dim">
                                {row.type}
                                {row.aliases.length > 0
                                  ? ` · ${row.aliases.slice(0, 2).join(', ')}`
                                  : ''}
                              </span>
                            </span>
                            {selected ? (
                              <span className="inline-flex size-6 items-center justify-center rounded-sm bg-signal text-signal-fg">
                                <Check className="size-3.5" aria-hidden="true" />
                              </span>
                            ) : null}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="px-3 py-4 text-sm text-fg-muted">
                    No existing objects match this search.
                  </p>
                )}
              </div>

              {selectedCandidate ? (
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-dim">
                    Selected
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      dispatch({ type: 'entityId', entityId: '' });
                    }}
                    className="inline-flex items-center gap-2 rounded-sm border border-border bg-surface px-2 py-1 text-fg transition-colors hover:bg-surface-2"
                  >
                    <span>{selectedCandidate.canonicalName}</span>
                    <X className="size-3.5 text-fg-dim" aria-hidden="true" />
                  </button>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="grid gap-2 sm:grid-cols-[0.75fr_1.5fr]">
              <select
                value={state.type}
                onChange={(e) => {
                  dispatch({
                    type: 'objectType',
                    objectType: e.target.value as objects.ObjectType,
                  });
                }}
                className="rounded-sm border border-border bg-bg px-3 py-2 text-sm focus:border-border-strong focus:outline-none"
              >
                {OBJECT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
              <label className="sr-only" htmlFor="board-new-object-name">
                Object name
              </label>
              <input
                id="board-new-object-name"
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
      ) : null}
    </div>
  );
}

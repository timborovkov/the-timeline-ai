'use client';

import { Check, Plus, Search, X } from 'lucide-react';
import { useEffect, useId, useMemo, useReducer, useState, useTransition } from 'react';

import type * as boards from '@timeline/shared/boards';
import type * as objects from '@timeline/shared/objects/types';
import type { Dispatch } from 'react';

import { addBoardItemAction, quickCreateBoardItemAction } from '@/app/actions/boards';
import { searchAddableObjectsAction } from '@/app/actions/objects';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { boardAddItemTypeOptions } from '@/lib/board-add-item-candidates';
import { displayText } from '@/lib/display-dates';
import { displayObjectLabel, isInternalIdentifier } from '@/lib/display-labels';
import { notifyAction } from '@/lib/notify';
import { filterObjectsByText } from '@/lib/object-filter';
import { OBJECT_TYPES } from '@/lib/object-types';
import { cn } from '@/lib/utils';

interface Props {
  boardId: string;
  defaultLaneId: string | null;
  candidates: objects.ObjectRow[];
  recommendedTypes: objects.ObjectType[];
  onOptimisticItem?: (item: boards.BoardItemRow) => void;
  onItemAdded?: (item: boards.BoardItemRow, optimisticId: string) => void;
  onItemAddFailed?: (item: boards.BoardItemRow) => void;
}

interface State {
  mode: 'existing' | 'new';
  query: string;
  existingType: objects.ObjectType | 'all';
  selectedObject: objects.ObjectRow | null;
  type: objects.ObjectType;
  canonicalName: string;
}

type Action =
  | { type: 'mode'; mode: State['mode'] }
  | { type: 'query'; query: string }
  | { type: 'existingType'; existingType: State['existingType'] }
  | { type: 'selectExisting'; object: objects.ObjectRow | null }
  | { type: 'objectType'; objectType: objects.ObjectType }
  | { type: 'canonicalName'; canonicalName: string };

type RemoteSearchStatus = 'idle' | 'loading' | 'success' | 'error';

function uniqueCandidates(rows: objects.ObjectRow[]): objects.ObjectRow[] {
  const byId = new Map<string, objects.ObjectRow>();
  for (const row of rows) byId.set(row.id, row);
  return [...byId.values()];
}

function addableSearchKey(
  enabled: boolean,
  query: string,
  type: objects.ObjectType | 'all',
): string | null {
  const trimmed = query.trim();
  if (!enabled || (type === 'all' && trimmed.length === 0)) return null;
  return `${type}:${trimmed}`;
}

function useAddableObjectSearch({
  enabled,
  query,
  type,
}: {
  enabled: boolean;
  query: string;
  type: objects.ObjectType | 'all';
}): { results: objects.ObjectRow[]; status: RemoteSearchStatus; retry: () => void } {
  const searchKey = addableSearchKey(enabled, query, type);
  const [retryNonce, setRetryNonce] = useState(0);
  const key = searchKey ? `${searchKey}#${retryNonce}` : null;
  const [fetched, setFetched] = useState<{
    key: string;
    results: objects.ObjectRow[];
    ok: boolean;
  } | null>(null);

  useEffect(() => {
    if (!key) return;
    const trimmed = query.trim();
    let active = true;
    const delay = trimmed.length > 0 ? 250 : 0;
    const timer = setTimeout(() => {
      void searchAddableObjectsAction({
        query: trimmed,
        ...(type === 'all' ? {} : { type }),
      }).then(
        (result) => {
          if (!active) return;
          setFetched({ key, results: result.results, ok: true });
        },
        () => {
          if (!active) return;
          setFetched({ key, results: [], ok: false });
        },
      );
    }, delay);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [key, query, type]);

  function retry(): void {
    setRetryNonce((current) => current + 1);
  }

  if (!key) return { results: [], status: 'idle', retry };
  if (fetched?.key === key) {
    return {
      results: fetched.results,
      status: fetched.ok ? 'success' : 'error',
      retry,
    };
  }
  return { results: [], status: 'loading', retry };
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'mode':
      return { ...state, mode: action.mode };
    case 'query':
      return { ...state, query: action.query };
    case 'existingType':
      return { ...state, existingType: action.existingType, selectedObject: null };
    case 'selectExisting':
      return { ...state, selectedObject: action.object };
    case 'objectType':
      return { ...state, type: action.objectType };
    case 'canonicalName':
      return { ...state, canonicalName: action.canonicalName };
  }
}

function optimisticId(): string {
  return `optimistic-${globalThis.crypto.randomUUID()}`;
}

function optimisticBoardItem({
  boardId,
  laneId,
  object,
}: {
  boardId: string;
  laneId: string | null;
  object: objects.ObjectRow;
}): boards.BoardItemRow {
  const now = new Date();
  return {
    id: optimisticId(),
    boardId,
    entityId: object.id,
    laneId,
    position: 0,
    responsibleUserId: null,
    dueAt: null,
    priority: null,
    nextStep: null,
    notes: null,
    customFields: {},
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
    object,
  };
}

function optimisticObject(type: objects.ObjectType, canonicalName: string): objects.ObjectRow {
  const now = new Date();
  return {
    id: optimisticId(),
    type,
    canonicalName,
    status: 'open',
    stage: null,
    priority: null,
    ownerUserId: null,
    assigneeUserId: null,
    dueAt: null,
    agentSuggested: false,
    taskCategory: null,
    taskCategoryMode: null,
    taskCategorySource: null,
    taskCategoryStatus: null,
    taskCategoryUpdatedAt: null,
    archivedAt: null,
    aliases: [],
    metadata: {},
    createdAt: now,
    updatedAt: now,
  };
}

function ModeSwitch({ mode, dispatch }: { mode: State['mode']; dispatch: Dispatch<Action> }) {
  return (
    <div className="mb-3 flex justify-end">
      <fieldset className="inline-flex overflow-hidden rounded-sm border border-border">
        <legend className="sr-only">Add item mode</legend>
        {(['existing', 'new'] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => {
              dispatch({ type: 'mode', mode: option });
            }}
            aria-pressed={mode === option}
            className={`px-2 py-1 text-[11px] ${
              mode === option ? 'bg-signal text-signal-fg' : 'bg-bg text-fg-muted'
            }`}
          >
            {option}
          </button>
        ))}
      </fieldset>
    </div>
  );
}

function ExistingObjectPicker({
  candidates,
  existingTypeOptions,
  existingType,
  selectableCandidates,
  query,
  remoteStatus,
  selectedCandidate,
  onRetrySearch,
  dispatch,
}: {
  candidates: objects.ObjectRow[];
  existingTypeOptions: objects.ObjectType[];
  existingType: State['existingType'];
  selectableCandidates: objects.ObjectRow[];
  query: string;
  remoteStatus: RemoteSearchStatus;
  selectedCandidate: objects.ObjectRow | null;
  onRetrySearch: () => void;
  dispatch: Dispatch<Action>;
}) {
  return (
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
            value={query}
            onChange={(e) => {
              dispatch({ type: 'query', query: e.target.value });
            }}
            placeholder="Search existing objects…"
            className="h-9 w-full rounded-sm border border-border bg-bg py-2 pl-8 pr-8 text-sm focus-visible:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/40 focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
          />
          {query.trim() ? (
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
          className="text-xs text-fg-dim"
          aria-live="polite"
          aria-busy={remoteStatus === 'loading'}
        >
          {selectableCandidates.length}
          {remoteStatus === 'idle' ? ` / ${candidates.length}` : ''}
          {remoteStatus === 'loading' ? ' · Searching…' : ''}
          {remoteStatus === 'error' ? ' · Couldn’t load' : ''}
        </output>
      </div>

      {existingTypeOptions.length > 1 ? (
        <div
          className="flex flex-wrap gap-1.5 text-[11px]"
          aria-label="Filter existing objects by type"
        >
          {(['all', ...existingTypeOptions] as const).map((type) => (
            <ExistingTypeButton
              key={type}
              type={type}
              active={type === existingType}
              dispatch={dispatch}
            />
          ))}
        </div>
      ) : null}

      <CandidateList
        candidates={selectableCandidates}
        selectedId={selectedCandidate?.id ?? ''}
        remoteStatus={remoteStatus}
        onRetry={onRetrySearch}
        dispatch={dispatch}
      />

      {selectedCandidate ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-xs text-fg-dim">Selected</span>
          <button
            type="button"
            onClick={() => {
              dispatch({ type: 'selectExisting', object: null });
            }}
            className="inline-flex items-center gap-2 rounded-sm border border-border bg-surface px-2 py-1 text-fg transition-colors hover:bg-surface-2"
          >
            <span>{displayObjectLabel(selectedCandidate)}</span>
            <X className="size-3.5 text-fg-dim" aria-hidden="true" />
          </button>
        </div>
      ) : null}
    </div>
  );
}

function ExistingTypeButton({
  type,
  active,
  dispatch,
}: {
  type: objects.ObjectType | 'all';
  active: boolean;
  dispatch: Dispatch<Action>;
}) {
  return (
    <button
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
}

function CandidateList({
  candidates,
  selectedId,
  remoteStatus,
  onRetry,
  dispatch,
}: {
  candidates: objects.ObjectRow[];
  selectedId: string;
  remoteStatus: RemoteSearchStatus;
  onRetry: () => void;
  dispatch: Dispatch<Action>;
}) {
  return (
    <div
      className="max-h-56 overflow-y-auto rounded-sm border border-border bg-bg"
      aria-busy={remoteStatus === 'loading'}
    >
      {candidates.length > 0 ? (
        <ul className="divide-y divide-border">
          {candidates.map((row) => {
            const selected = row.id === selectedId;
            const visibleAliases = row.aliases
              .filter((alias) => !isInternalIdentifier(alias))
              .slice(0, 2);
            return (
              <li key={row.id}>
                <button
                  type="button"
                  onClick={() => {
                    dispatch({ type: 'selectExisting', object: row });
                  }}
                  aria-pressed={selected}
                  className={cn(
                    'grid w-full grid-cols-[1fr_auto] items-center gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-surface-2 focus:bg-surface-2 focus:outline-none',
                    selected && 'bg-signal-soft',
                  )}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-fg">
                      {displayObjectLabel(row)}
                    </span>
                    <span className="block truncate text-[11px] text-fg-dim">
                      {row.type}
                      {visibleAliases.length > 0
                        ? ` · ${visibleAliases.map((alias) => displayText(alias)).join(', ')}`
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
      ) : remoteStatus === 'error' ? (
        <div className="space-y-2 px-3 py-4" role="alert">
          <p className="text-sm text-fg-muted">Couldn’t load existing objects.</p>
          <button
            type="button"
            onClick={onRetry}
            className="rounded-sm border border-border px-2 py-1 text-xs font-medium text-fg hover:bg-surface-2"
          >
            Retry
          </button>
        </div>
      ) : (
        <p className="px-3 py-4 text-sm text-fg-muted">
          {remoteStatus === 'loading' ? 'Searching…' : 'No existing objects match this search.'}
        </p>
      )}
    </div>
  );
}

function NewObjectFields({
  type,
  canonicalName,
  dispatch,
}: {
  type: objects.ObjectType;
  canonicalName: string;
  dispatch: Dispatch<Action>;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-[0.75fr_1.5fr]">
      <select
        value={type}
        onChange={(e) => {
          dispatch({
            type: 'objectType',
            objectType: e.target.value as objects.ObjectType,
          });
        }}
        className="rounded-sm border border-border bg-bg px-3 py-2 text-sm focus-visible:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/40 focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
      >
        {OBJECT_TYPES.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
      <label className="sr-only" htmlFor="board-new-object-name">
        Object name
      </label>
      <input
        id="board-new-object-name"
        value={canonicalName}
        onChange={(e) => {
          dispatch({ type: 'canonicalName', canonicalName: e.target.value });
        }}
        placeholder="Object name"
        className="rounded-sm border border-border bg-bg px-3 py-2 text-sm focus-visible:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/40 focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
      />
    </div>
  );
}

export function BoardAddItemForm({
  boardId,
  defaultLaneId,
  candidates,
  recommendedTypes,
  onOptimisticItem,
  onItemAdded,
  onItemAddFailed,
}: Props) {
  const panelId = useId();
  const [pending, startTransition] = useTransition();
  const [expanded, setExpanded] = useState(false);
  const [state, dispatch] = useReducer(reducer, {
    mode: 'existing',
    query: '',
    existingType: 'all',
    selectedObject: null,
    type: recommendedTypes[0] ?? 'task',
    canonicalName: '',
  });
  const existingTypeOptions = useMemo(
    () => boardAddItemTypeOptions(recommendedTypes),
    [recommendedTypes],
  );
  const {
    results: remoteCandidates,
    status: remoteStatus,
    retry: retrySearch,
  } = useAddableObjectSearch({
    enabled: expanded && state.mode === 'existing',
    query: state.query,
    type: state.existingType,
  });
  const selectableCandidates = useMemo(() => {
    const typeRank = new Set(recommendedTypes);
    const typedLocal =
      state.existingType === 'all'
        ? candidates
        : candidates.filter((row) => row.type === state.existingType);
    const localMatches = filterObjectsByText(typedLocal, state.query);
    return uniqueCandidates([...localMatches, ...remoteCandidates]).sort(
      (a, b) => Number(typeRank.has(b.type)) - Number(typeRank.has(a.type)),
    );
  }, [candidates, recommendedTypes, remoteCandidates, state.existingType, state.query]);
  const selectedCandidate = state.selectedObject;

  function submit(): void {
    const object =
      state.mode === 'existing'
        ? selectedCandidate
        : optimisticObject(state.type, state.canonicalName.trim());
    if (!object) return;
    const optimisticItem = optimisticBoardItem({
      boardId,
      laneId: defaultLaneId,
      object,
    });
    onOptimisticItem?.(optimisticItem);
    startTransition(async () => {
      const result = await notifyAction({
        id: `board:${boardId}:add-item`,
        loading: 'Adding item…',
        success: 'Item added',
        error: 'Couldn’t add item',
        run: async () => {
          const saved =
            state.mode === 'existing'
              ? await addBoardItemAction({
                  boardId,
                  entityId: object.id,
                  laneId: defaultLaneId,
                })
              : await quickCreateBoardItemAction({
                  boardId,
                  type: state.type,
                  canonicalName: state.canonicalName,
                  laneId: defaultLaneId,
                });
          if ('error' in saved && saved.error) return { error: saved.error };
          if (!saved.item) {
            return { error: 'Board item was created, but could not be loaded.' };
          }
          return saved;
        },
      });
      if (result.error) {
        onItemAddFailed?.(optimisticItem);
        setExpanded(true);
        return;
      }
      if (!('item' in result) || !result.item) {
        onItemAddFailed?.(optimisticItem);
        setExpanded(true);
        return;
      }
      onItemAdded?.(result.item, optimisticItem.id);
      setExpanded(false);
      dispatch({ type: 'query', query: '' });
      dispatch({ type: 'selectExisting', object: null });
      dispatch({ type: 'canonicalName', canonicalName: '' });
    });
  }

  const disabled =
    pending ||
    (state.mode === 'existing' ? !selectedCandidate : !state.canonicalName.trim() || !state.type);

  return (
    <Popover open={expanded} onOpenChange={setExpanded}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={pending}
          className={cn(
            'inline-flex min-h-10 items-center gap-1.5 rounded-sm px-2.5 text-xs font-medium text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/50',
            expanded && 'bg-surface-2 text-fg',
          )}
          aria-expanded={expanded}
          aria-controls={expanded ? panelId : undefined}
        >
          <Plus className="size-3.5" aria-hidden="true" />
          Add item
        </button>
      </PopoverTrigger>
      <PopoverContent
        id={panelId}
        align="end"
        className="w-[min(32rem,calc(100vw-2rem))] p-3"
        aria-label="Add board item"
      >
        <ModeSwitch mode={state.mode} dispatch={dispatch} />
        {state.mode === 'existing' ? (
          <ExistingObjectPicker
            candidates={candidates}
            existingTypeOptions={existingTypeOptions}
            existingType={state.existingType}
            selectableCandidates={selectableCandidates}
            query={state.query}
            remoteStatus={remoteStatus}
            selectedCandidate={selectedCandidate}
            onRetrySearch={retrySearch}
            dispatch={dispatch}
          />
        ) : (
          <NewObjectFields
            type={state.type}
            canonicalName={state.canonicalName}
            dispatch={dispatch}
          />
        )}
        <button
          type="button"
          onClick={submit}
          disabled={disabled}
          className="mt-3 inline-flex items-center gap-2 rounded-sm bg-signal px-3 py-1.5 text-sm font-medium text-signal-fg hover:opacity-90 disabled:opacity-40"
        >
          <Plus className="size-3.5" aria-hidden="true" />
          {pending ? 'Adding…' : 'Add to board'}
        </button>
      </PopoverContent>
    </Popover>
  );
}

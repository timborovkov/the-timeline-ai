'use client';

import { Check, ChevronDown, Plus, Search, X } from 'lucide-react';
import { useId, useMemo, useReducer, useState, useTransition } from 'react';

import type * as boards from '@timeline/shared/boards';
import type * as objects from '@timeline/shared/objects/types';
import type { Dispatch } from 'react';

import { addBoardItemAction, quickCreateBoardItemAction } from '@/app/actions/boards';
import { displayText } from '@/lib/display-dates';
import { displayObjectLabel, isInternalIdentifier } from '@/lib/display-labels';
import { filterObjectsByText } from '@/lib/object-filter';
import { OBJECT_TYPES } from '@/lib/object-types';
import { cn, errorMessage } from '@/lib/utils';

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

type SelectableObjectType = (typeof OBJECT_TYPES)[number];

function isSelectableObjectType(type: objects.ObjectType): type is SelectableObjectType {
  return (OBJECT_TYPES as readonly objects.ObjectType[]).includes(type);
}

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
      <div className="inline-flex overflow-hidden rounded-sm border border-border">
        {(['existing', 'new'] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => {
              dispatch({ type: 'mode', mode: option });
            }}
            className={`px-2 py-1 text-[11px] ${
              mode === option ? 'bg-signal text-signal-fg' : 'bg-bg text-fg-muted'
            }`}
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  );
}

function ExistingObjectPicker({
  candidates,
  existingTypeOptions,
  existingType,
  selectableCandidates,
  query,
  entityId,
  selectedCandidate,
  dispatch,
}: {
  candidates: objects.ObjectRow[];
  existingTypeOptions: objects.ObjectType[];
  existingType: State['existingType'];
  selectableCandidates: objects.ObjectRow[];
  query: string;
  entityId: string;
  selectedCandidate: objects.ObjectRow | null;
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
        <output className="text-xs text-fg-dim" aria-live="polite">
          {selectableCandidates.length} / {candidates.length}
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

      <CandidateList candidates={selectableCandidates} entityId={entityId} dispatch={dispatch} />

      {selectedCandidate ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-xs text-fg-dim">Selected</span>
          <button
            type="button"
            onClick={() => {
              dispatch({ type: 'entityId', entityId: '' });
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
  entityId,
  dispatch,
}: {
  candidates: objects.ObjectRow[];
  entityId: string;
  dispatch: Dispatch<Action>;
}) {
  return (
    <div className="max-h-56 overflow-y-auto rounded-sm border border-border bg-bg">
      {candidates.length > 0 ? (
        <ul className="divide-y divide-border">
          {candidates.map((row) => {
            const selected = row.id === entityId;
            const visibleAliases = row.aliases
              .filter((alias) => !isInternalIdentifier(alias))
              .slice(0, 2);
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
      ) : (
        <p className="px-3 py-4 text-sm text-fg-muted">No existing objects match this search.</p>
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
    entityId: '',
    type: recommendedTypes[0] ?? 'task',
    canonicalName: '',
    error: null,
  });
  const existingTypeOptions = useMemo(() => {
    const typeRank = new Set(recommendedTypes);
    const selectableTypes = new Set<SelectableObjectType>();
    for (const row of candidates) {
      if (isSelectableObjectType(row.type)) selectableTypes.add(row.type);
    }
    return Array.from(selectableTypes).sort(
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
      try {
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
          onItemAddFailed?.(optimisticItem);
          setExpanded(true);
          dispatch({ type: 'error', error: result.error });
          return;
        }
        if (!result.item) {
          onItemAddFailed?.(optimisticItem);
          setExpanded(true);
          dispatch({ type: 'error', error: 'Board item was created, but could not be loaded.' });
          return;
        }
        onItemAdded?.(result.item, optimisticItem.id);
        dispatch({ type: 'query', query: '' });
        dispatch({ type: 'entityId', entityId: '' });
        dispatch({ type: 'canonicalName', canonicalName: '' });
      } catch (err) {
        onItemAddFailed?.(optimisticItem);
        setExpanded(true);
        dispatch({ type: 'error', error: errorMessage(err, 'Board item could not be added.') });
      }
    });
  }

  const disabled =
    pending ||
    (state.mode === 'existing' ? !state.entityId : !state.canonicalName.trim() || !state.type);

  return (
    <div className="rounded-sm border border-border bg-surface p-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xs text-fg-dim">Add item</h2>
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
          <ModeSwitch mode={state.mode} dispatch={dispatch} />
          {state.mode === 'existing' ? (
            <ExistingObjectPicker
              candidates={candidates}
              existingTypeOptions={existingTypeOptions}
              existingType={state.existingType}
              selectableCandidates={selectableCandidates}
              query={state.query}
              entityId={state.entityId}
              selectedCandidate={selectedCandidate}
              dispatch={dispatch}
            />
          ) : (
            <NewObjectFields
              type={state.type}
              canonicalName={state.canonicalName}
              dispatch={dispatch}
            />
          )}
          {state.error ? <p className="mt-2 text-xs text-danger">{state.error}</p> : null}
          <button
            type="button"
            onClick={submit}
            disabled={disabled}
            className="mt-3 inline-flex items-center gap-2 rounded-sm bg-signal px-3 py-1.5 text-sm font-medium text-signal-fg hover:opacity-90 disabled:opacity-40"
          >
            <Plus className="size-3.5" aria-hidden="true" />
            {pending ? 'Adding…' : 'Add to board'}
          </button>
        </div>
      ) : null}
    </div>
  );
}

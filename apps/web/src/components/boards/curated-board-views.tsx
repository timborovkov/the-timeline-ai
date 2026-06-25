'use client';

import Link from 'next/link';
import { useMemo, useReducer, useState, useTransition } from 'react';

import type { BoardItemOptimisticPatch } from '@/components/boards/board-detail-client';
import type * as boards from '@timeline/shared/boards';
import type { Dispatch, SetStateAction } from 'react';

import { boardViewHref, type BoardLayout } from '@/lib/board-links';
import { displayText } from '@/lib/display-dates';
import { displayObjectTitle } from '@/lib/object-title';

export interface BoardMemberOption {
  id: string;
  label: string;
}

const EMPTY_LANES: boards.BoardLaneRow[] = [];
const EMPTY_MEMBERS: BoardMemberOption[] = [];

type BoardBulkField = 'responsible' | 'due' | 'priority' | 'lane';

interface BoardBulkState {
  field: BoardBulkField;
  responsibleUserId: string;
  due: string;
  priority: string;
  laneId: string;
  message: string | null;
}

type BoardBulkAction =
  | { type: 'field'; field: BoardBulkField }
  | { type: 'responsible'; responsibleUserId: string }
  | { type: 'due'; due: string }
  | { type: 'priority'; priority: string }
  | { type: 'lane'; laneId: string }
  | { type: 'message'; message: string | null };

export function CuratedBoardTable({
  boardId,
  view,
  lanes = EMPTY_LANES,
  items,
  members = EMPTY_MEMBERS,
  onUpdateItem,
}: {
  boardId: string;
  view: BoardLayout;
  lanes?: boards.BoardLaneRow[];
  items: boards.BoardItemRow[];
  members?: BoardMemberOption[];
  onUpdateItem?: (
    itemId: string,
    patch: BoardItemOptimisticPatch,
  ) => Promise<{ ok?: boolean; error?: string; id?: string }>;
}) {
  const [, startTransition] = useTransition();
  const [saving, setSaving] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const selectableItems = useMemo(() => items.filter((item) => !isOptimisticItem(item)), [items]);
  const visibleSelectedIds = useMemo(() => {
    const itemIds = new Set(selectableItems.map((item) => item.id));
    return new Set([...selectedIds].filter((id) => itemIds.has(id)));
  }, [selectableItems, selectedIds]);
  if (items.length === 0) return <EmptyBoardItems />;

  function updateItem(
    id: string,
    patch: BoardItemOptimisticPatch,
  ): Promise<{
    ok?: boolean;
    error?: string;
    id?: string;
  }> {
    if (!onUpdateItem) return Promise.resolve({ error: 'Board item editing is unavailable.' });
    const field = Object.keys(patch)[0] ?? 'field';
    setSaving((current) => ({ ...current, [id]: field }));
    setErrors((current) => {
      const { [id]: _cleared, ...rest } = current;
      return rest;
    });
    return new Promise((resolve) => {
      startTransition(async () => {
        try {
          const result = await onUpdateItem(id, patch);
          if ('error' in result && result.error) {
            setErrors((current) => ({ ...current, [id]: result.error ?? 'Save failed' }));
          }
          resolve(result);
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Save failed';
          setErrors((current) => ({ ...current, [id]: message }));
          resolve({ error: message });
        } finally {
          setSaving((current) => {
            const { [id]: _done, ...rest } = current;
            return rest;
          });
        }
      });
    });
  }

  async function updateItems(
    ids: string[],
    patch: BoardItemOptimisticPatch,
  ): Promise<{ failed: number }> {
    const results = await Promise.allSettled(ids.map((id) => updateItem(id, patch)));
    return {
      failed: results.filter(
        (result) =>
          result.status === 'rejected' || ('error' in result.value && Boolean(result.value.error)),
      ).length,
    };
  }

  function toggleAll(checked: boolean): void {
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const item of selectableItems) {
        if (checked) next.add(item.id);
        else next.delete(item.id);
      }
      return next;
    });
  }

  function toggleOne(id: string, checked: boolean): void {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  const allVisibleSelected =
    selectableItems.length > 0 && selectableItems.every((item) => visibleSelectedIds.has(item.id));

  return (
    <div className="space-y-3">
      {onUpdateItem ? (
        <BoardBulkToolbar
          lanes={lanes}
          members={members}
          selectedIds={visibleSelectedIds}
          setSelectedIds={setSelectedIds}
          onUpdateItems={updateItems}
        />
      ) : null}
      <div className="overflow-x-auto rounded-sm border border-border bg-surface">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-bg text-left font-mono text-[11px] uppercase tracking-[0.12em] text-fg-dim">
            <tr>
              {onUpdateItem ? (
                <th className="w-10 px-3 py-2 font-normal">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    disabled={selectableItems.length === 0}
                    onChange={(event) => {
                      toggleAll(event.currentTarget.checked);
                    }}
                    aria-label="Select all visible board items"
                    className="size-4 rounded-sm border-border"
                  />
                </th>
              ) : null}
              <th className="px-3 py-2 font-normal">Name</th>
              <th className="px-3 py-2 font-normal">Type</th>
              <th className="px-3 py-2 font-normal">Responsible</th>
              <th className="px-3 py-2 font-normal">Due</th>
              <th className="px-3 py-2 font-normal">Priority</th>
              <th className="px-3 py-2 font-normal">Lane</th>
              <th className="px-3 py-2 font-normal">Next step</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const optimistic = isOptimisticItem(item);
              const objectTitle = displayObjectTitle(item.object);
              return (
                <tr key={item.id} className="border-t border-border transition-colors hover:bg-bg">
                  {onUpdateItem ? (
                    <td className="px-3 py-2 align-top">
                      <input
                        type="checkbox"
                        checked={visibleSelectedIds.has(item.id)}
                        disabled={optimistic}
                        onChange={(event) => {
                          toggleOne(item.id, event.currentTarget.checked);
                        }}
                        aria-label={`Select ${displayText(objectTitle)}`}
                        className="size-4 rounded-sm border-border disabled:opacity-50"
                      />
                    </td>
                  ) : null}
                  <td className="px-3 py-2">
                    {optimistic ? (
                      <span className="font-medium text-fg">{displayText(objectTitle)}</span>
                    ) : (
                      <Link
                        href={boardViewHref(boardId, view, item.id)}
                        className="font-medium hover:underline"
                      >
                        {displayText(objectTitle)}
                      </Link>
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-fg-muted">{item.object.type}</td>
                  <td className="min-w-40 px-3 py-2">
                    <select
                      value={item.responsibleUserId ?? ''}
                      disabled={optimistic || !onUpdateItem}
                      onChange={(event) => {
                        void updateItem(item.id, { responsibleUserId: event.target.value || null });
                      }}
                      className="h-8 w-full rounded-sm border border-border bg-bg px-2 text-xs disabled:opacity-60"
                      aria-label={`Responsible person for ${displayText(objectTitle)}`}
                    >
                      <option value="">Unassigned</option>
                      {members.map((member) => (
                        <option key={member.id} value={member.id}>
                          {member.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="min-w-36 px-3 py-2">
                    <input
                      type="date"
                      value={item.dueAt ? new Date(item.dueAt).toISOString().slice(0, 10) : ''}
                      disabled={optimistic || !onUpdateItem}
                      onChange={(event) => {
                        void updateItem(item.id, {
                          dueAt: event.target.value
                            ? new Date(`${event.target.value}T00:00:00.000Z`)
                            : null,
                        });
                      }}
                      className="h-8 w-full rounded-sm border border-border bg-bg px-2 text-xs disabled:opacity-60"
                      aria-label={`Due date for ${displayText(objectTitle)}`}
                    />
                  </td>
                  <td className="min-w-28 px-3 py-2">
                    <select
                      value={item.priority ?? ''}
                      disabled={optimistic || !onUpdateItem}
                      onChange={(event) => {
                        void updateItem(item.id, {
                          priority: event.target.value ? Number(event.target.value) : null,
                        });
                      }}
                      className="h-8 w-full rounded-sm border border-border bg-bg px-2 text-xs disabled:opacity-60"
                      aria-label={`Priority for ${displayText(objectTitle)}`}
                    >
                      <option value="">None</option>
                      {[1, 2, 3, 4].map((priority) => (
                        <option key={priority} value={priority}>
                          P{priority}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="min-w-36 px-3 py-2">
                    <select
                      value={item.laneId ?? ''}
                      disabled={optimistic || !onUpdateItem}
                      onChange={(event) => {
                        void updateItem(item.id, { laneId: event.target.value || null });
                      }}
                      className="h-8 w-full rounded-sm border border-border bg-bg px-2 text-xs disabled:opacity-60"
                      aria-label={`Lane for ${displayText(objectTitle)}`}
                    >
                      <option value="">Unset</option>
                      {lanes.map((lane) => (
                        <option key={lane.id} value={lane.id}>
                          {displayText(lane.name)}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="min-w-64 px-3 py-2">
                    <BoardNextStepInput
                      key={`${item.id}:${item.nextStep ?? ''}`}
                      objectName={objectTitle}
                      nextStep={item.nextStep}
                      disabled={optimistic || !onUpdateItem}
                      onSave={(nextStep) => {
                        void updateItem(item.id, { nextStep });
                      }}
                    />
                    {saving[item.id] ? (
                      <span className="mt-1 block font-mono text-[10px] uppercase tracking-[0.1em] text-fg-dim">
                        Saving {saving[item.id]}...
                      </span>
                    ) : null}
                    {errors[item.id] ? (
                      <span className="mt-1 block text-xs text-danger">{errors[item.id]}</span>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BoardBulkToolbar({
  lanes,
  members,
  selectedIds,
  setSelectedIds,
  onUpdateItems,
}: {
  lanes: boards.BoardLaneRow[];
  members: BoardMemberOption[];
  selectedIds: ReadonlySet<string>;
  setSelectedIds: Dispatch<SetStateAction<ReadonlySet<string>>>;
  onUpdateItems: (ids: string[], patch: BoardItemOptimisticPatch) => Promise<{ failed: number }>;
}) {
  const [bulk, dispatchBulk] = useReducer(boardBulkReducer, lanes[0]?.id ?? '', (laneId) => ({
    field: 'responsible' as const,
    responsibleUserId: '',
    due: '',
    priority: '',
    laneId,
    message: null,
  }));
  const [pending, startTransition] = useTransition();
  const selectedCount = selectedIds.size;

  function currentPatch(): BoardItemOptimisticPatch {
    if (bulk.field === 'responsible') return { responsibleUserId: bulk.responsibleUserId || null };
    if (bulk.field === 'due') {
      return { dueAt: bulk.due ? new Date(`${bulk.due}T00:00:00.000Z`) : null };
    }
    if (bulk.field === 'priority')
      return { priority: bulk.priority ? Number(bulk.priority) : null };
    return { laneId: bulk.laneId || null };
  }

  function applyBulk(): void {
    if (selectedCount === 0) return;
    dispatchBulk({ type: 'message', message: null });
    const ids = [...selectedIds];
    const patch = currentPatch();
    startTransition(async () => {
      const result = await onUpdateItems(ids, patch);
      if (result.failed > 0) {
        dispatchBulk({
          type: 'message',
          message: `${result.failed} of ${ids.length} updates failed.`,
        });
        return;
      }
      setSelectedIds(new Set());
      dispatchBulk({
        type: 'message',
        message: `Updated ${ids.length} ${ids.length === 1 ? 'item' : 'items'}.`,
      });
    });
  }

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 rounded-sm border border-border bg-surface px-3 py-2">
      <output
        className="mr-auto font-mono text-[11px] uppercase tracking-[0.12em] text-fg-dim"
        aria-live="polite"
      >
        {selectedCount === 0
          ? 'Select board items to edit'
          : `${selectedCount} ${selectedCount === 1 ? 'item' : 'items'} selected`}
      </output>
      <select
        value={bulk.field}
        onChange={(event) => {
          dispatchBulk({ type: 'field', field: event.currentTarget.value as BoardBulkField });
        }}
        className="h-8 rounded-sm border border-border bg-bg px-2 text-xs"
        aria-label="Bulk board field"
      >
        <option value="responsible">Responsible</option>
        <option value="due">Due date</option>
        <option value="priority">Priority</option>
        <option value="lane">Lane</option>
      </select>
      {bulk.field === 'responsible' ? (
        <select
          value={bulk.responsibleUserId}
          onChange={(event) => {
            dispatchBulk({ type: 'responsible', responsibleUserId: event.currentTarget.value });
          }}
          className="h-8 rounded-sm border border-border bg-bg px-2 text-xs"
          aria-label="Bulk responsible person"
        >
          <option value="">Unassigned</option>
          {members.map((member) => (
            <option key={member.id} value={member.id}>
              {member.label}
            </option>
          ))}
        </select>
      ) : null}
      {bulk.field === 'due' ? (
        <input
          type="date"
          value={bulk.due}
          onChange={(event) => {
            dispatchBulk({ type: 'due', due: event.currentTarget.value });
          }}
          className="h-8 rounded-sm border border-border bg-bg px-2 text-xs"
          aria-label="Bulk board due date"
        />
      ) : null}
      {bulk.field === 'priority' ? (
        <select
          value={bulk.priority}
          onChange={(event) => {
            dispatchBulk({ type: 'priority', priority: event.currentTarget.value });
          }}
          className="h-8 rounded-sm border border-border bg-bg px-2 text-xs"
          aria-label="Bulk board priority"
        >
          <option value="">None</option>
          {[1, 2, 3, 4].map((priority) => (
            <option key={priority} value={priority}>
              P{priority}
            </option>
          ))}
        </select>
      ) : null}
      {bulk.field === 'lane' ? (
        <select
          value={bulk.laneId}
          onChange={(event) => {
            dispatchBulk({ type: 'lane', laneId: event.currentTarget.value });
          }}
          className="h-8 rounded-sm border border-border bg-bg px-2 text-xs"
          aria-label="Bulk board lane"
        >
          <option value="">Unset</option>
          {lanes.map((lane) => (
            <option key={lane.id} value={lane.id}>
              {displayText(lane.name)}
            </option>
          ))}
        </select>
      ) : null}
      <button
        type="button"
        disabled={selectedCount === 0 || pending}
        onClick={applyBulk}
        className="h-8 rounded-sm border border-border bg-bg px-3 text-xs font-medium hover:bg-signal-soft disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? 'Applying...' : 'Apply'}
      </button>
      {selectedCount > 0 ? (
        <button
          type="button"
          onClick={() => {
            setSelectedIds(new Set());
          }}
          className="h-8 rounded-sm border border-border bg-bg px-3 text-xs font-medium hover:bg-bg"
        >
          Clear
        </button>
      ) : null}
      {bulk.message ? (
        <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-fg-dim">
          {bulk.message}
        </span>
      ) : null}
    </div>
  );
}

function boardBulkReducer(state: BoardBulkState, action: BoardBulkAction): BoardBulkState {
  switch (action.type) {
    case 'field':
      return { ...state, field: action.field, message: null };
    case 'responsible':
      return { ...state, responsibleUserId: action.responsibleUserId, message: null };
    case 'due':
      return { ...state, due: action.due, message: null };
    case 'priority':
      return { ...state, priority: action.priority, message: null };
    case 'lane':
      return { ...state, laneId: action.laneId, message: null };
    case 'message':
      return { ...state, message: action.message };
  }
}

function BoardNextStepInput({
  objectName,
  nextStep,
  disabled,
  onSave,
}: {
  objectName: string;
  nextStep: string | null;
  disabled: boolean;
  onSave: (nextStep: string | null) => void;
}) {
  const [draft, setDraft] = useState(nextStep ?? '');

  return (
    <input
      value={draft}
      disabled={disabled}
      onChange={(event) => {
        setDraft(event.currentTarget.value);
      }}
      onBlur={() => {
        const trimmed = draft.trim();
        if ((nextStep ?? '') !== trimmed) {
          onSave(trimmed || null);
        }
      }}
      className="h-8 w-full rounded-sm border border-border bg-bg px-2 text-xs disabled:opacity-60"
      aria-label={`Next step for ${displayText(objectName)}`}
      placeholder="Next step"
    />
  );
}

export function CuratedBoardList({
  boardId,
  view,
  lanes = EMPTY_LANES,
  items,
  members = EMPTY_MEMBERS,
  onUpdateItem,
}: {
  boardId: string;
  view: BoardLayout;
  lanes?: boards.BoardLaneRow[];
  items: boards.BoardItemRow[];
  members?: BoardMemberOption[];
  onUpdateItem?: (
    itemId: string,
    patch: BoardItemOptimisticPatch,
  ) => Promise<{ ok?: boolean; error?: string; id?: string }>;
}) {
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const selectableItems = useMemo(() => items.filter((item) => !isOptimisticItem(item)), [items]);
  const visibleSelectedIds = useMemo(() => {
    const itemIds = new Set(selectableItems.map((item) => item.id));
    return new Set([...selectedIds].filter((id) => itemIds.has(id)));
  }, [selectableItems, selectedIds]);
  if (items.length === 0) return <EmptyBoardItems />;

  async function updateItems(
    ids: string[],
    patch: BoardItemOptimisticPatch,
  ): Promise<{ failed: number }> {
    if (!onUpdateItem) return { failed: ids.length };
    const results = await Promise.allSettled(ids.map((id) => onUpdateItem(id, patch)));
    return {
      failed: results.filter(
        (result) =>
          result.status === 'rejected' || ('error' in result.value && Boolean(result.value.error)),
      ).length,
    };
  }

  function toggleOne(id: string, checked: boolean): void {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  return (
    <div className="space-y-3">
      {onUpdateItem ? (
        <BoardBulkToolbar
          lanes={lanes}
          members={members}
          selectedIds={visibleSelectedIds}
          setSelectedIds={setSelectedIds}
          onUpdateItems={updateItems}
        />
      ) : null}
      <ul className="divide-y divide-border border border-border bg-surface">
        {items.map((item) => {
          const optimistic = isOptimisticItem(item);
          const objectTitle = displayObjectTitle(item.object);
          const content = (
            <>
              <span className="min-w-0 flex-1 whitespace-normal break-words font-medium leading-snug text-fg">
                {displayText(objectTitle)}
              </span>
              <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-fg-dim">
                {item.object.type}
                {item.dueAt ? ` · ${new Date(item.dueAt).toLocaleDateString('en-CA')}` : ''}
              </span>
            </>
          );
          return (
            <li key={item.id} className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-bg">
              {onUpdateItem ? (
                <input
                  type="checkbox"
                  checked={visibleSelectedIds.has(item.id)}
                  disabled={optimistic}
                  onChange={(event) => {
                    toggleOne(item.id, event.currentTarget.checked);
                  }}
                  aria-label={`Select ${displayText(objectTitle)}`}
                  className="size-4 shrink-0 rounded-sm border-border disabled:opacity-50"
                />
              ) : null}
              {optimistic ? (
                <span className="flex min-w-0 flex-1 items-center justify-between gap-3 opacity-80">
                  {content}
                </span>
              ) : (
                <Link
                  href={boardViewHref(boardId, view, item.id)}
                  className="flex min-w-0 flex-1 items-center justify-between gap-3"
                >
                  {content}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function isOptimisticItem(item: boards.BoardItemRow): boolean {
  return item.id.startsWith('optimistic-');
}

function EmptyBoardItems() {
  return (
    <p className="py-10 text-center font-mono text-xs uppercase tracking-[0.12em] text-fg-dim">
      NO BOARD ITEMS YET
    </p>
  );
}

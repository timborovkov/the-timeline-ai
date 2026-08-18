'use client';

import { presentDueDate } from '@timeline/shared/time';
import Link from 'next/link';
import { useMemo, useReducer, useState, useTransition } from 'react';

import type { BoardItemOptimisticPatch } from '@/components/boards/board-detail-client';
import type * as boards from '@timeline/shared/boards';
import type { Dispatch, SetStateAction } from 'react';

import { CollectionGroup } from '@/components/collections/collection-group';
import { CollectionRow } from '@/components/collections/collection-row';
import { CollectionStatus } from '@/components/collections/collection-status';
import { priorityTone } from '@/components/collections/collection-status-tone';
import { EditableMetadata } from '@/components/collections/editable-metadata';
import { MetadataDateEditor } from '@/components/collections/metadata-date-editor';
import { SelectionBar } from '@/components/collections/selection-bar';
import { VirtualList } from '@/components/collections/virtual-list';
import { DueDateDisplay } from '@/components/due-date-display';
import { LiveTaskCategoryBadge } from '@/components/tasks/task-category-badge';
import { useWorkspaceTimezone } from '@/components/workspace-timezone-context';
import { boardViewHref, type BoardLayout } from '@/lib/board-links';
import { displayText } from '@/lib/display-dates';
import { notifyAction } from '@/lib/notify';
import { displayObjectTitle } from '@/lib/object-title';
import { statusLabel } from '@/lib/status-labels';

export interface BoardMemberOption {
  id: string;
  label: string;
}

const EMPTY_LANES: boards.BoardLaneRow[] = [];
const EMPTY_MEMBERS: BoardMemberOption[] = [];
const EMPTY_FILTER_PARAMS: Record<string, string> = {};

type BoardBulkField = 'responsible' | 'due' | 'priority' | 'lane';

interface BoardBulkState {
  field: BoardBulkField;
  responsibleUserId: string;
  due: string;
  priority: string;
  laneId: string;
}

type BoardBulkAction =
  | { type: 'field'; field: BoardBulkField }
  | { type: 'responsible'; responsibleUserId: string }
  | { type: 'due'; due: string }
  | { type: 'priority'; priority: string }
  | { type: 'lane'; laneId: string };

interface BoardItemUpdateResult {
  ok?: boolean;
  error?: string;
  id?: string;
}

export function CuratedBoardTable({
  boardId,
  view,
  lanes = EMPTY_LANES,
  items,
  members = EMPTY_MEMBERS,
  onUpdateItem,
  filterParams = EMPTY_FILTER_PARAMS,
}: {
  boardId: string;
  view: BoardLayout;
  lanes?: boards.BoardLaneRow[];
  items: boards.BoardItemRow[];
  members?: BoardMemberOption[];
  filterParams?: Record<string, string>;
  onUpdateItem?: (
    itemId: string,
    patch: BoardItemOptimisticPatch,
  ) => Promise<{ ok?: boolean; error?: string; id?: string }>;
}) {
  const timezone = useWorkspaceTimezone();
  const [, startTransition] = useTransition();
  const [saving, setSaving] = useState<Record<string, string>>({});
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const selectableItems = useMemo(() => items.filter((item) => !isOptimisticItem(item)), [items]);
  const visibleSelectedIds = useMemo(() => {
    const itemIds = new Set(selectableItems.map((item) => item.id));
    return new Set([...selectedIds].filter((id) => itemIds.has(id)));
  }, [selectableItems, selectedIds]);
  if (items.length === 0) return <EmptyBoardItems />;

  async function persistItem(
    id: string,
    patch: BoardItemOptimisticPatch,
  ): Promise<BoardItemUpdateResult> {
    if (!onUpdateItem) return { error: 'Board item editing is unavailable.' };
    const field = Object.keys(patch)[0] ?? 'field';
    setSaving((current) => ({ ...current, [id]: field }));
    try {
      return await onUpdateItem(id, patch);
    } finally {
      setSaving((current) => {
        const { [id]: _done, ...rest } = current;
        return rest;
      });
    }
  }

  function updateItem(id: string, patch: BoardItemOptimisticPatch): Promise<BoardItemUpdateResult> {
    const field = Object.keys(patch)[0] ?? 'field';
    const label = field === 'dueAt' ? 'due date' : field;
    return new Promise((resolve) => {
      startTransition(async () => {
        resolve(
          await notifyAction({
            id: `board-item:${id}`,
            loading: `Updating ${label}…`,
            success: `${label.slice(0, 1).toUpperCase()}${label.slice(1)} updated`,
            error: `Couldn’t update ${label}`,
            run: () => persistItem(id, patch),
          }),
        );
      });
    });
  }

  async function updateItems(
    ids: string[],
    patch: BoardItemOptimisticPatch,
  ): Promise<{ failed: number }> {
    const results = await Promise.allSettled(ids.map((id) => persistItem(id, patch)));
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
      <CuratedBoardTableGrid
        boardId={boardId}
        view={view}
        items={items}
        lanes={lanes}
        members={members}
        filterParams={filterParams}
        timezone={timezone}
        saving={saving}
        selectableItems={selectableItems}
        visibleSelectedIds={visibleSelectedIds}
        allVisibleSelected={allVisibleSelected}
        canEdit={Boolean(onUpdateItem)}
        onToggleAll={toggleAll}
        onToggleOne={toggleOne}
        onUpdateItem={updateItem}
      />
    </div>
  );
}

function CuratedBoardTableGrid({
  boardId,
  view,
  items,
  lanes,
  members,
  filterParams,
  timezone,
  saving,
  selectableItems,
  visibleSelectedIds,
  allVisibleSelected,
  canEdit,
  onToggleAll,
  onToggleOne,
  onUpdateItem,
}: {
  boardId: string;
  view: BoardLayout;
  items: boards.BoardItemRow[];
  lanes: boards.BoardLaneRow[];
  members: BoardMemberOption[];
  filterParams: Record<string, string>;
  timezone: string;
  saving: Record<string, string>;
  selectableItems: boards.BoardItemRow[];
  visibleSelectedIds: ReadonlySet<string>;
  allVisibleSelected: boolean;
  canEdit: boolean;
  onToggleAll: (checked: boolean) => void;
  onToggleOne: (id: string, checked: boolean) => void;
  onUpdateItem: (id: string, patch: BoardItemOptimisticPatch) => Promise<BoardItemUpdateResult>;
}) {
  return (
    <div className="overflow-x-auto rounded-sm border border-border bg-surface">
      <table className="w-full text-sm">
        <thead className="border-b border-border bg-bg text-left text-xs text-fg-dim">
          <tr>
            {canEdit ? (
              <th className="w-10 px-3 py-2 font-normal">
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  disabled={selectableItems.length === 0}
                  onChange={(event) => {
                    onToggleAll(event.currentTarget.checked);
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
                {canEdit ? (
                  <td className="px-3 py-2 align-top">
                    <input
                      type="checkbox"
                      checked={visibleSelectedIds.has(item.id)}
                      disabled={optimistic}
                      onChange={(event) => {
                        onToggleOne(item.id, event.currentTarget.checked);
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
                      href={boardViewHref(boardId, view, item.id, filterParams)}
                      className="font-medium hover:underline"
                    >
                      {displayText(objectTitle)}
                    </Link>
                  )}
                </td>
                <td className="px-3 py-2 text-xs text-fg-muted">
                  <span className="flex flex-wrap items-center gap-1.5">
                    {statusLabel(item.object.type)}
                    {item.object.type === 'task' ? (
                      <LiveTaskCategoryBadge
                        taskId={item.object.id}
                        category={item.object.taskCategory}
                        status={item.object.taskCategoryStatus}
                        updatedAt={item.object.taskCategoryUpdatedAt}
                      />
                    ) : null}
                  </span>
                </td>
                <td className="min-w-40 px-3 py-2">
                  <EditableMetadata
                    label={`Responsible person for ${displayText(objectTitle)}`}
                    value={
                      members.find((member) => member.id === item.responsibleUserId)?.label ??
                      'Unassigned'
                    }
                    pending={saving[item.id] === 'responsibleUserId'}
                    disabled={optimistic || !canEdit}
                    editor={
                      <select
                        value={item.responsibleUserId ?? ''}
                        disabled={optimistic || !canEdit}
                        onChange={(event) => {
                          void onUpdateItem(item.id, {
                            responsibleUserId: event.target.value || null,
                          });
                        }}
                        className="h-10 w-full rounded-sm border border-border bg-bg px-2 text-xs disabled:opacity-60"
                        aria-label="Responsible person"
                      >
                        <option value="">Unassigned</option>
                        {members.map((member) => (
                          <option key={member.id} value={member.id}>
                            {member.label}
                          </option>
                        ))}
                      </select>
                    }
                  />
                </td>
                <td className="min-w-36 px-3 py-2">
                  <EditableMetadata
                    label={`Due date for ${displayText(objectTitle)}`}
                    value={<DueDateDisplay value={item.dueAt} variant="field-hint" />}
                    pending={saving[item.id] === 'dueAt'}
                    disabled={optimistic || !canEdit}
                    editor={
                      <MetadataDateEditor
                        defaultValue={
                          item.dueAt ? (presentDueDate(item.dueAt, { timezone }).dateKey ?? '') : ''
                        }
                        disabled={optimistic || !canEdit}
                        onApply={(value) => {
                          void onUpdateItem(item.id, {
                            dueAt: value ? new Date(`${value}T00:00:00.000Z`) : null,
                          });
                        }}
                      />
                    }
                  />
                </td>
                <td className="min-w-28 px-3 py-2">
                  <EditableMetadata
                    label={`Priority for ${displayText(objectTitle)}`}
                    value={
                      <CollectionStatus
                        value={item.priority ? `p${item.priority}` : 'none'}
                        tone={priorityTone(item.priority)}
                        label={item.priority ? `P${item.priority}` : 'No priority'}
                      />
                    }
                    pending={saving[item.id] === 'priority'}
                    disabled={optimistic || !canEdit}
                    editor={
                      <select
                        value={item.priority ?? ''}
                        disabled={optimistic || !canEdit}
                        onChange={(event) => {
                          void onUpdateItem(item.id, {
                            priority: event.target.value ? Number(event.target.value) : null,
                          });
                        }}
                        className="h-10 w-full rounded-sm border border-border bg-bg px-2 text-xs disabled:opacity-60"
                        aria-label="Priority"
                      >
                        <option value="">None</option>
                        {[1, 2, 3, 4].map((priority) => (
                          <option key={priority} value={priority}>
                            P{priority}
                          </option>
                        ))}
                      </select>
                    }
                  />
                </td>
                <td className="min-w-36 px-3 py-2">
                  <EditableMetadata
                    label={`Lane for ${displayText(objectTitle)}`}
                    value={lanes.find((lane) => lane.id === item.laneId)?.name ?? 'Unset'}
                    pending={saving[item.id] === 'laneId'}
                    disabled={optimistic || !canEdit}
                    editor={
                      <select
                        value={item.laneId ?? ''}
                        disabled={optimistic || !canEdit}
                        onChange={(event) => {
                          void onUpdateItem(item.id, { laneId: event.target.value || null });
                        }}
                        className="h-10 w-full rounded-sm border border-border bg-bg px-2 text-xs disabled:opacity-60"
                        aria-label="Lane"
                      >
                        <option value="">Unset</option>
                        {lanes.map((lane) => (
                          <option key={lane.id} value={lane.id}>
                            {displayText(lane.name)}
                          </option>
                        ))}
                      </select>
                    }
                  />
                </td>
                <td className="min-w-64 px-3 py-2">
                  <EditableMetadata
                    label={`Next step for ${displayText(objectTitle)}`}
                    value={item.nextStep ?? 'No next step'}
                    pending={saving[item.id] === 'nextStep'}
                    disabled={optimistic || !canEdit}
                    editor={
                      <BoardNextStepInput
                        key={`${item.id}:${item.nextStep ?? ''}`}
                        objectName={objectTitle}
                        nextStep={item.nextStep}
                        disabled={optimistic || !canEdit}
                        onSave={(nextStep) => {
                          void onUpdateItem(item.id, { nextStep });
                        }}
                      />
                    }
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
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
    const ids = [...selectedIds];
    const patch = currentPatch();
    startTransition(async () => {
      const result = await notifyAction({
        id: 'board-items:bulk',
        loading: `Updating ${ids.length} ${ids.length === 1 ? 'item' : 'items'}…`,
        success: `Updated ${ids.length} ${ids.length === 1 ? 'item' : 'items'}`,
        error: 'Couldn’t update items',
        run: async () => {
          const outcome = await onUpdateItems(ids, patch);
          return outcome.failed > 0
            ? { error: `${outcome.failed} of ${ids.length} updates failed.` }
            : { ok: true };
        },
      });
      if (result.error) return;
      setSelectedIds(new Set());
    });
  }

  return (
    <SelectionBar
      count={selectedCount}
      label={selectedCount === 1 ? 'board item selected' : 'board items selected'}
      onClear={() => {
        setSelectedIds(new Set());
      }}
      actions={
        <>
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
            disabled={pending}
            onClick={applyBulk}
            className="h-8 rounded-sm border border-border bg-bg px-3 text-xs font-medium hover:bg-signal-soft disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? 'Applying…' : 'Apply'}
          </button>
        </>
      }
    />
  );
}

function boardBulkReducer(state: BoardBulkState, action: BoardBulkAction): BoardBulkState {
  switch (action.type) {
    case 'field':
      return { ...state, field: action.field };
    case 'responsible':
      return { ...state, responsibleUserId: action.responsibleUserId };
    case 'due':
      return { ...state, due: action.due };
    case 'priority':
      return { ...state, priority: action.priority };
    case 'lane':
      return { ...state, laneId: action.laneId };
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
  filterParams = EMPTY_FILTER_PARAMS,
}: {
  boardId: string;
  view: BoardLayout;
  lanes?: boards.BoardLaneRow[];
  items: boards.BoardItemRow[];
  members?: BoardMemberOption[];
  filterParams?: Record<string, string>;
  onUpdateItem?: (
    itemId: string,
    patch: BoardItemOptimisticPatch,
  ) => Promise<{ ok?: boolean; error?: string; id?: string }>;
}) {
  const timezone = useWorkspaceTimezone();
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

  const knownLaneIds = new Set(lanes.map((lane) => lane.id));
  const missingLaneIds = Array.from(
    new Set(
      items.flatMap((item) => (item.laneId && !knownLaneIds.has(item.laneId) ? [item.laneId] : [])),
    ),
  );
  const laneGroups = [
    ...lanes.map((lane) => ({ id: lane.id, name: lane.name })),
    ...missingLaneIds.map((id) => ({ id, name: 'Other lane' })),
    { id: '', name: 'Unset' },
  ].flatMap((lane) => {
    const laneItems = items.filter((item) => (item.laneId ?? '') === lane.id);
    return laneItems.length > 0 ? [{ ...lane, items: laneItems }] : [];
  });

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
      <div className="border-x border-border bg-surface">
        {laneGroups.map((group) => (
          <CollectionGroup key={group.id || 'unset'} title={group.name} count={group.items.length}>
            <VirtualList
              items={group.items}
              getItemKey={(item) => item.id}
              estimateSize={48}
              renderItem={(item) => {
                const optimistic = isOptimisticItem(item);
                const objectTitle = displayObjectTitle(item.object);
                const title = optimistic ? (
                  <span>{displayText(objectTitle)}</span>
                ) : (
                  <Link
                    href={boardViewHref(boardId, view, item.id, filterParams)}
                    className="block truncate hover:underline"
                  >
                    {displayText(objectTitle)}
                  </Link>
                );
                return (
                  <div style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 44px' }}>
                    <CollectionRow
                      selected={visibleSelectedIds.has(item.id)}
                      leading={
                        onUpdateItem ? (
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
                        ) : null
                      }
                      title={title}
                      context={statusLabel(item.object.type)}
                      metadata={
                        <>
                          {item.object.type === 'task' ? (
                            <LiveTaskCategoryBadge
                              taskId={item.object.id}
                              category={item.object.taskCategory}
                              status={item.object.taskCategoryStatus}
                              updatedAt={item.object.taskCategoryUpdatedAt}
                            />
                          ) : null}
                          <EditableMetadata
                            label={`Responsible person for ${displayText(objectTitle)}`}
                            value={
                              members.find((member) => member.id === item.responsibleUserId)
                                ?.label ?? 'Unassigned'
                            }
                            disabled={optimistic || !onUpdateItem}
                            editor={
                              <select
                                value={item.responsibleUserId ?? ''}
                                onChange={(event) =>
                                  void onUpdateItem?.(item.id, {
                                    responsibleUserId: event.currentTarget.value || null,
                                  })
                                }
                                className="h-10 w-full rounded-sm border border-border bg-bg px-2 text-xs"
                              >
                                <option value="">Unassigned</option>
                                {members.map((member) => (
                                  <option key={member.id} value={member.id}>
                                    {member.label}
                                  </option>
                                ))}
                              </select>
                            }
                          />
                          <EditableMetadata
                            label={`Due date for ${displayText(objectTitle)}`}
                            value={
                              <DueDateDisplay
                                value={item.dueAt}
                                timezone={timezone}
                                variant="compact"
                              />
                            }
                            disabled={optimistic || !onUpdateItem}
                            editor={
                              <MetadataDateEditor
                                defaultValue={
                                  item.dueAt
                                    ? (presentDueDate(item.dueAt, { timezone }).dateKey ?? '')
                                    : ''
                                }
                                onApply={(value) =>
                                  void onUpdateItem?.(item.id, {
                                    dueAt: value ? new Date(`${value}T00:00:00.000Z`) : null,
                                  })
                                }
                              />
                            }
                          />
                          <EditableMetadata
                            label={`Priority for ${displayText(objectTitle)}`}
                            value={
                              <CollectionStatus
                                value={item.priority ? `p${item.priority}` : 'none'}
                                tone={priorityTone(item.priority)}
                                label={item.priority ? `P${item.priority}` : 'No priority'}
                              />
                            }
                            disabled={optimistic || !onUpdateItem}
                            editor={
                              <select
                                value={item.priority ?? ''}
                                onChange={(event) =>
                                  void onUpdateItem?.(item.id, {
                                    priority: event.currentTarget.value
                                      ? Number(event.currentTarget.value)
                                      : null,
                                  })
                                }
                                className="h-10 rounded-sm border border-border bg-bg px-2 text-xs"
                              >
                                <option value="">None</option>
                                {[1, 2, 3, 4].map((priority) => (
                                  <option key={priority} value={priority}>
                                    P{priority}
                                  </option>
                                ))}
                              </select>
                            }
                          />
                          <EditableMetadata
                            label={`Lane for ${displayText(objectTitle)}`}
                            value={group.name}
                            disabled={optimistic || !onUpdateItem}
                            editor={
                              <select
                                value={item.laneId ?? ''}
                                onChange={(event) =>
                                  void onUpdateItem?.(item.id, {
                                    laneId: event.currentTarget.value || null,
                                  })
                                }
                                className="h-10 rounded-sm border border-border bg-bg px-2 text-xs"
                              >
                                <option value="">Unset</option>
                                {lanes.map((lane) => (
                                  <option key={lane.id} value={lane.id}>
                                    {displayText(lane.name)}
                                  </option>
                                ))}
                              </select>
                            }
                          />
                          <EditableMetadata
                            label={`Next step for ${displayText(objectTitle)}`}
                            value={item.nextStep ?? 'No next step'}
                            disabled={optimistic || !onUpdateItem}
                            editor={
                              <BoardNextStepInput
                                objectName={objectTitle}
                                nextStep={item.nextStep}
                                disabled={optimistic || !onUpdateItem}
                                onSave={(nextStep) => void onUpdateItem?.(item.id, { nextStep })}
                              />
                            }
                          />
                        </>
                      }
                    />
                  </div>
                );
              }}
            />
          </CollectionGroup>
        ))}
      </div>
    </div>
  );
}

function isOptimisticItem(item: boards.BoardItemRow): boolean {
  return item.id.startsWith('optimistic-');
}

function EmptyBoardItems() {
  return <p className="py-10 text-center text-sm text-fg-dim">No board items yet</p>;
}

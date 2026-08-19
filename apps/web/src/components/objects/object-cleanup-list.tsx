'use client';

import { Archive, GitMerge, Shapes, SquareCheckBig } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useReducer, useState, useTransition } from 'react';

import type * as objects from '@timeline/shared/objects/types';

import {
  bulkArchiveObjectsAction,
  loadObjectRowsAction,
  updateObjectAction,
} from '@/app/actions/objects';
import { CollectionGroup } from '@/components/collections/collection-group';
import { CollectionRow } from '@/components/collections/collection-row';
import { CollectionStatus } from '@/components/collections/collection-status';
import { priorityTone, statusTone } from '@/components/collections/collection-status-tone';
import { EditableMetadata } from '@/components/collections/editable-metadata';
import { InfiniteScroll } from '@/components/collections/infinite-scroll';
import { SelectionBar } from '@/components/collections/selection-bar';
import { VirtualList } from '@/components/collections/virtual-list';
import { DueDateDisplay } from '@/components/due-date-display';
import { EmptyState } from '@/components/empty-state';
import { DiscussionCountBadge } from '@/components/objects/discussion-count-badge';
import { PinOverflowMenu } from '@/components/pins/pin-overflow-menu';
import {
  LiveTaskCategoryBadge,
  TaskCategoryPollingProvider,
} from '@/components/tasks/task-category-badge';
import { TaskCategorySelect } from '@/components/tasks/task-category-select';
import { useAppDialog } from '@/components/ui/app-dialog';
import { ItemActionGroup } from '@/components/ui/item-actions';
import { useWorkspaceTimezone } from '@/components/workspace-timezone-context';
import { displayText } from '@/lib/display-dates';
import { isSchedulableObjectType } from '@/lib/due-dates';
import { dateInputValue, toDateOrNull } from '@/lib/iso-timestamp';
import { notifyAction } from '@/lib/notify';
import { objectDetailHref } from '@/lib/object-links';
import { MAX_OBJECT_MERGE_SELECTION, objectMergeHref } from '@/lib/object-merge';
import { statusOptionsForType } from '@/lib/object-status-options';
import { statusLabel } from '@/lib/status-labels';

type PinnableObjectRow = objects.ObjectRow & { pinned?: boolean };
const EMPTY_FILTER_PARAMS: Record<string, string> = {};

function objectFilterKey(filterParams: Record<string, string>): string {
  return Object.entries(filterParams)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
}

interface Props {
  rows: PinnableObjectRow[];
  typeLabels: Record<string, string>;
  nextCursor?: string | null;
  filterParams?: Record<string, string>;
  sectionMoreHrefs?: Record<string, string>;
  returnTo?: string;
}

interface CleanupListState {
  selecting: boolean;
  selected: Set<string>;
  archivedIds: Set<string>;
  appendedRows: PinnableObjectRow[];
  cursor: string | null;
  paginationKey: string | null;
  loadError: string | null;
}

type CleanupListAction =
  | { type: 'begin-selecting' }
  | { type: 'toggle'; id: string }
  | { type: 'clear-selection' }
  | { type: 'archive-optimistic'; ids: string[] }
  | { type: 'archive-rollback'; ids: string[] }
  | {
      type: 'append-page';
      rows: PinnableObjectRow[];
      nextCursor: string | null;
      paginationKey: string;
    }
  | { type: 'load-error'; message: string | null; paginationKey: string };

function cleanupListReducer(state: CleanupListState, action: CleanupListAction): CleanupListState {
  switch (action.type) {
    case 'begin-selecting':
      return { ...state, selecting: true };
    case 'toggle': {
      const selected = new Set(state.selected);
      if (selected.has(action.id)) selected.delete(action.id);
      else selected.add(action.id);
      return { ...state, selected };
    }
    case 'clear-selection':
      return { ...state, selecting: false, selected: new Set() };
    case 'archive-optimistic':
      return {
        ...state,
        selecting: false,
        selected: new Set(),
        archivedIds: new Set([...state.archivedIds, ...action.ids]),
      };
    case 'archive-rollback': {
      const archivedIds = new Set(state.archivedIds);
      for (const id of action.ids) archivedIds.delete(id);
      return { ...state, archivedIds };
    }
    case 'append-page': {
      const currentRows = action.paginationKey === state.paginationKey ? state.appendedRows : [];
      const seen = new Set(currentRows.map((row) => row.id));
      return {
        ...state,
        paginationKey: action.paginationKey,
        appendedRows: [...currentRows, ...action.rows.filter((row) => !seen.has(row.id))],
        cursor: action.nextCursor,
        loadError: null,
      };
    }
    case 'load-error':
      return { ...state, paginationKey: action.paginationKey, loadError: action.message };
  }
}

export function ObjectCleanupList({
  rows,
  typeLabels,
  nextCursor = null,
  filterParams = EMPTY_FILTER_PARAMS,
  sectionMoreHrefs,
  returnTo = '/app/objects',
}: Props) {
  const timezone = useWorkspaceTimezone();
  const router = useRouter();
  const dialog = useAppDialog();
  const paginationKey = objectFilterKey(filterParams);
  const [
    { selecting, selected, archivedIds, appendedRows, cursor, paginationKey: loadedKey, loadError },
    dispatchCleanupList,
  ] = useReducer(cleanupListReducer, {
    selecting: false,
    selected: new Set<string>(),
    archivedIds: new Set<string>(),
    appendedRows: [],
    cursor: null,
    paginationKey: null,
    loadError: null,
  });
  const [loadingMore, startLoadMore] = useTransition();
  const loadedAppendedRows = useMemo(
    () => (loadedKey === paginationKey ? appendedRows : []),
    [appendedRows, loadedKey, paginationKey],
  );
  const pageCursor = loadedKey === paginationKey ? cursor : nextCursor;
  const pageLoadError = loadedKey === paginationKey ? loadError : null;
  const [isPending, startTransition] = useTransition();
  const activeRows = useMemo(() => {
    const firstPageIds = new Set(rows.map((row) => row.id));
    return [...rows, ...loadedAppendedRows.filter((row) => !firstPageIds.has(row.id))].filter(
      (row) => !archivedIds.has(row.id),
    );
  }, [archivedIds, loadedAppendedRows, rows]);
  const visibleRows = activeRows;
  const visibleIds = useMemo(() => new Set(visibleRows.map((row) => row.id)), [visibleRows]);

  const selectedIds = useMemo(
    () => Array.from(selected).filter((id) => visibleIds.has(id)),
    [selected, visibleIds],
  );
  const selectedCount = selectedIds.length;
  const canMergeSelected =
    selectedCount >= 2 && selectedCount <= MAX_OBJECT_MERGE_SELECTION && !isPending;
  const grouped = useMemo(() => {
    const map = new Map<string, PinnableObjectRow[]>();
    for (const row of visibleRows) {
      const list = map.get(row.type) ?? [];
      list.push(row);
      map.set(row.type, list);
    }
    return map;
  }, [visibleRows]);
  const typeKeys = useMemo(
    () =>
      Array.from(grouped.keys()).sort((a, b) =>
        (typeLabels[a] ?? a).localeCompare(typeLabels[b] ?? b),
      ),
    [grouped, typeLabels],
  );
  const categoryPollingTasks = useMemo(
    () =>
      visibleRows.flatMap((row) =>
        row.type === 'task'
          ? [{ id: row.id, status: row.taskCategoryStatus, updatedAt: row.taskCategoryUpdatedAt }]
          : [],
      ),
    [visibleRows],
  );
  function toggle(id: string) {
    dispatchCleanupList({ type: 'toggle', id });
  }

  function loadMoreObjects(): void {
    if (!pageCursor || loadingMore) return;
    dispatchCleanupList({ type: 'load-error', message: null, paginationKey });
    startLoadMore(async () => {
      const page = await loadObjectRowsAction({
        cursor: pageCursor,
        ...(Object.keys(filterParams).length > 0 ? { filters: filterParams } : {}),
      });
      if (page.error) {
        dispatchCleanupList({ type: 'load-error', message: page.error, paginationKey });
        return;
      }
      dispatchCleanupList({
        type: 'append-page',
        rows: page.rows,
        nextCursor: page.nextCursor,
        paginationKey,
      });
    });
  }

  function clearSelection() {
    dispatchCleanupList({ type: 'clear-selection' });
  }

  async function archiveSelected() {
    if (selectedCount === 0 || isPending) return;
    const confirmed = await dialog.confirm({
      title: 'Archive selected objects?',
      description: `${String(selectedCount)} selected object${
        selectedCount === 1 ? '' : 's'
      } will be archived.`,
      confirmLabel: 'Archive',
      destructive: true,
    });
    if (!confirmed) return;
    const idsToArchive = selectedIds;
    dispatchCleanupList({ type: 'archive-optimistic', ids: idsToArchive });
    startTransition(async () => {
      const result = await notifyAction({
        id: 'objects:archive',
        loading: 'Archiving objects…',
        success: 'Objects archived',
        error: 'Couldn’t archive objects',
        run: () => bulkArchiveObjectsAction({ ids: idsToArchive }),
      });
      if (result.error) {
        dispatchCleanupList({
          type: 'archive-rollback',
          ids: idsToArchive,
        });
        return;
      }
      router.refresh();
    });
  }

  return (
    <TaskCategoryPollingProvider tasks={categoryPollingTasks}>
      <div className="space-y-4">
        <div className="flex min-h-10 items-center justify-end border-b border-border">
          {!selecting ? (
            <button
              type="button"
              onClick={() => {
                dispatchCleanupList({ type: 'begin-selecting' });
              }}
              className="inline-flex min-h-10 items-center gap-1.5 rounded-sm px-2.5 text-xs text-fg transition-colors hover:bg-surface-2"
            >
              <SquareCheckBig className="size-3.5" aria-hidden />
              Select
            </button>
          ) : null}
        </div>
        <SelectionBar
          count={selectedCount}
          label={selectedCount === 1 ? 'object selected' : 'objects selected'}
          onClear={clearSelection}
          actions={
            <>
              {canMergeSelected ? (
                <Link
                  href={objectMergeHref(selectedIds)}
                  className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-border px-2.5 text-xs text-fg transition-colors hover:bg-surface-2"
                >
                  <GitMerge className="size-3.5" aria-hidden />
                  Merge
                </Link>
              ) : (
                <span
                  className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-border px-2.5 text-xs text-fg-dim opacity-50"
                  aria-disabled="true"
                >
                  <GitMerge className="size-3.5" aria-hidden />
                  Merge
                </span>
              )}
              <button
                type="button"
                onClick={() => void archiveSelected()}
                disabled={selectedCount === 0 || isPending}
                className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-border px-2.5 text-xs text-fg transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:text-fg-dim disabled:opacity-50"
              >
                <Archive className="size-3.5" aria-hidden />
                Archive
              </button>
            </>
          }
        />
        {dialog.node}
        {selecting && selectedCount > MAX_OBJECT_MERGE_SELECTION ? (
          <p className="border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
            Select {MAX_OBJECT_MERGE_SELECTION} or fewer objects to merge.
          </p>
        ) : null}
        {visibleRows.length === 0 ? (
          <EmptyState
            icon={Shapes}
            size="inset"
            title="No objects visible"
            body="Try another type or clear the current filters to see objects in this directory."
          />
        ) : (
          <div>
            {typeKeys.map((typeKey) => {
              const list = grouped.get(typeKey) ?? [];
              return (
                <CollectionGroup
                  key={typeKey}
                  title={typeLabels[typeKey] ?? typeKey}
                  count={list.length}
                  actions={
                    sectionMoreHrefs?.[typeKey] ? (
                      <Link
                        href={sectionMoreHrefs[typeKey]}
                        className="min-h-10 px-2 py-3 text-xs text-signal hover:underline"
                      >
                        View all
                      </Link>
                    ) : null
                  }
                >
                  <VirtualList
                    items={list}
                    getItemKey={(object) => object.id}
                    estimateSize={48}
                    renderItem={(object) => {
                      const isSelected = selected.has(object.id);
                      return (
                        <ObjectCollectionItem
                          object={object}
                          typeLabel={typeLabels[object.type] ?? object.type}
                          timezone={timezone}
                          returnTo={returnTo}
                          selecting={selecting}
                          selected={isSelected}
                          onToggle={() => {
                            toggle(object.id);
                          }}
                        />
                      );
                    }}
                  />
                </CollectionGroup>
              );
            })}
          </div>
        )}
        <InfiniteScroll
          hasMore={Boolean(pageCursor)}
          loading={loadingMore}
          error={pageLoadError}
          onLoadMore={loadMoreObjects}
          boundLabel="No more matching objects"
          hideBound={!pageCursor && Boolean(sectionMoreHrefs)}
        />
      </div>
    </TaskCategoryPollingProvider>
  );
}

type ObjectEditableKey = 'status' | 'priority' | 'dueAt';
type ObjectEditableValue = PinnableObjectRow[ObjectEditableKey];
interface ObjectFieldOverlay {
  value: ObjectEditableValue;
  pendingValues: ObjectEditableValue[];
}

function objectFieldLabel(key: ObjectEditableKey): string {
  if (key === 'dueAt') return 'due date';
  return key;
}

function capitalizeLabel(value: string): string {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}

function sameObjectFieldValue(left: ObjectEditableValue, right: ObjectEditableValue): boolean {
  if (left instanceof Date || right instanceof Date) {
    return (
      toDateOrNull(left as Date | string | null)?.getTime() ===
      toDateOrNull(right as Date | string | null)?.getTime()
    );
  }
  return left === right;
}

function ObjectCollectionItem({
  object,
  typeLabel,
  timezone,
  returnTo,
  selecting,
  selected,
  onToggle,
}: {
  object: PinnableObjectRow;
  typeLabel: string;
  timezone: string;
  returnTo: string;
  selecting: boolean;
  selected: boolean;
  onToggle: () => void;
}) {
  const router = useRouter();
  const [overlays, setOverlays] = useState<Partial<Record<ObjectEditableKey, ObjectFieldOverlay>>>(
    {},
  );
  const [saving, setSaving] = useState<ObjectEditableKey | null>(null);

  function effectiveValue(key: ObjectEditableKey): ObjectEditableValue {
    const overlay = overlays[key];
    const serverValue = object[key];
    if (!overlay || sameObjectFieldValue(serverValue, overlay.value)) return serverValue;
    return overlay.pendingValues.some((value) => sameObjectFieldValue(serverValue, value))
      ? overlay.value
      : serverValue;
  }

  const status = String(effectiveValue('status'));
  const priority = effectiveValue('priority') as number | null;
  const dueAt = effectiveValue('dueAt') as Date | null;

  function save(key: ObjectEditableKey, value: ObjectEditableValue): void {
    const previous = overlays[key];
    const current = effectiveValue(key);
    if (sameObjectFieldValue(current, value)) return;
    setSaving(key);
    setOverlays((existing) => ({
      ...existing,
      [key]: {
        value,
        pendingValues: [
          ...(previous?.pendingValues ?? []),
          current,
          ...(previous ? [previous.value] : []),
        ].filter(
          (candidate, index, values) =>
            !sameObjectFieldValue(candidate, value) &&
            values.findIndex((entry) => sameObjectFieldValue(entry, candidate)) === index,
        ),
      },
    }));
    const label = objectFieldLabel(key);
    void notifyAction({
      id: `object:${object.id}`,
      loading: `Updating ${label}…`,
      success: `${capitalizeLabel(label)} updated`,
      error: `Couldn’t update ${label}`,
      run: () =>
        updateObjectAction({
          id: object.id,
          [key]: value instanceof Date ? value.toISOString() : value,
        }),
      undo: {
        run: async () => {
          setOverlays((existing) => ({
            ...existing,
            [key]: { value: current, pendingValues: [] },
          }));
          const result = await updateObjectAction({
            id: object.id,
            [key]: current instanceof Date ? current.toISOString() : current,
          });
          if (!result.error) router.refresh();
          return result;
        },
      },
    }).then((result) => {
      if (result.error) setOverlays((existing) => ({ ...existing, [key]: previous }));
      else router.refresh();
      setSaving(null);
    });
  }

  const statusOptions = statusOptionsForType(object.type, status);

  return (
    <div style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 44px' }}>
      <CollectionRow selected={selected}>
        <CollectionRow.Leading>
          {selecting ? (
            <input
              type="checkbox"
              checked={selected}
              onChange={onToggle}
              aria-label={`Select ${displayText(object.canonicalName)}`}
              className="size-4 accent-[var(--signal)]"
            />
          ) : null}
        </CollectionRow.Leading>
        <CollectionRow.Title>
          <Link
            href={objectDetailHref(object.id, returnTo)}
            scroll={false}
            className="block truncate hover:underline"
          >
            {displayText(object.canonicalName)}
          </Link>
          <DiscussionCountBadge count={object.commentCount} className="ml-2 shrink-0" />
        </CollectionRow.Title>
        <CollectionRow.Context>{typeLabel}</CollectionRow.Context>
        <CollectionRow.Metadata>
          <>
            {object.type === 'task' ? (
              <EditableMetadata label={`Category for ${displayText(object.canonicalName)}`}>
                <EditableMetadata.Value>
                  <LiveTaskCategoryBadge
                    taskId={object.id}
                    category={object.taskCategory}
                    status={object.taskCategoryStatus}
                    updatedAt={object.taskCategoryUpdatedAt}
                  />
                </EditableMetadata.Value>
                <EditableMetadata.Editor>
                  <TaskCategorySelect
                    taskId={object.id}
                    category={object.taskCategory}
                    mode={object.taskCategoryMode}
                    status={object.taskCategoryStatus}
                    updatedAt={object.taskCategoryUpdatedAt}
                  />
                </EditableMetadata.Editor>
              </EditableMetadata>
            ) : null}
            <EditableMetadata
              label={`Status for ${displayText(object.canonicalName)}`}
              pending={saving === 'status'}
            >
              <EditableMetadata.Value>
                <CollectionStatus
                  value={status}
                  label={statusLabel(status)}
                  tone={statusTone(status)}
                />
              </EditableMetadata.Value>
              <EditableMetadata.Editor>
                <select
                  aria-label="Status"
                  value={status}
                  onChange={(event) => {
                    save('status', event.currentTarget.value);
                  }}
                  className="h-10 w-full rounded-sm border border-border bg-bg px-2 text-xs"
                >
                  {statusOptions.map((option) => (
                    <option key={option} value={option}>
                      {statusLabel(option)}
                    </option>
                  ))}
                  {!statusOptions.includes(status) ? (
                    <option value={status}>{statusLabel(status)}</option>
                  ) : null}
                </select>
              </EditableMetadata.Editor>
            </EditableMetadata>
            <EditableMetadata
              label={`Priority for ${displayText(object.canonicalName)}`}
              pending={saving === 'priority'}
            >
              <EditableMetadata.Value>
                <CollectionStatus
                  value={priority ? `p${priority}` : 'none'}
                  tone={priorityTone(priority)}
                  label={priority ? `P${priority}` : 'No priority'}
                />
              </EditableMetadata.Value>
              <EditableMetadata.Editor>
                <select
                  aria-label="Priority"
                  value={priority ?? ''}
                  onChange={(event) => {
                    save(
                      'priority',
                      event.currentTarget.value ? Number(event.currentTarget.value) : null,
                    );
                  }}
                  className="h-10 w-full rounded-sm border border-border bg-bg px-2 text-xs"
                >
                  <option value="">None</option>
                  {[1, 2, 3, 4].map((value) => (
                    <option key={value} value={value}>
                      P{value}
                    </option>
                  ))}
                </select>
              </EditableMetadata.Editor>
            </EditableMetadata>
            {isSchedulableObjectType(object.type) ? (
              <EditableMetadata
                label={`Due date for ${displayText(object.canonicalName)}`}
                pending={saving === 'dueAt'}
              >
                <EditableMetadata.Value>
                  <DueDateDisplay value={dueAt} timezone={timezone} variant="compact" />
                </EditableMetadata.Value>
                <EditableMetadata.Editor>
                  <ObjectDueDateEditor
                    value={dueAt}
                    onSave={(value) => {
                      save('dueAt', value);
                    }}
                  />
                </EditableMetadata.Editor>
              </EditableMetadata>
            ) : null}
          </>
        </CollectionRow.Metadata>
        <CollectionRow.Actions>
          <ItemActionGroup label={`Actions for ${displayText(object.canonicalName)}`}>
            <PinOverflowMenu
              target={{ kind: 'object', key: object.id }}
              title={displayText(object.canonicalName)}
              initialPinned={object.pinned ?? false}
            />
          </ItemActionGroup>
        </CollectionRow.Actions>
      </CollectionRow>
    </div>
  );
}

function ObjectDueDateEditor({
  value,
  onSave,
}: {
  value: Date | string | null;
  onSave: (value: Date | null) => void;
}) {
  const [draft, setDraft] = useState(() => dateInputValue(value));
  return (
    <form
      className="flex items-center gap-2"
      action={() => {
        onSave(draft ? new Date(`${draft}T00:00:00.000Z`) : null);
      }}
    >
      <input
        aria-label="Due date"
        type="date"
        value={draft}
        onChange={(event) => {
          setDraft(event.currentTarget.value);
        }}
        className="h-10 rounded-sm border border-border bg-bg px-2 text-xs"
      />
      <button
        type="submit"
        className="min-h-10 rounded-sm bg-signal px-3 text-xs font-medium text-signal-fg"
      >
        Apply
      </button>
    </form>
  );
}

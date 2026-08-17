'use client';

import { Archive, GitMerge, SquareCheckBig } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useReducer, useState, useTransition } from 'react';
import { toast } from 'sonner';

import type * as objects from '@timeline/shared/objects/types';

import { bulkArchiveObjectsAction, updateObjectAction } from '@/app/actions/objects';
import { CollectionGroup } from '@/components/collections/collection-group';
import { CollectionRow } from '@/components/collections/collection-row';
import {
  CollectionStatus,
  priorityTone,
  statusTone,
} from '@/components/collections/collection-status';
import { EditableMetadata } from '@/components/collections/editable-metadata';
import { SelectionBar } from '@/components/collections/selection-bar';
import { DueDateDisplay } from '@/components/due-date-display';
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
import { MAX_OBJECT_MERGE_SELECTION, objectMergeHref } from '@/lib/object-merge';
import { statusOptionsForType } from '@/lib/object-status-options';
import { statusLabel } from '@/lib/status-labels';

type PinnableObjectRow = objects.ObjectRow & { pinned?: boolean };

interface Props {
  rows: PinnableObjectRow[];
  typeLabels: Record<string, string>;
  pageInfo?: {
    shownCount: number;
    nextHref: string | null;
  };
  sectionMoreHrefs?: Record<string, string>;
}

interface CleanupListState {
  selecting: boolean;
  selected: Set<string>;
  archivedIds: Set<string>;
  error: string | null;
}

type CleanupListAction =
  | { type: 'begin-selecting' }
  | { type: 'toggle'; id: string }
  | { type: 'clear-selection' }
  | { type: 'archive-optimistic'; ids: string[] }
  | { type: 'archive-rollback'; ids: string[]; error: string };

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
      return { ...state, selecting: false, selected: new Set(), error: null };
    case 'archive-optimistic':
      return {
        ...state,
        selecting: false,
        selected: new Set(),
        archivedIds: new Set([...state.archivedIds, ...action.ids]),
        error: null,
      };
    case 'archive-rollback': {
      const archivedIds = new Set(state.archivedIds);
      for (const id of action.ids) archivedIds.delete(id);
      return { ...state, archivedIds, error: action.error };
    }
  }
}

export function ObjectCleanupList({ rows, typeLabels, pageInfo, sectionMoreHrefs }: Props) {
  const timezone = useWorkspaceTimezone();
  const router = useRouter();
  const dialog = useAppDialog();
  const [{ selecting, selected, archivedIds, error }, dispatchCleanupList] = useReducer(
    cleanupListReducer,
    {
      selecting: false,
      selected: new Set<string>(),
      archivedIds: new Set<string>(),
      error: null,
    },
  );
  const [isPending, startTransition] = useTransition();
  const activeRows = useMemo(
    () => rows.filter((row) => !archivedIds.has(row.id)),
    [archivedIds, rows],
  );
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
      const result = await bulkArchiveObjectsAction({ ids: idsToArchive });
      if (result.error) {
        dispatchCleanupList({
          type: 'archive-rollback',
          ids: idsToArchive,
          error: result.error,
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
        {pageInfo ? (
          <ObjectListPager shownCount={pageInfo.shownCount} nextHref={pageInfo.nextHref} />
        ) : null}
        {error ? (
          <p className="border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        ) : null}
        {dialog.node}
        {selecting && selectedCount > MAX_OBJECT_MERGE_SELECTION ? (
          <p className="border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
            Select {MAX_OBJECT_MERGE_SELECTION} or fewer objects to merge.
          </p>
        ) : null}
        {visibleRows.length === 0 ? (
          <p className="py-10 text-center text-sm text-fg-dim">No objects visible</p>
        ) : (
          <div className="border-x border-border">
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
                  <ul>
                    {list.map((object) => {
                      const isSelected = selected.has(object.id);
                      return (
                        <ObjectCollectionItem
                          key={object.id}
                          object={object}
                          typeLabel={typeLabels[object.type] ?? object.type}
                          timezone={timezone}
                          selecting={selecting}
                          selected={isSelected}
                          onToggle={() => {
                            toggle(object.id);
                          }}
                        />
                      );
                    })}
                  </ul>
                </CollectionGroup>
              );
            })}
          </div>
        )}
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
  selecting,
  selected,
  onToggle,
}: {
  object: PinnableObjectRow;
  typeLabel: string;
  timezone: string;
  selecting: boolean;
  selected: boolean;
  onToggle: () => void;
}) {
  const router = useRouter();
  const [overlays, setOverlays] = useState<Partial<Record<ObjectEditableKey, ObjectFieldOverlay>>>(
    {},
  );
  const [saving, setSaving] = useState<ObjectEditableKey | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    setError(null);
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
    void updateObjectAction({
      id: object.id,
      [key]: value instanceof Date ? value.toISOString() : value,
    })
      .then((result) => {
        if (result.error) {
          setOverlays((existing) => ({ ...existing, [key]: previous }));
          setError(result.error ?? 'Update failed');
          toast.error(result.error ?? 'Update failed');
          return;
        }
        router.refresh();
      })
      .catch(() => {
        setOverlays((existing) => ({ ...existing, [key]: previous }));
        setError('Update failed');
        toast.error('Update failed');
      })
      .finally(() => {
        setSaving(null);
      });
  }

  const statusOptions = statusOptionsForType(object.type, status);

  return (
    <li style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 44px' }}>
      <CollectionRow
        selected={selected}
        leading={
          selecting ? (
            <input
              type="checkbox"
              checked={selected}
              onChange={onToggle}
              aria-label={`Select ${displayText(object.canonicalName)}`}
              className="size-4 accent-[var(--signal)]"
            />
          ) : null
        }
        title={
          <Link href={`/app/objects/${object.id}`} className="block truncate hover:underline">
            {displayText(object.canonicalName)}
          </Link>
        }
        context={error ? <span className="text-danger">{error}</span> : typeLabel}
        metadata={
          <>
            {object.type === 'task' ? (
              <EditableMetadata
                label={`Category for ${displayText(object.canonicalName)}`}
                value={
                  <LiveTaskCategoryBadge
                    taskId={object.id}
                    category={object.taskCategory}
                    status={object.taskCategoryStatus}
                    updatedAt={object.taskCategoryUpdatedAt}
                  />
                }
                editor={
                  <TaskCategorySelect
                    taskId={object.id}
                    category={object.taskCategory}
                    mode={object.taskCategoryMode}
                    status={object.taskCategoryStatus}
                    updatedAt={object.taskCategoryUpdatedAt}
                  />
                }
              />
            ) : null}
            <EditableMetadata
              label={`Status for ${displayText(object.canonicalName)}`}
              pending={saving === 'status'}
              error={error}
              value={
                <CollectionStatus
                  value={status}
                  label={statusLabel(status)}
                  tone={statusTone(status)}
                />
              }
              editor={
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
              }
            />
            <EditableMetadata
              label={`Priority for ${displayText(object.canonicalName)}`}
              pending={saving === 'priority'}
              value={
                <CollectionStatus
                  value={priority ? `p${priority}` : 'none'}
                  tone={priorityTone(priority)}
                  label={priority ? `P${priority}` : 'No priority'}
                />
              }
              editor={
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
              }
            />
            {isSchedulableObjectType(object.type) ? (
              <EditableMetadata
                label={`Due date for ${displayText(object.canonicalName)}`}
                pending={saving === 'dueAt'}
                value={<DueDateDisplay value={dueAt} timezone={timezone} variant="compact" />}
                editor={
                  <ObjectDueDateEditor
                    value={dueAt}
                    onSave={(value) => {
                      save('dueAt', value);
                    }}
                  />
                }
              />
            ) : null}
          </>
        }
        actions={
          <ItemActionGroup label={`Actions for ${displayText(object.canonicalName)}`}>
            <PinOverflowMenu
              target={{ kind: 'object', key: object.id }}
              title={displayText(object.canonicalName)}
              initialPinned={object.pinned ?? false}
            />
          </ItemActionGroup>
        }
      />
    </li>
  );
}

function ObjectDueDateEditor({
  value,
  onSave,
}: {
  value: Date | string | null;
  onSave: (value: Date | null) => void;
}) {
  const [draft, setDraft] = useState(dateInputValue(value));
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
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

function ObjectListPager({
  shownCount,
  nextHref,
}: {
  shownCount: number;
  nextHref: string | null;
}) {
  return (
    <nav
      aria-label="Objects pages"
      className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2"
    >
      <p className="text-xs text-fg-dim">{shownCount} shown</p>
      <div className="flex items-center gap-1.5">
        <PaginationLink href={nextHref} label="Next" />
      </div>
    </nav>
  );
}

function PaginationLink({ href, label }: { href: string | null; label: string }) {
  const className =
    'inline-flex h-8 items-center rounded-sm border px-2.5 text-xs transition-colors';
  if (!href) {
    return (
      <span className={`${className} border-border text-fg-dim opacity-50`} aria-disabled="true">
        {label}
      </span>
    );
  }
  return (
    <Link href={href} className={`${className} border-border text-fg hover:bg-surface-2`}>
      {label}
    </Link>
  );
}

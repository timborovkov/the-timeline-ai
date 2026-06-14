'use client';

import { Archive, GitMerge, SquareCheckBig, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useReducer, useTransition } from 'react';

import type * as objects from '@timeline/shared/objects';

import { bulkArchiveObjectsAction } from '@/app/actions/objects';
import { ObjectTextFilter } from '@/components/boards/object-text-filter';
import { useAppDialog } from '@/components/ui/app-dialog';
import { filterObjectsByText } from '@/lib/object-filter';
import { MAX_OBJECT_MERGE_SELECTION, objectMergeHref } from '@/lib/object-merge';

interface Props {
  rows: objects.ObjectRow[];
  typeLabels: Record<string, string>;
}

interface CleanupListState {
  selecting: boolean;
  selected: Set<string>;
  archivedIds: Set<string>;
  error: string | null;
  filterQuery: string;
}

type CleanupListAction =
  | { type: 'begin-selecting' }
  | { type: 'toggle'; id: string }
  | { type: 'clear-selection' }
  | { type: 'set-filter'; query: string }
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
    case 'set-filter':
      return { ...state, filterQuery: action.query, selected: new Set() };
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

export function ObjectCleanupList({ rows, typeLabels }: Props) {
  const router = useRouter();
  const dialog = useAppDialog();
  const [{ selecting, selected, archivedIds, error, filterQuery }, dispatchCleanupList] =
    useReducer(cleanupListReducer, {
      selecting: false,
      selected: new Set<string>(),
      archivedIds: new Set<string>(),
      error: null,
      filterQuery: '',
    });
  const [isPending, startTransition] = useTransition();
  const activeRows = useMemo(
    () => rows.filter((row) => !archivedIds.has(row.id)),
    [archivedIds, rows],
  );
  const visibleRows = useMemo(
    () => filterObjectsByText(activeRows, filterQuery, { typeLabels }),
    [activeRows, filterQuery, typeLabels],
  );
  const visibleIds = useMemo(() => new Set(visibleRows.map((row) => row.id)), [visibleRows]);

  const selectedIds = useMemo(
    () => Array.from(selected).filter((id) => visibleIds.has(id)),
    [selected, visibleIds],
  );
  const selectedCount = selectedIds.length;
  const canMergeSelected =
    selectedCount >= 2 && selectedCount <= MAX_OBJECT_MERGE_SELECTION && !isPending;
  const grouped = useMemo(() => {
    const map = new Map<string, objects.ObjectRow[]>();
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
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2">
        <ObjectTextFilter
          query={filterQuery}
          onQueryChange={(query) => {
            dispatchCleanupList({ type: 'set-filter', query });
          }}
          resultCount={visibleRows.length}
          totalCount={activeRows.length}
        />
        <div className="flex items-center gap-1.5">
          {selecting ? (
            <div className="mr-1 font-mono text-[11px] uppercase tracking-[0.12em] text-fg-dim">
              {selectedCount} selected
            </div>
          ) : null}
          {selecting ? (
            <>
              <Link
                href={canMergeSelected ? objectMergeHref(selectedIds) : '#'}
                aria-disabled={!canMergeSelected}
                className={`inline-flex h-8 items-center gap-1.5 rounded-sm border px-2.5 font-mono text-[11px] uppercase tracking-[0.1em] transition-colors ${
                  canMergeSelected
                    ? 'border-border text-fg hover:bg-surface-2'
                    : 'pointer-events-none border-border text-fg-dim opacity-50'
                }`}
              >
                <GitMerge className="size-3.5" aria-hidden />
                Merge
              </Link>
              <button
                type="button"
                onClick={() => void archiveSelected()}
                disabled={selectedCount === 0 || isPending}
                className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-border px-2.5 font-mono text-[11px] uppercase tracking-[0.1em] text-fg transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:text-fg-dim disabled:opacity-50"
              >
                <Archive className="size-3.5" aria-hidden />
                Archive
              </button>
              <button
                type="button"
                onClick={clearSelection}
                className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-border px-2.5 font-mono text-[11px] uppercase tracking-[0.1em] text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
              >
                <X className="size-3.5" aria-hidden />
                Clear
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => {
                dispatchCleanupList({ type: 'begin-selecting' });
              }}
              className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-border px-2.5 font-mono text-[11px] uppercase tracking-[0.1em] text-fg transition-colors hover:bg-surface-2"
            >
              <SquareCheckBig className="size-3.5" aria-hidden />
              Select
            </button>
          )}
        </div>
      </div>
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
        <p className="py-10 text-center font-mono text-xs uppercase tracking-[0.12em] text-fg-dim">
          NOTHING MATCHES THIS FILTER
        </p>
      ) : (
        <div className="space-y-8">
          {typeKeys.map((typeKey) => {
            const list = grouped.get(typeKey) ?? [];
            return (
              <section key={typeKey} aria-label={typeLabels[typeKey] ?? typeKey}>
                <div className="mb-3 flex items-baseline justify-between border-b border-border pb-1.5">
                  <h2 className="font-mono text-[11px] uppercase tracking-[0.14em] text-fg">
                    {typeLabels[typeKey] ?? typeKey}
                  </h2>
                  <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-dim">
                    {list.length}
                  </span>
                </div>
                <ul className="grid grid-cols-1 gap-px overflow-hidden border border-border sm:grid-cols-2">
                  {list.map((object) => {
                    const isSelected = selected.has(object.id);
                    return (
                      <li key={object.id} className="bg-bg">
                        <div
                          className={`flex min-h-10 items-center px-3 py-2.5 text-sm transition-colors ${
                            isSelected ? 'bg-signal-soft' : 'hover:bg-surface'
                          }`}
                        >
                          {selecting ? (
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => {
                                toggle(object.id);
                              }}
                              aria-label={`Select ${object.canonicalName}`}
                              className="mr-2.5 size-4 accent-[var(--signal)]"
                            />
                          ) : null}
                          <Link
                            href={`/app/objects/${object.id}`}
                            className="min-w-0 flex-1 truncate font-medium text-fg"
                          >
                            {object.canonicalName}
                          </Link>
                          <span className="ml-3 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.1em] text-fg-dim">
                            <span>{object.status}</span>
                            {object.dueAt ? (
                              <span title={object.dueAt.toISOString()}>
                                · {object.dueAt.toLocaleDateString('en-CA')}
                              </span>
                            ) : null}
                            {object.agentSuggested && object.status === 'suggested' ? (
                              <span className="rounded-sm border border-signal/40 bg-signal-soft px-1.5 py-0.5 text-signal">
                                suggested
                              </span>
                            ) : null}
                          </span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

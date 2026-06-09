'use client';

import { Archive, GitMerge, SquareCheckBig, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';

import type * as objects from '@timeline/shared/objects';

import { bulkArchiveObjectsAction } from '@/app/actions/objects';
import { MAX_OBJECT_MERGE_SELECTION, objectMergeHref } from '@/lib/object-merge';

interface Props {
  rows: objects.ObjectRow[];
  typeLabels: Record<string, string>;
}

export function ObjectCleanupList({ rows, typeLabels }: Props) {
  const router = useRouter();
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const selectedIds = useMemo(() => Array.from(selected), [selected]);
  const selectedCount = selectedIds.length;
  const canMergeSelected =
    selectedCount >= 2 && selectedCount <= MAX_OBJECT_MERGE_SELECTION && !isPending;
  const grouped = useMemo(() => {
    const map = new Map<string, objects.ObjectRow[]>();
    for (const row of rows) {
      const list = map.get(row.type) ?? [];
      list.push(row);
      map.set(row.type, list);
    }
    return map;
  }, [rows]);
  const typeKeys = useMemo(
    () =>
      Array.from(grouped.keys()).sort((a, b) =>
        (typeLabels[a] ?? a).localeCompare(typeLabels[b] ?? b),
      ),
    [grouped, typeLabels],
  );

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function clearSelection() {
    setSelected(new Set());
    setSelecting(false);
    setError(null);
  }

  function archiveSelected() {
    if (selectedCount === 0 || isPending) return;
    if (!confirm(`Archive ${selectedCount} selected object${selectedCount === 1 ? '' : 's'}?`)) {
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await bulkArchiveObjectsAction({ ids: selectedIds });
      if (result.error) {
        setError(result.error);
        return;
      }
      clearSelection();
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2">
        <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-dim">
          {selecting ? `${selectedCount} selected` : `${rows.length} visible`}
        </div>
        <div className="flex items-center gap-1.5">
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
                <GitMerge className="h-3.5 w-3.5" aria-hidden />
                Merge
              </Link>
              <button
                type="button"
                onClick={archiveSelected}
                disabled={selectedCount === 0 || isPending}
                className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-border px-2.5 font-mono text-[11px] uppercase tracking-[0.1em] text-fg transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:text-fg-dim disabled:opacity-50"
              >
                <Archive className="h-3.5 w-3.5" aria-hidden />
                Archive
              </button>
              <button
                type="button"
                onClick={clearSelection}
                className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-border px-2.5 font-mono text-[11px] uppercase tracking-[0.1em] text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
              >
                <X className="h-3.5 w-3.5" aria-hidden />
                Clear
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => {
                setSelecting(true);
              }}
              className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-border px-2.5 font-mono text-[11px] uppercase tracking-[0.1em] text-fg transition-colors hover:bg-surface-2"
            >
              <SquareCheckBig className="h-3.5 w-3.5" aria-hidden />
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
      {selecting && selectedCount > MAX_OBJECT_MERGE_SELECTION ? (
        <p className="border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
          Select {MAX_OBJECT_MERGE_SELECTION} or fewer objects to merge.
        </p>
      ) : null}
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
                            className="mr-2.5 h-4 w-4 accent-[var(--signal)]"
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
    </div>
  );
}

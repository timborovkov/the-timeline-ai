'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';

import type * as objects from '@timeline/shared/objects';

import { ObjectTextFilter } from '@/components/boards/object-text-filter';
import { filterObjectsByText } from '@/lib/object-filter';

type GroupKey = 'status' | 'stage' | 'priority' | 'type';

interface Props {
  rows: objects.ObjectRow[];
  groupBy?: GroupKey;
}

function colValue(row: objects.ObjectRow, key: GroupKey): string {
  const v = row[key];
  if (v === null) return 'unset';
  return String(v);
}

export function ObjectList({ rows, groupBy = 'status' }: Props) {
  const [filterQuery, setFilterQuery] = useState('');
  const visibleRows = useMemo(() => filterObjectsByText(rows, filterQuery), [rows, filterQuery]);

  if (rows.length === 0) {
    return (
      <p className="py-10 text-center font-mono text-xs uppercase tracking-[0.12em] text-fg-dim">
        NOTHING MATCHES THIS FILTER
      </p>
    );
  }
  const grouped = new Map<string, objects.ObjectRow[]>();
  for (const r of visibleRows) {
    const k = colValue(r, groupBy);
    const list = grouped.get(k) ?? [];
    list.push(r);
    grouped.set(k, list);
  }
  const keys = Array.from(grouped.keys()).sort();
  return (
    <div className="space-y-6">
      <ObjectTextFilter
        query={filterQuery}
        onQueryChange={setFilterQuery}
        resultCount={visibleRows.length}
        totalCount={rows.length}
      />
      {visibleRows.length === 0 ? (
        <p className="py-10 text-center font-mono text-xs uppercase tracking-[0.12em] text-fg-dim">
          NOTHING MATCHES THIS FILTER
        </p>
      ) : (
        keys.map((k) => (
          <section key={k} aria-label={k}>
            <div className="mb-2 flex items-baseline justify-between border-b border-border pb-1.5">
              <h2 className="font-mono text-[11px] uppercase tracking-[0.14em] text-fg">{k}</h2>
              <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-dim">
                {grouped.get(k)?.length ?? 0}
              </span>
            </div>
            <ul className="border border-border">
              {(grouped.get(k) ?? []).map((r) => (
                <li key={r.id} className="border-b border-border last:border-b-0">
                  <Link
                    href={`/app/objects/${r.id}`}
                    className="flex items-center justify-between px-3 py-2 text-sm transition-colors hover:bg-surface"
                  >
                    <span className="min-w-0 flex-1 truncate font-medium text-fg">
                      {r.canonicalName}
                    </span>
                    <span className="ml-3 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.1em] text-fg-dim">
                      <span>{r.type}</span>
                      {r.dueAt && <span>· {new Date(r.dueAt).toLocaleDateString('en-CA')}</span>}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}

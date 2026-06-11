'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';

import type * as objects from '@timeline/shared/objects';

import { ObjectTextFilter } from '@/components/boards/object-text-filter';
import { filterObjectsByText } from '@/lib/object-filter';

export function ObjectTable({ rows }: { rows: objects.ObjectRow[] }) {
  const [filterQuery, setFilterQuery] = useState('');
  const visibleRows = useMemo(() => filterObjectsByText(rows, filterQuery), [rows, filterQuery]);

  if (rows.length === 0) {
    return (
      <p className="py-10 text-center font-mono text-xs uppercase tracking-[0.12em] text-fg-dim">
        NOTHING MATCHES THIS FILTER
      </p>
    );
  }
  return (
    <div className="space-y-3">
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
        <div className="overflow-x-auto rounded-sm border border-border bg-surface">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-bg text-left font-mono text-[11px] uppercase tracking-[0.12em] text-fg-dim">
              <tr>
                <th className="px-3 py-2 font-normal">Name</th>
                <th className="px-3 py-2 font-normal">Type</th>
                <th className="px-3 py-2 font-normal">Status</th>
                <th className="px-3 py-2 font-normal">Stage</th>
                <th className="px-3 py-2 font-normal">Due</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((r) => (
                <tr key={r.id} className="border-t border-border transition-colors hover:bg-bg">
                  <td className="px-3 py-2">
                    <Link
                      href={`/app/objects/${r.id}`}
                      className="font-medium text-fg hover:underline"
                    >
                      {r.canonicalName}
                    </Link>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-fg-muted">{r.type}</td>
                  <td className="px-3 py-2 font-mono text-xs text-fg-muted">{r.status}</td>
                  <td className="px-3 py-2 font-mono text-xs text-fg-muted">{r.stage ?? '-'}</td>
                  <td className="px-3 py-2 font-mono text-xs text-fg-muted">
                    {r.dueAt ? new Date(r.dueAt).toLocaleDateString('en-CA') : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

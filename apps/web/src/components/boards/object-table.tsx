import Link from 'next/link';

import type * as objects from '@timeline/shared/objects';

export function ObjectTable({ rows }: { rows: objects.ObjectRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="py-10 text-center font-mono text-xs uppercase tracking-[0.12em] text-fg-dim">
        NOTHING MATCHES THIS FILTER
      </p>
    );
  }
  return (
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
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-border transition-colors hover:bg-bg">
              <td className="px-3 py-2">
                <Link href={`/app/objects/${r.id}`} className="font-medium text-fg hover:underline">
                  {r.canonicalName}
                </Link>
              </td>
              <td className="px-3 py-2 font-mono text-xs text-fg-muted">{r.type}</td>
              <td className="px-3 py-2 font-mono text-xs text-fg-muted">{r.status}</td>
              <td className="px-3 py-2 font-mono text-xs text-fg-muted">{r.stage ?? '—'}</td>
              <td className="px-3 py-2 font-mono text-xs text-fg-muted">
                {r.dueAt ? new Date(r.dueAt).toLocaleDateString('en-CA') : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

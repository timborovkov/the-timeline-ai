import { type objects } from '@timeline/shared';
import Link from 'next/link';

export function ObjectTable({ rows }: { rows: objects.ObjectRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="rounded-xl border border-dashed bg-card/40 px-6 py-12 text-center text-sm text-muted-foreground">
        Nothing matches this filter.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-4 py-2 font-medium">Name</th>
            <th className="px-4 py-2 font-medium">Type</th>
            <th className="px-4 py-2 font-medium">Status</th>
            <th className="px-4 py-2 font-medium">Stage</th>
            <th className="px-4 py-2 font-medium">Due</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t hover:bg-accent/30">
              <td className="px-4 py-2">
                <Link href={`/app/objects/${r.id}`} className="font-medium hover:underline">
                  {r.canonicalName}
                </Link>
              </td>
              <td className="px-4 py-2 text-muted-foreground">{r.type}</td>
              <td className="px-4 py-2 text-muted-foreground">{r.status}</td>
              <td className="px-4 py-2 text-muted-foreground">{r.stage ?? '—'}</td>
              <td className="px-4 py-2 text-muted-foreground">
                {r.dueAt ? new Date(r.dueAt).toLocaleDateString() : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

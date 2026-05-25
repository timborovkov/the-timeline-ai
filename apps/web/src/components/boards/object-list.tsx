import { type objects } from '@timeline/shared';
import Link from 'next/link';

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
  if (rows.length === 0) {
    return (
      <p className="rounded-xl border border-dashed bg-card/40 px-6 py-12 text-center text-sm text-muted-foreground">
        Nothing matches this filter.
      </p>
    );
  }
  const grouped = new Map<string, objects.ObjectRow[]>();
  for (const r of rows) {
    const k = colValue(r, groupBy);
    const list = grouped.get(k) ?? [];
    list.push(r);
    grouped.set(k, list);
  }
  const keys = Array.from(grouped.keys()).sort();
  return (
    <div className="space-y-8">
      {keys.map((k) => (
        <section key={k}>
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="text-sm font-medium tracking-tight">{k}</h2>
            <span className="text-xs text-muted-foreground">{grouped.get(k)?.length ?? 0}</span>
          </div>
          <ul className="space-y-1.5">
            {(grouped.get(k) ?? []).map((r) => (
              <li key={r.id}>
                <Link
                  href={`/app/objects/${r.id}`}
                  className="flex items-center justify-between rounded-lg border bg-card px-4 py-2 text-sm hover:border-primary/30 hover:bg-accent/40"
                >
                  <span className="min-w-0 flex-1 truncate font-medium">{r.canonicalName}</span>
                  <span className="ml-3 flex items-center gap-2 text-[11px] uppercase tracking-wide text-muted-foreground">
                    <span>{r.type}</span>
                    {r.dueAt && <span>· {new Date(r.dueAt).toLocaleDateString()}</span>}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

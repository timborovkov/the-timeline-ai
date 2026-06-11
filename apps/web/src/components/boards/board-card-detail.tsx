import Link from 'next/link';

import type * as boards from '@timeline/shared/boards';

export function BoardCardDetail({
  boardId,
  item,
  history,
}: {
  boardId: string;
  item: boards.BoardItemRow | null;
  history: boards.BoardItemChangeRow[];
}) {
  if (!item) return null;
  return (
    <aside
      className="rounded-sm border border-border bg-surface p-4"
      aria-label="Board card detail"
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold text-fg">{item.object.canonicalName}</h2>
          <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.12em] text-fg-dim">
            {item.object.type} · board item
          </p>
        </div>
        <Link
          href={`/app/boards/${boardId}`}
          className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-muted hover:text-fg"
        >
          Close
        </Link>
      </div>

      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-sm border border-border bg-border text-sm">
        <Detail label="Responsible" value={item.responsibleUserId ? 'Assigned' : '-'} />
        <Detail
          label="Due"
          value={item.dueAt ? new Date(item.dueAt).toLocaleDateString('en-CA') : '-'}
        />
        <Detail label="Priority" value={item.priority ? `P${item.priority}` : '-'} />
        <Detail label="Object status" value={item.object.status} />
      </dl>

      {item.nextStep ? (
        <section className="mt-4">
          <h3 className="mb-1 font-mono text-[11px] uppercase tracking-[0.14em] text-fg-dim">
            Next step
          </h3>
          <p className="text-sm text-fg">{item.nextStep}</p>
        </section>
      ) : null}

      {item.notes ? (
        <section className="mt-4">
          <h3 className="mb-1 font-mono text-[11px] uppercase tracking-[0.14em] text-fg-dim">
            Board notes
          </h3>
          <p className="whitespace-pre-wrap text-sm text-fg-muted">{item.notes}</p>
        </section>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <Link
          href={`/app/objects/${item.entityId}`}
          className="rounded-sm border border-border px-2 py-1 text-xs font-medium hover:bg-bg"
        >
          Open object
        </Link>
        <Link
          href={`/app/chat?object=${item.entityId}`}
          className="rounded-sm border border-border px-2 py-1 text-xs font-medium hover:bg-bg"
        >
          Ask about object
        </Link>
      </div>

      <section className="mt-5">
        <h3 className="mb-2 font-mono text-[11px] uppercase tracking-[0.14em] text-fg-dim">
          History
        </h3>
        {history.length === 0 ? (
          <p className="text-sm text-fg-muted">No board history yet.</p>
        ) : (
          <ol className="space-y-2">
            {history.map((change) => (
              <li key={change.id} className="border-l border-border pl-3 text-xs text-fg-muted">
                <span className="font-mono uppercase tracking-[0.1em] text-fg-dim">
                  {change.field} · {change.status}
                </span>
                <span className="block">{change.changedAt.toLocaleString()}</span>
                {change.note ? <span className="block text-fg">{change.note}</span> : null}
              </li>
            ))}
          </ol>
        )}
      </section>
    </aside>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-bg p-2">
      <dt className="font-mono text-[10px] uppercase tracking-[0.12em] text-fg-dim">{label}</dt>
      <dd className="mt-1 truncate text-sm text-fg">{value}</dd>
    </div>
  );
}

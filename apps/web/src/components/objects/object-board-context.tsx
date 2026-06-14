import Link from 'next/link';

import type * as boards from '@timeline/shared/boards';

import { displayText } from '@/lib/display-dates';

export function ObjectBoardContext({ rows }: { rows: boards.ObjectBoardContextRow[] }) {
  if (rows.length === 0) return null;
  return (
    <section className="rounded-sm border border-border bg-surface p-3">
      <h2 className="mb-3 font-mono text-[11px] uppercase tracking-[0.14em] text-fg-dim">Boards</h2>
      <ul className="grid gap-2 sm:grid-cols-2">
        {rows.map((row) => (
          <li key={row.itemId} className="rounded-sm border border-border bg-bg p-3">
            <Link
              href={`/app/boards/${row.boardId}?item=${row.itemId}`}
              className="font-medium hover:underline"
            >
              {displayText(row.boardName)}
            </Link>
            <div className="mt-2 flex flex-wrap gap-2 font-mono text-[11px] uppercase tracking-[0.1em] text-fg-dim">
              {row.laneName ? <span>{displayText(row.laneName)}</span> : <span>No stage</span>}
              {row.responsibleUserId ? <span>· assigned</span> : null}
              {row.dueAt ? <span>· due {row.dueAt.toLocaleDateString('en-CA')}</span> : null}
              {row.priority ? <span>· p{row.priority}</span> : null}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

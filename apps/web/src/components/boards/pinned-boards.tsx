import { Pin } from 'lucide-react';
import Link from 'next/link';

import type * as boards from '@timeline/shared/boards';

export function PinnedBoards({ boards: rows }: { boards: boards.BoardRow[] }) {
  if (rows.length === 0) return null;
  return (
    <section className="space-y-3" aria-label="Pinned boards">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.14em] text-fg-dim">Boards</h2>
        <Link
          href="/app/boards"
          className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-muted hover:text-fg"
        >
          Manage
        </Link>
      </div>
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {rows.map((board) => (
          <Link
            key={board.id}
            href={`/app/boards/${board.id}`}
            className="rounded-sm border border-border bg-surface p-3 transition-colors hover:border-border-strong"
          >
            <span className="mb-3 flex items-center justify-between gap-3">
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg">
                {board.name}
              </span>
              <Pin className="size-3.5 text-signal" aria-hidden="true" />
            </span>
            <span className="flex flex-wrap gap-2 font-mono text-[11px] uppercase tracking-[0.1em] text-fg-dim">
              <span>{board.templateKind.replace('_', ' ')}</span>
              <span>· {board.itemCount} items</span>
              <span>· {board.updatedAt.toLocaleDateString('en-CA')}</span>
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

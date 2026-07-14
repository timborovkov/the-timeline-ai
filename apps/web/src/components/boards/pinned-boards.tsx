import { Pin } from 'lucide-react';
import Link from 'next/link';

import type * as boards from '@timeline/shared/boards';

import { SectionHeading } from '@/components/section-heading';
import { formatDisplayDate } from '@/lib/display-dates';

export function PinnedBoards({ boards: rows }: { boards: boards.BoardRow[] }) {
  if (rows.length === 0) return null;
  return (
    <section className="space-y-3" aria-label="Pinned boards">
      <SectionHeading
        actions={
          <Link href="/app/boards" className="text-sm text-fg-muted hover:text-fg">
            Manage
          </Link>
        }
      >
        Pinned work
      </SectionHeading>
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {rows.map((board) => (
          <Link
            key={board.id}
            href={`/app/boards/${board.id}`}
            className="rounded-lg border border-border bg-surface p-3 transition-colors hover:border-border-strong"
          >
            <span className="mb-3 flex items-center justify-between gap-3">
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg">
                {board.name}
              </span>
              <Pin className="size-3.5 text-signal" aria-hidden="true" />
            </span>
            <span className="flex flex-wrap gap-x-2 gap-y-1 text-xs text-fg-muted">
              <span className="capitalize">{board.templateKind.replace('_', ' ')}</span>
              <span className="font-mono">{board.itemCount} items</span>
              {board.laneCounts.slice(0, 3).map((lane) => (
                <span key={lane.laneId ?? 'unset'}>
                  {lane.laneName}: <span className="font-mono">{lane.count}</span>
                </span>
              ))}
              {board.overdueCount > 0 ? (
                <span className="text-danger">
                  <span className="font-mono">{board.overdueCount}</span> overdue
                </span>
              ) : null}
              {board.dueSoonCount > 0 ? (
                <span className="text-signal">
                  <span className="font-mono">{board.dueSoonCount}</span> due soon
                </span>
              ) : null}
              <span>{formatDisplayDate(board.updatedAt)}</span>
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

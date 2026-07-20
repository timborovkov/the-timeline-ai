'use client';

import Link from 'next/link';

import type * as boards from '@timeline/shared/boards';

import { DueDateDisplay } from '@/components/due-date-display';
import { useWorkspaceTimezone } from '@/components/workspace-timezone-context';
import { displayText } from '@/lib/display-dates';

export function ObjectBoardContext({ rows }: { rows: boards.ObjectBoardContextRow[] }) {
  const timezone = useWorkspaceTimezone();
  if (rows.length === 0) return null;
  return (
    <section className="rounded-sm border border-border bg-surface p-3">
      <h2 className="mb-3 text-xs text-fg-dim">Boards</h2>
      <ul className="grid gap-2 sm:grid-cols-2">
        {rows.map((row) => (
          <li key={row.itemId} className="rounded-sm border border-border bg-bg p-3">
            <Link
              href={`/app/boards/${row.boardId}?item=${row.itemId}`}
              className="font-medium hover:underline"
            >
              {displayText(row.boardName)}
            </Link>
            <div className="mt-2 flex flex-wrap gap-2 text-xs text-fg-dim">
              {row.laneName ? <span>{displayText(row.laneName)}</span> : <span>No stage</span>}
              {row.responsibleUserId ? <span>· assigned</span> : null}
              <DueDateDisplay value={row.dueAt} timezone={timezone} variant="compact" />
              {row.priority ? <span>· p{row.priority}</span> : null}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

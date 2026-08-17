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
    <section>
      <h2 className="text-xs text-fg-dim">Boards</h2>
      <ul className="mt-2 space-y-2">
        {rows.map((row) => (
          <li key={row.itemId} className="min-w-0">
            <Link
              href={`/app/boards/${row.boardId}?item=${row.itemId}`}
              className="font-medium hover:underline"
            >
              {displayText(row.boardName)}
            </Link>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-fg-dim">
              {row.laneName ? <span>{displayText(row.laneName)}</span> : <span>No stage</span>}
              {row.responsibleUserId ? <span>assigned</span> : null}
              <DueDateDisplay value={row.dueAt} timezone={timezone} variant="compact" />
              {row.priority ? <span>P{row.priority}</span> : null}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

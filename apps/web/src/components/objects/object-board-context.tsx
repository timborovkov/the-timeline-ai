'use client';

import Link from 'next/link';

import type * as boards from '@timeline/shared/boards';

import { displayText } from '@/lib/display-dates';

export function ObjectBoardContext({ rows }: { rows: boards.ObjectBoardContextRow[] }) {
  if (rows.length === 0) return null;
  return (
    <p className="mt-1 text-xs leading-4 text-fg-dim" aria-label="Boards">
      {rows.map((row, index) => (
        <span key={row.itemId}>
          {index > 0 ? <span aria-hidden="true"> · </span> : null}
          <Link
            href={`/app/boards/${row.boardId}?item=${row.itemId}`}
            className="hover:text-fg hover:underline"
          >
            {displayText(row.boardName)}
          </Link>
          {row.laneName ? ` · ${displayText(row.laneName)}` : ''}
        </span>
      ))}
    </p>
  );
}

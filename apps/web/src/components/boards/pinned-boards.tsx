'use client';

import { Pin } from 'lucide-react';
import Link from 'next/link';

import type * as boards from '@timeline/shared/boards';
import type { ObjectRow } from '@timeline/shared/objects/types';

import { SectionHeading } from '@/components/section-heading';
import { useWorkspaceTimezone } from '@/components/workspace-timezone-context';
import { displayText } from '@/lib/display-dates';
import { formatDisplayDate } from '@/lib/display-dates';
import { displayObjectTitle } from '@/lib/object-title';
import { statusLabel } from '@/lib/status-labels';

const EMPTY_OBJECTS: ObjectRow[] = [];

export function PinnedBoards({
  boards: boardRows,
  objects = EMPTY_OBJECTS,
}: {
  boards: boards.BoardRow[];
  objects?: ObjectRow[];
}) {
  const timezone = useWorkspaceTimezone();
  if (boardRows.length === 0 && objects.length === 0) return null;
  return (
    <section className="space-y-3" aria-label="Pinned work">
      <SectionHeading
        actions={
          <Link href="/app/work" className="text-sm text-fg-muted hover:text-fg">
            Open work
          </Link>
        }
      >
        Pinned work
      </SectionHeading>
      <div className="divide-y divide-border border-y border-border">
        {objects.map((object) => (
          <Link
            key={object.id}
            href={`/app/objects/${object.id}`}
            className="group grid gap-2 py-3 transition-colors hover:bg-surface sm:grid-cols-[minmax(0,1fr)_auto] sm:px-3"
          >
            <span className="min-w-0">
              <span className="flex items-center gap-2">
                <Pin className="size-3.5 shrink-0 fill-current text-signal" aria-hidden="true" />
                <span className="truncate text-sm font-medium text-fg">
                  {displayText(displayObjectTitle(object))}
                </span>
              </span>
              <span className="mt-1 block text-xs text-fg-muted">
                {statusLabel(object.type)} · {statusLabel(object.status)}
              </span>
            </span>
            <span className="self-center text-xs text-fg-dim">
              Updated {formatDisplayDate(object.updatedAt, { timezone })}
            </span>
          </Link>
        ))}
        {boardRows.map((board) => (
          <Link
            key={board.id}
            href={`/app/boards/${board.id}`}
            className="group grid gap-2 py-3 transition-colors hover:bg-surface sm:grid-cols-[minmax(0,1fr)_auto] sm:px-3"
          >
            <span className="min-w-0">
              <span className="flex items-center gap-2">
                <Pin className="size-3.5 shrink-0 fill-current text-signal" aria-hidden="true" />
                <span className="truncate text-sm font-medium text-fg">{board.name}</span>
              </span>
              <span className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-xs text-fg-muted">
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
              </span>
            </span>
            <span className="self-center text-xs text-fg-dim">
              Updated {formatDisplayDate(board.updatedAt, { timezone })}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

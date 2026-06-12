import Link from 'next/link';

import type * as boards from '@timeline/shared/boards';

import { boardViewHref, type BoardLayout } from '@/lib/board-links';

export function CuratedBoardTable({
  boardId,
  view,
  items,
}: {
  boardId: string;
  view: BoardLayout;
  items: boards.BoardItemRow[];
}) {
  if (items.length === 0) return <EmptyBoardItems />;
  return (
    <div className="overflow-x-auto rounded-sm border border-border bg-surface">
      <table className="w-full text-sm">
        <thead className="border-b border-border bg-bg text-left font-mono text-[11px] uppercase tracking-[0.12em] text-fg-dim">
          <tr>
            <th className="px-3 py-2 font-normal">Name</th>
            <th className="px-3 py-2 font-normal">Type</th>
            <th className="px-3 py-2 font-normal">Responsible</th>
            <th className="px-3 py-2 font-normal">Due</th>
            <th className="px-3 py-2 font-normal">Priority</th>
            <th className="px-3 py-2 font-normal">Next step</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} className="border-t border-border transition-colors hover:bg-bg">
              <td className="px-3 py-2">
                <Link
                  href={boardViewHref(boardId, view, item.id)}
                  className="font-medium hover:underline"
                >
                  {item.object.canonicalName}
                </Link>
              </td>
              <td className="px-3 py-2 font-mono text-xs text-fg-muted">{item.object.type}</td>
              <td className="px-3 py-2 font-mono text-xs text-fg-muted">
                {item.responsibleUserId ? 'assigned' : '-'}
              </td>
              <td className="px-3 py-2 font-mono text-xs text-fg-muted">
                {item.dueAt ? new Date(item.dueAt).toLocaleDateString('en-CA') : '-'}
              </td>
              <td className="px-3 py-2 font-mono text-xs text-fg-muted">
                {item.priority ? `p${item.priority}` : '-'}
              </td>
              <td className="max-w-[24rem] truncate px-3 py-2 text-xs text-fg-muted">
                {item.nextStep ?? '-'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CuratedBoardList({
  boardId,
  view,
  items,
}: {
  boardId: string;
  view: BoardLayout;
  items: boards.BoardItemRow[];
}) {
  if (items.length === 0) return <EmptyBoardItems />;
  return (
    <ul className="divide-y divide-border border border-border bg-surface">
      {items.map((item) => (
        <li key={item.id}>
          <Link
            href={boardViewHref(boardId, view, item.id)}
            className="flex items-center justify-between gap-3 px-3 py-2 text-sm hover:bg-bg"
          >
            <span className="min-w-0 flex-1 truncate font-medium text-fg">
              {item.object.canonicalName}
            </span>
            <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-fg-dim">
              {item.object.type}
              {item.dueAt ? ` · ${new Date(item.dueAt).toLocaleDateString('en-CA')}` : ''}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function EmptyBoardItems() {
  return (
    <p className="py-10 text-center font-mono text-xs uppercase tracking-[0.12em] text-fg-dim">
      NO BOARD ITEMS YET
    </p>
  );
}

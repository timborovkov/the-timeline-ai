import { withTeam } from '@timeline/shared/team-scope';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import type { Metadata } from 'next';

import { BoardAddItemForm } from '@/components/boards/board-add-item-form';
import { BoardCardDetail } from '@/components/boards/board-card-detail';
import { BoardPinButton } from '@/components/boards/board-pin-button';
import { CuratedBoardList, CuratedBoardTable } from '@/components/boards/curated-board-views';
import { CuratedKanbanBoard } from '@/components/boards/curated-kanban-board';
import { DeleteBoardButton } from '@/components/boards/delete-board-button';
import { HistoryBackLink } from '@/components/history-back-link';
import { IndexStrip } from '@/components/index-strip';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { boardViewHref, type BoardLayout } from '@/lib/board-links';
import { db } from '@/lib/db';

export const metadata: Metadata = {
  title: 'Board',
  description: 'Review a curated board and its timeline context.',
};

function viewParam(value: string | string[] | undefined): BoardLayout {
  const v = Array.isArray(value) ? value[0] : value;
  return v === 'table' || v === 'list' ? v : 'kanban';
}

function itemParam(value: string | string[] | undefined): string | null {
  const v = Array.isArray(value) ? value[0] : value;
  return typeof v === 'string' && v.length > 0 ? v : null;
}

export default async function BoardDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [session, { id }, query] = await Promise.all([auth(), params, searchParams]);
  if (!session?.user) redirect('/sign-in');
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) redirect('/sign-in');

  const scope = withTeam(db, active.teamId, session.user.id);
  const board = await scope.boards.getBoard(id, { itemLimit: 'all' });
  if (!board) notFound();
  const view = viewParam(query.view);
  const selectedItemId = itemParam(query.item);
  const selectedItem = selectedItemId
    ? (board.items.find((item) => item.id === selectedItemId) ?? null)
    : null;
  const [candidates, history] = await Promise.all([
    scope.objects.listObjects({
      archived: false,
      limit: 200,
    }),
    selectedItem ? scope.boards.listBoardItemHistory(selectedItem.id) : Promise.resolve([]),
  ]);
  const firstLaneId = board.lanes.find((lane) => !lane.archivedAt)?.id ?? null;
  const isKanban = view === 'kanban';

  return (
    <div className={isKanban ? 'flex h-[calc(100dvh-10rem)] flex-col' : undefined}>
      <IndexStrip
        srLabel={`${board.name} · ${board.templateKind} · ${board.itemCount} board items`}
        segments={[
          { value: 'BOARD' },
          { label: 'kind', value: board.templateKind.replace('_', ' ') },
          { label: 'name', value: board.name, signal: true },
          { label: 'items', value: board.itemCount },
        ]}
        className="mb-4 shrink-0"
      >
        <span className="inline-flex items-center gap-2">
          <HistoryBackLink fallbackHref="/app/boards" label="Back" />
          <BoardPinButton id={board.id} pinned={board.pinned} />
          <DeleteBoardButton id={board.id} />
        </span>
      </IndexStrip>

      <div className="mb-4 flex shrink-0 flex-wrap items-center justify-between gap-3">
        <p className="max-w-3xl text-sm text-fg-muted">
          {board.purpose || 'A curated board over workspace objects.'}
        </p>
        <nav className="inline-flex overflow-hidden rounded-sm border border-border">
          {(['kanban', 'table', 'list'] as const).map((v) => (
            <Link
              key={v}
              href={boardViewHref(board.id, v, selectedItemId)}
              className={`px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] ${
                view === v ? 'bg-signal text-signal-fg' : 'bg-bg text-fg-muted hover:text-fg'
              }`}
            >
              {v}
            </Link>
          ))}
        </nav>
      </div>

      <div className="mb-4 shrink-0">
        <BoardAddItemForm
          boardId={board.id}
          defaultLaneId={firstLaneId}
          candidates={candidates.filter(
            (row) => !board.items.some((item) => item.entityId === row.id),
          )}
          recommendedTypes={board.recommendedObjectTypes}
        />
      </div>

      <div
        className={
          selectedItem
            ? 'grid min-h-0 flex-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(22rem,0.35fr)]'
            : 'min-h-0 flex-1'
        }
      >
        <div className="min-h-0">
          {view === 'kanban' && (
            <CuratedKanbanBoard boardId={board.id} lanes={board.lanes} items={board.items} />
          )}
          {view === 'table' && (
            <CuratedBoardTable boardId={board.id} view={view} items={board.items} />
          )}
          {view === 'list' && (
            <CuratedBoardList boardId={board.id} view={view} items={board.items} />
          )}
        </div>
        {selectedItem ? (
          <BoardCardDetail boardId={board.id} view={view} item={selectedItem} history={history} />
        ) : null}
      </div>
    </div>
  );
}

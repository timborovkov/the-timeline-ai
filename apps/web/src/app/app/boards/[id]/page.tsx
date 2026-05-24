import { objects, withTeam } from '@timeline/shared';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { DeleteBoardButton } from '@/components/boards/delete-board-button';
import { KanbanBoard } from '@/components/boards/kanban-board';
import { ObjectList } from '@/components/boards/object-list';
import { ObjectTable } from '@/components/boards/object-table';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

type GroupKey = 'status' | 'stage' | 'priority' | 'type';

const VALID_GROUP_KEYS: readonly GroupKey[] = ['status', 'stage', 'priority', 'type'];

function isGroupKey(v: string | null | undefined): v is GroupKey {
  return v !== null && v !== undefined && (VALID_GROUP_KEYS as readonly string[]).includes(v);
}

export default async function BoardDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect('/sign-in');
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) redirect('/sign-in');

  const scope = withTeam(db, active.teamId, session.user.id);
  const { id } = await params;
  const board = await objects.getBoardView(db, scope, id);
  if (!board) notFound();

  const rows = await objects.listObjects(db, scope, board.filter);

  const groupBy: GroupKey = isGroupKey(board.groupBy) ? board.groupBy : 'status';

  return (
    <div>
      <header className="mb-8 flex items-end justify-between gap-6">
        <div>
          <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
            <Link href="/app/boards" className="hover:underline">
              Boards
            </Link>{' '}
            · {board.kind}
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">{board.name}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {rows.length} object{rows.length === 1 ? '' : 's'}
            {board.kind !== 'table' && ` · grouped by ${groupBy}`}
          </p>
        </div>
        <DeleteBoardButton id={board.id} />
      </header>

      {board.kind === 'kanban' && (
        <KanbanBoard rows={rows} groupBy={groupBy === 'type' ? 'status' : groupBy} />
      )}
      {board.kind === 'table' && <ObjectTable rows={rows} />}
      {board.kind === 'list' && <ObjectList rows={rows} groupBy={groupBy} />}
    </div>
  );
}

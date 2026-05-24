import { objects, withTeam } from '@timeline/shared';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { BoardCreateForm } from '@/components/boards/board-create-form';
import { NarrowContainer } from '@/components/narrow-container';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

export default async function BoardsIndexPage() {
  const session = await auth();
  if (!session?.user) redirect('/sign-in');
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) redirect('/sign-in');

  const scope = withTeam(db, active.teamId, session.user.id);
  const boards = await objects.listBoardViews(db, scope);

  return (
    <NarrowContainer>
      <header className="mb-10">
        <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Boards</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Saved boards</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Pin a filter as a kanban, table, or list view. Boards are shared with the team.
        </p>
      </header>

      <div className="mb-10">
        <BoardCreateForm />
      </div>

      {boards.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-card/40 px-6 py-12 text-center text-sm text-muted-foreground">
          No boards yet. Create one above.
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {boards.map((b) => (
            <li key={b.id}>
              <Link
                href={`/app/boards/${b.id}`}
                className="flex items-center justify-between rounded-lg border bg-card px-4 py-3 text-sm transition-colors hover:border-primary/30 hover:bg-accent/40"
              >
                <span className="min-w-0 flex-1 truncate font-medium">{b.name}</span>
                <span className="ml-3 text-[11px] uppercase tracking-wide text-muted-foreground">
                  {b.kind}
                  {b.groupBy ? ` · by ${b.groupBy}` : ''}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </NarrowContainer>
  );
}

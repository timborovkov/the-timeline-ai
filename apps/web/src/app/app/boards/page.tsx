import { objects, withTeam } from '@timeline/shared';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { BoardCreateForm } from '@/components/boards/board-create-form';
import { IndexStrip } from '@/components/index-strip';
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
    <div className="mx-auto max-w-4xl space-y-6">
      <IndexStrip
        srLabel={`Boards · ${boards.length} saved views`}
        segments={[
          { value: 'BOARDS' },
          { label: 'saved', value: boards.length },
        ]}
      />

      <section
        aria-label="Create board"
        className="rounded-sm border border-border bg-surface p-4"
      >
        <BoardCreateForm />
      </section>

      {boards.length === 0 ? (
        <div className="py-10 text-center font-mono text-xs uppercase tracking-[0.12em] text-fg-dim">
          NO BOARDS YET → PIN A FILTER ABOVE
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-px overflow-hidden border border-border sm:grid-cols-2">
          {boards.map((b) => (
            <li key={b.id} className="bg-bg">
              <Link
                href={`/app/boards/${b.id}`}
                className="flex items-center justify-between px-3 py-2.5 text-sm transition-colors hover:bg-surface"
              >
                <span className="min-w-0 flex-1 truncate font-medium text-fg">
                  {b.name}
                </span>
                <span className="ml-3 font-mono text-[11px] uppercase tracking-[0.1em] text-fg-dim">
                  {b.kind}
                  {b.groupBy ? ` · by ${b.groupBy}` : ''}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

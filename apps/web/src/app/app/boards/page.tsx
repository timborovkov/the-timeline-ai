import { withTeam } from '@timeline/shared/team-scope';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import type { Metadata } from 'next';

import { BoardCreateForm } from '@/components/boards/board-create-form';
import { BoardPinButton } from '@/components/boards/board-pin-button';
import { EmptyAction } from '@/components/empty-action';
import { IndexStrip } from '@/components/index-strip';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

export const metadata: Metadata = {
  title: 'Boards',
  description: 'Browse curated boards for timeline work.',
};

export default async function BoardsIndexPage() {
  const session = await auth();
  if (!session?.user) redirect('/sign-in');
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) redirect('/sign-in');

  const scope = withTeam(db, active.teamId, session.user.id);
  const boards = await scope.boards.listBoards();

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <IndexStrip
        srLabel={`Boards · ${boards.length} curated boards`}
        segments={[{ value: 'BOARDS' }, { label: 'curated', value: boards.length }]}
      />

      <section aria-label="Create board" className="rounded-sm border border-border bg-surface p-4">
        <BoardCreateForm />
      </section>

      {boards.length === 0 ? (
        <EmptyAction
          title="No boards yet"
          body="Boards are curated work surfaces over objects and tasks. Create a pipeline, task board, catalog, or custom board."
          href="/app#capture"
          action="Capture source material"
        />
      ) : (
        <ul className="grid grid-cols-1 gap-px overflow-hidden border border-border sm:grid-cols-2">
          {boards.map((b) => (
            <li key={b.id} className="bg-bg">
              <Link href={`/app/boards/${b.id}`} className="block px-3 py-2.5 hover:bg-surface">
                <span className="flex items-center justify-between gap-3">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg">
                    {b.name}
                  </span>
                  <BoardPinButton id={b.id} pinned={b.pinned} />
                </span>
                <span className="mt-1 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.1em] text-fg-dim">
                  <span>{b.templateKind.replace('_', ' ')}</span>
                  <span>· {b.itemCount} items</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

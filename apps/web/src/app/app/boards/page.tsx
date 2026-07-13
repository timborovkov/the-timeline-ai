import { withTeam } from '@timeline/shared/team-scope';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import type { Metadata } from 'next';

import { BoardCreateDialog } from '@/components/boards/board-create-form';
import { BoardPinButton } from '@/components/boards/board-pin-button';
import { EmptyAction } from '@/components/empty-action';
import { IndexStrip } from '@/components/index-strip';
import { WORK_BACK_LINK } from '@/components/work-back-link';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { visibleBoardDescription } from '@/lib/board-description';
import { db } from '@/lib/db';
import { formatDisplayDate } from '@/lib/display-dates';

export const metadata: Metadata = {
  title: 'Boards',
  description: 'Browse boards for timeline work.',
};

const BOARD_CREATE_DIALOG = <BoardCreateDialog />;

export default async function BoardsIndexPage() {
  const session = await auth();
  if (!session?.user) redirect('/sign-in');
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) redirect('/sign-in');

  const scope = withTeam(db, active.teamId, session.user.id);
  const boards = await scope.boards.listBoards();

  return (
    <div className="space-y-6">
      <IndexStrip
        srLabel={`Boards · ${boards.length} boards`}
        segments={[{ value: 'BOARDS' }, { label: 'total', value: boards.length }]}
        leading={WORK_BACK_LINK}
        trailing={BOARD_CREATE_DIALOG}
      />

      {boards.length === 0 ? (
        <EmptyAction
          title="No boards yet"
          body="Boards are work surfaces over objects and tasks. Start with a preset, then tune the stages to match the way your team works."
          href="/app#capture"
          action="Capture source material"
        />
      ) : (
        <ul className="divide-y divide-border border border-border" aria-label="Boards">
          {boards.map((b) => {
            const description = visibleBoardDescription(b.purpose);
            return (
              <li key={b.id} className="bg-bg transition-colors hover:bg-surface">
                <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-start">
                  <Link href={`/app/boards/${b.id}`} className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-fg">{b.name}</span>
                    {description ? (
                      <span className="mt-1 block line-clamp-2 text-sm text-fg-muted">
                        {description}
                      </span>
                    ) : null}
                    <span className="mt-2 flex flex-wrap items-center gap-2 font-mono text-[11px] uppercase tracking-[0.1em] text-fg-dim">
                      <span>{b.templateKind.replaceAll('_', ' ')}</span>
                      <span aria-hidden="true">·</span>
                      <span>{formatDisplayDate(b.updatedAt)}</span>
                    </span>
                  </Link>
                  <div className="flex shrink-0 items-center justify-between gap-3 sm:justify-start">
                    <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-fg-dim">
                      {b.itemCount} items
                    </span>
                    <BoardPinButton id={b.id} pinned={b.pinned} />
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

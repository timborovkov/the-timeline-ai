import { withTeam } from '@timeline/shared/team-scope';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import type { Metadata } from 'next';

import { BoardCreateDialog } from '@/components/boards/board-create-form';
import { CollectionRow } from '@/components/collections/collection-row';
import { PageHeader } from '@/components/page-header';
import { PinOverflowMenu } from '@/components/pins/pin-overflow-menu';
import { ItemActionGroup } from '@/components/ui/item-actions';
import { WorkSubnav } from '@/components/work-subnav';
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
  const [boards, calendarSettings] = await Promise.all([
    scope.boards.listBoards(),
    scope.calendar.getCalendarSettings(),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        variant="collection"
        title="Boards"
        subtitle="Curated work surfaces for the way your team operates."
        metadata={[{ label: 'Total', value: boards.length, mono: true }]}
        srLabel={`${boards.length} ${boards.length === 1 ? 'board' : 'boards'}`}
        trailing={boards.length > 0 ? BOARD_CREATE_DIALOG : undefined}
      />
      <WorkSubnav current="/app/boards" />

      {boards.length === 0 ? (
        <section
          className="border-y border-border py-10 text-center"
          aria-labelledby="empty-boards-title"
        >
          <h2 id="empty-boards-title" className="text-sm font-semibold text-fg">
            No boards yet
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-fg-muted">
            Boards organize the work your team wants to follow. Start with a preset, then tailor its
            stages to match how your team works.
          </p>
          <div className="mt-4 flex justify-center">{BOARD_CREATE_DIALOG}</div>
        </section>
      ) : (
        <ul className="overflow-hidden border-x border-border" aria-label="Boards">
          {boards.map((board) => {
            const description = visibleBoardDescription(board.purpose);
            return (
              <li key={board.id}>
                <CollectionRow>
                  <CollectionRow.Title>
                    <Link
                      href={`/app/boards/${board.id}`}
                      className="block truncate rounded-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {board.name}
                    </Link>
                  </CollectionRow.Title>
                  <CollectionRow.Context>
                    {description ?? board.templateKind.replaceAll('_', ' ')}
                  </CollectionRow.Context>
                  <CollectionRow.Metadata>
                    <>
                      <span className="capitalize">{board.templateKind.replaceAll('_', ' ')}</span>
                      <time dateTime={board.updatedAt.toISOString()}>
                        {formatDisplayDate(board.updatedAt, {
                          timezone: calendarSettings.defaultTimezone,
                        })}
                      </time>
                      <span className="font-mono tabular-nums text-fg-dim">
                        {board.itemCount} {board.itemCount === 1 ? 'item' : 'items'}
                      </span>
                    </>
                  </CollectionRow.Metadata>
                  <CollectionRow.Actions>
                    <ItemActionGroup label={`Actions for ${board.name}`}>
                      <PinOverflowMenu
                        target={{ kind: 'board', key: board.id }}
                        title={board.name}
                        initialPinned={board.pinned}
                      />
                    </ItemActionGroup>
                  </CollectionRow.Actions>
                </CollectionRow>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

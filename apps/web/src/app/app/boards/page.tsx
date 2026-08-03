import { withTeam } from '@timeline/shared/team-scope';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import type { Metadata } from 'next';

import { BoardCreateDialog } from '@/components/boards/board-create-form';
import { PageHeader } from '@/components/page-header';
import { PinOverflowMenu } from '@/components/pins/pin-overflow-menu';
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
        title="Boards"
        subtitle="Curated work surfaces for the way your team operates."
        metadata={[{ label: 'Total', value: boards.length, mono: true }]}
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
            Boards are work surfaces over objects and tasks. Start with a preset, then tune the
            stages to match the way your team works.
          </p>
          <div className="mt-4 flex justify-center">{BOARD_CREATE_DIALOG}</div>
        </section>
      ) : (
        <ul
          className="divide-y divide-border overflow-hidden rounded-lg border border-border"
          aria-label="Boards"
        >
          {boards.map((board) => {
            const description = visibleBoardDescription(board.purpose);
            return (
              <li
                key={board.id}
                className="bg-bg transition-colors hover:bg-surface focus-within:bg-surface"
              >
                <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-start">
                  <Link
                    href={`/app/boards/${board.id}`}
                    className="min-w-0 flex-1 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
                  >
                    <span className="block truncate text-sm font-medium text-fg">{board.name}</span>
                    {description ? (
                      <span className="mt-1 block line-clamp-2 text-sm text-fg-muted">
                        {description}
                      </span>
                    ) : null}
                    <span className="mt-2 flex flex-wrap items-center gap-2 text-xs text-fg-dim">
                      <span className="capitalize">{board.templateKind.replaceAll('_', ' ')}</span>
                      <span aria-hidden="true">·</span>
                      <span>
                        {formatDisplayDate(board.updatedAt, {
                          timezone: calendarSettings.defaultTimezone,
                        })}
                      </span>
                    </span>
                  </Link>
                  <div className="flex shrink-0 items-center justify-between gap-3 sm:justify-start">
                    <span className="font-mono text-xs text-fg-dim">{board.itemCount} items</span>
                    <PinOverflowMenu
                      target={{ kind: 'board', key: board.id }}
                      title={board.name}
                      initialPinned={board.pinned}
                    />
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

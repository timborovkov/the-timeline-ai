import { users } from '@timeline/db';
import { withTeam } from '@timeline/shared/team-scope';
import { inArray } from 'drizzle-orm';
import { notFound, redirect } from 'next/navigation';

import type { BoardLayout } from '@/lib/board-links';
import type { Metadata } from 'next';

import { BoardDetailClient } from '@/components/boards/board-detail-client';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { displayMemberLabel } from '@/lib/display-labels';
import { OBJECT_TYPE_LABELS } from '@/lib/object-type-labels';
import {
  WORK_FILTER_PARAM_KEYS,
  boardItemFilterFromWorkFilters,
  hasActiveWorkFilters,
  parseWorkFilters,
  workFilterHiddenParams,
} from '@/lib/work-filters';

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
  const filters = parseWorkFilters(query);
  const board = await scope.boards.getBoard(id, {
    itemLimit: 'all',
    itemFilter: boardItemFilterFromWorkFilters(filters),
  });
  if (!board) notFound();
  const view = viewParam(query.view);
  const selectedItemId = itemParam(query.item);
  const selectedServerItem = board.items.find((item) => item.id === selectedItemId) ?? null;
  const selectedServerItemId = selectedServerItem?.id ?? null;
  const [candidates, history, members, selectedObjectDetail] = await Promise.all([
    scope.objects.listObjects({
      archived: false,
      limit: 200,
    }),
    selectedServerItemId
      ? scope.boards.listBoardItemHistory(selectedServerItemId)
      : Promise.resolve([]),
    scope.timeline.listMembers(),
    selectedServerItem
      ? scope.objects.getObject(selectedServerItem.entityId)
      : Promise.resolve(null),
  ]);
  const memberIds = members.map((member) => member.userId);
  const memberRows =
    memberIds.length > 0
      ? await db
          .select({ id: users.id, name: users.name, email: users.email })
          .from(users)
          .where(inArray(users.id, memberIds))
      : [];
  const memberMap = new Map(memberRows.map((member) => [member.id, member] as const));
  const memberOptions = members.map((member) => {
    const user = memberMap.get(member.userId);
    return {
      id: member.userId,
      label: displayMemberLabel(user),
    };
  });
  const firstLaneId = board.lanes.find((lane) => !lane.archivedAt)?.id ?? null;
  const isKanban = view === 'kanban';
  const activeFilters = hasActiveWorkFilters(filters);
  const filterParams = workFilterHiddenParams(query, WORK_FILTER_PARAM_KEYS);

  return (
    <div
      data-app-layout={isKanban ? 'full-bleed' : undefined}
      className={
        isKanban
          ? '-mx-4 -my-6 flex h-[calc(100dvh-3.5rem)] min-w-0 flex-col md:-mx-8 md:-my-8'
          : undefined
      }
    >
      <BoardDetailClient
        boardId={board.id}
        boardName={board.name}
        purpose={board.purpose}
        pinned={board.pinned}
        itemCount={board.itemCount}
        view={view}
        lanes={board.lanes}
        initialItems={board.items}
        initialCandidates={candidates}
        recommendedTypes={board.recommendedObjectTypes}
        defaultLaneId={firstLaneId}
        selectedItemId={selectedServerItemId}
        selectedObjectContext={selectedObjectDetail?.connectedWork ?? null}
        history={history}
        members={memberOptions}
        filters={filters}
        activeFilters={activeFilters}
        filterParams={filterParams}
        typeLabels={OBJECT_TYPE_LABELS}
      />
    </div>
  );
}

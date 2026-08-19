import { users } from '@timeline/db';
import { getEnv } from '@timeline/shared/env';
import { withTeam } from '@timeline/shared/team-scope';
import { inArray } from 'drizzle-orm';
import { notFound, redirect } from 'next/navigation';

import type { Metadata } from 'next';

import { BoardDetailClient } from '@/components/boards/board-detail-client';
import { TaskCategoryFilterRefresh } from '@/components/tasks/task-category-filter-refresh';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { boardViewHref, normalizeBoardView, type BoardLayout } from '@/lib/board-links';
import { db } from '@/lib/db';
import { displayMemberLabel } from '@/lib/display-labels';
import { OBJECT_TYPE_LABELS } from '@/lib/object-type-labels';
import { loadBoardAddItemCandidates } from '@/lib/board-add-item-candidates';
import { loadProjectFilterRows } from '@/lib/project-filter-options';
import {
  WORK_FILTER_PARAM_KEYS,
  boardItemFilterFromWorkFilters,
  hasActiveWorkFilters,
  parseWorkFilters,
  taskCategoryFilterKeys,
  workFilterHiddenParams,
} from '@/lib/work-filters';

export const metadata: Metadata = {
  title: 'Board',
  description: 'Review a curated board and its timeline context.',
};

function viewParam(value: string | string[] | undefined): BoardLayout {
  return normalizeBoardView(value);
}

function legacyTableQueryParams(
  query: Record<string, string | string[] | undefined>,
): Record<string, string> {
  const extra: Record<string, string> = {};
  for (const [key, value] of Object.entries(query)) {
    if (key === 'view' || key === 'item') continue;
    const v = Array.isArray(value) ? value[0] : value;
    if (typeof v === 'string' && v.length > 0) extra[key] = v;
  }
  return extra;
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
  const rawView = Array.isArray(query.view) ? query.view[0] : query.view;
  if (rawView === 'table') {
    redirect(boardViewHref(id, 'list', itemParam(query.item), legacyTableQueryParams(query)));
  }

  const scope = withTeam(db, active.teamId, session.user.id);
  const now = new Date();
  const calendarSettings = await scope.calendar.getCalendarSettings();
  const filterTime = { now, timezone: calendarSettings.defaultTimezone };
  const filters = parseWorkFilters(query, {
    taskCategoriesEnabled: getEnv().TASK_CATEGORY_UI_ENABLED,
  });
  const categoryKeys = taskCategoryFilterKeys(filters);
  const categoryFilterBaseline =
    categoryKeys.length > 0
      ? await scope.boards.getTaskCategoryFilterRefreshState(
          id,
          boardItemFilterFromWorkFilters({ ...filters, category: '' }, filterTime),
          categoryKeys,
        )
      : null;
  const board = await scope.boards.getBoard(id, {
    itemLimit: 'all',
    itemFilter: boardItemFilterFromWorkFilters(filters, filterTime),
  });
  if (!board) notFound();
  const view = viewParam(query.view);
  const selectedItemId = itemParam(query.item);
  const selectedServerItem = board.items.find((item) => item.id === selectedItemId) ?? null;
  const selectedServerItemId = selectedServerItem?.id ?? null;
  const [projectRows, addItemCandidates, history, members, selectedObjectDetail] =
    await Promise.all([
      loadProjectFilterRows({
        listObjects: (filter) => scope.objects.listObjects(filter),
        selected: filters.project,
        includeArchivedSelected: true,
      }),
      loadBoardAddItemCandidates({
        listObjects: (filter) => scope.objects.listObjects(filter),
        recommendedTypes: board.recommendedObjectTypes,
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
  const activeFilters = hasActiveWorkFilters(filters);
  const filterParams = workFilterHiddenParams(query, WORK_FILTER_PARAM_KEYS);
  const initialCandidates = addItemCandidates.filter((candidate) => !candidate.archivedAt);
  const projectOptions = projectRows
    .filter((row) => row.type === 'project')
    .map((row) => ({ id: row.id, label: row.canonicalName }));

  return (
    <div
      data-app-layout="full-bleed"
      className="-mx-4 -my-6 flex h-[calc(100dvh-3rem)] min-w-0 flex-col md:-mx-8 md:-my-8"
    >
      {categoryFilterBaseline ? (
        <TaskCategoryFilterRefresh
          surface="board"
          boardId={board.id}
          filters={filters}
          baselineToken={categoryFilterBaseline.token}
        />
      ) : null}
      <BoardDetailClient
        boardId={board.id}
        boardName={board.name}
        purpose={board.purpose}
        pinned={board.pinned}
        itemCount={board.itemCount}
        view={view}
        lanes={board.lanes}
        initialItems={board.items}
        initialCandidates={initialCandidates}
        projectOptions={projectOptions}
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

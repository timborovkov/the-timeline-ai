import { users } from '@timeline/db';
import { getEnv } from '@timeline/shared/env';
import { withTeam } from '@timeline/shared/team-scope';
import { inArray } from 'drizzle-orm';
import { redirect } from 'next/navigation';

import type { Metadata } from 'next';

import { ApprovalsClient } from '@/components/approvals/approvals-client';
import { EmptyAction } from '@/components/empty-action';
import { PageHeader } from '@/components/page-header';
import { TaskBoard } from '@/components/tasks/task-board';
import { TaskCategoryFilterRefresh } from '@/components/tasks/task-category-filter-refresh';
import { WorkFilterBar } from '@/components/work-filter-bar';
import { WorkSubnav } from '@/components/work-subnav';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { displayMemberLabel } from '@/lib/display-labels';
import { loadProjectFilterRows } from '@/lib/project-filter-options';
import { serializeSuggestionBundle } from '@/lib/suggestions';
import { countTaskRows, loadTaskRowsPage } from '@/lib/task-page';
import { TASK_STATUS_COLUMNS } from '@/lib/task-statuses';
import {
  WORK_FILTER_PARAM_KEYS,
  hasActiveWorkFilters,
  parseWorkFilters,
  taskCategoryFilterKeys,
  taskObjectFilterFromWorkFilters,
  workFilterHiddenParams,
} from '@/lib/work-filters';

export const metadata: Metadata = {
  title: 'Tasks',
  description: 'Review tasks discovered from timeline activity.',
};

type PageSearchParams = Record<string, string | string[] | undefined>;

const EMPTY_SEARCH_PARAMS: PageSearchParams = {};
type TaskView = 'kanban' | 'list';

function taskParam(value: string | string[] | undefined): string | null {
  const v = Array.isArray(value) ? value[0] : value;
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function viewParam(value: string | string[] | undefined): TaskView {
  const v = Array.isArray(value) ? value[0] : value;
  return v === 'list' ? v : 'kanban';
}

export default async function TasksPage({
  searchParams,
}: {
  searchParams?: Promise<PageSearchParams>;
} = {}) {
  const [session, query] = await Promise.all([
    auth(),
    searchParams ?? Promise.resolve(EMPTY_SEARCH_PARAMS),
  ]);
  if (!session?.user) redirect('/sign-in');
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) redirect('/sign-in');

  const scope = withTeam(db, active.teamId, session.user.id);
  const now = new Date();
  const calendarSettings = await scope.calendar.getCalendarSettings();
  const filterTime = { now, timezone: calendarSettings.defaultTimezone };
  const taskCategoriesEnabled = getEnv().TASK_CATEGORY_UI_ENABLED;
  const selectedTaskId = taskParam(query.task);
  const filters = parseWorkFilters(query, {
    taskCategoriesEnabled,
  });
  const categoryKeys = taskCategoryFilterKeys(filters);
  const categoryFilterBaseline =
    categoryKeys.length > 0
      ? await scope.objects.getTaskCategoryFilterRefreshState(
          taskObjectFilterFromWorkFilters({ ...filters, category: '' }, filterTime),
          categoryKeys,
        )
      : null;
  const taskFilter = taskObjectFilterFromWorkFilters(filters, filterTime);
  const [projects, taskPage, counts, pendingSuggestions, members] = await Promise.all([
    loadProjectFilterRows({
      listObjects: (filter) => scope.objects.listObjects(filter),
      selected: filters.project,
      includeArchivedSelected: true,
    }),
    loadTaskRowsPage(scope.objects, null, taskFilter),
    countTaskRows(scope.objects, now, taskFilter, calendarSettings.defaultTimezone),
    scope.suggestions.listPendingSuggestions(),
    scope.timeline.listMembers(),
  ]);
  let rows = taskPage.rows;
  let selectedVisibleTaskId = rows.some((row) => row.id === selectedTaskId) ? selectedTaskId : null;
  if (selectedTaskId && !selectedVisibleTaskId) {
    const [selectedTask] = await scope.objects.listObjects({
      ...taskFilter,
      id: selectedTaskId,
      limit: 1,
    });
    if (selectedTask) {
      rows = [selectedTask, ...rows];
      selectedVisibleTaskId = selectedTask.id;
    }
  }
  const selectedTaskDetail = selectedVisibleTaskId
    ? await scope.objects.getObject(selectedVisibleTaskId)
    : null;
  const primaryProjects = await scope.objects.listPrimaryProjectsForTasks(
    rows.map((row) => row.id),
  );
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
  const taskSuggestions = pendingSuggestions.flatMap((bundle) => {
    const items = bundle.items.filter(
      (item) => item.targetKind === 'task' && item.status === 'pending',
    );
    return items.length > 0 ? [serializeSuggestionBundle({ ...bundle, items })] : [];
  });
  const pendingTaskItems = taskSuggestions.reduce((sum, bundle) => sum + bundle.items.length, 0);
  const view = viewParam(query.view);
  const activeFilters = hasActiveWorkFilters(filters);
  const hiddenFilterParams = workFilterHiddenParams(query, ['view']);
  const taskLoadFilterParams = workFilterHiddenParams(query, WORK_FILTER_PARAM_KEYS);

  return (
    <div
      data-app-layout={rows.length > 0 ? 'full-bleed' : undefined}
      className={
        rows.length > 0
          ? '-mx-4 -my-6 flex h-[calc(100dvh-3rem)] min-w-0 flex-col md:-mx-8 md:-my-8'
          : 'space-y-5'
      }
    >
      <PageHeader
        title="Tasks"
        subtitle="Assigned work and follow-ups from your timeline."
        metadata={[
          { label: 'Total', value: counts.total, mono: true },
          { label: 'Open', value: counts.open, mono: true },
          ...(pendingTaskItems > 0
            ? [
                {
                  label: 'Approvals',
                  value: pendingTaskItems,
                  mono: true,
                  signal: true,
                  href: '/app/approvals?status=pending',
                  ariaLabel: `${pendingTaskItems} pending task approvals`,
                },
              ]
            : []),
          ...(counts.overdue > 0
            ? [
                {
                  label: 'Overdue',
                  value: counts.overdue,
                  mono: true,
                  danger: true,
                  href: '/app/tasks?due=overdue',
                  ariaLabel: `${counts.overdue} overdue tasks`,
                },
              ]
            : []),
        ]}
        className={rows.length > 0 ? 'w-full shrink-0 px-4 pt-5 md:px-8' : 'shrink-0'}
      />
      <WorkSubnav
        current="/app/tasks"
        className={rows.length > 0 ? 'shrink-0 px-4 md:px-8' : undefined}
      />

      <WorkFilterBar
        mode="tasks"
        basePath="/app/tasks"
        filters={filters}
        active={activeFilters}
        resultCount={rows.length}
        totalCount={counts.total}
        hiddenParams={hiddenFilterParams}
        members={memberOptions}
        projects={projects.map((project) => ({ id: project.id, label: project.canonicalName }))}
        statusOptions={TASK_STATUS_COLUMNS}
      />

      {categoryFilterBaseline ? (
        <TaskCategoryFilterRefresh
          surface="tasks"
          filters={filters}
          baselineToken={categoryFilterBaseline.token}
        />
      ) : null}

      {rows.length === 0 ? (
        <EmptyAction
          title={activeFilters ? 'No tasks match this filter' : 'No active tasks'}
          body={
            activeFilters
              ? 'The task archive is still intact. Clear the filters or broaden the slice to see more work.'
              : pendingTaskItems > 0
                ? 'Pending task proposals are waiting below. Accepted proposals will appear on the board.'
                : 'Tasks are proposed from captured decisions, meetings, and follow-ups. Capture one commitment to start the task board.'
          }
          href={
            activeFilters
              ? view === 'list'
                ? '/app/tasks?view=list'
                : '/app/tasks'
              : '/app#capture'
          }
          action={activeFilters ? 'Clear filters' : 'Capture a follow-up'}
        />
      ) : (
        <div className="min-h-0 flex-1">
          <TaskBoard
            rows={rows}
            columns={[...TASK_STATUS_COLUMNS]}
            selectedTaskId={selectedVisibleTaskId}
            selectedTaskContext={selectedTaskDetail?.connectedWork ?? null}
            view={view}
            members={memberOptions}
            projects={projects.map((project) => ({ id: project.id, label: project.canonicalName }))}
            primaryProjects={primaryProjects}
            initialProjectsHydrated
            totalCount={counts.total}
            nextCursor={taskPage.nextCursor}
            filterParams={taskLoadFilterParams}
            categoryFilterRefreshToken={categoryFilterBaseline?.token}
            taskCategoriesEnabled={taskCategoriesEnabled}
          />
        </div>
      )}

      {taskSuggestions.length > 0 ? (
        <ApprovalsClient
          suggestions={taskSuggestions}
          allowBulkAccept={false}
          taskCategoriesEnabled={taskCategoriesEnabled}
          folded={{
            title: 'Task approvals',
            summary: {
              singular: 'pending task proposal',
              plural: 'pending task proposals',
            },
            className:
              rows.length > 0
                ? 'mx-4 border-t border-border pt-4 md:mx-8'
                : 'border-t border-border pt-4',
          }}
        />
      ) : null}
    </div>
  );
}

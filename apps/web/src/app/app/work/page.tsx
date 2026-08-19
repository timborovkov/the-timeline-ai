import { withTeam } from '@timeline/shared/team-scope';
import { workspaceDueDateBoundaries } from '@timeline/shared/time';
import { Columns3, ListTodo } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import type { Metadata } from 'next';

import { BoardCreateDialog } from '@/components/boards/board-create-form';
import { CollectionGroup } from '@/components/collections/collection-group';
import { CollectionRow } from '@/components/collections/collection-row';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { PinOverflowMenu } from '@/components/pins/pin-overflow-menu';
import { PinnedWorkspaceManager } from '@/components/pins/pinned-workspace-manager';
import { PinnedWorkspacePreview } from '@/components/pins/pinned-workspace-preview';
import { TaskCategoryPollingProvider } from '@/components/tasks/task-category-badge';
import { ItemActionGroup } from '@/components/ui/item-actions';
import { WorkQueueRow } from '@/components/work/work-queue-row';
import { WorkSubnav } from '@/components/work-subnav';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { formatDisplayDate } from '@/lib/display-dates';
import { displayMemberLabel } from '@/lib/display-labels';
import { getWorkAttentionSummary } from '@/lib/hub-status';
import {
  approvalQueueItem,
  boardQueueItem,
  dedupeWorkQueueItems,
  listWorkQueueObjects,
  objectQueueItem,
  sortWorkQueueItems,
} from '@/lib/work-queue';

export const metadata: Metadata = {
  title: 'Work',
  description: 'Daily queue for team work, boards, approvals, and operational context.',
};

const QUEUE_LIMIT = 20;

const PIN_FILTER_KINDS = {
  objects: ['object'],
  boards: ['board'],
  documents: ['document'],
  meetings: ['meeting', 'saved_meeting'],
  calendar: ['calendar_event'],
  timeline: ['timeline_moment'],
} as const;

export default async function WorkPage({ searchParams }: PageProps<'/app/work'>) {
  const session = await auth();
  if (!session?.user) redirect('/sign-in');
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) redirect('/sign-in');

  const scope = withTeam(db, active.teamId, session.user.id);
  const query = await searchParams;
  const view = Array.isArray(query.view) ? query.view[0] : query.view;
  const kind = Array.isArray(query.kind) ? query.kind[0] : query.kind;
  if (view === 'pinned') {
    const filter = kind && kind in PIN_FILTER_KINDS ? kind : 'all';
    const kinds =
      filter === 'all' ? undefined : [...PIN_FILTER_KINDS[filter as keyof typeof PIN_FILTER_KINDS]];
    const page = await scope.pins.list({ limit: 50, kinds });
    return (
      <div className="space-y-6">
        <PageHeader
          variant="collection"
          title="Work"
          subtitle="Personal shortcuts to the work and context you return to."
        />
        <WorkSubnav current="/app/work?view=pinned" />
        <PinnedWorkspaceManager initialPage={page} filter={filter} />
      </div>
    );
  }
  const now = new Date();
  const calendarSettings = await scope.calendar.getCalendarSettings();
  const timezone = calendarSettings.defaultTimezone;
  const dueBoundaries = workspaceDueDateBoundaries(timezone, now);
  const [attention, boardItems, queueObjects, pinnedPage, boards, members] = await Promise.all([
    getWorkAttentionSummary(scope, now, timezone),
    scope.boards.listWorkQueueItems({
      dueDateRange: { timezone, to: dueBoundaries.dueSoonEnd },
      limit: 100,
    }),
    listWorkQueueObjects(scope.objects, { userId: session.user.id, now, timezone }),
    scope.pins.list({ limit: 6 }),
    scope.boards.listBoards(),
    scope.timeline.listMembers(),
  ]);

  const approvalsItem = approvalQueueItem(attention.pendingApprovals, now);
  const queue = dedupeWorkQueueItems(
    sortWorkQueueItems([
      ...(approvalsItem ? [approvalsItem] : []),
      ...boardItems.map((item) => boardQueueItem(item, session.user.id, now, timezone)),
      ...queueObjects.flatMap((item) => {
        const queued = objectQueueItem(item, session.user.id, now, timezone);
        return queued ? [queued] : [];
      }),
    ]),
  ).slice(0, QUEUE_LIMIT);
  const queuePinState = await scope.pins.isPinnedMany(
    queue.flatMap((item) =>
      item.entityId && item.source !== 'approval'
        ? [{ kind: 'object' as const, key: item.entityId }]
        : [],
    ),
  );
  const memberOptions = members.map((member) => ({
    id: member.userId,
    label: displayMemberLabel(member),
  }));
  const categoryPollingTasks = queue.flatMap((item) =>
    item.objectType === 'task'
      ? [
          {
            id: item.entityId ?? item.id,
            status: item.taskCategoryStatus ?? null,
            updatedAt: item.updatedAt,
          },
        ]
      : [],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        variant="collection"
        title="Work"
        subtitle="Prioritized work that needs a decision, owner, or next action."
        metadata={[
          { label: 'Queue', value: queue.length, mono: true },
          {
            label: 'Overdue',
            value: attention.overdueTasks,
            mono: true,
            danger: attention.overdueTasks > 0,
            href: '/app/tasks?due=overdue',
            ariaLabel: `${attention.overdueTasks} overdue tasks`,
          },
          {
            label: 'Approvals',
            value: attention.pendingApprovals,
            mono: true,
            danger: attention.pendingApprovals > 0,
            href: '/app/approvals?status=pending',
            ariaLabel: `${attention.pendingApprovals} pending approvals`,
          },
        ]}
      />
      <WorkSubnav current="/app/work" />

      <div className="space-y-7">
        <PinnedWorkspacePreview initialItems={pinnedPage.items} heading="Pinned" />

        <CollectionGroup title="Boards" count={boards.length}>
          {boards.length === 0 ? (
            <EmptyState
              icon={Columns3}
              size="inset"
              title="No boards yet"
              body="Create a board so the team has a place to run work. Start with a preset, then tailor the stages."
            >
              <BoardCreateDialog appearance="empty" />
            </EmptyState>
          ) : (
            <div>
              {boards.map((board) => (
                <CollectionRow key={board.id}>
                  <CollectionRow.Title>
                    <Link
                      href={`/app/boards/${board.id}`}
                      className="block truncate hover:underline"
                    >
                      {board.name}
                    </Link>
                  </CollectionRow.Title>
                  <CollectionRow.Context>{`Updated ${dateLabel(board.updatedAt, timezone)}`}</CollectionRow.Context>
                  <CollectionRow.Metadata>
                    <span className="px-2 text-xs tabular-nums text-fg-dim">
                      {board.itemCount} items
                    </span>
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
              ))}
            </div>
          )}
        </CollectionGroup>

        <CollectionGroup title="Work queue" count={queue.length}>
          {queue.length === 0 ? (
            <EmptyState
              icon={ListTodo}
              size="inset"
              title="Work queue is clear"
              body="Assigned work, due team items, and pending approvals will appear here when they need attention."
              href="/app/boards"
              action="Open boards"
            />
          ) : (
            <TaskCategoryPollingProvider tasks={categoryPollingTasks}>
              <div>
                {queue.map((item) => (
                  <WorkQueueRow
                    key={item.id}
                    item={item}
                    members={memberOptions}
                    timezone={timezone}
                    pinned={
                      item.entityId ? (queuePinState[`object:${item.entityId}`] ?? false) : false
                    }
                  />
                ))}
              </div>
            </TaskCategoryPollingProvider>
          )}
        </CollectionGroup>
      </div>
    </div>
  );
}

function dateLabel(value: Date, timezone: string): string {
  return formatDisplayDate(value, { timezone });
}

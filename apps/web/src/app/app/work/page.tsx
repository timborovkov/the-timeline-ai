import { withTeam } from '@timeline/shared/team-scope';
import { workspaceDueDateBoundaries } from '@timeline/shared/time';
import { ListTodo } from 'lucide-react';
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
import { WorkOverviewHeader } from '@/components/work/work-overview-header';
import { WorkQueueRow } from '@/components/work/work-queue-row';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { formatDisplayDate } from '@/lib/display-dates';
import { displayMemberLabel } from '@/lib/display-labels';
import { getWorkAttentionSummary } from '@/lib/hub-status';
import { notificationHref } from '@/lib/notification-href';
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
      <div data-app-width="collection" className="space-y-6">
        <PageHeader
          leading={
            <Link href="/app/work" className="text-sm text-fg-muted hover:text-fg">
              ← Work overview
            </Link>
          }
          title="Pinned work"
          subtitle="Personal shortcuts to the work and context you return to."
        />
        <PinnedWorkspaceManager initialPage={page} filter={filter} />
      </div>
    );
  }
  const now = new Date();
  const calendarSettings = await scope.calendar.getCalendarSettings();
  const timezone = calendarSettings.defaultTimezone;
  const dueBoundaries = workspaceDueDateBoundaries(timezone, now);
  const [attention, boardItems, queueObjects, pinnedPage, boards, members, mentionNotifications] =
    await Promise.all([
      getWorkAttentionSummary(scope, now, timezone),
      scope.boards.listWorkQueueItems({
        dueDateRange: { timezone, to: dueBoundaries.dueSoonEnd },
        limit: 100,
      }),
      listWorkQueueObjects(scope.objects, { userId: session.user.id, now, timezone }),
      scope.pins.list({ limit: 6 }),
      scope.boards.listBoards(),
      scope.timeline.listMembers(),
      scope.objects.listNotifications({ unreadOnly: true, limit: 20 }),
    ]);
  const mentionPings = mentionNotifications.filter(
    (notification) => notification.kind === 'mention',
  );

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
    <div data-app-width="overview" className="work-overview space-y-4">
      <WorkOverviewHeader
        queueCount={queue.length}
        overdueCount={attention.overdueTasks}
        approvalCount={attention.pendingApprovals}
      />

      <div className="grid items-start gap-8 xl:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="min-w-0 space-y-6">
          {mentionPings.length > 0 ? (
            <CollectionGroup title="Unread mentions" count={mentionPings.length}>
              <div>
                {mentionPings.map((notification) => (
                  <CollectionRow key={notification.id}>
                    <CollectionRow.Title>
                      <Link
                        href={notificationHref(notification)}
                        className="block whitespace-normal [overflow-wrap:anywhere] hover:underline"
                      >
                        {notification.summary}
                      </Link>
                    </CollectionRow.Title>
                  </CollectionRow>
                ))}
              </div>
            </CollectionGroup>
          ) : null}

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
        <aside
          id="pinned-work"
          aria-label="Boards and pinned work"
          className="min-w-0 scroll-mt-4 space-y-8 border-t border-border pt-6 xl:border-t-0 xl:border-l xl:pl-6 xl:pt-0"
        >
          <PinnedWorkspacePreview initialItems={pinnedPage.items} heading="Pinned work" showEmpty />

          <CollectionGroup title="Boards" count={boards.length}>
            {boards.length === 0 ? (
              <div className="flex flex-col items-start gap-3 py-3">
                <div className="min-w-0 space-y-1">
                  <p className="text-sm font-medium">No boards yet</p>
                  <p className="text-sm text-fg-muted">
                    Start with a preset to organize your team’s work.
                  </p>
                </div>
                <BoardCreateDialog />
              </div>
            ) : (
              <div>
                {boards.map((board) => (
                  <CollectionRow key={board.id}>
                    <CollectionRow.Title>
                      <Link
                        href={`/app/boards/${board.id}`}
                        className="block whitespace-normal [overflow-wrap:anywhere] hover:underline"
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
        </aside>
      </div>
    </div>
  );
}

function dateLabel(value: Date, timezone: string): string {
  return formatDisplayDate(value, { timezone });
}

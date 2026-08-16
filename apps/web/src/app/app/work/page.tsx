import { withTeam } from '@timeline/shared/team-scope';
import { workspaceDueDateBoundaries } from '@timeline/shared/time';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import type { Metadata } from 'next';

import { CollectionGroup } from '@/components/collections/collection-group';
import { CollectionRow } from '@/components/collections/collection-row';
import { CollectionStatus, priorityTone } from '@/components/collections/collection-status';
import { DueDateDisplay } from '@/components/due-date-display';
import { EmptyAction } from '@/components/empty-action';
import { PageHeader } from '@/components/page-header';
import { PinnedWorkspaceManager } from '@/components/pins/pinned-workspace-manager';
import {
  LiveTaskCategoryBadge,
  TaskCategoryPollingProvider,
} from '@/components/tasks/task-category-badge';
import { WorkSubnav } from '@/components/work-subnav';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { displayText, formatDisplayDate } from '@/lib/display-dates';
import { getWorkAttentionSummary } from '@/lib/hub-status';
import { statusLabel } from '@/lib/status-labels';
import {
  approvalQueueItem,
  boardQueueItem,
  dedupeWorkQueueItems,
  listWorkQueueObjects,
  objectQueueItem,
  reasonLabel,
  reasonTone,
  sortWorkQueueItems,
  type WorkQueueItem,
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
  const [attention, boardItems, queueObjects, pinnedBoards, boards] = await Promise.all([
    getWorkAttentionSummary(scope, now, timezone),
    scope.boards.listWorkQueueItems({
      dueDateRange: { timezone, to: dueBoundaries.dueSoonEnd },
      limit: 100,
    }),
    listWorkQueueObjects(scope.objects, { userId: session.user.id, now, timezone }),
    scope.boards.listPinnedBoards({ timezone, now }),
    scope.boards.listBoards(),
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
  const boardModules = uniqueBoards([...pinnedBoards, ...boards]).slice(0, 6);
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
        <CollectionGroup title="Work queue" count={queue.length}>
          {queue.length === 0 ? (
            <EmptyAction
              title="Work queue clear"
              body="Assigned work, due team items, and pending approvals will appear here when they need attention."
              href="/app/boards"
              action="Open boards"
            />
          ) : (
            <TaskCategoryPollingProvider tasks={categoryPollingTasks}>
              <div className="border-x border-border">
                {queue.map((item) => (
                  <WorkQueueRow key={item.id} item={item} timezone={timezone} />
                ))}
              </div>
            </TaskCategoryPollingProvider>
          )}
        </CollectionGroup>

        <CollectionGroup title="Pinned and team boards" count={boardModules.length}>
          {boardModules.length === 0 ? (
            <EmptyPanel label="No boards yet" body="Create a board to give team work a surface." />
          ) : (
            <div className="border-x border-border">
              {boardModules.map((board) => (
                <CollectionRow
                  key={board.id}
                  title={
                    <Link
                      href={`/app/boards/${board.id}`}
                      className="block truncate hover:underline"
                    >
                      {board.name}
                    </Link>
                  }
                  context={`Updated ${dateLabel(board.updatedAt, timezone)}`}
                  metadata={
                    <>
                      <span className="px-2 text-xs tabular-nums text-fg-dim">
                        {board.itemCount} items
                      </span>
                      {board.pinned ? (
                        <span className="px-2 text-xs font-medium text-signal">Pinned</span>
                      ) : null}
                    </>
                  }
                />
              ))}
            </div>
          )}
        </CollectionGroup>
      </div>
    </div>
  );
}

function WorkQueueRow({ item, timezone }: { item: WorkQueueItem; timezone: string }) {
  const contextReasons = item.reasons.filter(
    (reason) => reason !== 'overdue' && reason !== 'due_soon',
  );
  return (
    <CollectionRow
      title={
        <Link href={item.href} className="block truncate hover:underline">
          {displayText(item.title)}
        </Link>
      }
      context={displayText(item.subtitle)}
      metadata={
        <>
          <span className="px-2 text-xs text-fg-dim">{item.sourceLabel}</span>
          {contextReasons.map((reason) => (
            <ReasonBadge key={reason} reason={reason} />
          ))}
          {item.source !== 'approval' ? (
            <DueDateDisplay value={item.dueAt} timezone={timezone} variant="compact" />
          ) : null}
          {item.priority ? (
            <CollectionStatus
              value={`p${item.priority}`}
              tone={priorityTone(item.priority)}
              label={`P${item.priority}`}
            />
          ) : null}
          {item.objectType ? (
            <CollectionStatus value={item.objectType} label={statusLabel(item.objectType)} />
          ) : null}
          {item.objectType === 'task' ? (
            <LiveTaskCategoryBadge
              taskId={item.entityId ?? item.id}
              category={item.taskCategory ?? null}
              status={item.taskCategoryStatus ?? null}
              updatedAt={item.updatedAt}
            />
          ) : null}
        </>
      }
    />
  );
}

function ReasonBadge({ reason }: { reason: WorkQueueItem['reasons'][number] }) {
  const tone = reasonTone(reason);
  return (
    <span
      className={`inline-flex min-h-6 items-center rounded-sm border px-2 text-xs ${
        tone === 'danger'
          ? 'border-danger/40 text-danger'
          : tone === 'signal'
            ? 'border-signal/40 bg-signal-soft text-signal'
            : 'border-border text-fg-muted'
      }`}
    >
      {reasonLabel(reason)}
    </span>
  );
}

function EmptyPanel({ label, body }: { label: string; body: string }) {
  return (
    <div className="border border-border bg-bg p-4">
      <p className="text-sm font-medium text-fg">{label}</p>
      <p className="mt-2 text-sm text-fg-muted">{body}</p>
    </div>
  );
}

function uniqueBoards<T extends { id: string }>(boards: T[]): T[] {
  const seen = new Set<string>();
  return boards.filter((board) => {
    if (seen.has(board.id)) return false;
    seen.add(board.id);
    return true;
  });
}

function dateLabel(value: Date, timezone: string): string {
  return formatDisplayDate(value, { timezone });
}

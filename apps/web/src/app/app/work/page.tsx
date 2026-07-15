import { withTeam } from '@timeline/shared/team-scope';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import type { Metadata } from 'next';

import { EmptyAction } from '@/components/empty-action';
import { PageHeader } from '@/components/page-header';
import { SectionHeading } from '@/components/section-heading';
import { WorkSubnav } from '@/components/work-subnav';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { displayText, formatDisplayDate } from '@/lib/display-dates';
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

const DUE_SOON_DAYS = 14;
const QUEUE_LIMIT = 20;

export default async function WorkPage() {
  const session = await auth();
  if (!session?.user) redirect('/sign-in');
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) redirect('/sign-in');

  const scope = withTeam(db, active.teamId, session.user.id);
  const now = new Date();
  const dueSoon = new Date(now.getTime() + DUE_SOON_DAYS * 24 * 60 * 60 * 1000);
  const [pendingApprovals, boardItems, queueObjects, pinnedBoards, boards] = await Promise.all([
    scope.suggestions.countPendingSuggestions(),
    scope.boards.listWorkQueueItems({ dueBefore: dueSoon, limit: 100 }),
    listWorkQueueObjects(scope.objects, session.user.id, dueSoon),
    scope.boards.listPinnedBoards(),
    scope.boards.listBoards(),
  ]);

  const approvalsItem = approvalQueueItem(pendingApprovals, now);
  const queue = dedupeWorkQueueItems(
    sortWorkQueueItems([
      ...(approvalsItem ? [approvalsItem] : []),
      ...boardItems.map((item) => boardQueueItem(item, session.user.id, now, dueSoon)),
      ...queueObjects.flatMap((item) => {
        const queued = objectQueueItem(item, session.user.id, now, dueSoon);
        return queued ? [queued] : [];
      }),
    ]),
  ).slice(0, QUEUE_LIMIT);
  const attentionCount = queue.filter((item) =>
    item.reasons.some(
      (reason) =>
        reason === 'pending_approval' ||
        reason === 'overdue' ||
        reason === 'team_due' ||
        reason === 'blocked',
    ),
  ).length;
  const boardModules = uniqueBoards([...pinnedBoards, ...boards]).slice(0, 6);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Work"
        subtitle="Prioritized work that needs a decision, owner, or next action."
        metadata={[
          { label: 'Queue', value: queue.length, mono: true },
          ...(attentionCount > 0
            ? [{ label: 'Attention', value: attentionCount, mono: true, danger: true }]
            : []),
        ]}
      />
      <WorkSubnav current="/app/work" />

      <div className="space-y-7">
        <section aria-labelledby="work-queue-title" className="space-y-3">
          <SectionHeading id="work-queue-title">Work queue</SectionHeading>
          {queue.length === 0 ? (
            <EmptyAction
              title="Work queue clear"
              body="Assigned work, due team items, and pending approvals will appear here when they need attention."
              href="/app/boards"
              action="Open boards"
            />
          ) : (
            <div className="overflow-hidden border border-border">
              {queue.map((item) => (
                <WorkQueueRow key={item.id} item={item} />
              ))}
            </div>
          )}
        </section>

        <section aria-labelledby="team-boards-title" className="space-y-3">
          <SectionHeading id="team-boards-title">Pinned and team boards</SectionHeading>
          {boardModules.length === 0 ? (
            <EmptyPanel label="No boards yet" body="Create a board to give team work a surface." />
          ) : (
            <div className="grid gap-px overflow-hidden border border-border sm:grid-cols-2">
              {boardModules.map((board) => (
                <Link
                  key={board.id}
                  href={`/app/boards/${board.id}`}
                  className="block bg-bg p-3 transition-colors hover:bg-surface"
                >
                  <span className="flex items-center justify-between gap-3">
                    <span className="truncate text-sm font-medium text-fg">{board.name}</span>
                    {board.pinned ? (
                      <span className="text-xs font-medium text-signal">Pinned</span>
                    ) : null}
                  </span>
                  <span className="mt-2 block text-xs tabular-nums text-fg-dim">
                    {board.itemCount} items · updated {dateLabel(board.updatedAt)}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function WorkQueueRow({ item }: { item: WorkQueueItem }) {
  return (
    <Link
      href={item.href}
      className="grid gap-3 border-b border-border bg-bg p-3 transition-colors last:border-b-0 hover:bg-surface md:grid-cols-[minmax(0,1fr)_auto]"
    >
      <span className="min-w-0">
        <span className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="truncate text-sm font-medium text-fg">{displayText(item.title)}</span>
          <span className="text-xs text-fg-dim">{item.sourceLabel}</span>
        </span>
        <span className="mt-1 block truncate text-sm text-fg-muted">
          {displayText(item.subtitle)}
        </span>
        <span className="mt-2 flex flex-wrap gap-1.5">
          {item.reasons.map((reason) => (
            <ReasonBadge key={reason} reason={reason} />
          ))}
        </span>
      </span>
      <span className="flex flex-wrap items-center gap-2 md:justify-end">
        {item.dueAt ? (
          <MetaPill
            label={`Due ${dateLabel(item.dueAt)}`}
            danger={item.reasons.includes('overdue')}
          />
        ) : null}
        {item.priority ? <MetaPill label={`P${item.priority}`} /> : null}
        {item.objectType ? <MetaPill label={item.objectType.replace('_', ' ')} /> : null}
      </span>
    </Link>
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

function MetaPill({ label, danger = false }: { label: string; danger?: boolean }) {
  return (
    <span
      className={`inline-flex min-h-6 items-center rounded-sm border px-2 text-xs ${
        danger ? 'border-danger/40 text-danger' : 'border-border text-fg-muted'
      }`}
    >
      {label}
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

function dateLabel(value: Date): string {
  return formatDisplayDate(value);
}

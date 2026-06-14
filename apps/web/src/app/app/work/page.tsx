import { withTeam } from '@timeline/shared/team-scope';
import { Box, CalendarDays, CheckSquare, CircleCheckBig, KanbanSquare } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import type * as objects from '@timeline/shared/objects';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { EmptyAction } from '@/components/empty-action';
import { IndexStrip } from '@/components/index-strip';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import {
  approvalQueueItem,
  boardQueueItem,
  dedupeWorkQueueItems,
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
const OBJECT_FETCH_PAGE_SIZE = 500;
const RECENT_CHANGE_LIMIT = 5;
const WORK_OBJECT_TYPES: objects.ObjectType[] = ['task', 'follow_up', 'project', 'deal'];

const NAV_LINKS = [
  {
    href: '/app/objects',
    label: 'Objects',
    detail: 'Durable team memory',
    icon: <Box className="size-4" aria-hidden="true" />,
  },
  {
    href: '/app/tasks',
    label: 'Tasks',
    detail: 'Task board',
    icon: <CheckSquare className="size-4" aria-hidden="true" />,
  },
  {
    href: '/app/boards',
    label: 'Boards',
    detail: 'Team work surfaces',
    icon: <KanbanSquare className="size-4" aria-hidden="true" />,
  },
  {
    href: '/app/calendar',
    label: 'Calendar',
    detail: 'Scheduled work',
    icon: <CalendarDays className="size-4" aria-hidden="true" />,
  },
  {
    href: '/app/approvals',
    label: 'Approvals',
    detail: 'Agent proposals',
    icon: <CircleCheckBig className="size-4" aria-hidden="true" />,
  },
] as const;

export default async function WorkPage() {
  const session = await auth();
  if (!session?.user) redirect('/sign-in');
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) redirect('/sign-in');

  const scope = withTeam(db, active.teamId, session.user.id);
  const now = new Date();
  const dueSoon = new Date(now.getTime() + DUE_SOON_DAYS * 24 * 60 * 60 * 1000);
  const [pendingApprovals, boardItems, queueObjects, pinnedBoards, boards, recentChanges] =
    await Promise.all([
      scope.suggestions.countPendingSuggestions(),
      scope.boards.listWorkQueueItems({ dueBefore: dueSoon, limit: 100 }),
      listWorkQueueObjects(scope.objects, session.user.id, dueSoon),
      scope.boards.listPinnedBoards(),
      scope.boards.listBoards(),
      scope.timeline.listEventsPage({ limit: RECENT_CHANGE_LIMIT }),
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
    <div className="mx-auto max-w-6xl space-y-6">
      <IndexStrip
        srLabel={`Work · ${active.teamName} · ${queue.length} queue item${queue.length === 1 ? '' : 's'} · ${attentionCount} attention`}
        segments={[
          { value: 'WORK' },
          { label: 'team', value: active.teamName, signal: true },
          { label: 'queue', value: queue.length },
          ...(attentionCount > 0
            ? ([{ label: 'attention', value: attentionCount, danger: true }] as const)
            : []),
        ]}
      />

      <section aria-labelledby="work-queue-title" className="space-y-3">
        <SectionHeader
          id="work-queue-title"
          label="Work Queue"
          meta={`${queue.length}/${QUEUE_LIMIT}`}
        />
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

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.48fr)]">
        <section aria-labelledby="team-boards-title" className="space-y-3">
          <SectionHeader
            id="team-boards-title"
            label="Team boards"
            meta={`${boardModules.length}`}
          />
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
                      <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-signal">
                        Pinned
                      </span>
                    ) : null}
                  </span>
                  <span className="mt-2 block font-mono text-[11px] uppercase tracking-[0.12em] text-fg-dim">
                    {board.itemCount} items · updated {dateLabel(board.updatedAt)}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </section>

        <aside className="space-y-5">
          <section aria-labelledby="recent-changes-title" className="space-y-3">
            <SectionHeader
              id="recent-changes-title"
              label="Recent changes"
              meta={`${recentChanges.items.length}`}
            />
            {recentChanges.items.length === 0 ? (
              <EmptyPanel
                label="No recent changes"
                body="Captured work activity will appear here."
              />
            ) : (
              <ol className="overflow-hidden border border-border">
                {recentChanges.items.map((event) => (
                  <li key={event.id} className="border-b border-border bg-bg p-3 last:border-b-0">
                    <p className="line-clamp-2 text-sm text-fg-muted">
                      {event.contentText?.trim() ?? `${event.source} event`}
                    </p>
                    <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.12em] text-fg-dim">
                      {event.source} · {dateLabel(event.occurredAt)}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <section aria-labelledby="work-surfaces-title" className="space-y-3">
            <SectionHeader id="work-surfaces-title" label="Work surfaces" />
            <div className="overflow-hidden border border-border">
              {NAV_LINKS.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="flex items-center justify-between gap-3 border-b border-border bg-bg p-3 text-sm transition-colors last:border-b-0 hover:bg-surface"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="text-fg-dim">{item.icon}</span>
                    <span className="min-w-0">
                      <span className="block font-medium text-fg">{item.label}</span>
                      <span className="block truncate text-xs text-fg-muted">{item.detail}</span>
                    </span>
                  </span>
                  <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-signal">
                    Open
                  </span>
                </Link>
              ))}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

async function listObjectPages(
  listObjects: (filter: objects.ObjectListFilter) => Promise<objects.ObjectRow[]>,
  filter: objects.ObjectListFilter,
  offset = 0,
  collected: objects.ObjectRow[] = [],
): Promise<objects.ObjectRow[]> {
  const page = await listObjects({ ...filter, limit: OBJECT_FETCH_PAGE_SIZE, offset });
  const rows = [...collected, ...page];
  if (page.length < OBJECT_FETCH_PAGE_SIZE) return rows;
  return listObjectPages(listObjects, filter, offset + OBJECT_FETCH_PAGE_SIZE, rows);
}

async function listWorkQueueObjects(
  objectScope: { listObjects(filter: objects.ObjectListFilter): Promise<objects.ObjectRow[]> },
  userId: string,
  dueBefore: Date,
): Promise<objects.ObjectRow[]> {
  const baseFilter = {
    type: WORK_OBJECT_TYPES,
    archived: false,
  } satisfies objects.ObjectListFilter;
  const listObjects = (filter: objects.ObjectListFilter) => objectScope.listObjects(filter);
  const [owned, assigned, teamDue] = await Promise.all([
    listObjectPages(listObjects, { ...baseFilter, ownerUserId: userId }),
    listObjectPages(listObjects, { ...baseFilter, assigneeUserId: userId }),
    listObjectPages(listObjects, {
      ...baseFilter,
      ownerUserId: null,
      assigneeUserId: null,
      dueBefore,
    }),
  ]);
  return [...owned, ...assigned, ...teamDue];
}

function WorkQueueRow({ item }: { item: WorkQueueItem }) {
  return (
    <Link
      href={item.href}
      className="grid gap-3 border-b border-border bg-bg p-3 transition-colors last:border-b-0 hover:bg-surface md:grid-cols-[minmax(0,1fr)_auto]"
    >
      <span className="min-w-0">
        <span className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="truncate text-sm font-medium text-fg">{item.title}</span>
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-fg-dim">
            {item.sourceLabel}
          </span>
        </span>
        <span className="mt-1 block truncate text-sm text-fg-muted">{item.subtitle}</span>
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
      className={`inline-flex min-h-6 items-center rounded-sm border px-2 font-mono text-[10px] uppercase tracking-[0.1em] ${
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
      className={`inline-flex min-h-6 items-center rounded-sm border px-2 font-mono text-[10px] uppercase tracking-[0.1em] ${
        danger ? 'border-danger/40 text-danger' : 'border-border text-fg-muted'
      }`}
    >
      {label}
    </span>
  );
}

function SectionHeader({ id, label, meta }: { id: string; label: string; meta?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 id={id} className="font-mono text-[11px] uppercase tracking-[0.14em] text-fg-dim">
        {label}
      </h2>
      {meta ? (
        <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-muted">
          {meta}
        </span>
      ) : null}
    </div>
  );
}

function EmptyPanel({ label, body }: { label: string; body: string }) {
  return (
    <div className="border border-border bg-bg p-4">
      <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-dim">{label}</p>
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
  return value.toLocaleDateString('en-CA');
}

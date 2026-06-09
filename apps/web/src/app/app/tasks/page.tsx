import { withTeam } from '@timeline/shared/team-scope';
import { redirect } from 'next/navigation';

import type { Metadata } from 'next';

import { ApprovalsClient } from '@/components/approvals/approvals-client';
import { KanbanBoard } from '@/components/boards/kanban-board';
import { EmptyAction } from '@/components/empty-action';
import { IndexStrip } from '@/components/index-strip';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { serializeSuggestionBundle } from '@/lib/suggestions';

export const metadata: Metadata = {
  title: 'Tasks',
  description: 'Review tasks discovered from timeline activity.',
};

const TASK_COLUMNS = ['todo', 'doing', 'done', 'blocked', 'cancelled'];
const ACTIONABLE_SUGGESTION_STATUSES = new Set(['pending', 'failed']);

export default async function TasksPage() {
  const session = await auth();
  if (!session?.user) redirect('/sign-in');
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) redirect('/sign-in');

  const scope = withTeam(db, active.teamId, session.user.id);
  const [rows, pendingSuggestions] = await Promise.all([
    scope.objects.listObjects({
      type: 'task',
      archived: false,
      limit: 500,
    }),
    scope.suggestions.listPendingSuggestions(),
  ]);
  const taskSuggestions = pendingSuggestions.flatMap((bundle) => {
    const items = bundle.items.filter(
      (item) => item.targetKind === 'task' && ACTIONABLE_SUGGESTION_STATUSES.has(item.status),
    );
    return items.length > 0 ? [serializeSuggestionBundle({ ...bundle, items })] : [];
  });
  const pendingTaskItems = taskSuggestions.reduce((sum, bundle) => sum + bundle.items.length, 0);

  const open = rows.filter((r) => r.status !== 'done' && r.status !== 'cancelled').length;
  const overdue = rows.filter(
    (r) =>
      r.dueAt !== null && r.dueAt < new Date() && r.status !== 'done' && r.status !== 'cancelled',
  ).length;
  const srSegments = [
    'Tasks',
    `${rows.length} total`,
    `${open} open`,
    ...(pendingTaskItems > 0
      ? [`${pendingTaskItems} pending ${pendingTaskItems === 1 ? 'approval' : 'approvals'}`]
      : []),
    ...(overdue > 0 ? [`${overdue} overdue`] : []),
  ];

  return (
    // Fixed viewport-bounded height (viewport − AppShell header − main
    // py padding ≈ 10rem) so KanbanBoard can fill the remaining space
    // and each column gets its own internal scroll. Without a known
    // parent height the kanban would size to content and you'd lose
    // the per-column vertical scroll entirely.
    <div className="flex h-[calc(100dvh-10rem)] flex-col">
      <IndexStrip
        srLabel={srSegments.join(' · ')}
        segments={[
          { value: 'TASKS' },
          { label: 'total', value: rows.length },
          { label: 'open', value: open },
          ...(pendingTaskItems > 0
            ? ([{ label: 'approvals', value: pendingTaskItems, signal: true }] as const)
            : ([] as const)),
          ...(overdue > 0
            ? ([{ label: 'overdue', value: overdue, danger: true }] as const)
            : ([] as const)),
        ]}
        className="mb-5 shrink-0"
      />

      {taskSuggestions.length > 0 ? (
        <section className="mb-5 shrink-0 space-y-3">
          <h2 className="text-sm font-medium tracking-tight">Task approvals</h2>
          <ApprovalsClient suggestions={taskSuggestions} allowBulkAccept={false} />
        </section>
      ) : null}

      {rows.length === 0 ? (
        <EmptyAction
          title="No tasks yet"
          body="Tasks are proposed from captured decisions, meetings, and follow-ups. Capture one commitment to start the task board."
          href="/app#capture"
          action="Capture a follow-up"
        />
      ) : (
        <div className="min-h-0 flex-1">
          <KanbanBoard rows={rows} groupBy="status" columns={TASK_COLUMNS} />
        </div>
      )}
    </div>
  );
}

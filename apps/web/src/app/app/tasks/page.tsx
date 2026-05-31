import { withTeam } from '@timeline/shared';
import { redirect } from 'next/navigation';

import type { Metadata } from 'next';

import { KanbanBoard } from '@/components/boards/kanban-board';
import { IndexStrip } from '@/components/index-strip';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

export const metadata: Metadata = {
  title: 'Tasks',
  description: 'Review tasks discovered from timeline activity.',
};

const TASK_COLUMNS = ['todo', 'doing', 'done', 'blocked', 'cancelled'];

export default async function TasksPage() {
  const session = await auth();
  if (!session?.user) redirect('/sign-in');
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) redirect('/sign-in');

  const scope = withTeam(db, active.teamId, session.user.id);
  const rows = await scope.objects.listObjects({
    type: 'task',
    archived: false,
    limit: 500,
  });

  const open = rows.filter((r) => r.status !== 'done' && r.status !== 'cancelled').length;
  const overdue = rows.filter(
    (r) =>
      r.dueAt !== null && r.dueAt < new Date() && r.status !== 'done' && r.status !== 'cancelled',
  ).length;

  return (
    // Fixed viewport-bounded height (viewport − AppShell header − main
    // py padding ≈ 10rem) so KanbanBoard can fill the remaining space
    // and each column gets its own internal scroll. Without a known
    // parent height the kanban would size to content and you'd lose
    // the per-column vertical scroll entirely.
    <div className="flex h-[calc(100dvh-10rem)] flex-col">
      <IndexStrip
        srLabel={`Tasks · ${rows.length} total · ${open} open${overdue ? ` · ${overdue} overdue` : ''}`}
        segments={[
          { value: 'TASKS' },
          { label: 'total', value: rows.length },
          { label: 'open', value: open },
          ...(overdue > 0
            ? ([{ label: 'overdue', value: overdue, danger: true }] as const)
            : ([] as const)),
        ]}
        className="mb-5 shrink-0"
      />

      <div className="min-h-0 flex-1">
        <KanbanBoard rows={rows} groupBy="status" columns={TASK_COLUMNS} />
      </div>
    </div>
  );
}

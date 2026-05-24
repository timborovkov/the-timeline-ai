import { objects, withTeam } from '@timeline/shared';
import { redirect } from 'next/navigation';

import { KanbanBoard } from '@/components/boards/kanban-board';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

const TASK_COLUMNS = ['todo', 'doing', 'done', 'blocked', 'cancelled'];

export default async function TasksPage() {
  const session = await auth();
  if (!session?.user) redirect('/sign-in');
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) redirect('/sign-in');

  const scope = withTeam(db, active.teamId, session.user.id);
  const rows = await objects.listObjects(db, scope, {
    type: 'task',
    archived: false,
    limit: 500,
  });

  return (
    // Fixed viewport-bounded height (viewport − AppShell header − main py
    // padding ≈ 11rem) so KanbanBoard can fill the remaining space and
    // each column gets its own internal scroll. Without a known parent
    // height the kanban would size to content and you'd lose the
    // per-column vertical scroll entirely.
    <div className="flex h-[calc(100dvh-11rem)] flex-col">
      <header className="mb-8 shrink-0">
        <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Tasks</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">All tasks</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Every task across the workspace, grouped by status. Drag between columns to update.
        </p>
      </header>

      <div className="min-h-0 flex-1">
        <KanbanBoard rows={rows} groupBy="status" columns={TASK_COLUMNS} />
      </div>
    </div>
  );
}

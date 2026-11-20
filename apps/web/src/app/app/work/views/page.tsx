import { savedWorkViewHref } from '@timeline/shared/saved-work-views';
import { withTeam } from '@timeline/shared/team-scope';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { PageHeader } from '@/components/page-header';
import { SavedViewSettings } from '@/components/saved-views/saved-view-settings';
import { Button } from '@/components/ui/button';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

export default async function SavedViewsPage() {
  const session = await auth();
  if (!session?.user) redirect('/sign-in');
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) redirect('/sign-in');
  const scope = withTeam(db, active.teamId, session.user.id);
  const views = await scope.savedViews.list();
  const rows = await Promise.all(
    views.map(async (view) => {
      const boardId = view.collection === 'boards' ? view.targetId : view.filters.boardId;
      const available = !boardId || Boolean(await scope.boards.getBoard(boardId, { itemLimit: 0 }));
      return { view, href: available ? savedWorkViewHref(view) : null };
    }),
  );
  return (
    <div className="space-y-5">
      <Link className="text-sm underline" href="/app/work">
        Work
      </Link>
      <PageHeader
        title="Saved views"
        subtitle="Open saved filters and choose which new matches appear in your daily digest."
        trailing={
          <Button asChild size="sm" variant="outline">
            <Link href="/app/team?tab=general">Digest settings</Link>
          </Button>
        }
      />
      <section className="divide-y rounded-lg border">
        {rows.map(({ view, href }) => (
          <SavedViewSettings
            key={view.id}
            id={view.id}
            title={view.title}
            collection={view.collection}
            href={href}
            notify={view.notify}
          />
        ))}
        {rows.length === 0 ? (
          <p className="p-4 text-sm text-fg-muted">
            Use Save view while browsing Approvals, Tasks, Objects, or a board.
          </p>
        ) : null}
      </section>
    </div>
  );
}

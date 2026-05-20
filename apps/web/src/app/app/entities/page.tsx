import { entities } from '@timeline/db';
import { withTeam } from '@timeline/shared';
import { and, asc, eq, isNull } from 'drizzle-orm';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

const TYPE_LABEL: Record<string, string> = {
  person: 'People',
  company: 'Companies',
  project: 'Projects',
  topic: 'Topics',
  other: 'Other',
};

const TYPE_ORDER = ['person', 'company', 'project', 'topic', 'other'] as const;

export default async function EntitiesIndexPage() {
  const session = await auth();
  if (!session?.user) redirect('/sign-in');
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) redirect('/sign-in');

  const scope = withTeam(db, active.teamId, session.user.id);
  await scope.requireMembership();

  const rows = await db
    .select({
      id: entities.id,
      type: entities.type,
      canonicalName: entities.canonicalName,
    })
    .from(entities)
    .where(and(eq(entities.teamId, active.teamId), isNull(entities.mergedIntoId)))
    .orderBy(asc(entities.canonicalName));

  const grouped = new Map<string, typeof rows>();
  for (const row of rows) {
    const list = grouped.get(row.type) ?? [];
    list.push(row);
    grouped.set(row.type, list);
  }

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Entities</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          People, companies, projects, and topics extracted from this team&apos;s timeline.
        </p>
      </header>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No entities yet. Post a note that mentions a person or company and the extraction worker
          will populate this view.
        </p>
      ) : (
        <div className="space-y-6">
          {TYPE_ORDER.map((type) => {
            const list = grouped.get(type) ?? [];
            if (list.length === 0) return null;
            return (
              <section key={type}>
                <h2 className="text-sm font-medium text-muted-foreground">
                  {TYPE_LABEL[type] ?? type}
                </h2>
                <ul className="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-2">
                  {list.map((e) => (
                    <li key={e.id}>
                      <Link
                        href={`/app/entities/${e.id}`}
                        className="block rounded-md px-2 py-1 text-sm transition-colors hover:bg-accent"
                      >
                        {e.canonicalName}
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

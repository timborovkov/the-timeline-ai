import { entities, factEntities, facts as factsTable, rawEvents } from '@timeline/db';
import { withTeam } from '@timeline/shared';
import { and, asc, eq, exists, isNull, or, sql } from 'drizzle-orm';
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

  // Show only entities that have at least one fact tied to a raw event the
  // caller is allowed to see. Defense in depth: Phase 4 already gates the
  // extract worker on `visibility = 'team'` so private events should never
  // create entities, but a stale row from before that fix (or any future
  // path that bypasses the worker) must not surface in the shared index.
  const visibleEntityCondition = exists(
    db
      .select({ one: sql<number>`1` })
      .from(factEntities)
      .innerJoin(factsTable, eq(factsTable.id, factEntities.factId))
      .innerJoin(rawEvents, eq(rawEvents.id, factsTable.rawEventId))
      .where(
        and(
          eq(factEntities.entityId, entities.id),
          eq(rawEvents.teamId, active.teamId),
          or(
            eq(rawEvents.visibility, 'team'),
            and(eq(rawEvents.visibility, 'private'), eq(rawEvents.authorUserId, session.user.id)),
            and(
              eq(rawEvents.visibility, 'specific_users'),
              sql`${session.user.id}::uuid = ANY(${rawEvents.visibilityUserIds})`,
            ),
          ),
        ),
      ),
  );

  const rows = await db
    .select({
      id: entities.id,
      type: entities.type,
      canonicalName: entities.canonicalName,
    })
    .from(entities)
    .where(
      and(
        eq(entities.teamId, active.teamId),
        isNull(entities.mergedIntoId),
        visibleEntityCondition,
      ),
    )
    .orderBy(asc(entities.canonicalName));

  const grouped = new Map<string, typeof rows>();
  for (const row of rows) {
    const list = grouped.get(row.type) ?? [];
    list.push(row);
    grouped.set(row.type, list);
  }

  return (
    <div>
      <header className="mb-10">
        <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Entities</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">People, companies & projects</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Everything extracted from this team&apos;s timeline.
        </p>
      </header>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-card/40 px-6 py-16 text-center text-sm text-muted-foreground">
          No entities yet. Post a note that mentions a person or company and the extraction worker
          will populate this view.
        </div>
      ) : (
        <div className="space-y-10">
          {TYPE_ORDER.map((type) => {
            const list = grouped.get(type) ?? [];
            if (list.length === 0) return null;
            return (
              <section key={type}>
                <div className="mb-3 flex items-baseline justify-between">
                  <h2 className="text-sm font-medium tracking-tight">{TYPE_LABEL[type] ?? type}</h2>
                  <span className="text-xs text-muted-foreground">{list.length}</span>
                </div>
                <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {list.map((e) => (
                    <li key={e.id}>
                      <Link
                        href={`/app/entities/${e.id}`}
                        className="flex items-center justify-between rounded-lg border bg-card px-4 py-3 text-sm transition-colors hover:border-primary/30 hover:bg-accent/40"
                      >
                        <span className="truncate font-medium">{e.canonicalName}</span>
                        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                          {e.type}
                        </span>
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

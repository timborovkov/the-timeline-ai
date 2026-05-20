import { entities, factEntities, facts as factsTable, rawEvents, users } from '@timeline/db';
import { withTeam } from '@timeline/shared';
import { and, desc, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { MergeEntityPanel } from './merge-panel';

import { Card, CardContent } from '@/components/ui/card';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Props {
  params: Promise<{ id: string }>;
}

function formatDate(d: Date): string {
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default async function EntityPage({ params }: Props) {
  const session = await auth();
  if (!session?.user) redirect('/sign-in');
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) redirect('/sign-in');

  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();

  const scope = withTeam(db, active.teamId, session.user.id);
  const callerRole = await scope.requireMembership();
  const isAdmin = callerRole === 'admin' || callerRole === 'owner';

  const entityRows = await db
    .select()
    .from(entities)
    .where(
      and(eq(entities.id, id), eq(entities.teamId, active.teamId), isNull(entities.mergedIntoId)),
    )
    .limit(1);
  const entity = entityRows[0];
  if (!entity) notFound();

  // All facts referencing this entity (any role), team-scoped.
  const factRows = await db
    .select({
      id: factsTable.id,
      statement: factsTable.statement,
      confidence: factsTable.confidence,
      rawEventId: factsTable.rawEventId,
      extractedAt: factsTable.extractedAt,
    })
    .from(factsTable)
    .innerJoin(factEntities, eq(factEntities.factId, factsTable.id))
    .where(and(eq(factEntities.entityId, id), eq(factsTable.teamId, active.teamId)))
    .orderBy(desc(factsTable.extractedAt))
    .limit(200);

  const eventIds = Array.from(new Set(factRows.map((f) => f.rawEventId)));

  // Visibility-filtered events. Pull through the team-scope helper's filter
  // shape so private/specific_users rules are honoured automatically.
  const eventRows =
    eventIds.length > 0
      ? await db
          .select()
          .from(rawEvents)
          .where(
            and(
              inArray(rawEvents.id, eventIds),
              eq(rawEvents.teamId, active.teamId),
              or(
                eq(rawEvents.visibility, 'team'),
                and(
                  eq(rawEvents.visibility, 'private'),
                  eq(rawEvents.authorUserId, session.user.id),
                ),
                and(
                  eq(rawEvents.visibility, 'specific_users'),
                  sql`${session.user.id}::uuid = ANY(${rawEvents.visibilityUserIds})`,
                ),
              ),
            ),
          )
          .orderBy(desc(rawEvents.occurredAt))
      : [];
  const visibleEventIds = new Set(eventRows.map((e) => e.id));
  const visibleFacts = factRows.filter((f) => visibleEventIds.has(f.rawEventId));
  // Co-occurring entities source from VISIBLE facts only. Using the unfiltered
  // fact set would leak the entity graph of private events to teammates who
  // shouldn't see them.
  const visibleFactIds = visibleFacts.map((f) => f.id);

  // Co-occurring entities: other entities referenced by the same facts.
  const coRows =
    visibleFactIds.length > 0
      ? await db
          .select({
            id: entities.id,
            canonicalName: entities.canonicalName,
            type: entities.type,
            count: sql<number>`COUNT(*)::int`,
          })
          .from(factEntities)
          .innerJoin(entities, eq(factEntities.entityId, entities.id))
          .where(
            and(
              inArray(factEntities.factId, visibleFactIds),
              ne(factEntities.entityId, id),
              eq(entities.teamId, active.teamId),
              isNull(entities.mergedIntoId),
            ),
          )
          .groupBy(entities.id, entities.canonicalName, entities.type)
          .orderBy(sql`COUNT(*) DESC`)
          .limit(20)
      : [];

  const authorIds = Array.from(
    new Set(eventRows.map((e) => e.authorUserId).filter((v): v is string => v !== null)),
  );
  const authorRows =
    authorIds.length > 0
      ? await db
          .select({ id: users.id, name: users.name, email: users.email })
          .from(users)
          .where(inArray(users.id, authorIds))
      : [];
  const authorMap = new Map(authorRows.map((r) => [r.id, r] as const));

  const aliases = Array.isArray(entity.aliases)
    ? (entity.aliases as unknown[]).filter((v): v is string => typeof v === 'string')
    : [];

  return (
    <div className="space-y-8">
      <header className="flex flex-col gap-2">
        <Link href="/app/entities" className="text-xs text-muted-foreground hover:text-foreground">
          ← All entities
        </Link>
        <div className="flex items-baseline gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{entity.canonicalName}</h1>
          <span className="text-xs uppercase tracking-wide text-muted-foreground">
            {entity.type}
          </span>
        </div>
        {aliases.length > 0 && (
          <p className="text-sm text-muted-foreground">Also known as: {aliases.join(', ')}</p>
        )}
      </header>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <section className="md:col-span-2 space-y-4">
          <h2 className="text-sm font-medium text-muted-foreground">Facts</h2>
          {visibleFacts.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No facts visible to you. Either no events mention this entity yet, or the events that
              do are private to other users.
            </p>
          ) : (
            <ul className="space-y-2">
              {visibleFacts.map((f) => (
                <li key={f.id} className="rounded-md border bg-card p-3 text-sm">
                  <p>{f.statement}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Confidence {(f.confidence * 100).toFixed(0)}% · extracted{' '}
                    {formatDate(f.extractedAt)}
                  </p>
                </li>
              ))}
            </ul>
          )}

          <h2 className="mt-6 text-sm font-medium text-muted-foreground">Source events</h2>
          {eventRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No source events visible to you.</p>
          ) : (
            <ul className="space-y-3">
              {eventRows.map((ev) => {
                const author = ev.authorUserId ? authorMap.get(ev.authorUserId) : undefined;
                return (
                  <li key={ev.id} className="rounded-md border bg-card p-3">
                    <p className="text-xs text-muted-foreground">
                      {formatDate(ev.occurredAt)} ·{' '}
                      {author?.name ?? author?.email ?? 'Unknown author'} · {ev.source}
                    </p>
                    {ev.contentText && (
                      <p className="mt-1 whitespace-pre-wrap text-sm">{ev.contentText}</p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <aside className="space-y-4">
          <Card>
            <CardContent className="space-y-3 pt-6">
              <h2 className="text-sm font-medium text-muted-foreground">Related</h2>
              {coRows.length === 0 ? (
                <p className="text-xs text-muted-foreground">No co-occurring entities yet.</p>
              ) : (
                <ul className="space-y-1">
                  {coRows.map((c) => (
                    <li key={c.id} className="text-sm">
                      <Link href={`/app/entities/${c.id}`} className="hover:underline">
                        {c.canonicalName}
                      </Link>{' '}
                      <span className="text-xs text-muted-foreground">
                        ({c.type}, {c.count})
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {isAdmin && (
            <Card>
              <CardContent className="pt-6">
                <h2 className="text-sm font-medium text-muted-foreground">Merge</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Fold this entity into another. All facts and aliases move to the survivor.
                </p>
                <div className="mt-3">
                  <MergeEntityPanel entityId={entity.id} entityName={entity.canonicalName} />
                </div>
              </CardContent>
            </Card>
          )}
        </aside>
      </div>
    </div>
  );
}

import { withTeam } from '@timeline/shared';
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

  // Single source of truth: same query the agent's get_entity tool runs.
  const profile = await scope.getEntity(id);
  if (!profile) notFound();
  const { entity, facts: visibleFacts, events: eventRows, coOccurring: coRows } = profile;

  return (
    <div>
      <header className="mb-10 flex flex-col gap-3">
        <Link
          href="/app/entities"
          className="inline-flex w-fit items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          ← All entities
        </Link>
        <div className="flex flex-wrap items-baseline gap-3">
          <h1 className="text-3xl font-semibold tracking-tight">{entity.canonicalName}</h1>
          <span className="rounded-full border bg-card px-2.5 py-0.5 text-[11px] uppercase tracking-wide text-muted-foreground">
            {entity.type}
          </span>
        </div>
        {entity.aliases.length > 0 && (
          <p className="text-sm text-muted-foreground">
            Also known as: {entity.aliases.join(', ')}
          </p>
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
              {eventRows.map((ev) => (
                <li key={ev.id} className="rounded-md border bg-card p-3">
                  <p className="text-xs text-muted-foreground">
                    {formatDate(ev.occurredAt)} ·{' '}
                    {ev.authorName ?? ev.authorEmail ?? 'Unknown author'} · {ev.source}
                  </p>
                  {ev.contentText && (
                    <p className="mt-1 whitespace-pre-wrap text-sm">{ev.contentText}</p>
                  )}
                </li>
              ))}
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

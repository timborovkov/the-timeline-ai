import { withTeam } from '@timeline/shared/team-scope';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { repairSourceIndex } from '@/app/actions/source-health';
import { PageHeader } from '@/components/page-header';
import { RelativeTimestamp } from '@/components/relative-timestamp';
import { Button } from '@/components/ui/button';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { displaySourceLabel } from '@/lib/display-labels';

function RepairButton({
  kind,
  source = '',
}: {
  kind: 'source' | 'object' | 'calendar' | 'document';
  source?: string;
}) {
  return (
    <form action={repairSourceIndex}>
      <input name="kind" type="hidden" value={kind} />
      <input name="key" type="hidden" value={source} />
      <Button type="submit" size="sm" variant="outline">
        Queue reindex
      </Button>
    </form>
  );
}

export default async function SourceHealthPage() {
  const session = await auth();
  if (!session?.user) redirect('/sign-in');
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) redirect('/sign-in');
  const scope = withTeam(db, active.teamId, session.user.id);
  const role = await scope.requireMembership();
  if (role !== 'owner' && role !== 'admin') notFound();
  const [health, calendarImport] = await Promise.all([
    scope.sourceHealth.read(),
    scope.calendar.google.getImport(),
  ]);
  const evidence = new Map(health.sources.map((row) => [row.key, row]));
  const connections = [...new Map(health.connections.map((row) => [row.id, row])).values()];
  const indexRows = [
    { title: 'Objects', kind: 'object' as const, counts: health.objects },
    { title: 'Calendar events', kind: 'calendar' as const, counts: health.calendar },
    { title: 'Document passages', kind: 'document' as const, counts: health.documents },
  ];
  return (
    <div className="space-y-6">
      <Link href="/app/connections" className="text-sm underline">
        Connections
      </Link>
      <PageHeader
        title="Source health"
        subtitle="Check evidence delivery, indexing, and connection recovery."
      />
      <section className="divide-y rounded-lg border" aria-label="Connections">
        {connections.map((connection) => {
          const source = evidence.get(connection.id);
          const selections = [
            ...new Set(
              health.connections
                .filter((row) => row.id === connection.id)
                .flatMap((row) => (row.selection ? [row.selection] : [])),
            ),
          ];
          const needsOwner = connection.paused === 'auth' || connection.paused === 'access_revoked';
          return (
            <article key={connection.id} className="space-y-2 p-4">
              <h2 className="font-medium">{connection.name}</h2>
              <p className="text-sm text-fg-muted">
                {selections.length ? selections.join(', ') : 'No resources selected'}
              </p>
              <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
                <RelativeTimestamp
                  prefix="Last synced"
                  value={connection.lastSync}
                  empty="Never synced"
                />
                <RelativeTimestamp
                  prefix="Last evidence"
                  value={source?.lastDelivered}
                  empty="No visible evidence delivered"
                />
                <span>
                  {source
                    ? `${source.indexed} of ${source.total} indexed`
                    : 'Index coverage unavailable'}
                </span>
                <span>
                  Recovery by{' '}
                  {needsOwner
                    ? (connection.owner ??
                      connection.ownerEmail ??
                      'a replacement connection owner')
                    : 'a workspace admin'}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button asChild size="sm" variant="outline">
                  <Link href={`/app/connections/sources?integrationId=${connection.id}`}>
                    {needsOwner
                      ? 'Open reconnect options'
                      : connection.error || connection.paused || !connection.enabled
                        ? 'Open recovery controls'
                        : 'Manage selections'}
                  </Link>
                </Button>
                {source && source.indexed < source.total ? (
                  <RepairButton kind="source" source={source.key} />
                ) : null}
              </div>
            </article>
          );
        })}
        {health.sources
          .filter((source) => !/^[0-9a-f-]{36}$/i.test(source.key))
          .map((source) => (
            <article key={source.key} className="space-y-2 p-4">
              <h2 className="font-medium">{displaySourceLabel(source.key)}</h2>
              <div className="flex flex-wrap gap-3 text-sm">
                <RelativeTimestamp prefix="Last evidence" value={source.lastDelivered} />
                <span>
                  {source.indexed} of {source.total} indexed
                </span>
              </div>
              {source.indexed < source.total ? (
                <RepairButton kind="source" source={source.key} />
              ) : null}
            </article>
          ))}
        {calendarImport ? (
          <article className="space-y-2 p-4">
            <h2 className="font-medium">Your Google Calendar</h2>
            <p className="text-sm text-fg-muted">
              {calendarImport.calendarName ?? 'No calendar selected'}
            </p>
            <RelativeTimestamp
              prefix="Last synced"
              value={calendarImport.lastSyncAt}
              empty="Never synced"
            />
            <div>
              <Button asChild size="sm" variant="outline">
                <Link href="/app/calendar">Manage import</Link>
              </Button>
            </div>
          </article>
        ) : null}
      </section>
      <section className="space-y-2" aria-label="Workspace index">
        <h2 className="font-medium">Workspace index</h2>
        <div className="divide-y rounded-lg border">
          {indexRows.map(({ title, kind, counts }) => (
            <div key={kind} className="flex flex-wrap items-center justify-between gap-2 p-4">
              <div>
                <h3 className="text-sm font-medium">{title}</h3>
                <p className="text-sm text-fg-muted">
                  {counts?.indexed ?? 0} of {counts?.total ?? 0} confirmed indexed
                </p>
              </div>
              {counts && counts.indexed < counts.total ? <RepairButton kind={kind} /> : null}
            </div>
          ))}
          <div className="p-4">
            <h3 className="text-sm font-medium">Boards</h3>
            <p className="text-sm text-fg-muted">
              Board filters read live records. Linked objects and evidence use their own indexes.
            </p>
          </div>
        </div>
        <Link className="text-sm underline" href="/app/team/jobs?kind=embedding">
          Open indexing job recovery
        </Link>
      </section>
    </div>
  );
}

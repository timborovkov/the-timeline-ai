import { objects, withTeam } from '@timeline/shared';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { NarrowContainer } from '@/components/narrow-container';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

const TYPE_LABEL: Record<string, string> = {
  person: 'People',
  company: 'Companies',
  project: 'Projects',
  topic: 'Topics',
  deal: 'Deals',
  vendor: 'Vendors',
  incident: 'Incidents',
  document: 'Documents',
  decision: 'Decisions',
  hiring_loop: 'Hiring loops',
  task: 'Tasks',
  follow_up: 'Follow-ups',
  other: 'Other',
};

export default async function ObjectsIndexPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; status?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect('/sign-in');
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) redirect('/sign-in');

  const scope = withTeam(db, active.teamId, session.user.id);
  const params = await searchParams;

  // Anything in TYPE_LABEL is a valid filter; otherwise show all.
  const type =
    params.type && TYPE_LABEL[params.type] ? (params.type as objects.ObjectType) : undefined;
  const status = params.status?.trim() ?? undefined;

  // Default to hiding archived objects — `listObjects` only applies the
  // archived predicate when `filter.archived` is explicitly set, so an
  // unset value would surface archived rows in the main index and defeat
  // the archive button on the detail page. A dedicated "Archived" filter
  // chip (with `?archived=1`) is a future addition.
  const filter: objects.ObjectListFilter = { limit: 500, archived: false };
  if (type) filter.type = type;
  if (status) filter.status = status;

  const rows = await objects.listObjects(db, scope, filter);

  // Group by type for the index view. Tasks and follow-ups deserve their own
  // headings since teams are likely to scan them as workstreams.
  const grouped = new Map<string, typeof rows>();
  for (const row of rows) {
    const list = grouped.get(row.type) ?? [];
    list.push(row);
    grouped.set(row.type, list);
  }

  const typeKeys = Array.from(grouped.keys()).sort((a, b) =>
    (TYPE_LABEL[a] ?? a).localeCompare(TYPE_LABEL[b] ?? b),
  );

  return (
    <NarrowContainer>
      <header className="mb-10 flex items-end justify-between gap-6">
        <div>
          <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Objects</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Workspace objects</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            People, companies, deals, tasks, decisions, and everything else this team tracks.
          </p>
        </div>
        <Link
          href="/app/objects/new"
          className="rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 text-sm font-medium text-primary hover:bg-primary/20"
        >
          New object
        </Link>
      </header>

      <nav className="mb-8 flex flex-wrap gap-2 text-xs">
        <Link
          href="/app/objects"
          className={`rounded-full border px-3 py-1 ${!type ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:border-primary/30'}`}
        >
          All
        </Link>
        {Object.entries(TYPE_LABEL).map(([key, label]) => (
          <Link
            key={key}
            href={`/app/objects?type=${key}`}
            className={`rounded-full border px-3 py-1 ${type === key ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:border-primary/30'}`}
          >
            {label}
          </Link>
        ))}
      </nav>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-card/40 px-6 py-16 text-center text-sm text-muted-foreground">
          No objects match this filter yet. Create one above, or capture a note and the extraction
          worker will surface entities here.
        </div>
      ) : (
        <div className="space-y-10">
          {typeKeys.map((typeKey) => {
            const list = grouped.get(typeKey) ?? [];
            return (
              <section key={typeKey}>
                <div className="mb-3 flex items-baseline justify-between">
                  <h2 className="text-sm font-medium tracking-tight">
                    {TYPE_LABEL[typeKey] ?? typeKey}
                  </h2>
                  <span className="text-xs text-muted-foreground">{list.length}</span>
                </div>
                <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {list.map((o) => (
                    <li key={o.id}>
                      <Link
                        href={`/app/objects/${o.id}`}
                        className="flex items-center justify-between rounded-lg border bg-card px-4 py-3 text-sm transition-colors hover:border-primary/30 hover:bg-accent/40"
                      >
                        <span className="min-w-0 flex-1 truncate font-medium">
                          {o.canonicalName}
                        </span>
                        <span className="ml-3 flex items-center gap-2 text-[11px] uppercase tracking-wide text-muted-foreground">
                          <span>{o.status}</span>
                          {o.dueAt && (
                            <span title={o.dueAt.toISOString()}>
                              · {o.dueAt.toLocaleDateString()}
                            </span>
                          )}
                          {/* `agentSuggested` is permanent provenance; the badge should
                              reflect the live review state, not "this was ever proposed
                              by the agent." Once accepted/rejected, status leaves
                              'suggested' and the badge clears. */}
                          {o.agentSuggested && o.status === 'suggested' && (
                            <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-amber-700">
                              suggested
                            </span>
                          )}
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
    </NarrowContainer>
  );
}

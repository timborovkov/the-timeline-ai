import { objects, withTeam } from '@timeline/shared';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { IndexStrip } from '@/components/index-strip';
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

  const type =
    params.type && TYPE_LABEL[params.type]
      ? (params.type as objects.ObjectType)
      : undefined;
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
    <div className="mx-auto max-w-5xl space-y-6">
      <IndexStrip
        srLabel={`Objects · ${rows.length} total${type ? ` · filtered to ${TYPE_LABEL[type] ?? type}` : ''}`}
        segments={[
          { value: 'OBJECTS' },
          { label: 'total', value: rows.length },
          ...(type
            ? ([{ label: 'type', value: TYPE_LABEL[type] ?? type, signal: true }] as const)
            : ([] as const)),
        ]}
        trailing={
          <Link
            href="/app/objects/new"
            className="font-mono text-[11px] uppercase tracking-[0.12em] text-signal hover:underline"
          >
            new →
          </Link>
        }
      />

      <nav
        aria-label="Filter by type"
        className="flex flex-wrap gap-1.5 font-mono text-[11px] uppercase tracking-[0.12em]"
      >
        <Link
          href="/app/objects"
          aria-current={!type ? 'page' : undefined}
          className={`rounded-sm border px-2.5 py-1 transition-colors ${!type ? 'border-signal/40 bg-signal-soft text-signal' : 'border-border text-fg-muted hover:bg-surface-2 hover:text-fg'}`}
        >
          All
        </Link>
        {Object.entries(TYPE_LABEL).map(([key, label]) => (
          <Link
            key={key}
            href={`/app/objects?type=${key}`}
            aria-current={type === key ? 'page' : undefined}
            className={`rounded-sm border px-2.5 py-1 transition-colors ${type === key ? 'border-signal/40 bg-signal-soft text-signal' : 'border-border text-fg-muted hover:bg-surface-2 hover:text-fg'}`}
          >
            {label}
          </Link>
        ))}
      </nav>

      {rows.length === 0 ? (
        <div className="py-10 text-center font-mono text-xs uppercase tracking-[0.12em] text-fg-dim">
          NO OBJECTS MATCH THIS FILTER →{' '}
          <Link href="/app/objects/new" className="text-signal underline">
            create one
          </Link>{' '}
          OR CAPTURE A NOTE
        </div>
      ) : (
        <div className="space-y-8">
          {typeKeys.map((typeKey) => {
            const list = grouped.get(typeKey) ?? [];
            return (
              <section key={typeKey} aria-label={TYPE_LABEL[typeKey] ?? typeKey}>
                <div className="mb-3 flex items-baseline justify-between border-b border-border pb-1.5">
                  <h2 className="font-mono text-[11px] uppercase tracking-[0.14em] text-fg">
                    {TYPE_LABEL[typeKey] ?? typeKey}
                  </h2>
                  <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-dim">
                    {list.length}
                  </span>
                </div>
                <ul className="grid grid-cols-1 gap-px overflow-hidden border border-border sm:grid-cols-2">
                  {list.map((o) => (
                    <li key={o.id} className="bg-bg">
                      <Link
                        href={`/app/objects/${o.id}`}
                        className="flex items-center justify-between px-3 py-2.5 text-sm transition-colors hover:bg-surface"
                      >
                        <span className="min-w-0 flex-1 truncate font-medium text-fg">
                          {o.canonicalName}
                        </span>
                        <span className="ml-3 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.1em] text-fg-dim">
                          <span>{o.status}</span>
                          {o.dueAt ? (
                            <span title={o.dueAt.toISOString()}>
                              · {o.dueAt.toLocaleDateString('en-CA')}
                            </span>
                          ) : null}
                          {/* `agentSuggested` is permanent provenance; the
                              badge should reflect the live review state,
                              not "this was ever proposed by the agent."
                              Once accepted/rejected, status leaves
                              'suggested' and the badge clears. */}
                          {o.agentSuggested && o.status === 'suggested' ? (
                            <span className="rounded-sm border border-signal/40 bg-signal-soft px-1.5 py-0.5 text-signal">
                              suggested
                            </span>
                          ) : null}
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

import { withTeam } from '@timeline/shared/team-scope';
import { redirect } from 'next/navigation';

import type { Metadata } from 'next';

import { Breadcrumb } from '@/components/breadcrumb';
import { EmptyAction } from '@/components/empty-action';
import { IndexStrip } from '@/components/index-strip';
import { TechnicalDetails } from '@/components/technical-details';
import { Badge } from '@/components/ui/badge';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { formatDisplayDateTime } from '@/lib/display-dates';

export const metadata: Metadata = {
  title: 'Team audit',
  description: 'Review team activity and audit history.',
};

export const dynamic = 'force-dynamic';

export default async function TrustAuditPage() {
  const session = await auth();
  if (!session?.user) redirect('/sign-in');
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) redirect('/sign-in');

  const scope = withTeam(db, active.teamId, session.user.id);
  let canViewAudit = true;
  try {
    await scope.requireMembership('admin');
  } catch {
    canViewAudit = false;
  }
  if (!canViewAudit) redirect('/app/team');

  const [rows, calendarSettings] = await Promise.all([
    scope.audit.list(200),
    scope.calendar.getCalendarSettings(),
  ]);
  const timezone = calendarSettings.defaultTimezone;

  return (
    <div className="space-y-8">
      <Breadcrumb items={[{ label: 'Team', href: '/app/team' }, { label: 'Trust audit' }]} />
      <IndexStrip
        srLabel={`Trust audit · ${String(rows.length)} rows · times in ${timezone}`}
        segments={[
          { value: 'TRUST AUDIT' },
          { label: 'team', value: active.teamName, signal: true },
          { label: 'rows', value: rows.length },
          {
            label: 'time zone',
            value: <span className="normal-case tracking-normal">{timezone}</span>,
          },
        ]}
      />
      <section aria-labelledby="trust-audit-entries">
        <h2 id="trust-audit-entries" className="sr-only">
          Audit entries
        </h2>
        {rows.length === 0 ? (
          <EmptyAction
            title="No audit entries yet"
            body="Team activity that creates an audit record will appear here."
            href="/app/team"
            action="Manage team settings"
          />
        ) : (
          <ul className="divide-y divide-border rounded-sm border border-border bg-surface text-sm">
            {rows.map((row) => (
              <li key={row.id} className="grid gap-2 p-3 sm:grid-cols-[1fr_auto]">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs uppercase tracking-[0.14em] text-fg-muted">
                      {row.action}
                    </span>
                    {row.redacted ? <Badge variant="outline">redacted</Badge> : null}
                    <time
                      dateTime={row.createdAt.toISOString()}
                      className="font-mono text-xs tabular-nums text-fg-muted"
                    >
                      {formatDisplayDateTime(row.createdAt, { timezone })}
                    </time>
                  </div>
                  <div className="truncate font-medium">{row.targetLabel}</div>
                  <div className="text-xs text-fg-muted">{row.targetType.replaceAll('_', ' ')}</div>
                  <TechnicalDetails
                    items={[
                      { label: 'Audit ID', value: row.id, copyValue: row.id },
                      ...(row.targetId
                        ? [{ label: 'Target ID', value: row.targetId, copyValue: row.targetId }]
                        : []),
                    ]}
                  />
                </div>
                <div className="text-left text-xs text-fg-muted sm:text-right">
                  <div>{row.actor.name ?? row.actor.email ?? 'Unknown actor'}</div>
                  {row.actor.email ? <div>{row.actor.email}</div> : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

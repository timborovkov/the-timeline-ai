import { withTeam } from '@timeline/shared/team-scope';
import { redirect } from 'next/navigation';

import type { Metadata } from 'next';

import { integrationAuditSummary } from '@/app/app/team/integrations/audit/integration-audit-summary';
import { Breadcrumb } from '@/components/breadcrumb';
import { IndexStrip } from '@/components/index-strip';
import { TechnicalDetails } from '@/components/technical-details';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { formatDisplayDateTime } from '@/lib/display-dates';

export const metadata: Metadata = {
  title: 'Integration audit',
  description: 'Review integration activity and sync history.',
};

export const dynamic = 'force-dynamic';

export default async function IntegrationAuditPage() {
  const session = await auth();
  if (!session?.user) redirect('/sign-in');
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) redirect('/sign-in');
  const scope = withTeam(db, active.teamId, session.user.id);
  // Audit rows can contain provider/external_account_id metadata + sync
  // error details (file/issue names, partial payloads) that the rest of
  // the integration mutations gate to admins. Match that posture here.
  let canViewAudit = true;
  try {
    await scope.requireMembership('admin');
  } catch {
    canViewAudit = false;
  }
  if (!canViewAudit) redirect('/app/team/integrations');
  const [rows, calendarSettings] = await Promise.all([
    scope.integrations.listAudit(null, 200),
    scope.calendar.getCalendarSettings(),
  ]);
  const timezone = calendarSettings.defaultTimezone;

  return (
    <div className="space-y-8">
      <Breadcrumb
        items={[
          { label: 'Team', href: '/app/team' },
          { label: 'Integrations', href: '/app/team/integrations' },
          { label: 'Audit log' },
        ]}
      />
      <IndexStrip
        srLabel={`Integration audit · ${String(rows.length)} rows · times in ${timezone}`}
        segments={[
          { value: 'INTEGRATION AUDIT' },
          { label: 'team', value: active.teamName, signal: true },
          { label: 'rows', value: rows.length },
          {
            label: 'time zone',
            value: <span className="normal-case tracking-normal">{timezone}</span>,
          },
        ]}
      />
      <ul className="divide-y divide-border rounded-sm border border-border bg-surface text-sm">
        {rows.length === 0 ? (
          <li className="px-3 py-2 text-fg-muted">No audit entries yet.</li>
        ) : (
          rows.map((r) => (
            <li key={r.id} className="p-3">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="font-medium leading-snug text-fg">
                    {integrationAuditSummary(r.kind)}
                  </div>
                  <time
                    dateTime={r.createdAt.toISOString()}
                    className="font-mono text-xs tabular-nums text-fg-muted"
                  >
                    {formatDisplayDateTime(r.createdAt, { timezone })}
                  </time>
                </div>
                <TechnicalDetails
                  className="mt-3"
                  items={[
                    { label: 'Audit ID', value: r.id, copyValue: r.id },
                    { label: 'Event code', value: r.kind, copyValue: r.kind },
                    {
                      label: 'Payload',
                      value: JSON.stringify(r.payload, null, 2),
                      copyValue: JSON.stringify(r.payload, null, 2),
                    },
                  ]}
                />
              </div>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

import { withTeam } from '@timeline/shared/team-scope';
import { redirect } from 'next/navigation';

import type { Metadata } from 'next';

import { integrationAuditSummary } from '@/app/app/team/integrations/audit/integration-audit-summary';
import { Breadcrumb } from '@/components/breadcrumb';
import { EmptyAction } from '@/components/empty-action';
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

const INTEGRATION_AUDIT_SUMMARIES: Record<string, string> = {
  backfill_enqueue_failed: 'Unable to queue sync',
  backfill_requested: 'Sync requested',
  'backfill_skipped:provider_budget': 'Sync paused for provider quota',
  connect: 'Provider account connected',
  disconnect: 'Provider disconnected',
  disconnect_failed: 'Provider disconnect failed',
  drive_page_cap_hit: 'Google Drive sync reached its page limit',
  github_backfill_partial: 'GitHub historical sync completed with gaps',
  github_commit_cursor_target_missing: 'GitHub commit cursor was reset',
  github_commit_gap_checkpoint: 'GitHub commit sync checkpoint saved',
  github_commit_history_truncated: 'GitHub commit history was limited',
  github_incremental_partial: 'GitHub update sync completed with gaps',
  harvest_failed: 'File content could not be read',
  harvest_skipped: 'File content skipped',
  monday_board_synced: 'Monday board synced',
  targeted_item_board_mismatch: 'Selected item is on a different board',
  targeted_item_missing: 'Selected item was not found',
  webhook_provision_failed: 'Webhook setup failed',
  webhook_provision_skipped_missing_scopes: 'Webhook setup needs more permissions',
  webhooks_reconciled: 'Webhook subscriptions updated',
};

export function integrationAuditSummary(kind: string): string {
  return (
    INTEGRATION_AUDIT_SUMMARIES[kind] ??
    kind
      .replaceAll(/[_:.-]+/g, ' ')
      .trim()
      .replace(/^./, (first) => first.toUpperCase())
  );
}

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
      <section aria-labelledby="integration-audit-entries">
        <h2 id="integration-audit-entries" className="sr-only">
          Audit entries
        </h2>
        {rows.length === 0 ? (
          <EmptyAction
            title="No integration audit entries yet"
            body="Connection and sync activity that creates an audit record will appear here."
            href="/app/team/integrations"
            action="Manage integrations"
          />
        ) : (
          <ul className="divide-y divide-border rounded-sm border border-border bg-surface text-sm">
            {rows.map((r) => (
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
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

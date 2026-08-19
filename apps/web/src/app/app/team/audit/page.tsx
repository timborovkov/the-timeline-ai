import { withTeam } from '@timeline/shared/team-scope';
import { ClipboardList } from 'lucide-react';
import { redirect } from 'next/navigation';

import type { Metadata } from 'next';

import { Breadcrumb } from '@/components/breadcrumb';
import { EmptyState } from '@/components/empty-state';
import { IndexStrip } from '@/components/index-strip';
import { RelativeTimestamp } from '@/components/relative-timestamp';
import { TechnicalDetails } from '@/components/technical-details';
import { Badge } from '@/components/ui/badge';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { cn } from '@/lib/utils';

export const metadata: Metadata = {
  title: 'Team audit',
  description: 'Review team activity and audit history.',
};

export const dynamic = 'force-dynamic';

const auditActionAbbreviations: Record<string, string> = {
  api: 'API',
  id: 'ID',
  mcp: 'MCP',
  oauth: 'OAuth',
  url: 'URL',
};

const auditActionLabels: Record<string, string> = {
  'document.detail_read': 'Document viewed',
  'document.promote_captured_file': 'Captured file added to documents',
  'document.signed_url': 'Document link created',
  'document.visibility_change': 'Document visibility changed',
  'event.detail_read': 'Event viewed',
  'ingest_webhook.create': 'Ingest webhook created',
  'ingest_webhook.disable': 'Ingest webhook disabled',
  'ingest_webhook.rotate': 'Ingest webhook credential rotated',
  'integration.connect': 'Integration connected',
  'integration.disconnect': 'Integration disconnected',
  'integration.resource_revoke': 'Integration resource access revoked',
  'integration.resource_share': 'Integration resources shared',
  'integration.settings_change': 'Integration settings changed',
  'job.dismiss': 'Job dismissed',
  'job.retry': 'Job retried',
  'mcp.connect': 'MCP server connected',
  'mcp.disconnect': 'MCP server disconnected',
  'mcp.settings_change': 'MCP server settings changed',
  'settings.change': 'Team settings changed',
  'slack.connect': 'Slack connected',
  'slack.disconnect': 'Slack disconnected',
  'slack.settings_change': 'Slack settings changed',
  'team.export_create': 'Team export',
  'team.export_download': 'Team export download',
  'team_export.file_urls_signed': 'Team export links created',
  'team_export.ready': 'Team export ready',
};

const auditMetadataFields = [
  ['mode', 'Mode'],
  ['outcome', 'Outcome'],
  ['reason', 'Reason'],
  ['recovery_kind', 'Recovery kind'],
  ['artifact_kind', 'Artifact kind'],
  ['target_count', 'Target count'],
  ['expires_at', 'Expires at'],
] as const;

function auditActionLabel(action: string): string {
  if (auditActionLabels[action]) return auditActionLabels[action];
  return action
    .split(/[._:-]+/)
    .filter(Boolean)
    .map(
      (word) =>
        auditActionAbbreviations[word.toLowerCase()] ?? `${word[0]?.toUpperCase()}${word.slice(1)}`,
    )
    .join(' ');
}

function auditSummary(action: string, metadata: Record<string, unknown>) {
  const label = auditActionLabel(action);
  const outcome = typeof metadata.outcome === 'string' ? metadata.outcome : null;

  switch (outcome) {
    case 'enqueue_failed':
      return { label: `Unable to queue ${label.toLowerCase()}`, outcome: 'Failed', danger: true };
    case 'rejected':
      return { label: `${label} rejected`, outcome: 'Rejected', danger: true };
    case 'queued':
      return { label: `${label} queued`, outcome: null, danger: false };
    case 'succeeded':
      return { label: `${label} completed`, outcome: null, danger: false };
    case 'signed':
      return { label: `${label} link created`, outcome: null, danger: false };
    default:
      return { label, outcome: null, danger: false };
  }
}

function auditMetadataDetails(metadata: Record<string, unknown>) {
  return auditMetadataFields.flatMap(([key, label]) => {
    const value = metadata[key];
    if (typeof value !== 'string' && typeof value !== 'number') return [];
    const copyValue = String(value);
    return [{ id: `metadata-${key}`, label, value: copyValue, copyValue }];
  });
}

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
          <EmptyState
            icon={ClipboardList}
            title="No audit entries yet"
            body="Team activity that creates an audit record will appear here."
            href="/app/team"
            action="Manage team settings"
          />
        ) : (
          <ul className="border-y border-border text-sm">
            {rows.map((row) => {
              const summary = row.redacted
                ? { label: 'Restricted activity', outcome: null, danger: false }
                : auditSummary(row.action, row.metadata);
              const metadataDetails = row.redacted ? [] : auditMetadataDetails(row.metadata);
              const technicalItems = row.redacted
                ? [{ label: 'Audit ID', value: row.id, copyValue: row.id }]
                : [
                    { label: 'Event code', value: row.action, copyValue: row.action },
                    ...metadataDetails,
                    { label: 'Audit ID', value: row.id, copyValue: row.id },
                    ...(row.targetId
                      ? [{ label: 'Target ID', value: row.targetId, copyValue: row.targetId }]
                      : []),
                  ];
              const actorName = row.actor.name ?? row.actor.email ?? 'Unknown actor';
              const showActorEmail = Boolean(row.actor.name && row.actor.email);

              return (
                <li
                  key={row.id}
                  className="grid gap-3 border-b border-border py-3 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_minmax(10rem,18rem)]"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {summary.outcome ? (
                        <Badge variant="destructive">{summary.outcome}</Badge>
                      ) : null}
                      {row.redacted ? <Badge variant="outline">Restricted</Badge> : null}
                      <RelativeTimestamp value={row.createdAt} />
                    </div>
                    <div
                      className={cn(
                        'break-words font-medium text-fg',
                        summary.danger && 'text-danger',
                      )}
                    >
                      {summary.label}
                    </div>
                    {!row.redacted ? (
                      <>
                        <div className="break-words text-sm text-fg-muted">{row.targetLabel}</div>
                        <div className="text-xs text-fg-muted">
                          {row.targetType.replaceAll('_', ' ')}
                        </div>
                      </>
                    ) : null}
                  </div>
                  {!row.redacted ? (
                    <dl className="min-w-0 text-left text-xs text-fg-muted sm:text-right">
                      <dt className="sr-only">Performed by</dt>
                      <dd className="m-0 break-words">{actorName}</dd>
                      {showActorEmail ? (
                        <>
                          <dt className="sr-only">Email</dt>
                          <dd className="m-0 break-all">{row.actor.email}</dd>
                        </>
                      ) : null}
                    </dl>
                  ) : null}
                  <TechnicalDetails className="sm:col-span-2" items={technicalItems} />
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

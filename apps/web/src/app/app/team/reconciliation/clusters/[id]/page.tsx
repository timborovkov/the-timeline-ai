import { withTeam } from '@timeline/shared/team-scope';
import { ArrowLeft, Play } from 'lucide-react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import type {
  ReconciliationClusterDetailEvidence,
  ReconciliationClusterDetailOutput,
} from '@timeline/shared/reconciliation';
import type { Metadata } from 'next';

import { queueReconciliationJobFormAction } from '@/app/actions/reconciliation';
import {
  artifactClusterKindLabel,
  artifactTypeLabel,
  clusterStatusLabel,
  confidenceLabel,
  evidenceRoleLabel,
  evidenceStrengthLabel,
  outputActionLabel,
  outputKindLabel,
  outputStatusLabel,
} from '@/app/app/team/reconciliation/clusters/[id]/presentation';
import { Breadcrumb } from '@/components/breadcrumb';
import { PageHeader } from '@/components/page-header';
import { SectionHeading } from '@/components/section-heading';
import { StatusBadge } from '@/components/status-badge';
import { TechnicalDetails } from '@/components/technical-details';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { formatDisplayDateTime } from '@/lib/display-dates';
import { displayArtifactLabel, displaySourceLabel } from '@/lib/display-labels';

export const metadata: Metadata = {
  title: 'Reconciliation Cluster',
  description: 'Inspect reconciliation evidence and outputs for one work artifact cluster.',
};

export const dynamic = 'force-dynamic';

export default async function ReconciliationClusterPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const [{ id }, session] = await Promise.all([params, auth()]);
  if (!session?.user) redirect('/sign-in');
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) redirect('/sign-in');

  const scope = withTeam(db, active.teamId, session.user.id);
  const detail = await scope.reconciliation.getClusterDetail({ clusterId: id });
  if (!detail) notFound();
  const calendarSettings = await scope.calendar.getCalendarSettings();
  const timezone = calendarSettings.defaultTimezone;
  const { cluster } = detail;

  return (
    <div className="space-y-8">
      <Breadcrumb
        items={[
          { label: 'Team', href: '/app/team' },
          { label: 'Reconciliation', href: '/app/team/reconciliation' },
          { label: cluster.canonicalName },
        ]}
      />
      <PageHeader
        title={displayArtifactLabel(cluster)}
        subtitle={
          <>
            {artifactTypeLabel(cluster.artifactType)} ·{' '}
            <time dateTime={cluster.updatedAt.toISOString()}>
              Updated {formatDisplayDateTime(cluster.updatedAt, { timezone })}
            </time>
          </>
        }
        metadata={[
          {
            value: (
              <StatusBadge status={cluster.status} label={clusterStatusLabel(cluster.status)} />
            ),
          },
          { label: 'Category', value: artifactClusterKindLabel(cluster.artifactClusterKind) },
          { label: 'Evidence', value: detail.evidence.length, mono: true },
          { label: 'Outputs', value: detail.outputs.length, mono: true },
          { label: 'Time zone', value: timezone },
        ]}
        srLabel={`Reconciliation cluster ${displayArtifactLabel(cluster)}. ${clusterStatusLabel(cluster.status)}. ${String(detail.evidence.length)} evidence items and ${String(detail.outputs.length)} outputs. Times in ${timezone}.`}
      />

      <section className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="space-y-3 rounded-sm border border-border bg-surface p-4">
          <Link
            href="/app/team/reconciliation"
            className="inline-flex items-center gap-2 text-sm text-fg-muted hover:text-signal"
          >
            <ArrowLeft className="size-4" />
            Reconciliation dashboard
          </Link>
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline" className="rounded-sm">
              {artifactClusterKindLabel(cluster.artifactClusterKind)}
            </Badge>
            {cluster.canonicalEntityId ? (
              <Link href={`/app/objects/${cluster.canonicalEntityId}`}>
                <Badge className="rounded-sm">View workspace item</Badge>
              </Link>
            ) : null}
          </div>
          <TechnicalDetails
            items={[
              { label: 'Cluster ID', value: cluster.id, copyValue: cluster.id },
              ...(cluster.canonicalEntityId
                ? [
                    {
                      label: 'Object ID',
                      value: cluster.canonicalEntityId,
                      copyValue: cluster.canonicalEntityId,
                    },
                  ]
                : []),
              { label: 'Cluster kind', value: cluster.artifactClusterKind },
              { label: 'Artifact type', value: cluster.artifactType },
              { label: 'Status', value: cluster.status },
              {
                label: 'Updated at',
                value: cluster.updatedAt.toISOString(),
                copyValue: cluster.updatedAt.toISOString(),
              },
            ]}
          />
        </div>

        <section className="space-y-3 rounded-sm border border-border bg-surface p-4">
          <SectionHeading>Manual reconcile</SectionHeading>
          <form action={queueReconciliationJobFormAction} className="space-y-3">
            <input type="hidden" name="mode" value="scope" />
            <input type="hidden" name="scope" value="cluster" />
            <input type="hidden" name="targetId" value={cluster.id} />
            <Button type="submit" variant="outline">
              <Play className="size-4" />
              Reconcile cluster
            </Button>
          </form>
        </section>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <EvidenceList rows={detail.evidence} />
        <OutputList rows={detail.outputs} timezone={timezone} />
      </section>
    </div>
  );
}

function EvidenceList({ rows }: { rows: ReconciliationClusterDetailEvidence[] }) {
  return (
    <section className="space-y-3">
      <SectionTitle label="Evidence" />
      <ul className="divide-y divide-border rounded-sm border border-border bg-surface text-sm">
        {rows.length === 0 ? (
          <li className="px-3 py-2 text-fg-muted">No visible evidence for this cluster.</li>
        ) : (
          rows.map((row, index) => (
            <li
              key={`${row.rawEventId ?? 'no-event'}:${row.role}:${String(index)}`}
              className="p-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="rounded-sm">
                  {evidenceRoleLabel(row.role)}
                </Badge>
                {row.authoritative ? (
                  <Badge variant="outline" className="rounded-sm">
                    Authoritative source
                  </Badge>
                ) : null}
                <span className="text-xs text-fg-muted">{evidenceStrengthLabel(row.strength)}</span>
                {row.provider ? (
                  <span className="text-xs text-fg-muted">{displaySourceLabel(row.provider)}</span>
                ) : null}
              </div>
              <div className="mt-2 line-clamp-3 text-fg">
                {row.objectName ?? row.contentText ?? 'Unavailable evidence'}
              </div>
              <TechnicalDetails
                className="mt-3"
                items={[
                  ...(row.rawEventId
                    ? [{ label: 'Raw event ID', value: row.rawEventId, copyValue: row.rawEventId }]
                    : []),
                  ...(row.externalObjectId
                    ? [
                        {
                          label: 'External object ID',
                          value: row.externalObjectId,
                          copyValue: row.externalObjectId,
                        },
                      ]
                    : []),
                  { label: 'Evidence role', value: row.role },
                  { label: 'Evidence strength', value: row.strength },
                  { label: 'Authoritative', value: String(row.authoritative) },
                ]}
              />
            </li>
          ))
        )}
      </ul>
    </section>
  );
}

function OutputList({
  rows,
  timezone,
}: {
  rows: ReconciliationClusterDetailOutput[];
  timezone: string;
}) {
  return (
    <section className="space-y-3">
      <SectionTitle label="Outputs" />
      <ul className="divide-y divide-border rounded-sm border border-border bg-surface text-sm">
        {rows.length === 0 ? (
          <li className="px-3 py-2 text-fg-muted">
            No visible reconciliation outputs for this cluster.
          </li>
        ) : (
          rows.map((row) => (
            <li key={row.id} className="space-y-2 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  variant={row.status === 'failed' ? 'destructive' : 'outline'}
                  className="rounded-sm"
                >
                  {outputStatusLabel(row.status)}
                </Badge>
                {row.requiresApproval ? <Badge className="rounded-sm">Needs approval</Badge> : null}
                <span className="text-xs text-fg-muted">{outputKindLabel(row.outputKind)}</span>
              </div>
              <div className="font-medium">{outputActionLabel(row)}</div>
              <div className="flex flex-wrap gap-x-2 text-xs text-fg-muted">
                <span>{confidenceLabel(row.confidence)}</span>
                <span aria-hidden="true">·</span>
                <time
                  dateTime={row.createdAt.toISOString()}
                  className="font-mono tabular-nums text-fg-dim"
                >
                  Created {formatDisplayDateTime(row.createdAt, { timezone })}
                </time>
              </div>
              <TechnicalDetails
                items={[
                  { label: 'Output ID', value: row.id, copyValue: row.id },
                  { label: 'Output kind', value: row.outputKind },
                  { label: 'Target kind', value: row.targetKind },
                  { label: 'Operation', value: row.operation },
                  { label: 'Confidence', value: row.confidence },
                  { label: 'Status', value: row.status },
                  { label: 'Requires approval', value: String(row.requiresApproval) },
                  ...(row.targetId
                    ? [{ label: 'Target ID', value: row.targetId, copyValue: row.targetId }]
                    : []),
                  {
                    id: `${row.id}:created-at`,
                    label: 'Created at',
                    value: row.createdAt.toISOString(),
                    copyValue: row.createdAt.toISOString(),
                  },
                  {
                    id: `${row.id}:updated-at`,
                    label: 'Updated at',
                    value: row.updatedAt.toISOString(),
                    copyValue: row.updatedAt.toISOString(),
                  },
                  {
                    label: 'Source refs',
                    ...jsonDetail(row.sourceRefs),
                  },
                  {
                    label: 'Payload refs',
                    ...jsonDetail(row.sourcePayloadRefs),
                  },
                  {
                    label: 'Payload',
                    ...jsonDetail(row.payload),
                  },
                ]}
              />
            </li>
          ))
        )}
      </ul>
    </section>
  );
}

function SectionTitle({ label }: { label: string }) {
  return <SectionHeading>{label}</SectionHeading>;
}

function jsonDetail(value: unknown): { value: string; copyValue: string } {
  const serialized = JSON.stringify(value ?? {}, null, 2);
  return { value: serialized.slice(0, 2_000), copyValue: serialized };
}

import { withTeam } from '@timeline/shared/team-scope';
import { Play } from 'lucide-react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import type {
  ReconciliationClusterDetailEvidence,
  ReconciliationClusterDetailOutput,
} from '@timeline/shared/reconciliation';
import type { Metadata } from 'next';

import { queueReconciliationJobFormAction } from '@/app/actions/reconciliation';
import { Breadcrumb } from '@/components/breadcrumb';
import { CollectionRow } from '@/components/collections/collection-row';
import { CollectionStatus } from '@/components/collections/collection-status';
import { PageHeader } from '@/components/page-header';
import { ClusterOutputRow } from '@/components/reconciliation/cluster-output-row';
import { ReconciliationForbiddenView } from '@/components/reconciliation/forbidden-view';
import {
  artifactClusterKindLabel,
  artifactTypeLabel,
  clusterStatusLabel,
  confidenceLabel,
  evidenceRoleLabel,
  evidenceStrengthLabel,
  outputActionLabel,
  outputKindLabel,
} from '@/components/reconciliation/presentation';
import {
  reconciliationClusterRowHint,
  reconciliationEvidenceRowHint,
  reconciliationOutputRowHint,
} from '@/components/reconciliation/row-hint';
import { RelativeTimestamp } from '@/components/relative-timestamp';
import { SectionHeading } from '@/components/section-heading';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { formatRelativeAge } from '@/lib/display-dates';
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
  try {
    await scope.requireMembership('admin');
  } catch {
    return <ReconciliationForbiddenView teamName={active.teamName} />;
  }

  const detail = await scope.reconciliation.getClusterDetail({ clusterId: id });
  if (!detail) notFound();
  const calendarSettings = await scope.calendar.getCalendarSettings();
  const timezone = calendarSettings.defaultTimezone;
  const { cluster } = detail;
  const clusterHint = reconciliationClusterRowHint({
    artifactClusterKind: cluster.artifactClusterKind,
    artifactType: cluster.artifactType,
    clusterId: cluster.id,
    status: cluster.status,
    timeZone: timezone,
    updatedAt: cluster.updatedAt,
  });

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
        title={<span title={clusterHint}>{displayArtifactLabel(cluster)}</span>}
        subtitle={
          <>
            {artifactTypeLabel(cluster.artifactType)} ·{' '}
            <RelativeTimestamp prefix="Updated" value={cluster.updatedAt} />
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
        trailing={
          <div className="flex flex-wrap items-center justify-end gap-2">
            {cluster.canonicalEntityId ? (
              <Button asChild variant="secondary" size="sm">
                <Link href={`/app/objects/${cluster.canonicalEntityId}`}>View workspace item</Link>
              </Button>
            ) : null}
            <form action={queueReconciliationJobFormAction}>
              <input type="hidden" name="mode" value="scope" />
              <input type="hidden" name="scope" value="cluster" />
              <input type="hidden" name="targetId" value={cluster.id} />
              <Button type="submit" variant="outline" size="sm">
                <Play className="size-4" />
                Reconcile cluster
              </Button>
            </form>
          </div>
        }
        srLabel={`Reconciliation cluster ${displayArtifactLabel(cluster)}. ${clusterStatusLabel(cluster.status)}. ${String(detail.evidence.length)} evidence items and ${String(detail.outputs.length)} outputs. Times in ${timezone}.`}
      />

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
      <SectionHeading>Evidence</SectionHeading>
      {rows.length === 0 ? (
        <p className="px-1 py-4 text-sm text-fg-muted">No visible evidence for this cluster.</p>
      ) : (
        <ul className="border-y border-border">
          {rows.map((row, index) => {
            const hint = reconciliationEvidenceRowHint({
              authoritative: row.authoritative,
              externalObjectId: row.externalObjectId,
              rawEventId: row.rawEventId,
              role: row.role,
              strength: row.strength,
            });
            const contextParts = [
              evidenceStrengthLabel(row.strength),
              row.provider ? displaySourceLabel(row.provider) : null,
              row.authoritative ? 'Authoritative source' : null,
            ].filter((part): part is string => Boolean(part));
            return (
              <li key={`${row.rawEventId ?? 'no-event'}:${row.role}:${String(index)}`}>
                <CollectionRow>
                  <CollectionRow.Leading>
                    <CollectionStatus value={row.role} label={evidenceRoleLabel(row.role)} />
                  </CollectionRow.Leading>
                  <CollectionRow.Title title={hint}>
                    {row.objectName ?? row.contentText ?? 'Unavailable evidence'}
                  </CollectionRow.Title>
                  <CollectionRow.Context title={hint}>
                    {contextParts.join(' · ')}
                  </CollectionRow.Context>
                </CollectionRow>
              </li>
            );
          })}
        </ul>
      )}
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
      <SectionHeading>Outputs</SectionHeading>
      {rows.length === 0 ? (
        <p className="px-1 py-4 text-sm text-fg-muted">
          No visible reconciliation outputs for this cluster.
        </p>
      ) : (
        <ul className="border-y border-border">
          {rows.map((row) => {
            const title = outputActionLabel(row);
            const hint = reconciliationOutputRowHint({
              clusterId: row.clusterId,
              confidence: row.confidence,
              createdAt: row.createdAt,
              outputId: row.id,
              outputKind: row.outputKind,
              sourcePayloadRefs: row.sourcePayloadRefs,
              sourceRefs: row.sourceRefs,
              status: row.status,
              targetId: row.targetId,
              targetKind: row.targetKind,
              timeZone: timezone,
            });
            const contextParts = [
              outputKindLabel(row.outputKind),
              confidenceLabel(row.confidence),
              row.requiresApproval ? 'Needs approval' : null,
            ].filter((part): part is string => Boolean(part));
            return (
              <li key={row.id}>
                <ClusterOutputRow
                  context={contextParts.join(' · ')}
                  createdAtIso={row.createdAt.toISOString()}
                  payloadJson={JSON.stringify(row.payload ?? {})}
                  relativeAge={formatRelativeAge(row.createdAt)}
                  status={row.status}
                  title={title}
                  titleHint={hint}
                />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

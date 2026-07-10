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
import { Breadcrumb } from '@/components/breadcrumb';
import { IndexStrip } from '@/components/index-strip';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

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
  const { cluster } = detail;

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <Breadcrumb
        items={[
          { label: 'Team', href: '/app/team' },
          { label: 'Reconciliation', href: '/app/team/reconciliation' },
          { label: cluster.canonicalName },
        ]}
      />
      <IndexStrip
        srLabel={`Reconciliation cluster ${cluster.canonicalName} · ${cluster.artifactClusterKind} · ${cluster.status}`}
        segments={[
          { value: 'CLUSTER' },
          { label: 'kind', value: cluster.artifactClusterKind, signal: true },
          { label: 'status', value: cluster.status },
          { label: 'evidence', value: detail.evidence.length },
          { label: 'outputs', value: detail.outputs.length },
        ]}
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
          <div>
            <h1 className="text-2xl font-semibold text-fg">{cluster.canonicalName}</h1>
            <p className="mt-1 text-sm text-fg-muted">
              {cluster.artifactType} · updated {cluster.updatedAt.toLocaleString()}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline" className="rounded-sm">
              {cluster.status}
            </Badge>
            <Badge variant="outline" className="rounded-sm">
              {cluster.artifactClusterKind}
            </Badge>
            {cluster.canonicalEntityId ? (
              <Link href={`/app/objects/${cluster.canonicalEntityId}`}>
                <Badge className="rounded-sm">workspace object</Badge>
              </Link>
            ) : null}
          </div>
        </div>

        <section className="space-y-3 rounded-sm border border-border bg-surface p-4">
          <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-fg-muted">
            Manual reconcile
          </h2>
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
        <OutputList rows={detail.outputs} />
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
                <Badge variant={row.authoritative ? 'default' : 'outline'} className="rounded-sm">
                  {row.role}
                </Badge>
                <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-dim">
                  {row.strength}
                </span>
                {row.provider ? (
                  <span className="text-xs text-fg-muted">{row.provider}</span>
                ) : null}
              </div>
              <div className="mt-2 line-clamp-3 text-fg">
                {row.objectName ?? row.contentText ?? row.externalObjectId ?? row.rawEventId}
              </div>
              {row.rawEventId ? (
                <div className="mt-2 font-mono text-xs text-fg-dim">{row.rawEventId}</div>
              ) : null}
            </li>
          ))
        )}
      </ul>
    </section>
  );
}

function OutputList({ rows }: { rows: ReconciliationClusterDetailOutput[] }) {
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
                  {row.status}
                </Badge>
                {row.requiresApproval ? <Badge className="rounded-sm">approval</Badge> : null}
                <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-dim">
                  {row.outputKind}
                </span>
              </div>
              <div className="font-medium">
                {row.targetKind} · {row.operation}
              </div>
              <div className="text-xs text-fg-muted">
                {row.confidence} confidence · {row.createdAt.toLocaleString()}
              </div>
              <div className="space-y-1 rounded-sm border border-border bg-background p-2 font-mono text-[11px] text-fg-dim">
                <div>output {row.id}</div>
                <div>source refs {jsonPreview(row.sourceRefs)}</div>
                <div>payload refs {jsonPreview(row.sourcePayloadRefs)}</div>
              </div>
              <pre className="max-h-44 overflow-auto rounded-sm border border-border bg-background p-2 text-xs text-fg-muted">
                {jsonPreview(row.payload)}
              </pre>
            </li>
          ))
        )}
      </ul>
    </section>
  );
}

function SectionTitle({ label }: { label: string }) {
  return (
    <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-fg-muted">{label}</h2>
  );
}

function jsonPreview(value: unknown): string {
  return JSON.stringify(value ?? {}, null, 2).slice(0, 2_000);
}

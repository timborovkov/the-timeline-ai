import { eventSource } from '@timeline/db';
import { withTeam } from '@timeline/shared/team-scope';
import { DatabaseZap, ListRestart, Play } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import type {
  ReconciliationDashboardCluster,
  ReconciliationDashboardOutput,
  ReconciliationDashboardRun,
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
  title: 'Reconciliation',
  description: 'Review reconciliation evidence coverage, outputs, and replay health.',
};

export const dynamic = 'force-dynamic';

type PageSearchParams = Record<string, string | string[] | undefined>;

export default async function ReconciliationDashboardPage({
  searchParams,
}: {
  searchParams?: Promise<PageSearchParams>;
}) {
  const session = await auth();
  if (!session?.user) redirect('/sign-in');
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) redirect('/sign-in');
  const params = (await searchParams) ?? {};
  const notice = reconciliationNotice(params);

  const scope = withTeam(db, active.teamId, session.user.id);
  let dashboard: Awaited<ReturnType<typeof scope.reconciliation.getDashboardSnapshot>> | null =
    null;
  try {
    dashboard = await scope.reconciliation.getDashboardSnapshot();
  } catch {
    dashboard = null;
  }
  if (!dashboard) redirect('/app/team');

  const coverage = dashboard.evidenceCoverage;
  const diagnostics = dashboard.diagnostics;
  const outputAttention = countKeys(dashboard.outputs.byStatus, ['pending', 'failed']);
  const outboxAttention = countKeys(dashboard.projectionOutbox.byStatus, ['pending', 'failed']);
  const approvalRate = formatRate(diagnostics.approvalStats.acceptanceRate);

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <Breadcrumb items={[{ label: 'Team', href: '/app/team' }, { label: 'Reconciliation' }]} />
      <IndexStrip
        srLabel={`Reconciliation · ${String(coverage.missingRawEvents)} missing evidence rows · ${String(coverage.degradedReplayEvidence)} degraded replay rows`}
        segments={[
          { value: 'RECONCILIATION' },
          { label: 'team', value: active.teamName, signal: true },
          { label: 'missing', value: coverage.missingRawEvents },
          { label: 'degraded', value: coverage.degradedReplayEvidence },
        ]}
      />
      {notice ? <Notice tone={notice.tone} message={notice.message} /> : null}

      <section className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric label="raw scanned" value={coverage.totalRawEvents} />
          <Metric label="normalized" value={coverage.normalizedRawEvents} />
          <Metric
            label="outputs open"
            value={outputAttention}
            tone={outputAttention > 0 ? 'hot' : 'ok'}
          />
          <Metric
            label="conflicts open"
            value={diagnostics.openConflicts}
            tone={diagnostics.openConflicts > 0 ? 'hot' : 'ok'}
          />
          <Metric
            label="outbox open"
            value={outboxAttention}
            tone={outboxAttention > 0 ? 'hot' : 'ok'}
          />
          <Metric label="full replay" value={coverage.fullReplayEvidence} />
          <Metric
            label="degraded replay"
            value={coverage.degradedReplayEvidence}
            tone={coverage.degradedReplayEvidence > 0 ? 'warn' : 'ok'}
          />
          <Metric label="clusters" value={dashboard.clusters.total} />
          <Metric label="associations" value={dashboard.associations.total} />
          <Metric label="approval rate" value={approvalRate} />
        </div>

        <section className="space-y-3 rounded-sm border border-border bg-surface p-4">
          <div className="flex items-center gap-2">
            <DatabaseZap className="size-4 text-signal" />
            <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-fg-muted">
              Queue replay work
            </h2>
          </div>
          <form action={queueReconciliationJobFormAction} className="space-y-3">
            <label className="grid gap-1 text-xs font-medium uppercase tracking-[0.12em] text-fg-muted">
              Source
              <select
                name="source"
                className="h-10 rounded-sm border border-border bg-background px-3 text-sm normal-case tracking-normal text-fg"
                defaultValue=""
              >
                <option value="">All sources</option>
                {eventSource.enumValues.map((source) => (
                  <option key={source} value={source}>
                    {sourceLabel(source)}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid gap-2 sm:grid-cols-2">
              <Button type="submit" name="mode" value="audit" variant="outline">
                <ListRestart className="size-4" />
                Audit
              </Button>
              <Button type="submit" name="mode" value="backfill">
                <Play className="size-4" />
                Backfill dry run
              </Button>
            </div>
            <input type="hidden" name="dryRun" value="true" />
          </form>
          <p className="text-xs text-fg-dim">
            Updated {dashboard.generatedAt.toLocaleString()} · coverage limit{' '}
            {dashboard.coverageLimit.toLocaleString()}
          </p>
        </section>

        <section className="space-y-3 rounded-sm border border-border bg-surface p-4 lg:col-start-2">
          <div className="flex items-center gap-2">
            <ListRestart className="size-4 text-signal" />
            <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-fg-muted">
              Manual reconcile
            </h2>
          </div>
          <form action={queueReconciliationJobFormAction} className="space-y-3">
            <input type="hidden" name="mode" value="scope" />
            <label className="grid gap-1 text-xs font-medium uppercase tracking-[0.12em] text-fg-muted">
              Scope
              <select
                name="scope"
                className="h-10 rounded-sm border border-border bg-background px-3 text-sm normal-case tracking-normal text-fg"
                defaultValue="team"
              >
                <option value="team">Team</option>
                <option value="object">Object</option>
                <option value="cluster">Cluster</option>
              </select>
            </label>
            <label className="grid gap-1 text-xs font-medium uppercase tracking-[0.12em] text-fg-muted">
              Target id
              <input
                name="targetId"
                className="h-10 rounded-sm border border-border bg-background px-3 font-mono text-sm normal-case tracking-normal text-fg"
                placeholder="Object or cluster UUID"
              />
            </label>
            <Button type="submit" variant="outline">
              <Play className="size-4" />
              Reconcile
            </Button>
          </form>
        </section>
      </section>

      <section className="space-y-3">
        <SectionTitle label="Evidence coverage by source" />
        <div className="overflow-x-auto rounded-sm border border-border bg-surface">
          <table className="min-w-full divide-y divide-border text-sm">
            <thead className="bg-muted/30 text-left font-mono text-[11px] uppercase tracking-[0.12em] text-fg-dim">
              <tr>
                <th className="px-3 py-2">Source</th>
                <th className="px-3 py-2 text-right">Raw</th>
                <th className="px-3 py-2 text-right">Normalized</th>
                <th className="px-3 py-2 text-right">Missing</th>
                <th className="px-3 py-2 text-right">Full replay</th>
                <th className="px-3 py-2 text-right">Degraded</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {Object.entries(coverage.bySource).map(([source, row]) => (
                <tr key={source}>
                  <td className="px-3 py-2 font-medium">{sourceLabel(source)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{row.totalRawEvents}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{row.normalizedRawEvents}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{row.missingRawEvents}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{row.fullReplayEvidence}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {row.degradedReplayEvidence}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <RecentClusters rows={dashboard.clusters.recent} />
        <StatusPanel title="Cluster kinds" rows={dashboard.clusters.byKind} />
        <StatusPanel title="Run status" rows={dashboard.runs.byStatus} />
        <StatusPanel title="Output status" rows={dashboard.outputs.byStatus} />
        <StatusPanel title="Output kinds" rows={dashboard.outputs.byKind} />
        <StatusPanel title="Projection outbox" rows={dashboard.projectionOutbox.byStatus} />
        <StatusPanel title="Direct writes by source" rows={diagnostics.directWritesBySource} />
        <StatusPanel title="Ambiguity by source" rows={diagnostics.ambiguityBySource} />
        <StatusPanel title="Top no-action reasons" rows={diagnostics.topNoActionReasons} />
        <ApprovalPanel stats={diagnostics.approvalStats} />
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <RecentRuns rows={dashboard.runs.recent} />
        <RecentOutputs rows={dashboard.outputs.recent} />
      </section>
    </div>
  );
}

function Metric({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: number | string;
  tone?: 'neutral' | 'ok' | 'warn' | 'hot';
}) {
  const toneClass =
    tone === 'ok'
      ? 'text-emerald-700'
      : tone === 'warn'
        ? 'text-amber-700'
        : tone === 'hot'
          ? 'text-destructive'
          : 'text-fg';
  return (
    <div className="rounded-sm border border-border bg-surface px-4 py-3">
      <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-dim">{label}</div>
      <div className={`mt-2 text-2xl font-semibold tabular-nums ${toneClass}`}>{value}</div>
    </div>
  );
}

function Notice({ tone, message }: { tone: 'success' | 'error'; message: string }) {
  const toneClass =
    tone === 'success'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
      : 'border-destructive/30 bg-destructive/10 text-destructive';
  return (
    <div className={`rounded-sm border px-4 py-3 text-sm font-medium ${toneClass}`}>{message}</div>
  );
}

function ApprovalPanel({
  stats,
}: {
  stats: {
    accepted: number;
    rejected: number;
    open: number;
    totalDecided: number;
    acceptanceRate: number | null;
  };
}) {
  return (
    <section className="space-y-3 rounded-sm border border-border bg-surface p-4">
      <SectionTitle label="Approval health" />
      <div className="grid grid-cols-2 gap-2 text-sm">
        <MiniStat label="accepted" value={stats.accepted} />
        <MiniStat label="rejected" value={stats.rejected} />
        <MiniStat label="open" value={stats.open} />
        <MiniStat label="acceptance" value={formatRate(stats.acceptanceRate)} />
      </div>
      <p className="text-xs text-fg-dim">
        Decided approvals: <span className="tabular-nums">{stats.totalDecided}</span>
      </p>
    </section>
  );
}

function MiniStat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-sm border border-border bg-background px-3 py-2">
      <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-dim">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums text-fg">{value}</div>
    </div>
  );
}

function SectionTitle({ label }: { label: string }) {
  return (
    <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-fg-muted">{label}</h2>
  );
}

function StatusPanel({ title, rows }: { title: string; rows: { key: string; count: number }[] }) {
  return (
    <section className="space-y-3 rounded-sm border border-border bg-surface p-4">
      <SectionTitle label={title} />
      <div className="flex flex-wrap gap-2">
        {rows.length === 0 ? (
          <span className="text-sm text-fg-muted">No rows yet.</span>
        ) : (
          rows.map((row) => (
            <Badge key={row.key} variant="outline" className="gap-2 rounded-sm font-mono">
              <span>{row.key}</span>
              <span className="tabular-nums">{row.count}</span>
            </Badge>
          ))
        )}
      </div>
    </section>
  );
}

function RecentRuns({ rows }: { rows: ReconciliationDashboardRun[] }) {
  return (
    <section className="space-y-3">
      <SectionTitle label="Recent runs" />
      <ul className="divide-y divide-border rounded-sm border border-border bg-surface text-sm">
        {rows.length === 0 ? (
          <li className="px-3 py-2 text-fg-muted">No reconciliation runs yet.</li>
        ) : (
          rows.map((row) => (
            <li key={row.id} className="grid gap-2 p-3 sm:grid-cols-[1fr_auto]">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="rounded-sm">
                    {row.status}
                  </Badge>
                  <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-dim">
                    {row.trigger}
                  </span>
                </div>
                <div className="mt-1 truncate font-medium">{row.scope}</div>
                <div className="font-mono text-xs text-fg-dim">{row.engineVersion}</div>
              </div>
              <time className="text-xs text-fg-muted sm:text-right">
                {row.createdAt.toLocaleString()}
              </time>
            </li>
          ))
        )}
      </ul>
    </section>
  );
}

function RecentClusters({ rows }: { rows: ReconciliationDashboardCluster[] }) {
  return (
    <section className="space-y-3">
      <SectionTitle label="Recent clusters" />
      <ul className="divide-y divide-border rounded-sm border border-border bg-surface text-sm">
        {rows.length === 0 ? (
          <li className="px-3 py-2 text-fg-muted">No reconciliation clusters yet.</li>
        ) : (
          rows.map((row) => (
            <li key={row.id} className="p-3">
              <Link
                href={`/app/team/reconciliation/clusters/${row.id}`}
                className="grid gap-2 hover:text-signal sm:grid-cols-[1fr_auto]"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="rounded-sm">
                      {row.status}
                    </Badge>
                    <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-dim">
                      {row.artifactClusterKind}
                    </span>
                  </div>
                  <div className="mt-1 truncate font-medium">{row.canonicalName}</div>
                  <div className="font-mono text-xs text-fg-dim">{row.artifactType}</div>
                </div>
                <time className="text-xs text-fg-muted sm:text-right">
                  {row.updatedAt.toLocaleString()}
                </time>
              </Link>
            </li>
          ))
        )}
      </ul>
    </section>
  );
}

function RecentOutputs({ rows }: { rows: ReconciliationDashboardOutput[] }) {
  return (
    <section className="space-y-3">
      <SectionTitle label="Recent outputs" />
      <ul className="divide-y divide-border rounded-sm border border-border bg-surface text-sm">
        {rows.length === 0 ? (
          <li className="px-3 py-2 text-fg-muted">No reconciliation outputs yet.</li>
        ) : (
          rows.map((row) => (
            <li key={row.id} className="grid gap-2 p-3 sm:grid-cols-[1fr_auto]">
              <div className="min-w-0">
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
                <div className="mt-1 truncate font-medium">
                  {row.clusterId ? (
                    <Link
                      href={`/app/team/reconciliation/clusters/${row.clusterId}`}
                      className="hover:text-signal"
                    >
                      {row.targetKind} · {row.operation}
                    </Link>
                  ) : (
                    <>
                      {row.targetKind} · {row.operation}
                    </>
                  )}
                </div>
                <div className="font-mono text-xs text-fg-dim">{row.confidence}</div>
              </div>
              <time className="text-xs text-fg-muted sm:text-right">
                {row.createdAt.toLocaleString()}
              </time>
            </li>
          ))
        )}
      </ul>
    </section>
  );
}

function countKeys(rows: { key: string; count: number }[], keys: string[]): number {
  const set = new Set(keys);
  return rows.reduce((sum, row) => sum + (set.has(row.key) ? row.count : 0), 0);
}

function formatRate(rate: number | null): string {
  if (rate === null) return 'n/a';
  return `${Math.round(rate * 100)}%`;
}

function sourceLabel(source: string): string {
  return source
    .split('_')
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function reconciliationNotice(params: PageSearchParams): {
  tone: 'success' | 'error';
  message: string;
} | null {
  const kind = scalarParam(params.reconciliationNotice);
  if (kind !== 'queued' && kind !== 'error') return null;
  const rawMessage = scalarParam(params.message);
  const fallback =
    kind === 'queued' ? 'Queued reconciliation work.' : 'Could not queue reconciliation work.';
  const message = rawMessage && rawMessage.length <= 240 ? rawMessage : fallback;
  return { tone: kind === 'queued' ? 'success' : 'error', message };
}

function scalarParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

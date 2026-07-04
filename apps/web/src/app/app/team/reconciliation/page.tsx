import { eventSource } from '@timeline/db';
import { withTeam } from '@timeline/shared/team-scope';
import { CheckCircle2, DatabaseZap, ListRestart, Play, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import type {
  ReconciliationDashboardCluster,
  ReconciliationDashboardOutput,
  ReconciliationDashboardRun,
  ReconciliationDashboardRunHistory,
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
  const runHistoryInput = runHistoryInputFromParams(params);

  const scope = withTeam(db, active.teamId, session.user.id);
  let dashboard: Awaited<ReturnType<typeof scope.reconciliation.getDashboardSnapshot>> | null =
    null;
  try {
    dashboard = await scope.reconciliation.getDashboardSnapshot({ runHistory: runHistoryInput });
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

      <ReleaseGatePanel gate={coverage.releaseGate} />

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
        <RecentRuns
          rows={dashboard.runs.recent}
          history={dashboard.runs.history}
          statusOptions={dashboard.runs.byStatus.map((row) => row.key)}
          triggerOptions={dashboard.runs.byTrigger.map((row) => row.key)}
        />
        <RecentOutputs rows={dashboard.outputs.recent} />
      </section>
    </div>
  );
}

function ReleaseGatePanel({
  gate,
}: {
  gate: {
    passed: boolean;
    failureCount: number;
    failures: {
      source: string;
      code: string;
      rawEventCount: number;
      message: string;
    }[];
  };
}) {
  const Icon = gate.passed ? CheckCircle2 : TriangleAlert;
  return (
    <section
      className={`space-y-3 rounded-sm border p-4 ${
        gate.passed
          ? 'border-emerald-200 bg-emerald-50/70'
          : 'border-destructive/30 bg-destructive/10'
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Icon className={`size-4 ${gate.passed ? 'text-emerald-700' : 'text-destructive'}`} />
          <SectionTitle label="Release gate" />
        </div>
        <Badge variant={gate.passed ? 'outline' : 'destructive'} className="rounded-sm">
          {gate.passed
            ? 'passed'
            : `${gate.failureCount} failure${gate.failureCount === 1 ? '' : 's'}`}
        </Badge>
      </div>
      {gate.passed ? (
        <p className="text-sm text-emerald-900">
          Evidence coverage is release-ready for the scanned window.
        </p>
      ) : (
        <ul className="divide-y divide-border text-sm">
          {gate.failures.map((failure) => (
            <li
              key={`${failure.source}:${failure.code}`}
              className="grid gap-2 py-2 sm:grid-cols-[140px_1fr_auto]"
            >
              <span className="font-medium">{sourceLabel(failure.source)}</span>
              <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-dim">
                {failure.code}
              </span>
              <span className="tabular-nums text-fg-muted">
                {failure.rawEventCount.toLocaleString()} raw
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
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

function RecentRuns({
  rows,
  history,
  statusOptions,
  triggerOptions,
}: {
  rows: ReconciliationDashboardRun[];
  history: ReconciliationDashboardRunHistory;
  statusOptions: string[];
  triggerOptions: string[];
}) {
  const statusValues = uniqueOptions(statusOptions, history.status);
  const triggerValues = uniqueOptions(triggerOptions, history.trigger);
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <SectionTitle label="Run history" />
          <p className="mt-1 text-xs text-fg-dim">
            Showing page {history.page.toLocaleString()} of {history.totalPages.toLocaleString()} ·{' '}
            {history.total.toLocaleString()} run{history.total === 1 ? '' : 's'}
          </p>
        </div>
        <form method="get" className="flex flex-wrap items-end gap-2">
          <label className="grid gap-1 text-[11px] font-medium uppercase tracking-[0.12em] text-fg-muted">
            Status
            <select
              name="runStatus"
              defaultValue={history.status ?? ''}
              className="h-9 rounded-sm border border-border bg-background px-2 text-sm normal-case tracking-normal text-fg"
            >
              <option value="">All</option>
              {statusValues.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-[11px] font-medium uppercase tracking-[0.12em] text-fg-muted">
            Trigger
            <select
              name="runTrigger"
              defaultValue={history.trigger ?? ''}
              className="h-9 rounded-sm border border-border bg-background px-2 text-sm normal-case tracking-normal text-fg"
            >
              <option value="">All</option>
              {triggerValues.map((trigger) => (
                <option key={trigger} value={trigger}>
                  {trigger}
                </option>
              ))}
            </select>
          </label>
          <Button type="submit" variant="outline" size="sm">
            Filter
          </Button>
        </form>
      </div>
      <ul className="divide-y divide-border rounded-sm border border-border bg-surface text-sm">
        {rows.length === 0 ? (
          <li className="px-3 py-2 text-fg-muted">No reconciliation runs match these filters.</li>
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
                <RunMetricSummary metrics={row.metrics} />
                <div className="font-mono text-xs text-fg-dim">{row.engineVersion}</div>
              </div>
              <time className="text-xs text-fg-muted sm:text-right">
                {row.createdAt.toLocaleString()}
              </time>
            </li>
          ))
        )}
      </ul>
      <div className="flex flex-wrap items-center justify-between gap-2">
        {history.hasPreviousPage ? (
          <Button asChild variant="outline" size="sm">
            <Link href={runHistoryHref(history, history.page - 1)}>Previous</Link>
          </Button>
        ) : (
          <Button variant="outline" size="sm" disabled>
            Previous
          </Button>
        )}
        {history.hasNextPage ? (
          <Button asChild variant="outline" size="sm">
            <Link href={runHistoryHref(history, history.page + 1)}>Next</Link>
          </Button>
        ) : (
          <Button variant="outline" size="sm" disabled>
            Next
          </Button>
        )}
      </div>
    </section>
  );
}

function RunMetricSummary({ metrics }: { metrics: unknown }) {
  const record = jsonRecord(metrics);
  if (!record) return null;
  const mode = stringMetric(record.mode);
  if (mode === 'audit') {
    const passed = booleanMetric(record.release_gate_passed);
    const label = passed === false ? 'failed' : passed === true ? 'passed' : 'unknown';
    return (
      <div className="mt-2 flex flex-wrap gap-2">
        <Badge variant={passed === false ? 'destructive' : 'outline'} className="rounded-sm">
          release {label}
        </Badge>
        <RunMetricBadge label="missing" value={numberMetric(record.missing_raw_events)} />
        <RunMetricBadge
          label="gate failures"
          value={numberMetric(record.release_gate_failure_count)}
        />
      </div>
    );
  }
  if (mode === 'backfill') {
    return (
      <div className="mt-2 flex flex-wrap gap-2">
        <RunMetricBadge label="candidates" value={numberMetric(record.candidate_raw_events)} />
        <RunMetricBadge label="normalized" value={numberMetric(record.normalized_evidence)} />
      </div>
    );
  }
  if (mode === 'production_sampling') {
    const failedCount = numberMetric(record.failed_count);
    return (
      <div className="mt-2 flex flex-wrap gap-2">
        <RunMetricBadge label="samples" value={numberMetric(record.sample_count)} />
        <Badge
          variant={failedCount && failedCount > 0 ? 'destructive' : 'outline'}
          className="gap-1 rounded-sm font-mono"
        >
          <span>failed</span>
          <span className="tabular-nums">{(failedCount ?? 0).toLocaleString()}</span>
        </Badge>
        <RunMetricBadge
          label="unconfirmed fixtures"
          value={numberMetric(record.unconfirmed_fixture_candidate_count)}
        />
      </div>
    );
  }
  if (
    mode === 'manual_repair' ||
    record.evidence_backfilled !== undefined ||
    record.association_repair_count !== undefined ||
    record.projection_repair_count !== undefined
  ) {
    return (
      <div className="mt-2 flex flex-wrap gap-2">
        <RunMetricBadge label="evidence" value={numberMetric(record.evidence_backfilled)} />
        <RunMetricBadge
          label="associations"
          value={numberMetric(record.association_repair_count)}
        />
        <RunMetricBadge label="projections" value={numberMetric(record.projection_repair_count)} />
        <RunMetricBadge label="outputs" value={numberMetric(record.output_count)} />
      </div>
    );
  }
  return null;
}

function RunMetricBadge({ label, value }: { label: string; value: number | null }) {
  if (value === null) return null;
  return (
    <Badge variant="outline" className="gap-1 rounded-sm font-mono">
      <span>{label}</span>
      <span className="tabular-nums">{value.toLocaleString()}</span>
    </Badge>
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

function jsonRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function stringMetric(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function numberMetric(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function booleanMetric(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
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

function runHistoryInputFromParams(params: PageSearchParams) {
  return {
    status: scalarParam(params.runStatus) ?? undefined,
    trigger: scalarParam(params.runTrigger) ?? undefined,
    page: positiveIntParam(params.runPage),
  };
}

function positiveIntParam(value: string | string[] | undefined): number | undefined {
  const raw = scalarParam(value);
  if (!raw) return undefined;
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function uniqueOptions(values: string[], selected: string | null): string[] {
  return [...new Set([...(selected ? [selected] : []), ...values])];
}

function runHistoryHref(history: ReconciliationDashboardRunHistory, page: number): string {
  const params = new URLSearchParams();
  if (history.status) params.set('runStatus', history.status);
  if (history.trigger) params.set('runTrigger', history.trigger);
  if (page > 1) params.set('runPage', String(page));
  const query = params.toString();
  return query ? `/app/team/reconciliation?${query}` : '/app/team/reconciliation';
}

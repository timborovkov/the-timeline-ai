import { eventSource } from '@timeline/db';
import { withTeam } from '@timeline/shared/team-scope';
import {
  CheckCircle2,
  ChevronDown,
  DatabaseZap,
  FileCheck2,
  GitMerge,
  ListRestart,
  Play,
  ScanSearch,
  TriangleAlert,
} from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import type {
  ReconciliationDashboardCluster,
  ReconciliationDashboardOutput,
  ReconciliationDashboardRun,
  ReconciliationDashboardRunHistory,
} from '@timeline/shared/reconciliation';
import type { LucideIcon } from 'lucide-react';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { queueReconciliationJobFormAction } from '@/app/actions/reconciliation';
import { Breadcrumb } from '@/components/breadcrumb';
import { DebouncedFilterForm } from '@/components/debounced-filter-form';
import { PageHeader } from '@/components/page-header';
import { SectionHeading } from '@/components/section-heading';
import { TechnicalDetails } from '@/components/technical-details';
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

const manualFieldClass =
  'h-10 rounded-sm border border-border bg-surface px-3 text-sm font-normal text-fg';

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
  const legacyProvenanceRows = diagnostics.legacyProvenance.totalRows;
  const approvalRate = formatRate(diagnostics.approvalStats.acceptanceRate);

  return (
    <div className="space-y-10">
      <Breadcrumb items={[{ label: 'Team', href: '/app/team' }, { label: 'Reconciliation' }]} />
      <PageHeader
        title="Reconciliation"
        subtitle="Timeline connects activity from different sources, checks the evidence, and proposes trustworthy updates for review."
        metadata={[
          { label: 'team', value: active.teamName, signal: true },
          { label: 'checked', value: coverage.totalRawEvents },
          {
            label: 'needs repair',
            value: coverage.missingRawEvents + coverage.degradedReplayEvidence,
            danger: coverage.missingRawEvents + coverage.degradedReplayEvidence > 0,
          },
          {
            label: 'updated',
            value: (
              <span data-visual-dynamic="reconciliation-generated-at">
                {dashboard.generatedAt.toLocaleString()}
              </span>
            ),
            mono: true,
          },
        ]}
        srLabel={`Reconciliation for ${active.teamName}. ${String(coverage.totalRawEvents)} captured items checked; ${String(coverage.missingRawEvents + coverage.degradedReplayEvidence)} need repair.`}
      />
      {notice ? <Notice tone={notice.tone} message={notice.message} /> : null}

      <section aria-labelledby="how-reconciliation-works" className="space-y-4">
        <SectionHeading id="how-reconciliation-works">How it works</SectionHeading>
        <div className="grid overflow-hidden rounded-sm border border-border bg-surface md:grid-cols-3 md:divide-x md:divide-border">
          <ProcessStep
            icon={ScanSearch}
            number="01"
            title="Check the evidence"
            description="Captured activity is converted into consistent, citable evidence."
            metric={`${coverage.fullReplayEvidence.toLocaleString()} of ${coverage.totalRawEvents.toLocaleString()} ready`}
          />
          <ProcessStep
            icon={GitMerge}
            number="02"
            title="Connect related work"
            description="Evidence about the same task, incident, or project is grouped together."
            metric={`${dashboard.clusters.total.toLocaleString()} clusters · ${dashboard.associations.total.toLocaleString()} links`}
          />
          <ProcessStep
            icon={FileCheck2}
            number="03"
            title="Propose safe updates"
            description="Potential workspace changes are prepared for approval, with their sources attached."
            metric={`${outputAttention.toLocaleString()} awaiting attention`}
          />
        </div>
      </section>

      <section aria-labelledby="reconciliation-health" className="space-y-4">
        <SectionHeading id="reconciliation-health">Current health</SectionHeading>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
          <ReleaseGatePanel gate={coverage.releaseGate} />
          <ReplayPanel coverageLimit={dashboard.coverageLimit} />
        </div>
        <div className="grid divide-y divide-border rounded-sm border border-border bg-surface sm:grid-cols-2 sm:divide-x sm:divide-y-0 lg:grid-cols-4">
          <Metric label="Evidence ready" value={coverage.fullReplayEvidence} />
          <Metric
            label="Needs evidence"
            value={coverage.missingRawEvents}
            tone={coverage.missingRawEvents > 0 ? 'hot' : 'ok'}
          />
          <Metric
            label="Needs full replay"
            value={coverage.degradedReplayEvidence}
            tone={coverage.degradedReplayEvidence > 0 ? 'hot' : 'ok'}
          />
          <Metric
            label="Open conflicts"
            value={diagnostics.openConflicts}
            tone={diagnostics.openConflicts > 0 ? 'hot' : 'ok'}
          />
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <SectionHeading>Evidence by source</SectionHeading>
          <p className="mt-1 max-w-2xl text-sm text-fg-muted">
            This shows where captured activity is ready to support a proposed update—and where
            Timeline still needs to rebuild evidence.
          </p>
        </div>
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

      <section className="space-y-4">
        <SectionHeading>Recently reconciled</SectionHeading>
        <div className="grid gap-6 xl:grid-cols-2">
          <RecentClusters rows={dashboard.clusters.recent} />
          <RecentOutputs rows={dashboard.outputs.recent} />
        </div>
      </section>

      <details className="group rounded-sm border border-border bg-surface">
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-surface-2 [&::-webkit-details-marker]:hidden">
          <div>
            <div className="font-semibold text-fg">Advanced tools and diagnostics</div>
            <div className="mt-0.5 text-sm text-fg-muted">
              Manual repair, system counters, and run history for operators.
            </div>
          </div>
          <ChevronDown className="size-4 shrink-0 text-fg-dim transition-transform group-open:rotate-180" />
        </summary>
        <div className="space-y-8 border-t border-border p-4 sm:p-6">
          <ManualReconcilePanel />
          <section className="grid gap-4 xl:grid-cols-2">
            <StatusPanel title="Cluster kinds" rows={dashboard.clusters.byKind} />
            <StatusPanel title="Run status" rows={dashboard.runs.byStatus} />
            <StatusPanel title="Output status" rows={dashboard.outputs.byStatus} />
            <StatusPanel title="Output kinds" rows={dashboard.outputs.byKind} />
            <StatusPanel title="Projection outbox" rows={dashboard.projectionOutbox.byStatus} />
            <StatusPanel title="Direct writes by source" rows={diagnostics.directWritesBySource} />
            <StatusPanel
              title="Legacy provenance"
              rows={[
                {
                  key: 'object source_event_id',
                  count: diagnostics.legacyProvenance.objectSourceEventRows,
                },
                {
                  key: 'object agent_suggested',
                  count: diagnostics.legacyProvenance.objectAgentSuggestedRows,
                },
                {
                  key: 'object_change source_event_id',
                  count: diagnostics.legacyProvenance.objectChangeSourceEventRows,
                },
                {
                  key: 'board_history source_event_id',
                  count: diagnostics.legacyProvenance.boardHistorySourceEventRows,
                },
              ]}
            />
            <StatusPanel title="Ambiguity by source" rows={diagnostics.ambiguityBySource} />
            <StatusPanel title="Top no-action reasons" rows={diagnostics.topNoActionReasons} />
            <ApprovalPanel stats={diagnostics.approvalStats} />
            <div className="grid divide-y divide-border rounded-sm border border-border bg-background sm:grid-cols-3 sm:divide-x sm:divide-y-0 xl:col-span-2">
              <Metric label="Open projections" value={outboxAttention} />
              <Metric label="Legacy provenance" value={legacyProvenanceRows} />
              <Metric label="Approval rate" value={approvalRate} />
            </div>
          </section>
          <RecentRuns
            rows={dashboard.runs.recent}
            history={dashboard.runs.history}
            statusOptions={dashboard.runs.byStatus.map((row) => row.key)}
            triggerOptions={dashboard.runs.byTrigger.map((row) => row.key)}
          />
        </div>
      </details>
    </div>
  );
}

function ProcessStep({
  icon: Icon,
  number,
  title,
  description,
  metric,
}: {
  icon: LucideIcon;
  number: string;
  title: string;
  description: string;
  metric: string;
}) {
  return (
    <article className="relative min-h-48 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex size-9 items-center justify-center rounded-sm bg-surface-2 text-fg">
          <Icon className="size-4" />
        </div>
        <span className="font-mono text-xs tabular-nums text-fg-dim">{number}</span>
      </div>
      <h3 className="mt-5 text-base font-semibold tracking-tight text-fg">{title}</h3>
      <p className="mt-1 text-sm leading-relaxed text-fg-muted">{description}</p>
      <div className="mt-4 font-mono text-xs uppercase tracking-[0.1em] text-signal">{metric}</div>
    </article>
  );
}

function ReplayPanel({ coverageLimit }: { coverageLimit: number }) {
  return (
    <section className="space-y-4 rounded-sm border border-border bg-surface p-4">
      <div>
        <div className="flex items-center gap-2">
          <DatabaseZap className="size-4 text-signal" />
          <h3 className="font-semibold text-fg">Check or repair evidence</h3>
        </div>
        <p className="mt-1 text-sm text-fg-muted">
          Check first, then preview a safe repair without changing workspace data.
        </p>
      </div>
      <form action={queueReconciliationJobFormAction} className="space-y-3">
        <label className="grid gap-1.5 text-sm font-medium text-fg">
          Source
          <select
            name="source"
            className="h-10 rounded-sm border border-border bg-background px-3 text-sm text-fg"
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
            Check coverage
          </Button>
          <Button type="submit" name="mode" value="backfill">
            <Play className="size-4" />
            Preview repair
          </Button>
        </div>
        <input type="hidden" name="dryRun" value="true" />
      </form>
      <p className="font-mono text-[11px] uppercase tracking-[0.1em] text-fg-dim">
        Scanned window · {coverageLimit.toLocaleString()} items max
      </p>
    </section>
  );
}

function ManualReconcilePanel() {
  return (
    <section className="space-y-4">
      <div>
        <SectionTitle label="Manual reconcile" />
        <p className="mt-1 text-sm text-fg-muted">
          Rerun reconciliation for the team or a specific object or cluster. This can enqueue
          planner work.
        </p>
      </div>
      <form
        action={queueReconciliationJobFormAction}
        className="grid gap-4 rounded-sm border border-border bg-background p-4 md:grid-cols-2 xl:grid-cols-3"
      >
        <input type="hidden" name="mode" value="scope" />
        <FormField label="Scope">
          <select aria-label="Scope" name="scope" className={manualFieldClass} defaultValue="team">
            <option value="team">Team</option>
            <option value="object">Object</option>
            <option value="cluster">Cluster</option>
          </select>
        </FormField>
        <FormField label="Target id">
          <input
            name="targetId"
            aria-label="Target id"
            className={`${manualFieldClass} font-mono`}
            placeholder="Object or cluster UUID"
          />
        </FormField>
        <FormField label="Planner replay cap">
          <input
            name="plannerReplayLimit"
            aria-label="Planner replay cap"
            type="number"
            min="0"
            max="1000"
            defaultValue="100"
            className={`${manualFieldClass} font-mono`}
          />
        </FormField>
        <FormField label="Planner replay mode">
          <select
            aria-label="Planner replay mode"
            name="plannerReplayMode"
            defaultValue="missing"
            className={manualFieldClass}
          >
            <option value="missing">Missing only</option>
            <option value="all">All visible</option>
          </select>
        </FormField>
        <FormField label="Planner replay source">
          <select
            aria-label="Planner replay source"
            name="plannerReplaySource"
            className={manualFieldClass}
            defaultValue=""
          >
            <option value="">All sources</option>
            {eventSource.enumValues.map((source) => (
              <option key={source} value={source}>
                {sourceLabel(source)}
              </option>
            ))}
          </select>
        </FormField>
        <div className="hidden xl:block" />
        <FormField label="Planner replay from">
          <input
            name="plannerReplayOccurredAfter"
            aria-label="Planner replay from"
            type="datetime-local"
            className={`${manualFieldClass} font-mono`}
          />
        </FormField>
        <FormField label="Planner replay until">
          <input
            name="plannerReplayOccurredBefore"
            aria-label="Planner replay until"
            type="datetime-local"
            className={`${manualFieldClass} font-mono`}
          />
        </FormField>
        <div className="flex items-end">
          <Button type="submit" variant="outline">
            <Play className="size-4" />
            Reconcile
          </Button>
        </div>
      </form>
    </section>
  );
}

function FormField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1.5 text-sm font-medium text-fg">
      {label}
      {children}
    </label>
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
      className={`space-y-4 rounded-sm border p-5 ${gate.passed ? 'border-border bg-surface' : 'border-destructive/40 bg-destructive/10'}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Icon className={`size-4 ${gate.passed ? 'text-signal' : 'text-destructive'}`} />
          <h3 className="font-semibold text-fg">
            {gate.passed ? 'Evidence is ready' : 'Some evidence needs repair'}
          </h3>
        </div>
        <Badge variant={gate.passed ? 'outline' : 'destructive'} className="rounded-sm">
          {gate.passed
            ? 'Release gate passed'
            : `Release gate · ${gate.failureCount} failure${gate.failureCount === 1 ? '' : 's'}`}
        </Badge>
      </div>
      {gate.passed ? (
        <p className="text-sm text-fg-muted">
          Every captured item in the scanned window has the evidence needed for reconciliation.
        </p>
      ) : (
        <div>
          <p className="text-sm text-fg-muted">
            These items cannot yet support complete, source-backed updates. Check coverage, then
            preview a repair.
          </p>
          <ul className="mt-3 divide-y divide-destructive/20 text-sm">
            {gate.failures.map((failure) => (
              <li
                key={`${failure.source}:${failure.code}`}
                className="grid gap-1 py-3 sm:grid-cols-[140px_1fr_auto] sm:gap-3"
              >
                <span className="font-medium">{sourceLabel(failure.source)}</span>
                <span className="text-fg-muted">
                  {failure.message}
                  <span className="ml-2 font-mono text-[11px] uppercase tracking-[0.1em] text-fg-dim">
                    {failure.code}
                  </span>
                </span>
                <span className="tabular-nums text-fg-muted">
                  {failure.rawEventCount.toLocaleString()} raw
                </span>
              </li>
            ))}
          </ul>
        </div>
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
      ? 'text-signal'
      : tone === 'warn'
        ? 'text-destructive'
        : tone === 'hot'
          ? 'text-destructive'
          : 'text-fg';
  return (
    <div className="px-4 py-4">
      <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-dim">{label}</div>
      <div className={`mt-2 text-2xl font-semibold tabular-nums ${toneClass}`}>{value}</div>
    </div>
  );
}

function Notice({ tone, message }: { tone: 'success' | 'error'; message: string }) {
  const toneClass =
    tone === 'success'
      ? 'border-signal/30 bg-signal-soft text-fg'
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

function SectionTitle({ label, level = 2 }: { label: string; level?: 2 | 3 }) {
  const Heading = level === 3 ? 'h3' : 'h2';
  return (
    <Heading className="text-sm font-semibold uppercase tracking-[0.12em] text-fg-muted">
      {label}
    </Heading>
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
        <DebouncedFilterForm
          basePath="/app/team/reconciliation"
          className="flex flex-wrap items-end gap-2"
        >
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
        </DebouncedFilterForm>
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
    const promotion = jsonRecord(record.evidence_pack_promotion);
    const promotionReady = booleanMetric(promotion?.ready);
    const promotionBlockers = Array.isArray(promotion?.blockerCodes)
      ? promotion.blockerCodes.filter((value): value is string => typeof value === 'string')
      : [];
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
        {promotionReady !== null ? (
          <Badge
            variant={promotionReady ? 'outline' : 'destructive'}
            className="rounded-sm"
            title={promotionBlockers.join(', ') || undefined}
          >
            promotion {promotionReady ? 'ready' : 'blocked'}
          </Badge>
        ) : null}
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
    record.output_repair_count !== undefined ||
    record.projection_repair_count !== undefined ||
    record.planner_replay_enqueued !== undefined
  ) {
    return (
      <div className="mt-2 flex flex-wrap gap-2">
        <RunMetricBadge label="evidence" value={numberMetric(record.evidence_backfilled)} />
        <RunMetricBadge
          label="associations"
          value={numberMetric(record.association_repair_count)}
        />
        <RunMetricBadge label="output repairs" value={numberMetric(record.output_repair_count)} />
        <RunMetricBadge label="projections" value={numberMetric(record.projection_repair_count)} />
        <RunMetricBadge
          label="planner replay"
          value={numberMetric(record.planner_replay_enqueued)}
        />
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
      <SectionTitle label="Recent clusters" level={3} />
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
                      {clusterStatusLabel(row.status)}
                    </Badge>
                    <span className="text-xs text-fg-muted">
                      {artifactClusterKindLabel(row.artifactClusterKind)}
                    </span>
                  </div>
                  <div className="mt-1 truncate font-medium">{row.canonicalName}</div>
                  <div className="text-xs text-fg-dim">{artifactTypeLabel(row.artifactType)}</div>
                </div>
                <time className="text-xs text-fg-muted sm:text-right">
                  {row.updatedAt.toLocaleString()}
                </time>
              </Link>
              <TechnicalDetails
                className="mt-3"
                items={[
                  { label: 'Cluster ID', value: row.id, copyValue: row.id },
                  { label: 'Cluster kind', value: row.artifactClusterKind },
                  { label: 'Artifact type', value: row.artifactType },
                  { label: 'Status', value: row.status },
                ]}
              />
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
      <SectionTitle label="Recent outputs" level={3} />
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
                    {outputStatusLabel(row.status)}
                  </Badge>
                  {row.requiresApproval ? (
                    <Badge className="rounded-sm">Needs approval</Badge>
                  ) : null}
                  <span className="text-xs text-fg-muted">{outputKindLabel(row.outputKind)}</span>
                </div>
                <div className="mt-1 truncate font-medium">
                  {row.clusterId ? (
                    <Link
                      href={`/app/team/reconciliation/clusters/${row.clusterId}`}
                      className="hover:text-signal"
                    >
                      {outputActionLabel(row)}
                    </Link>
                  ) : (
                    outputActionLabel(row)
                  )}
                </div>
                <div className="text-xs text-fg-dim">{confidenceLabel(row.confidence)}</div>
              </div>
              <time className="text-xs text-fg-muted sm:text-right">
                {row.createdAt.toLocaleString()}
              </time>
              <TechnicalDetails
                className="sm:col-span-2"
                items={[
                  { label: 'Output ID', value: row.id, copyValue: row.id },
                  ...(row.clusterId
                    ? [{ label: 'Cluster ID', value: row.clusterId, copyValue: row.clusterId }]
                    : []),
                  { label: 'Output kind', value: row.outputKind },
                  { label: 'Target kind', value: row.targetKind },
                  { label: 'Operation', value: row.operation },
                  { label: 'Confidence', value: row.confidence },
                  { label: 'Status', value: row.status },
                ]}
              />
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

const ARTIFACT_CLUSTER_KIND_LABELS: Record<string, string> = {
  customer_project: 'Customer project',
  account: 'Account',
  incident: 'Incident',
  deal: 'Deal',
  document: 'Document',
  decision: 'Decision',
  task: 'Task',
  meeting: 'Meeting',
  calendar_event: 'Calendar event',
  provider_record: 'Connected record',
  topic: 'Topic',
  person_context: 'Person context',
  relationship_bundle: 'Relationship',
  system_workflow: 'System workflow',
  other: 'Other work',
};

const ARTIFACT_TYPE_LABELS: Record<string, string> = {
  person: 'Person',
  company: 'Company',
  project: 'Project',
  topic: 'Topic',
  other: 'Other item',
  deal: 'Deal',
  vendor: 'Vendor',
  incident: 'Incident',
  document: 'Document',
  decision: 'Decision',
  hiring_loop: 'Hiring loop',
  task: 'Task',
  follow_up: 'Follow-up',
  link: 'Link',
  monday_board: 'Monday board',
  sentry_project: 'Sentry project',
};

const OUTPUT_KIND_LABELS: Record<string, string> = {
  direct_write: 'Provider update',
  approval_bundle: 'Approval request',
  observed_association: 'Related evidence',
  no_action: 'No change',
  conflict: 'Conflicting evidence',
  eval_observation: 'Evaluation observation',
  agent_suggestion_projection: 'Suggestion projection',
};

const TARGET_KIND_LABELS: Record<string, string> = {
  object: 'Workspace memory',
  task: 'Task',
  calendar_event: 'Calendar event',
  identity_facet: 'Identity detail',
  object_note: 'Workspace note',
  object_relationship: 'Relationship',
  object_merge: 'Duplicate records',
  board_membership: 'Board membership',
  board_item_update: 'Board item',
  cluster_identity: 'Work identity',
  cluster_lifecycle: 'Work status',
};

const OPERATION_LABELS: Record<string, string> = {
  create: 'Create',
  update: 'Update',
  archive_or_cancel: 'Archive or cancel',
  merge: 'Merge',
  link: 'Link',
  unlink: 'Remove link',
  supersede: 'Supersede',
  noop: 'No change',
};

const CONFIDENCE_LABELS: Record<string, string> = {
  high: 'High confidence',
  medium: 'Medium confidence',
  low: 'Low confidence',
};

const CLUSTER_STATUS_LABELS: Record<string, string> = {
  open: 'Open',
  active: 'Active',
  blocked: 'Blocked',
  resolved: 'Resolved',
  cancelled: 'Cancelled',
  archived: 'Archived',
};

const OUTPUT_STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  applied: 'Applied',
  approval_created: 'Approval created',
  rejected: 'Rejected',
  superseded: 'Superseded',
  failed: 'Failed',
};

function artifactClusterKindLabel(value: string): string {
  return ARTIFACT_CLUSTER_KIND_LABELS[value] ?? humanizeToken(value);
}

function artifactTypeLabel(value: string): string {
  return ARTIFACT_TYPE_LABELS[value] ?? humanizeToken(value);
}

function outputKindLabel(value: string): string {
  return OUTPUT_KIND_LABELS[value] ?? humanizeToken(value);
}

function outputActionLabel({
  operation,
  targetKind,
}: Pick<ReconciliationDashboardOutput, 'operation' | 'targetKind'>): string {
  return `${OPERATION_LABELS[operation] ?? humanizeToken(operation)} ${TARGET_KIND_LABELS[targetKind] ?? humanizeToken(targetKind)}`;
}

function confidenceLabel(value: string): string {
  return CONFIDENCE_LABELS[value] ?? `${humanizeToken(value)} confidence`;
}

function clusterStatusLabel(value: string): string {
  return CLUSTER_STATUS_LABELS[value] ?? humanizeToken(value);
}

function outputStatusLabel(value: string): string {
  return OUTPUT_STATUS_LABELS[value] ?? humanizeToken(value);
}

function humanizeToken(value: string): string {
  const words = value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim();
  return words ? `${words.charAt(0).toUpperCase()}${words.slice(1)}` : value;
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

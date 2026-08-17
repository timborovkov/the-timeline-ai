import { eventSource } from '@timeline/db';
import { withTeam } from '@timeline/shared/team-scope';
import { ChevronDown, ListRestart, Play } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import type {
  ReconciliationDashboardCluster,
  ReconciliationDashboardOutput,
  ReconciliationDashboardRun,
  ReconciliationDashboardRunHistory,
} from '@timeline/shared/reconciliation';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { queueReconciliationJobFormAction } from '@/app/actions/reconciliation';
import { CollectionRow } from '@/components/collections/collection-row';
import { CollectionStatus } from '@/components/collections/collection-status';
import { DebouncedFilterForm } from '@/components/debounced-filter-form';
import { ReconciliationForbiddenView } from '@/components/reconciliation/forbidden-view';
import { HintedSubmitButton } from '@/components/reconciliation/hinted-submit-button';
import { ReconciliationPageHeader } from '@/components/reconciliation/page-header';
import {
  artifactClusterKindLabel,
  artifactTypeLabel,
  clusterStatusLabel,
  confidenceLabel,
  outputActionLabel,
  outputKindLabel,
  outputStatusLabel,
} from '@/components/reconciliation/presentation';
import { repairFailureCopy } from '@/components/reconciliation/repair-copy';
import {
  reconciliationClusterRowHint,
  reconciliationOutputRowHint,
} from '@/components/reconciliation/row-hint';
import { reconciliationOutputTone } from '@/components/reconciliation/row-status';
import { ReconciliationRowTime } from '@/components/reconciliation/row-time';
import { SectionHeading } from '@/components/section-heading';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { formatDisplayDateTime } from '@/lib/display-dates';

export const metadata: Metadata = {
  title: 'Reconciliation',
  description: 'Groups related captures into the same work, then proposes updates for review.',
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
  try {
    await scope.requireMembership('admin');
  } catch {
    return <ReconciliationForbiddenView teamName={active.teamName} />;
  }

  let dashboard: Awaited<ReturnType<typeof scope.reconciliation.getDashboardSnapshot>> | null =
    null;
  try {
    dashboard = await scope.reconciliation.getDashboardSnapshot({ runHistory: runHistoryInput });
  } catch {
    dashboard = null;
  }
  if (!dashboard) redirect('/app/team');
  const calendarSettings = await scope.calendar.getCalendarSettings();
  const timezone = calendarSettings.defaultTimezone;

  const coverage = dashboard.evidenceCoverage;
  const diagnostics = dashboard.diagnostics;
  const outboxAttention = countKeys(dashboard.projectionOutbox.byStatus, ['pending', 'failed']);
  const legacyProvenanceRows = diagnostics.legacyProvenance.totalRows;
  const approvalRate = formatRate(diagnostics.approvalStats.acceptanceRate);

  return (
    <div className="space-y-8">
      <ReconciliationPageHeader
        teamName={active.teamName}
        metadata={[
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
                {formatDisplayDateTime(dashboard.generatedAt, { timezone })}
              </span>
            ),
            mono: true,
          },
          ...(diagnostics.openConflicts > 0
            ? ([
                {
                  label: 'conflicts',
                  value: diagnostics.openConflicts,
                  danger: true,
                },
              ] as const)
            : []),
        ]}
        srLabel={`Reconciliation for ${active.teamName}. Admins only. ${String(coverage.totalRawEvents)} captured items checked; ${String(coverage.missingRawEvents + coverage.degradedReplayEvidence)} need repair. Times in ${timezone}.`}
      />
      {notice ? <Notice tone={notice.tone} message={notice.message} /> : null}

      <CoverageSection
        failures={coverage.releaseGate.failures}
        coverageLimit={dashboard.coverageLimit}
      />

      <section className="space-y-4">
        <SectionHeading>Recently reconciled</SectionHeading>
        <div className="grid gap-6 xl:grid-cols-2">
          <RecentClusters rows={dashboard.clusters.recent} timeZone={timezone} />
          <RecentOutputs rows={dashboard.outputs.recent} timeZone={timezone} />
        </div>
      </section>

      <details className="group rounded-sm border border-border bg-surface">
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-surface-2 [&::-webkit-details-marker]:hidden">
          <div>
            <div className="font-semibold text-fg">Advanced tools</div>
            <div className="mt-0.5 text-sm text-fg-muted">
              Manual repair, system counters, and run history for operators.
            </div>
          </div>
          <ChevronDown className="size-4 shrink-0 text-fg-dim transition-transform group-open:rotate-180" />
        </summary>
        <div className="space-y-8 border-t border-border p-4 sm:p-6">
          <ManualReconcilePanel />
          <EvidenceBySource coverage={coverage} />
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

function CoverageSection({
  coverageLimit,
  failures,
}: {
  coverageLimit: number;
  failures: {
    source: string;
    code: string;
    rawEventCount: number;
    message: string;
  }[];
}) {
  return (
    <div className="border-y border-border">
      <RepairAttention failures={failures} />
      <CoverageToolbar coverageLimit={coverageLimit} hasRepairRows={failures.length > 0} />
    </div>
  );
}

function RepairAttention({
  failures,
}: {
  failures: {
    source: string;
    code: string;
    rawEventCount: number;
    message: string;
  }[];
}) {
  if (failures.length === 0) return null;
  return (
    <div aria-label="Evidence that needs repair">
      {failures.map((failure) => {
        const copy = repairFailureCopy({
          code: failure.code,
          message: failure.message,
          rawEventCount: failure.rawEventCount,
        });
        return (
          <CollectionRow
            key={`${failure.source}:${failure.code}`}
            leading={<CollectionStatus value="failed" label={copy.status} tone="danger" />}
            title={copy.detail}
            titleHint={copy.hint}
            context={sourceLabel(failure.source)}
            contextTitle={copy.hint}
          />
        );
      })}
    </div>
  );
}

function CoverageToolbar({
  coverageLimit,
  hasRepairRows,
}: {
  coverageLimit: number;
  hasRepairRows: boolean;
}) {
  const windowHint = `Looks at up to ${coverageLimit.toLocaleString()} recent captures.`;
  return (
    <form
      action={queueReconciliationJobFormAction}
      className={`flex flex-col gap-2 px-2 py-2 sm:px-3 md:flex-row md:items-center md:justify-end${hasRepairRows ? ' border-t border-border' : ''}`}
    >
      <p className="text-xs text-fg-muted md:mr-auto">{windowHint}</p>
      <label className="sr-only" htmlFor="reconciliation-source">
        Source
      </label>
      <select
        id="reconciliation-source"
        name="source"
        aria-label="Source"
        title="Limit the check to one capture source."
        className="h-8 rounded-sm border border-border bg-background px-2 text-sm text-fg"
        defaultValue=""
      >
        <option value="">All sources</option>
        {eventSource.enumValues.map((source) => (
          <option key={source} value={source}>
            {sourceLabel(source)}
          </option>
        ))}
      </select>
      <div className="flex flex-wrap gap-2">
        <HintedSubmitButton
          name="mode"
          value="audit"
          variant="outline"
          size="sm"
          hint="Count captures that still need evidence. Nothing is changed."
        >
          <ListRestart className="size-4" />
          Check coverage
        </HintedSubmitButton>
        <HintedSubmitButton
          name="mode"
          value="backfill"
          size="sm"
          hint="Queue a dry-run that rebuilds missing evidence. Workspace data does not change."
        >
          <Play className="size-4" />
          Preview repair
        </HintedSubmitButton>
      </div>
      <input type="hidden" name="dryRun" value="true" />
    </form>
  );
}

function EvidenceBySource({
  coverage,
}: {
  coverage: {
    bySource: Record<
      string,
      {
        totalRawEvents: number;
        normalizedRawEvents: number;
        missingRawEvents: number;
        fullReplayEvidence: number;
        degradedReplayEvidence: number;
      }
    >;
  };
}) {
  return (
    <section className="space-y-3">
      <div>
        <SectionTitle label="Evidence by source" />
        <p className="mt-1 text-sm text-fg-muted">
          Where captured activity already has evidence, and where a rebuild is still needed.
        </p>
      </div>
      <div className="overflow-x-auto rounded-sm border border-border bg-background">
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
                <td className="px-3 py-2 text-right tabular-nums">{row.degradedReplayEvidence}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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

function RecentClusters({
  rows,
  timeZone,
}: {
  rows: ReconciliationDashboardCluster[];
  timeZone: string;
}) {
  return (
    <section className="space-y-3">
      <SectionTitle label="Recent clusters" level={3} />
      {rows.length === 0 ? (
        <p className="px-1 py-4 text-sm text-fg-muted">No reconciliation clusters yet.</p>
      ) : (
        <ul className="border-y border-border">
          {rows.map((row) => {
            const hint = reconciliationClusterRowHint({
              artifactClusterKind: row.artifactClusterKind,
              artifactType: row.artifactType,
              clusterId: row.id,
              status: row.status,
              timeZone,
              updatedAt: row.updatedAt,
            });
            return (
              <li key={row.id}>
                <CollectionRow
                  leading={
                    <CollectionStatus value={row.status} label={clusterStatusLabel(row.status)} />
                  }
                  title={
                    <Link
                      href={`/app/team/reconciliation/clusters/${row.id}`}
                      className="block truncate hover:underline"
                    >
                      {row.canonicalName}
                    </Link>
                  }
                  titleHint={hint}
                  context={`${artifactClusterKindLabel(row.artifactClusterKind)} · ${artifactTypeLabel(row.artifactType)}`}
                  contextTitle={hint}
                  metadata={<ReconciliationRowTime value={row.updatedAt} hint={hint} />}
                />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function RecentOutputs({
  rows,
  timeZone,
}: {
  rows: ReconciliationDashboardOutput[];
  timeZone: string;
}) {
  return (
    <section className="space-y-3">
      <SectionTitle label="Recent outputs" level={3} />
      {rows.length === 0 ? (
        <p className="px-1 py-4 text-sm text-fg-muted">No reconciliation outputs yet.</p>
      ) : (
        <ul className="border-y border-border">
          {rows.map((row) => {
            const hint = reconciliationOutputRowHint({
              clusterId: row.clusterId,
              confidence: row.confidence,
              createdAt: row.createdAt,
              outputId: row.id,
              outputKind: row.outputKind,
              status: row.status,
              targetKind: row.targetKind,
              timeZone,
            });
            const action = outputActionLabel(row);
            const contextParts = [
              outputKindLabel(row.outputKind),
              confidenceLabel(row.confidence),
              row.requiresApproval ? 'Needs approval' : null,
            ].filter((part): part is string => Boolean(part));
            return (
              <li key={row.id}>
                <CollectionRow
                  leading={
                    <CollectionStatus
                      value={row.status}
                      label={outputStatusLabel(row.status)}
                      tone={reconciliationOutputTone(row.status)}
                    />
                  }
                  title={
                    row.clusterId ? (
                      <Link
                        href={`/app/team/reconciliation/clusters/${row.clusterId}`}
                        className="block truncate hover:underline"
                      >
                        {action}
                      </Link>
                    ) : (
                      action
                    )
                  }
                  titleHint={hint}
                  context={contextParts.join(' · ')}
                  contextTitle={hint}
                  metadata={<ReconciliationRowTime value={row.createdAt} hint={hint} />}
                />
              </li>
            );
          })}
        </ul>
      )}
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

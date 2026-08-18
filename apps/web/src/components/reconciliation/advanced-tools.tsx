import { eventSource } from '@timeline/db';
import { Play } from 'lucide-react';
import Link from 'next/link';

import type {
  ReconciliationDashboardCount,
  ReconciliationDashboardRun,
  ReconciliationDashboardRunHistory,
  ReconciliationDashboardSnapshot,
} from '@timeline/shared/reconciliation';
import type { ReactNode } from 'react';

import { queueReconciliationJobFormAction } from '@/app/actions/reconciliation';
import { CollectionRow } from '@/components/collections/collection-row';
import { CollectionStatus } from '@/components/collections/collection-status';
import { CountList } from '@/components/collections/count-list';
import { DebouncedFilterForm } from '@/components/debounced-filter-form';
import {
  artifactClusterKindLabel,
  diagnosticLabel,
  eventSourceLabel,
  legacyProvenanceLabel,
  outputKindLabel,
  outputStatusLabel,
  runStatusLabel,
  runTriggerLabel,
} from '@/components/reconciliation/presentation';
import { runMetricHint } from '@/components/reconciliation/run-metric-hint';
import { SectionHeading } from '@/components/section-heading';
import { Button } from '@/components/ui/button';

const MANUAL_FIELD_CLASS =
  'h-10 rounded-sm border border-border bg-surface px-3 text-sm font-normal text-fg';

export function ReconciliationAdvancedTools({
  dashboard,
}: {
  dashboard: ReconciliationDashboardSnapshot;
}) {
  const coverage = dashboard.evidenceCoverage;
  const diagnostics = dashboard.diagnostics;
  return (
    <details className="group border-t border-border pt-3 text-sm">
      <summary className="cursor-pointer list-none text-sm font-medium text-fg-muted marker:hidden hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
        <span aria-hidden="true" className="mr-2 inline-block text-fg-dim group-open:rotate-90">
          ›
        </span>
        Advanced tools
      </summary>
      <div className="mt-3 space-y-8">
        <p className="text-xs text-fg-muted">Manual repair, coverage by source, and run history.</p>
        <ManualReconcilePanel />
        <EvidenceBySource coverage={coverage} />
        <div className="grid gap-8 xl:grid-cols-2">
          <CountSection
            title="Cluster kinds"
            rows={dashboard.clusters.byKind}
            labelFor={artifactClusterKindLabel}
          />
          <CountSection
            title="Run status"
            rows={dashboard.runs.byStatus}
            labelFor={runStatusLabel}
          />
          <CountSection
            title="Output status"
            rows={dashboard.outputs.byStatus}
            labelFor={outputStatusLabel}
          />
          <CountSection
            title="Output kinds"
            rows={dashboard.outputs.byKind}
            labelFor={outputKindLabel}
          />
          <CountSection
            title="Projection outbox"
            rows={dashboard.projectionOutbox.byStatus}
            labelFor={diagnosticLabel}
          />
          <CountSection
            title="Direct writes by source"
            rows={diagnostics.directWritesBySource}
            labelFor={eventSourceLabel}
          />
          <CountSection
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
            labelFor={legacyProvenanceLabel}
          />
          <CountSection
            title="Ambiguity by source"
            rows={diagnostics.ambiguityBySource}
            labelFor={eventSourceLabel}
          />
          <CountSection
            title="Top no-action reasons"
            rows={diagnostics.topNoActionReasons}
            labelFor={diagnosticLabel}
          />
          <ApprovalHealth stats={diagnostics.approvalStats} />
        </div>
        <RecentRuns
          rows={dashboard.runs.recent}
          history={dashboard.runs.history}
          statusOptions={dashboard.runs.byStatus.map((row) => row.key)}
          triggerOptions={dashboard.runs.byTrigger.map((row) => row.key)}
        />
      </div>
    </details>
  );
}

function CountSection({
  labelFor,
  rows,
  title,
}: {
  labelFor: (key: string) => string;
  rows: ReconciliationDashboardCount[];
  title: string;
}) {
  return (
    <section className="space-y-3">
      <SectionHeading>{title}</SectionHeading>
      <CountList
        items={rows.map((row) => ({
          hint: row.key,
          key: row.key,
          label: labelFor(row.key),
          value: row.count,
        }))}
      />
    </section>
  );
}

function ApprovalHealth({
  stats,
}: {
  stats: ReconciliationDashboardSnapshot['diagnostics']['approvalStats'];
}) {
  return (
    <section className="space-y-3">
      <SectionHeading>Approval health</SectionHeading>
      <CountList
        items={[
          { key: 'accepted', label: 'Accepted', value: stats.accepted },
          { key: 'rejected', label: 'Rejected', value: stats.rejected },
          { key: 'open', label: 'Open', value: stats.open },
          {
            hint: `Decided approvals: ${String(stats.totalDecided)}`,
            key: 'acceptance',
            label: 'Acceptance',
            value: formatRate(stats.acceptanceRate),
          },
        ]}
      />
    </section>
  );
}

function EvidenceBySource({
  coverage,
}: {
  coverage: ReconciliationDashboardSnapshot['evidenceCoverage'];
}) {
  return (
    <section className="space-y-3">
      <div>
        <SectionHeading>Evidence by source</SectionHeading>
        <p className="mt-1 text-sm text-fg-muted">
          Where captured activity already has evidence, and where a rebuild is still needed.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="border-y border-border text-left text-xs text-fg-dim">
            <tr>
              <th className="px-3 py-2 font-medium">Source</th>
              <th className="px-3 py-2 text-right font-medium">Raw</th>
              <th className="px-3 py-2 text-right font-medium">Normalized</th>
              <th className="px-3 py-2 text-right font-medium">Missing</th>
              <th className="px-3 py-2 text-right font-medium">Full replay</th>
              <th className="px-3 py-2 text-right font-medium">Degraded</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {Object.entries(coverage.bySource).map(([source, row]) => (
              <tr key={source}>
                <td className="px-3 py-2 font-medium">{eventSourceLabel(source)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{row.totalRawEvents}</td>
                <td className="px-3 py-2 text-right tabular-nums">{row.normalizedRawEvents}</td>
                <td
                  className={`px-3 py-2 text-right tabular-nums${row.missingRawEvents > 0 ? ' text-danger' : ''}`}
                >
                  {row.missingRawEvents}
                </td>
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
    <section className="space-y-3">
      <div>
        <SectionHeading>Manual reconcile</SectionHeading>
        <p className="mt-1 text-sm text-fg-muted">
          Rerun reconciliation for the team or a specific object or cluster. This can enqueue
          planner work.
        </p>
      </div>
      <form
        action={queueReconciliationJobFormAction}
        className="grid gap-4 md:grid-cols-2 xl:grid-cols-3"
      >
        <input type="hidden" name="mode" value="scope" />
        <FormField label="Scope">
          <select
            aria-label="Scope"
            name="scope"
            className={MANUAL_FIELD_CLASS}
            defaultValue="team"
          >
            <option value="team">Team</option>
            <option value="object">Object</option>
            <option value="cluster">Cluster</option>
          </select>
        </FormField>
        <FormField label="Object or cluster ID">
          <input
            name="targetId"
            aria-label="Object or cluster ID"
            className={`${MANUAL_FIELD_CLASS} font-mono`}
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
            className={`${MANUAL_FIELD_CLASS} font-mono`}
          />
        </FormField>
        <FormField label="Planner replay mode">
          <select
            aria-label="Planner replay mode"
            name="plannerReplayMode"
            defaultValue="missing"
            className={MANUAL_FIELD_CLASS}
          >
            <option value="missing">Missing only</option>
            <option value="all">All visible</option>
          </select>
        </FormField>
        <FormField label="Planner replay source">
          <select
            aria-label="Planner replay source"
            name="plannerReplaySource"
            className={MANUAL_FIELD_CLASS}
            defaultValue=""
          >
            <option value="">All sources</option>
            {eventSource.enumValues.map((source) => (
              <option key={source} value={source}>
                {eventSourceLabel(source)}
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
            className={`${MANUAL_FIELD_CLASS} font-mono`}
          />
        </FormField>
        <FormField label="Planner replay until">
          <input
            name="plannerReplayOccurredBefore"
            aria-label="Planner replay until"
            type="datetime-local"
            className={`${MANUAL_FIELD_CLASS} font-mono`}
          />
        </FormField>
        <div className="flex items-end">
          <Button type="submit" variant="outline" size="sm">
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

function RecentRuns({
  history,
  rows,
  statusOptions,
  triggerOptions,
}: {
  history: ReconciliationDashboardRunHistory;
  rows: ReconciliationDashboardRun[];
  statusOptions: string[];
  triggerOptions: string[];
}) {
  const statusValues = uniqueOptions(statusOptions, history.status);
  const triggerValues = uniqueOptions(triggerOptions, history.trigger);
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <SectionHeading>Run history</SectionHeading>
          <p className="mt-1 text-xs text-fg-dim">
            Showing page {history.page.toLocaleString()} of {history.totalPages.toLocaleString()} ·{' '}
            {history.total.toLocaleString()} run{history.total === 1 ? '' : 's'}
          </p>
        </div>
        <DebouncedFilterForm
          basePath="/app/team/reconciliation"
          className="flex flex-wrap items-end gap-2"
        >
          <label className="grid gap-1 text-xs font-medium text-fg-muted">
            Status
            <select
              name="runStatus"
              defaultValue={history.status ?? ''}
              className="h-9 rounded-sm border border-border bg-background px-2 text-sm text-fg"
            >
              <option value="">All</option>
              {statusValues.map((status) => (
                <option key={status} value={status}>
                  {runStatusLabel(status)}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-xs font-medium text-fg-muted">
            Trigger
            <select
              name="runTrigger"
              defaultValue={history.trigger ?? ''}
              className="h-9 rounded-sm border border-border bg-background px-2 text-sm text-fg"
            >
              <option value="">All</option>
              {triggerValues.map((trigger) => (
                <option key={trigger} value={trigger}>
                  {runTriggerLabel(trigger)}
                </option>
              ))}
            </select>
          </label>
        </DebouncedFilterForm>
      </div>
      {rows.length === 0 ? (
        <p className="px-1 py-3 text-sm text-fg-muted">
          No reconciliation runs match these filters.
        </p>
      ) : (
        <ul className="border-y border-border">
          {rows.map((row) => {
            const metrics = runMetricHint(row.metrics);
            const hint = [
              `${runTriggerLabel(row.trigger)} · ${row.trigger}`,
              row.engineVersion,
              metrics,
            ]
              .filter(Boolean)
              .join('\n');
            return (
              <li key={row.id}>
                <CollectionRow
                  leading={
                    <CollectionStatus value={row.status} label={runStatusLabel(row.status)} />
                  }
                  title={row.scope}
                  titleHint={hint}
                  context={runTriggerLabel(row.trigger)}
                  contextTitle={hint}
                  metadata={
                    <time className="text-xs text-fg-muted" title={hint}>
                      {row.createdAt.toLocaleString()}
                    </time>
                  }
                />
              </li>
            );
          })}
        </ul>
      )}
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

function formatRate(rate: number | null): string {
  if (rate === null) return 'n/a';
  return `${Math.round(rate * 100)}%`;
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

import { eventSource } from '@timeline/db';
import { withTeam } from '@timeline/shared/team-scope';
import { ListRestart, Play } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import type {
  ReconciliationDashboardCluster,
  ReconciliationDashboardOutput,
} from '@timeline/shared/reconciliation';
import type { Metadata } from 'next';

import { queueReconciliationJobFormAction } from '@/app/actions/reconciliation';
import { CollectionRow } from '@/components/collections/collection-row';
import { CollectionStatus } from '@/components/collections/collection-status';
import { ReconciliationAdvancedTools } from '@/components/reconciliation/advanced-tools';
import { ReconciliationForbiddenView } from '@/components/reconciliation/forbidden-view';
import { HintedSubmitButton } from '@/components/reconciliation/hinted-submit-button';
import { ReconciliationPageHeader } from '@/components/reconciliation/page-header';
import {
  artifactClusterKindLabel,
  artifactTypeLabel,
  clusterStatusLabel,
  confidenceLabel,
  eventSourceLabel,
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
import { Button } from '@/components/ui/button';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

export const metadata: Metadata = {
  title: 'Reconciliation',
  description: 'Groups related captures into the same work, then proposes updates for review.',
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

  return (
    <div className="space-y-8">
      <ReconciliationPageHeader
        teamName={active.teamName}
        srLabel={`Reconciliation for ${active.teamName}. Admins only. ${String(coverage.totalRawEvents)} captured items checked; ${String(coverage.missingRawEvents + coverage.degradedReplayEvidence)} need repair. Times in ${timezone}.`}
      />
      {notice ? <Notice tone={notice.tone} message={notice.message} /> : null}

      <CoverageSection
        failures={coverage.releaseGate.failures}
        coverageLimit={dashboard.coverageLimit}
      />

      <div className="grid gap-6 xl:grid-cols-2">
        <RecentClusters rows={dashboard.clusters.recent} timeZone={timezone} />
        <RecentOutputs rows={dashboard.outputs.recent} timeZone={timezone} />
      </div>

      <ReconciliationAdvancedTools dashboard={dashboard} />
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
            context={eventSourceLabel(failure.source)}
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
            {eventSourceLabel(source)}
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

function RecentClusters({
  rows,
  timeZone,
}: {
  rows: ReconciliationDashboardCluster[];
  timeZone: string;
}) {
  return (
    <section className="space-y-3">
      <SectionHeading>Recent clusters</SectionHeading>
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
      <SectionHeading>Recent outputs</SectionHeading>
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

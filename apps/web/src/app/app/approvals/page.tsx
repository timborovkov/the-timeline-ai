import { getEnv } from '@timeline/shared/env';
import { pageWindow } from '@timeline/shared/pagination';
import { withTeam } from '@timeline/shared/team-scope';
import type { Metadata } from 'next';
import Link from 'next/link';
import { z } from 'zod';
import { redirect } from 'next/navigation';

import { ApprovalsClient } from '@/components/approvals/approvals-client';
import { CollectionToolbar } from '@/components/collections/collection-toolbar';
import { GuidedContinue } from '@/components/onboarding/guided-continue';
import { RefreshSuggestions } from '@/components/onboarding/refresh-suggestions';
import { SaveViewButton } from '@/components/saved-views/save-view-button';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';
import { PageHeader } from '@/components/page-header';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { SUGGESTIONS_PAGE_SIZE } from '@/lib/collection-page-sizes';
import { db } from '@/lib/db';
import { guidedApprovalItemIds } from '@/lib/guided-approval-items';
import { isActionableSuggestionStatus } from '@/lib/suggestion-status';
import { serializeSuggestionBundle } from '@/lib/suggestions';

export const metadata: Metadata = {
  title: 'Approvals',
  description: 'Review pending agent suggestions and approvals.',
};

const STATUS_FILTERS = ['pending', 'failed', 'resolved', 'all'] as const;
type ApprovalFilter = (typeof STATUS_FILTERS)[number];

const EMPTY_STATES: Record<
  ApprovalFilter,
  { title: string; body: string; href?: string; action?: string }
> = {
  pending: {
    title: 'No proposals to review',
    body: 'The timeline is collecting events. Proposals will appear here when something needs a decision.',
    href: '/app/timeline',
    action: 'Open timeline',
  },
  failed: {
    title: 'No failed approvals',
    body: 'Approvals that need a retry or rejection will appear here.',
  },
  resolved: {
    title: 'No resolved approvals',
    body: 'Accepted, rejected, and superseded approvals will appear here.',
  },
  all: {
    title: 'No proposals to review',
    body: 'The timeline is collecting events. Proposals will appear here when something needs a decision.',
    href: '/app/timeline',
    action: 'Open timeline',
  },
};

interface PageProps {
  searchParams: Promise<{ status?: string; boardId?: string; project?: string; decision?: string }>;
}

const GUIDED_APPROVAL_PHASES = new Set(['ask', 'approve', 'record']);

async function loadGuidedApprovals(scope: ReturnType<typeof withTeam>): Promise<boolean> {
  const firstRun = await scope.onboarding.getFirstRun().catch(() => null);
  if (firstRun && (firstRun.phase === 'ask' || firstRun.phase === 'record')) {
    await scope.onboarding.setFirstRunPhase('approve');
  }
  return Boolean(firstRun && GUIDED_APPROVAL_PHASES.has(firstRun.phase));
}

function approvalsSubtitle(guided: boolean): string {
  return guided
    ? 'Nothing becomes a lasting record until you accept it. Rejecting removes the suggestion; the source stays in your event history either way.'
    : 'Review evidence-backed changes before they become team memory.';
}

function GuidedApprovalsChrome({ enabled }: { enabled: boolean }) {
  if (!enabled) return null;
  return <p className="text-xs text-fg-dim">Approvals · from this capture</p>;
}

function GuidedApprovalsContinue({ enabled }: { enabled: boolean }) {
  if (!enabled) return null;
  return (
    <GuidedContinue
      phase="live"
      href="/app/onboarding/live"
      label="Continue"
      hint="Anything you leave stays in Work → Approvals."
    />
  );
}

function ApprovalFiltersToolbar({
  status,
  filters,
  projects,
  counts,
  showCounts,
}: {
  status: ApprovalFilter;
  filters: Record<string, string>;
  projects: { id: string; canonicalName: string }[];
  counts: { pending: number; failed: number };
  showCounts: boolean;
}) {
  return (
    <CollectionToolbar>
      <CollectionToolbar.Search>
        <nav className="flex flex-wrap gap-1" aria-label="Approval status filters">
          {STATUS_FILTERS.map((filter) => (
            <Link
              key={filter}
              href={`/app/approvals?${new URLSearchParams({ ...filters, status: filter }).toString()}`}
              aria-current={status === filter ? 'page' : undefined}
              className={`inline-flex min-h-9 items-center rounded-sm px-2.5 text-xs capitalize transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong ${
                status === filter
                  ? 'bg-signal-soft text-signal'
                  : 'text-fg-muted hover:bg-surface-2 hover:text-fg'
              }`}
            >
              {filter}
              {showCounts && (filter === 'pending' || filter === 'failed')
                ? ` ${counts[filter]}`
                : ''}
            </Link>
          ))}
        </nav>
      </CollectionToolbar.Search>
      <CollectionToolbar.Filters>
        <form action="/app/approvals" className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="status" value={status} />
          {filters.boardId ? <input type="hidden" name="boardId" value={filters.boardId} /> : null}
          <label className="block space-y-1 text-xs">
            Project
            <NativeSelect name="project" defaultValue={filters.project ?? ''}>
              <option value="">All projects</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.canonicalName}
                </option>
              ))}
            </NativeSelect>
          </label>
          <label className="block space-y-1 text-xs">
            Change type
            <NativeSelect name="decision" defaultValue={filters.decision ?? ''}>
              <option value="">All changes</option>
              <option value="1">Decisions</option>
            </NativeSelect>
          </label>
          <Button size="sm" variant="outline" type="submit">
            Apply filters
          </Button>
        </form>
      </CollectionToolbar.Filters>
    </CollectionToolbar>
  );
}

function getApprovalFilters(params: Awaited<PageProps['searchParams']>) {
  const status = STATUS_FILTERS.includes(params.status as ApprovalFilter)
    ? (params.status as ApprovalFilter)
    : 'pending';
  const projectId = z.uuid().safeParse(params.project).data;
  const decisionOnly = params.decision === '1';
  const approvalFilters = {
    status,
    ...(params.boardId ? { boardId: params.boardId } : {}),
    ...(projectId ? { project: projectId } : {}),
    ...(decisionOnly ? { decision: '1' } : {}),
  };
  return {
    status,
    projectId,
    decisionOnly,
    approvalFilters,
    showCounts: !params.boardId && !projectId && !decisionOnly,
  };
}

function visibleApprovalBundles(
  rows: Parameters<typeof serializeSuggestionBundle>[0][],
  status: ApprovalFilter,
  boardId?: string,
) {
  return rows.flatMap((bundle) => {
    const items = bundle.items.filter((item) => {
      if (boardId && item.proposedPayload.boardId !== boardId) return false;
      if (status === 'pending') return item.status === 'pending';
      if (status === 'failed') return item.status === 'failed';
      if (status === 'resolved') return !isActionableSuggestionStatus(item.status);
      return item.status !== 'failed';
    });
    return items.length > 0 ? [serializeSuggestionBundle({ ...bundle, items })] : [];
  });
}

export default async function ApprovalsPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user) redirect('/sign-in');
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) redirect('/sign-in');

  const scope = withTeam(db, active.teamId, session.user.id);
  const guidedApprovals = await loadGuidedApprovals(scope);
  const itemIds = guidedApprovals ? await guidedApprovalItemIds(scope) : undefined;
  const params = await searchParams;
  const { status, projectId, decisionOnly, approvalFilters, showCounts } =
    getApprovalFilters(params);
  const [suggestionRows, calendarSettings, approvalCounts, projects] = await Promise.all([
    scope.suggestions.withCalendarResolutionHints(
      await scope.suggestions.listSuggestions({
        status,
        boardId: params.boardId,
        projectId,
        decisionOnly,
        itemIds,
        limit: SUGGESTIONS_PAGE_SIZE + 1,
        cursor: null,
      }),
    ),
    scope.calendar.getCalendarSettings(),
    scope.suggestions.getApprovalItemCounts({ itemIds }),
    scope.objects.listObjects({ type: 'project', archived: false, limit: 100 }),
  ]);
  const page = pageWindow(suggestionRows, SUGGESTIONS_PAGE_SIZE, (row) => ({
    at: row.createdAt.toISOString(),
    id: row.id,
  }));
  const visibleSuggestions = visibleApprovalBundles(page.items, status, params.boardId);
  const inventoryCount =
    showCounts && (status === 'pending' || status === 'failed') ? approvalCounts[status] : null;

  return (
    <div data-app-width="overview" className="space-y-4">
      <PageHeader
        variant="default"

        title="Approvals"
        trailing={<SaveViewButton collection="approvals" filters={approvalFilters} />}
        subtitle={
          params.boardId
            ? 'Membership changes for this board. Each decision is separate from object approval.'
            : approvalsSubtitle(guidedApprovals)
        }
        metadata={[
          ...(inventoryCount !== null
            ? [
                {
                  label: status === 'pending' ? 'To review' : 'Needs attention',
                  value: inventoryCount,
                  mono: true,
                },
              ]
            : []),
        ]}
      />
      <div>
        <ApprovalFiltersToolbar
          status={status}
          filters={approvalFilters}
          projects={projects}
          counts={approvalCounts}
          showCounts={showCounts}
        />
        <GuidedApprovalsChrome enabled={guidedApprovals} />
        <ApprovalsClient
          layout="inbox"
          key={`${status}:${params.boardId ?? 'all'}:${projectId ?? 'all'}:${decisionOnly}`}
          boardId={params.boardId}
          projectId={projectId}
          decisionOnly={decisionOnly}
          suggestions={visibleSuggestions}
          nextCursor={page.nextCursor}
          status={status}
          guided={guidedApprovals}
          timezone={calendarSettings.defaultTimezone}
          taskCategoriesEnabled={getEnv().TASK_CATEGORY_UI_ENABLED}
          emptyState={EMPTY_STATES[status]}
        />
      </div>
      {guidedApprovals && visibleSuggestions.length === 0 ? <RefreshSuggestions /> : null}
      <GuidedApprovalsContinue enabled={guidedApprovals} />
    </div>
  );
}

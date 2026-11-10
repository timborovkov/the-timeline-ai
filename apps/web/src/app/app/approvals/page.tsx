import { getEnv } from '@timeline/shared/env';
import { pageWindow } from '@timeline/shared/pagination';
import { withTeam } from '@timeline/shared/team-scope';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import type { Metadata } from 'next';

import { ApprovalsClient } from '@/components/approvals/approvals-client';
import { CollectionToolbar } from '@/components/collections/collection-toolbar';
import { GuidedContinue } from '@/components/onboarding/guided-continue';
import { PageHeader } from '@/components/page-header';
import { WorkSubnav } from '@/components/work-subnav';
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
  searchParams: Promise<{ status?: string }>;
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

export default async function ApprovalsPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user) redirect('/sign-in');
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) redirect('/sign-in');

  const scope = withTeam(db, active.teamId, session.user.id);
  const guidedApprovals = await loadGuidedApprovals(scope);
  const itemIds = guidedApprovals ? await guidedApprovalItemIds(scope) : undefined;
  const params = await searchParams;
  const status = STATUS_FILTERS.includes(params.status as ApprovalFilter)
    ? (params.status as ApprovalFilter)
    : 'pending';
  const [suggestionRows, calendarSettings, approvalCounts] = await Promise.all([
    scope.suggestions.withCalendarResolutionHints(
      await scope.suggestions.listSuggestions({
        status,
        itemIds,
        limit: SUGGESTIONS_PAGE_SIZE + 1,
        cursor: null,
      }),
    ),
    scope.calendar.getCalendarSettings(),
    scope.suggestions.getApprovalItemCounts({ itemIds }),
  ]);
  const page = pageWindow(suggestionRows, SUGGESTIONS_PAGE_SIZE, (row) => ({
    at: row.createdAt.toISOString(),
    id: row.id,
  }));
  const visibleSuggestions = page.items.flatMap((bundle) => {
    const items = bundle.items.filter((item) => {
      if (status === 'pending') return item.status === 'pending';
      if (status === 'failed') return item.status === 'failed';
      if (status === 'resolved') return !isActionableSuggestionStatus(item.status);
      return item.status !== 'failed';
    });
    return items.length > 0 ? [serializeSuggestionBundle({ ...bundle, items })] : [];
  });
  const inventoryCount =
    status === 'pending' || status === 'failed' ? approvalCounts[status] : null;

  return (
    <div className="space-y-6">
      <PageHeader
        variant="collection"
        title="Approvals"
        subtitle={approvalsSubtitle(guidedApprovals)}
        metadata={[
          { label: 'Filter', value: status.replaceAll('_', ' ') },
          ...(inventoryCount !== null
            ? [{ label: 'Items', value: inventoryCount, mono: true }]
            : []),
        ]}
      />
      <WorkSubnav current="/app/approvals" />
      <CollectionToolbar>
        <CollectionToolbar.View>
          <nav className="flex flex-wrap gap-1" aria-label="Approval status filters">
            {STATUS_FILTERS.map((filter) => (
              <Link
                key={filter}
                href={`/app/approvals?status=${filter}`}
                aria-current={status === filter ? 'page' : undefined}
                className={`inline-flex min-h-9 items-center rounded-sm px-2.5 text-xs capitalize transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong ${
                  status === filter
                    ? 'bg-signal-soft text-signal'
                    : 'text-fg-muted hover:bg-surface-2 hover:text-fg'
                }`}
              >
                {filter}
                {filter === 'pending' || filter === 'failed' ? ` ${approvalCounts[filter]}` : ''}
              </Link>
            ))}
          </nav>
        </CollectionToolbar.View>
      </CollectionToolbar>
      <GuidedApprovalsChrome enabled={guidedApprovals} />
      <ApprovalsClient
        key={status}
        suggestions={visibleSuggestions}
        nextCursor={page.nextCursor}
        status={status}
        guided={guidedApprovals}
        timezone={calendarSettings.defaultTimezone}
        taskCategoriesEnabled={getEnv().TASK_CATEGORY_UI_ENABLED}
        emptyState={EMPTY_STATES[status]}
      />
      <GuidedApprovalsContinue enabled={guidedApprovals} />
    </div>
  );
}

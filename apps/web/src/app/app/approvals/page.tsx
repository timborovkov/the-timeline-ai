import { getEnv } from '@timeline/shared/env';
import { pageWindow } from '@timeline/shared/pagination';
import { withTeam } from '@timeline/shared/team-scope';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import type { Metadata } from 'next';

import { ApprovalsClient } from '@/components/approvals/approvals-client';
import { CollectionToolbar } from '@/components/collections/collection-toolbar';
import { PageHeader } from '@/components/page-header';
import { WorkSubnav } from '@/components/work-subnav';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { SUGGESTIONS_PAGE_SIZE } from '@/lib/collection-page-sizes';
import { db } from '@/lib/db';
import { isActionableSuggestionStatus } from '@/lib/suggestion-status';
import { serializeSuggestionBundle } from '@/lib/suggestions';

export const metadata: Metadata = {
  title: 'Approvals',
  description: 'Review pending agent suggestions and approvals.',
};

const STATUS_FILTERS = ['pending', 'failed', 'resolved', 'all'] as const;
type ApprovalFilter = (typeof STATUS_FILTERS)[number];

const EMPTY_STATES: Record<ApprovalFilter, { title: string; body: string }> = {
  pending: {
    title: 'No pending approvals',
    body: 'When the agent proposes a workspace change, it will wait here before becoming canonical.',
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
    title: 'No approvals',
    body: 'Agent proposals will appear here as they move through review.',
  },
};

interface PageProps {
  searchParams: Promise<{ status?: string }>;
}

export default async function ApprovalsPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user) redirect('/sign-in');
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) redirect('/sign-in');

  const scope = withTeam(db, active.teamId, session.user.id);
  const params = await searchParams;
  const status = STATUS_FILTERS.includes(params.status as ApprovalFilter)
    ? (params.status as ApprovalFilter)
    : 'pending';
  const [suggestionRows, calendarSettings, approvalCounts] = await Promise.all([
    scope.suggestions.withCalendarResolutionHints(
      await scope.suggestions.listSuggestions({
        status,
        limit: SUGGESTIONS_PAGE_SIZE + 1,
        cursor: null,
      }),
    ),
    scope.calendar.getCalendarSettings(),
    scope.suggestions.getApprovalItemCounts(),
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
        subtitle="Review evidence-backed changes before they become team memory."
        metadata={[
          { label: 'Filter', value: status.replaceAll('_', ' ') },
          ...(inventoryCount !== null
            ? [{ label: 'Items', value: inventoryCount, mono: true }]
            : []),
        ]}
      />
      <WorkSubnav current="/app/approvals" />
      <CollectionToolbar
        view={
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
        }
      />
      <ApprovalsClient
        key={status}
        suggestions={visibleSuggestions}
        nextCursor={page.nextCursor}
        status={status}
        timezone={calendarSettings.defaultTimezone}
        taskCategoriesEnabled={getEnv().TASK_CATEGORY_UI_ENABLED}
        emptyState={EMPTY_STATES[status]}
      />
    </div>
  );
}

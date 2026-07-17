import { withTeam } from '@timeline/shared/team-scope';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import type { Metadata } from 'next';

import { ApprovalsClient } from '@/components/approvals/approvals-client';
import { IndexStrip } from '@/components/index-strip';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
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
  const [suggestions, calendarSettings, approvalCounts] = await Promise.all([
    scope.suggestions.withCalendarResolutionHints(
      await scope.suggestions.listSuggestions({ status }),
    ),
    scope.calendar.getCalendarSettings(),
    scope.suggestions.getApprovalItemCounts(),
  ]);
  const visibleSuggestions = suggestions.flatMap((bundle) => {
    const items = bundle.items.filter((item) => {
      if (status === 'pending') return item.status === 'pending';
      if (status === 'failed') return item.status === 'failed';
      if (status === 'resolved') return !isActionableSuggestionStatus(item.status);
      return item.status !== 'failed';
    });
    return items.length > 0 ? [serializeSuggestionBundle({ ...bundle, items })] : [];
  });
  const itemCount = visibleSuggestions.reduce((sum, s) => sum + s.items.length, 0);

  return (
    <div className="space-y-6">
      <IndexStrip
        srLabel={`Approvals · ${status} · ${visibleSuggestions.length} suggestion bundles · ${itemCount} items`}
        segments={[
          { value: 'APPROVALS' },
          { label: 'filter', value: status.toUpperCase() },
          {
            label: 'bundles',
            value: visibleSuggestions.length,
            signal: visibleSuggestions.length > 0,
          },
          { label: 'items', value: itemCount, signal: itemCount > 0 },
        ]}
      />
      <nav className="flex flex-wrap gap-2" aria-label="Approval status filters">
        {STATUS_FILTERS.map((filter) => (
          <Link
            key={filter}
            href={`/app/approvals?status=${filter}`}
            className={`rounded-md border px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] ${
              status === filter
                ? 'border-signal bg-signal/10 text-signal'
                : 'border-border text-fg-dim hover:text-fg'
            }`}
          >
            {filter}
            {filter === 'pending' || filter === 'failed' ? ` ${approvalCounts[filter]}` : ''}
          </Link>
        ))}
      </nav>
      <ApprovalsClient
        suggestions={visibleSuggestions}
        timezone={calendarSettings.defaultTimezone}
        emptyState={EMPTY_STATES[status]}
      />
    </div>
  );
}

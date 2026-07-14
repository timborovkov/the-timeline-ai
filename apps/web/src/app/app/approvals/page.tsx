import { withTeam } from '@timeline/shared/team-scope';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import type { Metadata } from 'next';

import { ApprovalsClient } from '@/components/approvals/approvals-client';
import { PageHeader } from '@/components/page-header';
import { WorkSubnav } from '@/components/work-subnav';
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
  const status = STATUS_FILTERS.includes(params.status as (typeof STATUS_FILTERS)[number])
    ? (params.status as (typeof STATUS_FILTERS)[number])
    : 'pending';
  const [suggestions, calendarSettings] = await Promise.all([
    scope.suggestions.withCalendarResolutionHints(
      await scope.suggestions.listSuggestions({ status }),
    ),
    scope.calendar.getCalendarSettings(),
  ]);
  const visibleSuggestions = suggestions.flatMap((bundle) => {
    const items = bundle.items.filter((item) => {
      if (status === 'pending') return item.status === 'pending';
      if (status === 'failed') return item.status === 'failed';
      if (status === 'resolved') return !isActionableSuggestionStatus(item.status);
      return true;
    });
    return items.length > 0 ? [serializeSuggestionBundle({ ...bundle, items })] : [];
  });
  const itemCount = visibleSuggestions.reduce((sum, s) => sum + s.items.length, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Approvals"
        subtitle="Review evidence-backed changes before they become team memory."
        metadata={[
          { label: 'Filter', value: status.replaceAll('_', ' ') },
          { label: 'Bundles', value: visibleSuggestions.length, mono: true },
          { label: 'Items', value: itemCount, mono: true },
        ]}
      />
      <WorkSubnav current="/app/approvals" />
      <nav className="flex flex-wrap gap-2" aria-label="Approval status filters">
        {STATUS_FILTERS.map((filter) => (
          <Link
            key={filter}
            href={`/app/approvals?status=${filter}`}
            className={`rounded-sm border px-3 py-1.5 text-xs capitalize ${
              status === filter
                ? 'border-signal bg-signal/10 text-signal'
                : 'border-border text-fg-dim hover:text-fg'
            }`}
          >
            {filter}
          </Link>
        ))}
      </nav>
      <ApprovalsClient
        suggestions={visibleSuggestions}
        timezone={calendarSettings.defaultTimezone}
      />
    </div>
  );
}

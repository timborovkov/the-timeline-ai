import { withTeam } from '@timeline/shared';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { ApprovalsClient } from '@/components/approvals/approvals-client';
import { IndexStrip } from '@/components/index-strip';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { serializeSuggestionBundle } from '@/lib/suggestions';

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
  const suggestions = await scope.suggestions.listSuggestions({ status });
  const itemCount = suggestions.reduce(
    (sum, s) => sum + s.items.filter((i) => i.status === 'pending' || i.status === 'failed').length,
    0,
  );

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <IndexStrip
        srLabel={`Approvals · ${status} · ${suggestions.length} suggestion bundles · ${itemCount} actionable items`}
        segments={[
          { value: 'APPROVALS' },
          { label: 'filter', value: status.toUpperCase() },
          { label: 'bundles', value: suggestions.length, signal: suggestions.length > 0 },
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
          </Link>
        ))}
      </nav>
      <ApprovalsClient suggestions={suggestions.map(serializeSuggestionBundle)} />
    </div>
  );
}

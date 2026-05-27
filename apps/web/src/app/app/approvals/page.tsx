import { withTeam } from '@timeline/shared';
import { redirect } from 'next/navigation';

import { ApprovalsClient } from '@/components/approvals/approvals-client';
import { IndexStrip } from '@/components/index-strip';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

export default async function ApprovalsPage() {
  const session = await auth();
  if (!session?.user) redirect('/sign-in');
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) redirect('/sign-in');

  const scope = withTeam(db, active.teamId, session.user.id);
  const suggestions = await scope.suggestions.listPendingSuggestions();
  const itemCount = suggestions.reduce(
    (sum, s) => sum + s.items.filter((i) => i.status === 'pending' || i.status === 'failed').length,
    0,
  );

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <IndexStrip
        srLabel={`Approvals · ${suggestions.length} suggestion bundles · ${itemCount} pending items`}
        segments={[
          { value: 'APPROVALS' },
          { label: 'bundles', value: suggestions.length, signal: suggestions.length > 0 },
          { label: 'items', value: itemCount, signal: itemCount > 0 },
        ]}
      />
      <ApprovalsClient
        suggestions={suggestions.map((s) => ({
          id: s.id,
          source: s.source,
          status: s.status,
          title: s.title,
          summary: s.summary,
          reason: s.reason,
          confidence: s.confidence,
          createdAt: s.createdAt.toISOString(),
          items: s.items,
          evidence: s.evidence.map((ev) => ({
            rawEventId: ev.rawEventId,
            quote: ev.quote,
            source: ev.source,
            occurredAt: ev.occurredAt?.toISOString() ?? null,
          })),
        }))}
      />
    </div>
  );
}

import {
  listDailyDigests,
  presentSavedViewDigest,
  type DailyDigestPayload,
} from '@timeline/shared/messaging';
import { withTeam } from '@timeline/shared/team-scope';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { DigestHistoryTable } from '@/components/home/digest-history-table';
import { PageHeader } from '@/components/page-header';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

export const metadata: Metadata = {
  title: 'Digests',
  description: 'Browse every daily digest and open a specific day.',
};

export const dynamic = 'force-dynamic';

export default async function DigestsPage({
  searchParams,
}: {
  searchParams: Promise<{ digest?: string | string[] }>;
}) {
  const session = await auth();
  if (!session?.user) redirect('/sign-in');
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) redirect('/sign-in');

  const query = await searchParams;
  const selectedId = Array.isArray(query.digest) ? query.digest[0] : query.digest;
  const rows = await listDailyDigests({
    db,
    teamId: active.teamId,
    userId: session.user.id,
    limit: 90,
  });

  const scope = withTeam(db, active.teamId, session.user.id);
  // One `now` + request-scoped match cache so history rows reuse each view scan.
  const now = new Date();
  const presented = await Promise.all(
    rows.map(async (row) => {
      const { payload } = await presentSavedViewDigest(
        scope,
        row.payload as DailyDigestPayload,
        now,
      );
      return {
        id: row.id,
        status: row.status,
        summary: payload.summary,
        windowEnd: row.windowEnd.toISOString(),
        timezone: payload.timezone,
        payload,
      };
    }),
  );
  return (
    <div data-app-width="collection" className="space-y-6">
      <PageHeader
        variant="collection"
        title="Digests"
        subtitle="Every generated daily digest, one day at a time."
        metadata={[{ label: 'days', value: rows.length, mono: true }]}
        srLabel={`Digests · ${String(rows.length)} days`}
      />
      <DigestHistoryTable selectedId={selectedId} digests={presented} />
    </div>
  );
}

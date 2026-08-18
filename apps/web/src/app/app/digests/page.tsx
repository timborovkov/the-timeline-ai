import { listDailyDigests, type DailyDigestPayload } from '@timeline/shared/messaging';
import { redirect } from 'next/navigation';

import type { Metadata } from 'next';

import { DigestHistoryTable } from '@/components/home/digest-history-table';
import { PageHeader } from '@/components/page-header';
import { WorkSubnav } from '@/components/work-subnav';
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

  return (
    <div className="space-y-6">
      <PageHeader
        variant="collection"
        title="Digests"
        subtitle="Every generated daily digest, one day at a time."
        metadata={[{ label: 'days', value: rows.length, mono: true }]}
        srLabel={`Digests · ${String(rows.length)} days`}
      />
      <WorkSubnav current="/app/digests" />
      <DigestHistoryTable
        selectedId={selectedId}
        digests={rows.map((row) => {
          const payload = row.payload as DailyDigestPayload;
          return {
            id: row.id,
            status: row.status,
            summary: row.summary,
            windowEnd: row.windowEnd.toISOString(),
            timezone: payload.timezone,
            payload,
          };
        })}
      />
    </div>
  );
}

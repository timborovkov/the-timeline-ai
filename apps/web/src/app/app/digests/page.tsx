import {
  presentSavedViewDigest,
  presentUpdateReport,
  type DailyDigestPayload,
} from '@timeline/shared/messaging';
import { withTeam } from '@timeline/shared/team-scope';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { DigestHistoryTable } from '@/components/home/digest-history-table';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

export const metadata: Metadata = {
  title: 'Update history',
  description: 'Browse past updates and their delivery channels.',
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
  if (!active) redirect('/app');

  const query = await searchParams;
  const selectedId = Array.isArray(query.digest) ? query.digest[0] : query.digest;
  const scope = withTeam(db, active.teamId, session.user.id);
  const rows = await scope.updates.history(selectedId);
  const deliveries = await scope.updates.deliveryInfo(rows.map((row) => row.id));
  const presented = await Promise.all(
    rows.map(async (row) => {
      const stored = row.payload as DailyDigestPayload;
      const payload =
        row.id === selectedId
          ? stored.update
            ? await presentUpdateReport(scope, stored)
            : (await presentSavedViewDigest(scope, stored)).payload
          : undefined;
      const delivery = deliveries.get(row.id);
      return {
        id: row.id,
        name: stored.update?.name ?? 'Daily update',
        status: row.status,
        date: (delivery?.sentAt ?? row.sentAt ?? row.windowEnd).toISOString(),
        timezone: stored.timezone,
        channels: delivery?.channels ?? [],
        payload,
      };
    }),
  );
  return (
    <div data-app-width="collection" className="max-w-4xl space-y-6">
      <PageHeader
        title="Update history"
        subtitle="Open an update to see what it covered."
        trailing={
          <Button asChild variant="outline">
            <Link href="/app/updates">Manage updates</Link>
          </Button>
        }
      />
      {selectedId && !presented.some((update) => update.id === selectedId) && (
        <p className="text-sm text-fg-muted">
          This update is unavailable in the current workspace.
        </p>
      )}
      <DigestHistoryTable selectedId={selectedId} digests={presented} />
    </div>
  );
}

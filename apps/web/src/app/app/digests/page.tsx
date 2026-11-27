import {
  listDailyDigests,
  presentSavedViewDigest,
  presentUpdateReport,
  type DailyDigestPayload,
} from '@timeline/shared/messaging';
import { withTeam } from '@timeline/shared/team-scope';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { DigestHistoryTable } from '@/components/home/digest-history-table';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { resolveActiveTeam } from '@/lib/active-team';
import { getRequestIdentity } from '@/lib/auth';
import { db } from '@/lib/db';

export const metadata: Metadata = {
  title: 'Update history',
  description: 'Browse past updates and their delivery channels.',
};

export const dynamic = 'force-dynamic';

export default async function DigestsPage({
  searchParams,
}: {
  searchParams: Promise<{ digest?: string | string[]; team?: string }>;
}) {
  const { session, impersonation } = await getRequestIdentity();
  if (!session?.user) redirect('/sign-in');
  if (impersonation) redirect('/app');
  const { active, memberships } = await resolveActiveTeam(session.user.id);
  if (!active) redirect('/app');

  const query = await searchParams;
  const selectedId = z
    .uuid()
    .safeParse(Array.isArray(query.digest) ? query.digest[0] : query.digest).data;
  const requestedTeam =
    selectedId && memberships.find((membership) => membership.teamId === query.team);
  if (requestedTeam && requestedTeam.teamId !== active.teamId) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Open update"
          subtitle={`Switch to ${requestedTeam.teamName} to read this update.`}
        />
        <form
          method="post"
          action={`/app/team/switch/${requestedTeam.teamId}?digest=${selectedId}`}
        >
          <Button type="submit">Switch workspace and open update</Button>
        </form>
      </div>
    );
  }
  if (query.team && query.team !== active.teamId && !requestedTeam) redirect('/app');

  const scope = withTeam(db, active.teamId, session.user.id);
  const role = await scope.requireMembership();
  if (!['owner', 'admin', 'member'].includes(role)) redirect('/app');
  const identity = { db, teamId: active.teamId, userId: session.user.id };
  const [scheduled, previous, direct] = await Promise.all([
    scope.updates.history(selectedId),
    listDailyDigests({ ...identity, limit: 90 }),
    selectedId ? listDailyDigests({ ...identity, id: selectedId, limit: 1 }) : [],
  ]);
  const rows = [
    ...new Map([...scheduled, ...previous, ...direct].map((row) => [row.id, row])).values(),
  ]
    .sort((a, b) => {
      if (a.id === selectedId) return -1;
      if (b.id === selectedId) return 1;
      return (b.sentAt ?? b.windowEnd).getTime() - (a.sentAt ?? a.windowEnd).getTime();
    })
    .slice(0, 90);
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

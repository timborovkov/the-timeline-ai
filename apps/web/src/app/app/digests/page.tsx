import {
  listDailyDigests,
  presentSavedViewDigest,
  type DailyDigestPayload,
} from '@timeline/shared/messaging';
import { withTeam } from '@timeline/shared/team-scope';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { DigestHistoryTable } from '@/components/home/digest-history-table';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

export const metadata: Metadata = {
  title: 'Digests',
  description: 'Browse previous scheduled updates.',
};

export const dynamic = 'force-dynamic';

export default async function DigestsPage({
  searchParams,
}: {
  searchParams: Promise<{ digest?: string | string[]; team?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect('/sign-in');
  const { active, memberships } = await resolveActiveTeam(session.user.id);
  if (!active) redirect('/sign-in');

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
  const rows = await listDailyDigests({
    db,
    teamId: active.teamId,
    userId: session.user.id,
    limit: 90,
  });

  const scope = withTeam(db, active.teamId, session.user.id);
  if (selectedId && !rows.some((row) => row.id === selectedId)) {
    rows.unshift(
      ...(await listDailyDigests({
        db,
        teamId: active.teamId,
        userId: session.user.id,
        id: selectedId,
        limit: 1,
      })),
    );
  }
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
        subtitle="Open a previous update and its supporting sources."
        metadata={[{ label: 'days', value: rows.length, mono: true }]}
        srLabel={`Digests · ${String(rows.length)} days`}
      />
      <DigestHistoryTable selectedId={selectedId} digests={presented} />
    </div>
  );
}

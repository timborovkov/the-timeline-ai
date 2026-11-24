import { getDigestPreference } from '@timeline/shared/messaging';
import { withTeam } from '@timeline/shared/team-scope';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { UpdateScheduleForm } from '@/app/app/updates/update-schedule-form';
import { PageHeader } from '@/components/page-header';
import { resolveActiveTeam } from '@/lib/active-team';
import { getRequestIdentity } from '@/lib/auth';
import { db } from '@/lib/db';

export default async function UpdatesSettingsPage() {
  const { session, impersonation } = await getRequestIdentity();
  if (!session?.user) redirect('/sign-in');
  if (impersonation) redirect('/app');
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) redirect('/app');
  const role = await withTeam(db, active.teamId, session.user.id).requireMembership('member');
  if (!['owner', 'admin', 'member'].includes(role)) redirect('/app');
  const preference = await getDigestPreference({
    db,
    teamId: active.teamId,
    userId: session.user.id,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Customize updates"
        subtitle="Choose what to follow and when to catch up."
      />
      <UpdateScheduleForm key={active.teamId} teamId={active.teamId} preference={preference} />
      <Link href="/app/digests" className="inline-block text-sm underline underline-offset-4">
        Update history
      </Link>
    </div>
  );
}

import { isFullMemberRole } from '@timeline/db/contracts/workspace-access';
import { getDigestPreference } from '@timeline/shared/messaging';
import { DEFAULT_UPDATE_KEY } from '@timeline/shared/messaging/format';
import { withTeam } from '@timeline/shared/team-scope';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { UpdateScheduleForm } from '@/app/app/updates/update-schedule-form';
import { PageHeader } from '@/components/page-header';
import { UpdateEditorScreen } from '@/components/updates/update-editor-screen';
import { UpdateSchedules } from '@/components/updates/update-schedules';
import { resolveActiveTeam } from '@/lib/active-team';
import { getRequestIdentity } from '@/lib/auth';
import { db } from '@/lib/db';

export const metadata: Metadata = { title: 'Updates' };

export default async function UpdatesPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string; preset?: string; legacy?: string }>;
}) {
  const { session, impersonation } = await getRequestIdentity();
  if (!session?.user) redirect('/sign-in');
  if (impersonation) redirect('/app');
  const [{ active }, query] = await Promise.all([resolveActiveTeam(session.user.id), searchParams]);
  if (!active) redirect('/app');

  const scope = withTeam(db, active.teamId, session.user.id);
  const role = await scope.requireMembership();
  if (!isFullMemberRole(role)) redirect('/app');
  if (query.legacy === '1') {
    const [preference, personalDestinations] = await Promise.all([
      getDigestPreference({ db, teamId: active.teamId, userId: session.user.id }),
      scope.updatePreferences.availablePersonalDestinations(),
    ]);
    return (
      <div className="space-y-6">
        <Link href="/app/updates" className="text-sm underline underline-offset-4">
          All schedules
        </Link>
        <PageHeader title="Customize updates" subtitle="Manage your previous update schedule." />
        <UpdateScheduleForm
          key={active.teamId}
          teamId={active.teamId}
          preference={preference}
          personalDestinations={personalDestinations}
        />
        <Link href="/app/digests" className="inline-block text-sm underline underline-offset-4">
          Update history
        </Link>
      </div>
    );
  }
  const { schedules, workspaceDefault, timezone, hasLegacySchedule } = await scope.updates.list();
  const canManage = active.role === 'owner' || active.role === 'admin';
  const personalDestinations =
    query.edit && query.edit !== 'workspace'
      ? await scope.updatePreferences.availablePersonalDestinations()
      : [];
  const editor = {
    personalDestinations,
    teamId: active.teamId,
    timezone,
    preset: query.preset === 'weekly' ? ('weekly' as const) : ('daily' as const),
  };
  if (query.edit === 'new') return <UpdateEditorScreen {...editor} mode="new" />;
  if (query.edit === 'workspace' && canManage) {
    return (
      <UpdateEditorScreen
        {...editor}
        mode="workspace"
        schedule={{ key: DEFAULT_UPDATE_KEY, inherited: false, settings: workspaceDefault }}
      />
    );
  }
  const selected = schedules.find((schedule) => schedule.key === query.edit);
  if (selected) return <UpdateEditorScreen {...editor} mode="personal" schedule={selected} />;
  return (
    <UpdateSchedules
      schedules={schedules}
      hasLegacySchedule={hasLegacySchedule}
      workspaceDefault={canManage ? workspaceDefault : undefined}
      timezone={timezone}
    />
  );
}

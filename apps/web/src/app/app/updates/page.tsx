import { DEFAULT_UPDATE_KEY } from '@timeline/shared/messaging/format';
import { withTeam } from '@timeline/shared/team-scope';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { UpdateEditorScreen } from '@/components/updates/update-editor-screen';
import { UpdateSchedules } from '@/components/updates/update-schedules';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

export const metadata: Metadata = { title: 'Updates' };

export default async function UpdatesPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string; preset?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect('/sign-in');
  const [{ active }, query] = await Promise.all([resolveActiveTeam(session.user.id), searchParams]);
  if (!active) redirect('/app');

  const scope = withTeam(db, active.teamId, session.user.id);
  const { schedules, workspaceDefault, timezone } = await scope.updates.list();
  const canManage = active.role === 'owner' || active.role === 'admin';
  const editor = {
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
      workspaceDefault={canManage ? workspaceDefault : undefined}
      timezone={timezone}
    />
  );
}

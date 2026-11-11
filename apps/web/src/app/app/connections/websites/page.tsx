import { getEnv } from '@timeline/shared/env';
import { withTeam } from '@timeline/shared/team-scope';
import { redirect } from 'next/navigation';

import { WebsiteManager } from '@/app/app/connections/websites/website-manager';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
export const metadata = { title: 'Website sources' };
export default async function WebsitesPage({
  searchParams,
}: {
  searchParams: Promise<{ source?: string }>;
}) {
  const { source } = await searchParams;
  const initialSourceId = source && /^[a-f0-9-]{36}$/i.test(source) ? source : undefined;
  const session = await auth();
  if (!session?.user.id) redirect('/sign-in');
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) redirect('/app');
  const scope = withTeam(db, active.teamId, session.user.id);
  const [role, settings] = await Promise.all([
    scope.requireMembership(),
    scope.calendar.getCalendarSettings(),
  ]);
  return (
    <WebsiteManager
      {...(initialSourceId ? { initialSourceId } : {})}
      canManage={role !== 'member'}
      timezone={settings.defaultTimezone}
      schedulesEnabled={getEnv().WEBSITE_SCHEDULES_ENABLED}
    />
  );
}

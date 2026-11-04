import { withTeam } from '@timeline/shared/team-scope';
import { redirect } from 'next/navigation';

import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { CONNECT_AGENT_SKILL_MARKDOWN } from '@/lib/connect-agent-content';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const session = await auth();
  if (!session?.user.id) {
    redirect('/sign-in?callbackUrl=/app/connect-agent/skill');
  }
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) redirect('/sign-in');
  await withTeam(db, active.teamId, session.user.id).requireMembership();
  return new Response(CONNECT_AGENT_SKILL_MARKDOWN, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': 'attachment; filename="SKILL.md"',
      'Cache-Control': 'private, no-store',
    },
  });
}

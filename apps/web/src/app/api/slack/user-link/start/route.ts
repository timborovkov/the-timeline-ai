import { getEnv, slack, withTeam } from '@timeline/shared';
import { redirect } from 'next/navigation';

import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

export async function GET(): Promise<Response> {
  const session = await auth();
  if (!session?.user) redirect('/sign-in');
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) redirect('/sign-in');
  await withTeam(db, active.teamId, session.user.id).requireMembership();
  if (!(await slack.hasSlackInstallForTeam({ db, teamId: active.teamId }))) {
    redirect('/app/team/slack?error=slack_not_installed');
  }
  const env = getEnv();
  if (!env.SLACK_CLIENT_ID) redirect('/app/team/slack?error=slack_unconfigured');
  const state = slack.signSlackOAuthState({
    kind: 'user_link',
    teamId: active.teamId,
    userId: session.user.id,
  });
  const url = new URL('https://slack.com/oauth/v2/authorize');
  url.searchParams.set('client_id', env.SLACK_CLIENT_ID);
  url.searchParams.set('user_scope', 'identity.basic');
  url.searchParams.set(
    'redirect_uri',
    `${env.AUTH_URL.replace(/\/$/, '')}/api/slack/user-link/callback`,
  );
  url.searchParams.set('state', state);
  redirect(url.toString());
}

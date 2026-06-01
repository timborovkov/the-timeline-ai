import { getEnv } from '@timeline/shared/env';
import * as slack from '@timeline/shared/slack';
import { withTeam } from '@timeline/shared/team-scope';
import { redirect } from 'next/navigation';

import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

const BOT_SCOPES = [
  'app_mentions:read',
  'channels:history',
  'channels:read',
  'chat:write',
  'commands',
  'files:read',
  'groups:history',
  'groups:read',
  'im:history',
  'im:read',
  'reactions:write',
  'users:read',
  'users:read.email',
].join(',');

export async function GET(): Promise<Response> {
  const session = await auth();
  if (!session?.user) redirect('/sign-in');
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) redirect('/sign-in');
  await withTeam(db, active.teamId, session.user.id).requireMembership('admin');
  const env = getEnv();
  if (!env.SLACK_CLIENT_ID) redirect('/app/team/slack?error=slack_unconfigured');
  const state = slack.signSlackOAuthState({
    kind: 'install',
    teamId: active.teamId,
    userId: session.user.id,
  });
  const url = new URL('https://slack.com/oauth/v2/authorize');
  url.searchParams.set('client_id', env.SLACK_CLIENT_ID);
  url.searchParams.set('scope', BOT_SCOPES);
  url.searchParams.set('user_scope', 'identity.basic');
  url.searchParams.set(
    'redirect_uri',
    `${env.AUTH_URL.replace(/\/$/, '')}/api/slack/install/callback`,
  );
  url.searchParams.set('state', state);
  redirect(url.toString());
}

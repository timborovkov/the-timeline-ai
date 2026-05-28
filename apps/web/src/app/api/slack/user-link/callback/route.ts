import { getEnv, slack, withTeam } from '@timeline/shared';
import { redirect } from 'next/navigation';

import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { safeMarkOnboardingStep } from '@/lib/onboarding';

export async function GET(req: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user) redirect('/sign-in');
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const rawState = url.searchParams.get('state');
  if (!code || !rawState) redirect('/app/team/slack?error=missing_oauth');
  let state: slack.SlackOAuthState;
  try {
    state = slack.verifySlackOAuthState(rawState);
  } catch {
    redirect('/app/team/slack?error=invalid_state');
  }
  if (state.kind !== 'user_link' || state.userId !== session.user.id) {
    redirect('/app/team/slack?error=invalid_state');
  }
  const scope = withTeam(db, state.teamId, session.user.id);
  await scope.requireMembership();
  const env = getEnv();
  if (!env.SLACK_CLIENT_ID || !env.SLACK_CLIENT_SECRET) {
    redirect('/app/team/slack?error=slack_unconfigured');
  }
  const api = new slack.SlackApi('');
  const oauth = await api.oauthV2Access({
    clientId: env.SLACK_CLIENT_ID,
    clientSecret: env.SLACK_CLIENT_SECRET,
    code,
    redirectUri: `${env.AUTH_URL.replace(/\/$/, '')}/api/slack/user-link/callback`,
  });
  await slack.linkSlackUserFromOAuth({
    db,
    oauth,
    userId: session.user.id,
    teamId: state.teamId,
  });
  await scope.audit.record({
    action: 'slack.connect',
    targetType: 'slack_user_link',
    metadata: {
      slack_team_id: oauth.team?.id ?? null,
      slack_user_id: oauth.authed_user?.id ?? null,
    },
  });
  await safeMarkOnboardingStep(scope, 'slack');
  redirect('/app/team/slack?linked=1');
}

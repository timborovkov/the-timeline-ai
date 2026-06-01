import { getEnv } from '@timeline/shared/env';
import * as slack from '@timeline/shared/slack';
import { withTeam } from '@timeline/shared/team-scope';
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
  if (state.kind !== 'install' || state.userId !== session.user.id) {
    redirect('/app/team/slack?error=invalid_state');
  }
  const scope = withTeam(db, state.teamId, session.user.id);
  await scope.requireMembership('admin');
  const env = getEnv();
  if (!env.SLACK_CLIENT_ID || !env.SLACK_CLIENT_SECRET) {
    redirect('/app/team/slack?error=slack_unconfigured');
  }
  const api = new slack.SlackApi('');
  const oauth = await api.oauthV2Access({
    clientId: env.SLACK_CLIENT_ID,
    clientSecret: env.SLACK_CLIENT_SECRET,
    code,
    redirectUri: `${env.AUTH_URL.replace(/\/$/, '')}/api/slack/install/callback`,
  });
  const workspaceId = await slack.upsertSlackWorkspaceFromOAuth({
    db,
    oauth,
    installedByUserId: session.user.id,
    teamId: state.teamId,
  });
  await scope.audit.record({
    action: 'slack.connect',
    targetType: 'slack_workspace',
    targetId: workspaceId,
    metadata: { slack_team_id: oauth.team?.id ?? null, slack_team_name: oauth.team?.name ?? null },
  });
  await safeMarkOnboardingStep(scope, 'slack');
  redirect('/app/team/slack?installed=1');
}

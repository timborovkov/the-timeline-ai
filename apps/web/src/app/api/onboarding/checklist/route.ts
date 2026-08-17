import { cacheKey, cachedJson, deleteCacheKey } from '@timeline/shared/cache';
import * as onboarding from '@timeline/shared/onboarding';
import { withTeam } from '@timeline/shared/team-scope';
import { z } from 'zod';

import { resolveActiveTeam } from '@/lib/active-team';
import { trackProductEventBestEffort } from '@/lib/analytics';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const LABELS: Record<onboarding.OnboardingStep, string> = {
  first_note: 'Capture one timeline event',
  invite_teammate: 'Invite a teammate',
  telegram: 'Link Telegram',
  slack: 'Install or link Slack',
  email_forwarding: 'Forward email into the timeline',
  first_document: 'Upload a document',
  first_ask: 'Ask the agent a question',
  first_meeting: 'Invite the agent to a call',
  review_proposal: 'Review a proposal',
  daily_digest: 'Set up daily digests',
  first_integration: 'Connect a source, webhook, or MCP',
};

const patchSchema = z.object({
  action: z.enum(['dismiss', 'reopen', 'complete']),
  key: z.enum(onboarding.ONBOARDING_STEPS).optional(),
});

export async function GET(): Promise<Response> {
  const session = await auth();
  if (!session?.user) return Response.json({ error: 'unauthenticated' }, { status: 401 });
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) return Response.json({ error: 'no_active_team' }, { status: 400 });
  const scope = withTeam(db, active.teamId, session.user.id);
  await scope.requireMembership();

  const key = cacheKey(['onboarding', active.teamId, session.user.id]);
  const state = await cachedJson(key, 30, async () => {
    const checklist = await scope.onboarding.getChecklistState();
    return {
      dismissed: checklist.dismissed,
      items: checklist.steps.map((step) => ({
        key: step.step,
        label: LABELS[step.step],
        completed: step.completed,
      })),
    };
  });

  return Response.json(state);
}

export async function PATCH(req: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user) return Response.json({ error: 'unauthenticated' }, { status: 401 });
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) return Response.json({ error: 'no_active_team' }, { status: 400 });
  const scope = withTeam(db, active.teamId, session.user.id);
  await scope.requireMembership();
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'invalid_input' }, { status: 400 });

  if (parsed.data.action === 'dismiss') {
    await scope.onboarding.dismissChecklist();
  } else if (parsed.data.action === 'reopen') {
    await scope.onboarding.reopenChecklist();
  } else if (parsed.data.key) {
    const completedStep = await scope.onboarding.markStepComplete(parsed.data.key);
    if (completedStep) {
      trackProductEventBestEffort(session.user.id, 'onboarding_step_completed', {
        teamId: active.teamId,
        userId: session.user.id,
        step: parsed.data.key,
        source: 'manual',
      });
    }
  } else {
    return Response.json({ error: 'invalid_input' }, { status: 400 });
  }

  await deleteCacheKey(cacheKey(['onboarding', active.teamId, session.user.id]));
  return GET();
}

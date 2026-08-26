import { deleteCacheKey } from '@timeline/shared/cache';
import * as onboarding from '@timeline/shared/onboarding';
import { withTeam } from '@timeline/shared/team-scope';
import { z } from 'zod';

import { resolveActiveTeam } from '@/lib/active-team';
import { trackProductEventBestEffort } from '@/lib/analytics';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import {
  loadOnboardingChecklistView,
  onboardingChecklistCacheKey,
} from '@/lib/onboarding-checklist';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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

  const state = await loadOnboardingChecklistView({
    teamId: active.teamId,
    userId: session.user.id,
    getChecklistState: () => scope.onboarding.getChecklistState(),
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
      trackProductEventBestEffort(
        { kind: 'user', userId: session.user.id, teamId: active.teamId },
        'onboarding_step_completed',
        {
          step: parsed.data.key,
          source: 'manual',
        },
      );
    }
  } else {
    return Response.json({ error: 'invalid_input' }, { status: 400 });
  }

  await deleteCacheKey(onboardingChecklistCacheKey(active.teamId, session.user.id));
  return GET();
}
